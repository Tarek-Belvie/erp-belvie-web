// Sauvegarde R2 : export réel (pg_dump sur la base locale), stockage S3 et e-mail simulés.
const test = require("node:test");
const assert = require("node:assert/strict");
const r2 = require("../../scripts/sauvegarde-r2");
require("../../src/config").chargerConfiguration();

function fauxS3(clesInitiales = []) {
  const objets = new Map(clesInitiales.map((k) => [k, 10]));
  let echecEnvoi = false;
  return {
    objets, echouerEnvoi() { echecEnvoi = true; },
    async send(cmd) {
      const n = cmd.constructor.name; const i = cmd.input;
      if (n === "PutObjectCommand") {
        if (echecEnvoi) throw new Error("R2 injoignable (simulé)");
        const morceaux = []; for await (const c of i.Body) morceaux.push(c);
        objets.set(i.Key, Buffer.concat(morceaux).length); return {};
      }
      if (n === "HeadObjectCommand") return { ContentLength: objets.get(i.Key) };
      if (n === "ListObjectsV2Command") return { Contents: [...objets.keys()].filter((k) => k.startsWith(i.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      if (n === "DeleteObjectCommand") { objets.delete(i.Key); return {}; }
      throw new Error("commande inattendue " + n);
    },
  };
}
const anciennes = ["2026-10-10-0000", "2026-10-11-0000", "2026-10-12-0000", "2026-10-13-0000", "2026-10-14-0000", "2026-10-15-0000", "2026-10-16-0000"].map((d) => `base/belvie-${d}.dump`);

test("sauvegarde : envoi vérifié, 5 versions conservées, e-mail de réussite", async () => {
  Object.assign(process.env, { R2_BUCKET: "belvie-backup", R2_VERSIONS: "5", MAIL_DESTINATAIRE: "tarek@example.test" });
  const s3 = fauxS3(anciennes);
  const mails = [];
  r2.deps.clientR2 = () => s3;
  r2.deps.transportMail = { sendMail: async (m) => mails.push(m) };
  const r = await r2.sauvegarder();
  assert.equal(r.ok, true);
  assert.ok(r.taille > 1000, "archive non vide");
  assert.equal(s3.objets.size, 5);
  assert.ok(s3.objets.has(r.cle), "la nouvelle sauvegarde est conservée");
  assert.deepEqual([...r.supprimes].sort(), anciennes.slice(0, 3));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /réussie/);
  assert.equal(mails[0].to, "tarek@example.test");
});

test("sauvegarde : en cas d'échec, rien n'est supprimé et un e-mail d'échec part", async () => {
  const s3 = fauxS3(anciennes);
  s3.echouerEnvoi();
  const mails = [];
  r2.deps.clientR2 = () => s3;
  r2.deps.transportMail = { sendMail: async (m) => mails.push(m) };
  await assert.rejects(r2.sauvegarder(), /injoignable/);
  assert.equal(s3.objets.size, anciennes.length, "aucune ancienne version supprimée");
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /ÉCHEC/);
});

test("rotation : un fichier déposé à la main n'est ni compté ni supprimé ; R2_VERSIONS invalide refusé", async () => {
  process.env.R2_VERSIONS = "5";
  const manuel = "base/belvie-avant-reprise.dump";
  const s3 = fauxS3([...anciennes, manuel]);
  r2.deps.clientR2 = () => s3;
  r2.deps.transportMail = { sendMail: async () => {} };
  const r = await r2.sauvegarder();
  assert.ok(s3.objets.has(manuel), "le fichier manuel est conservé");
  assert.equal(r.conserves.length, 5);
  assert.ok(!r.conserves.includes(manuel));
  for (const v of ["0", "cinq", "-2", "1.5"]) {
    process.env.R2_VERSIONS = v;
    const avant = s3.objets.size;
    await assert.rejects(r2.sauvegarder(), /R2_VERSIONS invalide/);
    assert.equal(s3.objets.size, avant, `rien supprimé avec R2_VERSIONS=${v}`);
  }
  process.env.R2_VERSIONS = "5";
});

test("planification : prochaine échéance à minuit, heure de Paris", () => {
  const d = r2.prochaineEcheance("00:00", "Europe/Paris");
  assert.equal(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(d), "00:00");
  assert.ok(d > new Date() && d - new Date() <= 24 * 3600 * 1000 + 3600 * 1000);
});
