// ================================================================================================
// AUTHENTIFICATION — comptes locaux, session par cookie HttpOnly.
//
//   POST /api/auth/connexion    { email, motDePasse }  → pose le cookie, renvoie l'utilisateur
//   POST /api/auth/deconnexion                         → supprime la session
//   GET  /api/auth/moi                                 → utilisateur courant (401 sinon)
//
// Le jeton de session (aléatoire, 32 octets) n'est connu que du navigateur ; la base n'en garde
// que l'empreinte SHA-256. Les comptes se créent en ligne de commande (npm run utilisateur).
// ================================================================================================
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const COOKIE = "belvie_session";
// Empreinte factice : on compare même quand le compte n'existe pas, pour que le temps de réponse
// ne révèle pas quelles adresses ont un compte.
const EMPREINTE_FACTICE = bcrypt.hashSync("mot-de-passe-factice-belvie", 12);
const jetonDe = (req) => { const j = req.cookies && req.cookies[COOKIE]; return typeof j === "string" && j.length <= 200 ? j : null; };
const empreinte = (jeton) => crypto.createHash("sha256").update(jeton).digest("hex");

// Limitation des tentatives : 10 échecs par quart d'heure, comptés séparément par adresse IP
// ET par adresse e-mail (derrière Vercel/Caddy, plusieurs utilisateurs peuvent partager une IP).
const echecs = new Map();
const FENETRE = 15 * 60 * 1000;
function tropDeTentatives(cles) {
  return cles.some((k) => { const e = echecs.get(k); return e && Date.now() - e.debut <= FENETRE && e.n >= 10; });
}
function noterEchec(cles) {
  for (const k of cles) {
    const e = echecs.get(k);
    if (!e || Date.now() - e.debut > FENETRE) echecs.set(k, { n: 1, debut: Date.now() }); else e.n++;
  }
  if (echecs.size > 10000) for (const [k, e] of echecs) if (Date.now() - e.debut > FENETRE) echecs.delete(k);
}

function publicUtilisateur(u) {
  return { id: u.id, email: u.email, nom: u.nom, role: u.role };
}

function creerAuth({ db, config }) {
  const optionsCookie = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecurise,
    path: "/",
    maxAge: config.dureeSessionJours * 24 * 3600 * 1000,
  };

  async function connexion(req, res, next) {
   try {
    const ip = req.ip;
    const { email, motDePasse } = req.body || {};
    const cles = ["ip:" + ip, "email:" + String(email || "").toLowerCase().slice(0, 200)];
    if (tropDeTentatives(cles)) return res.status(429).json({ erreur: "Trop de tentatives. Réessayez dans quelques minutes." });
    const u = typeof email === "string" && email ? await db.prepare("SELECT * FROM utilisateurs WHERE lower(email) = lower(?)").get(email) : undefined;
    const correspond = await bcrypt.compare(String(motDePasse || ""), u ? u.mot_de_passe_hash : EMPREINTE_FACTICE);
    const ok = u && u.actif === 1 && correspond;
    if (!ok) { noterEchec(cles); return res.status(401).json({ erreur: "Adresse e-mail ou mot de passe incorrect." }); }
    const jeton = crypto.randomBytes(32).toString("base64url");
    await db.prepare(
      "INSERT INTO sessions (empreinte, utilisateur_id, expire_le, adresse_ip, navigateur) VALUES (?, ?, now() + (? || ' days')::interval, ?, ?)"
    ).run(empreinte(jeton), u.id, String(config.dureeSessionJours), ip || null, String(req.get("user-agent") || "").slice(0, 300));
    await db.prepare("UPDATE utilisateurs SET derniere_connexion = maintenant() WHERE id = ?").run(u.id);
    for (const k of cles) echecs.delete(k);
    res.cookie(COOKIE, jeton, optionsCookie);
    return res.json({ resultat: publicUtilisateur(u) });
   } catch (err) { next(err); }
  }

  async function deconnexion(req, res, next) {
    try {
      const jeton = jetonDe(req);
      if (jeton) await db.prepare("DELETE FROM sessions WHERE empreinte = ?").run(empreinte(jeton));
      res.clearCookie(COOKIE, { ...optionsCookie, maxAge: undefined });
      res.json({ resultat: true });
    } catch (err) { next(err); }
  }

  // Middleware : exige une session valide. Prolonge la session à l'usage (au plus une fois par heure).
  async function exigerSession(req, res, next) {
    try {
      const jeton = jetonDe(req);
      if (!jeton) return res.status(401).json({ erreur: "Session absente ou expirée. Reconnectez-vous." });
      const s = await db.prepare(
        "SELECT s.empreinte, s.derniere_activite, u.* FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id " +
        "WHERE s.empreinte = ? AND s.expire_le > now() AND u.actif = 1"
      ).get(empreinte(jeton));
      if (!s) return res.status(401).json({ erreur: "Session absente ou expirée. Reconnectez-vous." });
      if (Date.now() - new Date(s.derniere_activite).getTime() > 3600 * 1000) {
        await db.prepare("UPDATE sessions SET derniere_activite = now(), expire_le = now() + (? || ' days')::interval WHERE empreinte = ?")
          .run(String(config.dureeSessionJours), s.empreinte);
      }
      req.utilisateur = publicUtilisateur(s);
      next();
    } catch (err) { next(err); }
  }

  function exigerAdmin(req, res, next) {
    if (!req.utilisateur || req.utilisateur.role !== "admin") return res.status(403).json({ erreur: "Action réservée aux administrateurs." });
    next();
  }

  return { connexion, deconnexion, exigerSession, exigerAdmin, COOKIE };
}

async function creerUtilisateur(db, { email, nom, motDePasse, role = "utilisateur" }) {
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Adresse e-mail invalide.");
  if (!motDePasse || String(motDePasse).length < 10) throw new Error("Le mot de passe doit contenir au moins 10 caractères.");
  const hash = await bcrypt.hash(String(motDePasse), 12);
  const r = await db.prepare("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES (?, ?, ?, ?)").run(email.trim(), nom || email, hash, role);
  return r.lastInsertRowid;
}

module.exports = { creerAuth, creerUtilisateur, publicUtilisateur };
