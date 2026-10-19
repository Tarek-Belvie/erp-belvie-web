// Version en ligne (Vercel) : sauvegardes de la nuit lues dans R2, nettoyage des téléversements,
// point d'entrée serverless.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("http");
const sauvegardesR2 = require("../../src/lib/sauvegardesR2");
const { nettoyer } = require("../../scripts/nettoyer-televersements");

function fauxS3(objets) {
  const supprimes = [];
  return {
    supprimes,
    async send(cmd) {
      const n = cmd.constructor.name; const i = cmd.input;
      if (n === "ListObjectsV2Command") {
        return { Contents: [...objets.entries()].filter(([k]) => k.startsWith(i.Prefix)).map(([Key, o]) => ({ Key, Size: o.contenu.length, LastModified: o.date })), IsTruncated: false };
      }
      if (n === "GetObjectCommand") {
        const o = objets.get(i.Key);
        if (!o) { const e = new Error("absent"); e.name = "NoSuchKey"; throw e; }
        return { Body: { transformToByteArray: async () => o.contenu }, Metadata: o.meta || {} };
      }
      if (n === "DeleteObjectCommand") { supprimes.push(i.Key); objets.delete(i.Key); return {}; }
      throw new Error("commande inattendue " + n);
    },
  };
}
const dump = Buffer.concat([Buffer.from("PGDMP"), crypto.randomBytes(200)]);
const sha = crypto.createHash("sha256").update(dump).digest("hex");

test("sauvegardes en ligne : liste triée, fichiers étrangers ignorés", async () => {
  Object.assign(process.env, { R2_BUCKET: "belvie-backup", R2_PREFIXE: "base/" });
  sauvegardesR2._definirClient(fauxS3(new Map([
    ["base/belvie-2026-10-17-0000.dump", { contenu: dump, date: new Date("2026-10-16T22:00:00Z") }],
    ["base/belvie-2026-10-18-0000.dump", { contenu: dump, date: new Date("2026-10-17T22:00:00Z") }],
    ["base/notes-perso.txt", { contenu: Buffer.from("x"), date: new Date() }],
    ["fichiers/images/a.jpg", { contenu: Buffer.from("x"), date: new Date() }],
  ])));
  const liste = await sauvegardesR2.lister();
  assert.deepEqual(liste.map((s) => s.nom), ["belvie-2026-10-18-0000.dump", "belvie-2026-10-17-0000.dump"]);
  assert.equal(liste[0].taille, dump.length);
});

test("sauvegardes en ligne : vérification complète (signature, empreinte)", async () => {
  sauvegardesR2._definirClient(fauxS3(new Map([
    ["base/belvie-2026-10-18-0000.dump", { contenu: dump, date: new Date(), meta: { sha256: sha } }],
    ["base/belvie-2026-10-17-0000.dump", { contenu: dump, date: new Date(), meta: { sha256: "0".repeat(64) } }],
  ])));
  assert.equal((await sauvegardesR2.verifier("belvie-2026-10-18-0000.dump")).rapport.ok, true);
  const abimee = await sauvegardesR2.verifier("belvie-2026-10-17-0000.dump");
  assert.equal(abimee.rapport.ok, false);
  assert.ok(abimee.rapport.controles.some((c) => !c.ok && /SHA-256/.test(c.libelle)));
  assert.equal((await sauvegardesR2.verifier("belvie-2026-10-01-0000.dump")).rapport.ok, false, "absente → jamais « réussie »");
});

test("sauvegardes en ligne : un nom hors format est refusé (pas d'accès à d'autres objets)", async () => {
  for (const nom of ["../fichiers/images/a.jpg", "notes-perso.txt", "belvie-2026-10-18-0000.dump/../x"]) {
    await assert.rejects(sauvegardesR2.lienTelechargement(nom), /introuvable/);
  }
});

