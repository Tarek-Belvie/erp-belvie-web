const photos = require("./photos");

const CHAMPS_MODIFIABLES = [
  "nom_commercial", "raison_sociale", "matricule_fiscal", "registre_commerce", "identifiant_tva",
  "adresse", "ville", "code_postal", "pays", "telephone", "email", "site_web",
  "banque", "agence_bancaire", "rib", "swift_bic", "taux_tva_defaut",
];

const CLE_ETAT_WIZARD = "entreprise_wizard_etat"; // "never_shown" (défaut) ; "postponed" ; "completed"
const ETAT_PAR_DEFAUT = "never_shown";

async function get(db) {
  return (await db.prepare("SELECT * FROM entreprise WHERE id = 1").get()) || null;
}

async function save(db, payload) {
  const current = await get(db);
  const fields = CHAMPS_MODIFIABLES.filter((f) => payload[f] !== undefined);

  if (!current) {
    const cols = ["id", ...fields];
    const placeholders = cols.map((c) => (c === "id" ? "1" : `@${c}`));
    await db.prepare(`INSERT INTO entreprise (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`).run(payload);
  } else if (fields.length > 0) {
    const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
    await db.prepare(`UPDATE entreprise SET ${setClause} WHERE id = 1`).run(payload);
  }
  return await get(db);
}

async function setLogo(db, sourcePath) {
  const current = await get(db);
  const result = await photos.copyLogoIntoStore(sourcePath);
  const logo_path = result.logo_path;
  const oldLogoPath = current ? current.logo_path : null;

  if (!current) {
    await db.prepare("INSERT INTO entreprise (id, logo_path) VALUES (1, @logo_path)").run({ logo_path: logo_path });
  } else {
    await db.prepare("UPDATE entreprise SET logo_path = @logo_path WHERE id = 1").run({ logo_path: logo_path });
  }
  if (oldLogoPath && oldLogoPath !== logo_path) await photos.removeLogoFile(oldLogoPath);
  return await get(db);
}

async function removeLogo(db) {
  const current = await get(db);
  if (current && current.logo_path) await photos.removeLogoFile(current.logo_path);
  await db.prepare("UPDATE entreprise SET logo_path = NULL WHERE id = 1").run();
  return await get(db);
}

// État de l'assistant, entièrement indépendant du contenu de la table "entreprise" : le
// déclenchement automatique au démarrage ne se base QUE sur cette valeur, jamais sur la
// présence ou l'absence d'une ligne entreprise — pour éviter toute ambiguïté en cas d'import de
// base, de restauration de sauvegarde, ou de création automatique future d'une fiche entreprise.
async function getEtatWizard(db) {
  const row = await db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(CLE_ETAT_WIZARD);
  return row ? row.valeur : ETAT_PAR_DEFAUT;
}

async function setEtatWizard(db, etat) {
  await db.prepare(
    "INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur"
  ).run(CLE_ETAT_WIZARD, etat);
  return etat;
}

module.exports = {
  get: get,
  save: save,
  setLogo: setLogo,
  removeLogo: removeLogo,
  getEtatWizard: getEtatWizard,
  setEtatWizard: setEtatWizard,
};
