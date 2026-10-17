const fs = require("fs");
const path = require("path");

// Sauvegarde de sécurité prise juste avant une migration qui reconstruit une table
// (CREATE/INSERT/DROP/RENAME). Le WAL est d'abord entièrement rapatrié dans le fichier
// principal (checkpoint), pour garantir que la copie du fichier .db est réellement complète.
function backupBeforeMigration(db, dbPath) {
  db.pragma("wal_checkpoint(TRUNCATE)");
  const dir = path.join(path.dirname(dbPath), "backups", "pre-migration");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `belvie-avant-migration-${stamp}.db`);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

// Restaure une sauvegarde de sécurité par-dessus le fichier de base actuel. À appeler
// uniquement après avoir fermé la connexion SQLite en cours (verrouillage de fichier Windows).
function restoreBackup(backupPath, dbPath) {
  fs.copyFileSync(backupPath, dbPath);
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = dbPath + ext;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

module.exports = { backupBeforeMigration, restoreBackup };