test("sauvegardes en ligne : lien de téléchargement signé et limité dans le temps", async () => {
  Object.assign(process.env, { R2_ENDPOINT: "https://compte.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "id-test", R2_SECRET_ACCESS_KEY: "secret-test" });
  sauvegardesR2._definirClient(null); // vrai client S3, rien n'est envoyé : la signature est locale
  const { url } = await sauvegardesR2.lienTelechargement("belvie-2026-10-18-0000.dump");
  const u = new URL(url);
  assert.match(u.hostname + u.pathname, /belvie-backup.*\/base\/belvie-2026-10-18-0000\.dump$/);
  assert.equal(u.searchParams.get("X-Amz-Expires"), "300");
  assert.match(u.searchParams.get("response-content-disposition"), /attachment/);
});

test("téléversements abandonnés : seuls ceux de plus de 24 h, et seulement dans leur dossier", async () => {
  const vieux = new Date(Date.now() - 48 * 3600 * 1000);
  const objets = new Map([
    ["fichiers/televersements/0b6a8f5e-1111-4222-8333-444455556666.jpg", { contenu: Buffer.from("a"), date: vieux }],
    ["fichiers/televersements/9c1d2e3f-1111-4222-8333-444455556666.png", { contenu: Buffer.from("b"), date: new Date() }],
    ["fichiers/televersements/LISEZMOI.txt", { contenu: Buffer.from("c"), date: vieux }],
    ["fichiers/images/commandes/0b6a8f5e-1111-4222-8333-444455556666.jpg", { contenu: Buffer.from("d"), date: vieux }],
  ]);
  const s3 = fauxS3(objets);
  const r = await nettoyer({ s3, bucket: "b", prefixe: "fichiers/", journal: () => {} });
  assert.deepEqual(s3.supprimes, ["fichiers/televersements/0b6a8f5e-1111-4222-8333-444455556666.jpg"]);
  assert.equal(r.supprimes, 1);
  assert.ok(objets.has("fichiers/images/commandes/0b6a8f5e-1111-4222-8333-444455556666.jpg"), "les images ne sont jamais touchées");
});

test("point d'entrée Vercel : répond via Express, et proprement si la base est injoignable", async () => {
  const appel = async (handler, chemin) => {
    const serveur = http.createServer(handler);
    await new Promise((ok) => serveur.listen(0, ok));
    try {
      const r = await fetch(`http://localhost:${serveur.address().port}${chemin}`);
      return { statut: r.status, corps: await r.json() };
    } finally { serveur.close(); }
  };
  const urlTest = process.env.DATABASE_URL;
  delete require.cache[require.resolve("../../../../api/index.js")];
  const handler = require("../../../../api/index.js");
  assert.deepEqual(await appel(handler, "/api/sante"), { statut: 200, corps: { resultat: { statut: "ok" } } });
  assert.equal((await appel(handler, "/api/commandes/list")).statut, 401, "session exigée");

  process.env.DATABASE_URL = "postgres://personne:faux@127.0.0.1:1/aucune";
  delete require.cache[require.resolve("../../../../api/index.js")];
  const enPanne = require("../../../../api/index.js");
  const r = await appel(enPanne, "/api/sante");
  process.env.DATABASE_URL = urlTest;
  assert.equal(r.statut, 503);
  assert.match(r.corps.erreur, /indisponible/);
});

test("Vercel sans STOCKAGE=r2 : refus net plutôt que des fichiers perdus", () => {
  const { stockage, _definirStockage } = require("../../src/lib/stockage");
  const avant = { VERCEL: process.env.VERCEL, STOCKAGE: process.env.STOCKAGE };
  try {
    _definirStockage(null); process.env.VERCEL = "1"; delete process.env.STOCKAGE;
    assert.throws(() => stockage(), /STOCKAGE=r2 est obligatoire/);
  } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _definirStockage(null);
  }
});

test("copies temporaires des téléversements : supprimées, et jamais en dehors de leur dossier", () => {
  const fs = require("fs"); const os = require("os"); const path = require("path");
  const { libererCopieLocale } = require("../../src/lib/plateforme");
  const dossier = path.join(os.tmpdir(), "belvie-televersements");
  fs.mkdirSync(dossier, { recursive: true });
  const copie = path.join(dossier, "0b6a8f5e-1111-4222-8333-444455556666.jpg");
  fs.writeFileSync(copie, "x");
  const ailleurs = path.join(os.tmpdir(), `belvie-test-${process.pid}.jpg`);
  fs.writeFileSync(ailleurs, "x");
  libererCopieLocale(copie); libererCopieLocale(ailleurs); libererCopieLocale(null);
  assert.equal(fs.existsSync(copie), false);
  assert.equal(fs.existsSync(ailleurs), true, "un fichier hors du dossier temporaire n'est jamais supprimé");
  fs.unlinkSync(ailleurs);
});

test("/media en mode R2 : redirection vers un lien signé (l'image ne passe pas par la fonction)", async () => {
  const express = require("express");
  const { routeMedias } = require("../../src/routes/speciales");
  const { _definirStockage } = require("../../src/lib/stockage");
  _definirStockage({ mode: "r2", lienSigne: async (rel, s) => `https://belvie-backup.compte.r2.cloudflarestorage.com/fichiers/${rel}?X-Amz-Expires=${s}` });
  const app = express(); app.use("/media", routeMedias());
  const serveur = app.listen(0);
  try {
    const port = serveur.address().port;
    const r = await fetch(`http://localhost:${port}/media/images/commandes/a.jpg`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location"), /r2\.cloudflarestorage\.com\/fichiers\/images\/commandes\/a\.jpg\?X-Amz-Expires=3600$/);
    assert.equal((await fetch(`http://localhost:${port}/media/televersements/a.jpg`, { redirect: "manual" })).status, 404, "seul images/ est servi");
    assert.equal((await fetch(`http://localhost:${port}/media/images/..%2F..%2Fx`, { redirect: "manual" })).status, 400);
  } finally { serveur.close(); _definirStockage(null); }
});

test("PDF : une grande photo est réduite avant d'être intégrée", async () => {
  const sharp = require("sharp");
  const { _definirStockage } = require("../../src/lib/stockage");
  const grande = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(grande.length > 1024 * 1024);
  _definirStockage({ mode: "test", lire: async () => grande });
  try {
    const { integrerMedias: _integrerMedias } = require("../../src/lib/fenetreImpression");
    const html = await _integrerMedias('<img src="belvie-media://local/images/commandes/a.jpg">');
    const base64 = /data:image\/jpeg;base64,([^"]+)/.exec(html)[1];
    const meta = await sharp(Buffer.from(base64, "base64")).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 1600);
    assert.ok(base64.length < grande.length / 2);
  } finally { _definirStockage(null); }
});
