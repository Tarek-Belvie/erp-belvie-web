// ============================================================================
// PONT TEMPORAIRE vers le module Paramètres (NON encore validé/migré).
//
// Les modules validés (Commandes en production) ont besoin de deux lectures
// minimales appartenant conceptuellement à Paramètres :
//   1. les informations entreprise nécessaires au snapshot d'un BC PF ;
//   2. l'identifiant de l'opérateur actif, pour l'historique des transitions.
//
// Ce fichier existe UNIQUEMENT pour isoler ces deux besoins, sans copier
// electron/ipc/entreprise.js ni electron/ipc/parametres.js dans leur
// ensemble, et sans migrer le module Paramètres lui-même.
//
// Quand Paramètres sera développé, validé, puis migré au web, ces deux
// fonctions devront être retirées d'ici et reconnectées proprement au
// module Paramètres migré. Ne pas ajouter d'autres fonctions Paramètres
// dans ce fichier — toute nouvelle dépendance de ce type doit être signalée
// avant d'être ajoutée ici.
// ============================================================================

// Lecture seule — informations entreprise nécessaires au snapshot figé d'un
// BC PF au moment de sa création (electron/ipc/bcPf.js::snapshotEntreprise).
// N'inclut PAS le logo (logoSnapshotPath) : nécessiterait photos.js (fichier
// physique), hors périmètre tant que Cloudflare R2 n'est pas configuré —
// toujours null ici, jamais un chemin réel. Reproduit fidèlement le
// SNAPSHOT TEXTE (raison sociale, adresse, RIB...), seule la partie fichier
// est omise.
async function lireInfosEntrepriseSnapshot(adapter) {
  const e = await adapter.get("SELECT * FROM entreprise WHERE id = 1", []);
  if (!e) return { logoSnapshotPath: null, fields: {} };
  return {
    logoSnapshotPath: null, // toujours null ici — voir commentaire ci-dessus (R2 non configuré)
    fields: {
      entreprise_nom_commercial: e.nom_commercial,
      entreprise_raison_sociale: e.raison_sociale,
      entreprise_matricule_fiscal: e.matricule_fiscal,
      entreprise_registre_commerce: e.registre_commerce,
      entreprise_adresse: e.adresse,
      entreprise_telephone: e.telephone,
      entreprise_email: e.email,
      entreprise_banque: e.banque,
      entreprise_agence_bancaire: e.agence_bancaire,
      entreprise_rib: e.rib,
    },
  };
}

// Lecture seule — opérateur actif courant, utilisé pour horodater/attribuer
// les transitions de commande (electron/ipc/commandes.js::getOperateurActif).
async function lireOperateurActifId(adapter) {
  const row = await adapter.get("SELECT valeur FROM parametres WHERE cle = 'operateur_actif_id'", []);
  if (!row || !row.valeur) return null;
  return adapter.get("SELECT * FROM listes_valeurs WHERE id = ? AND type = 'operateur' AND actif = 1", [Number(row.valeur)]);
}

module.exports = {
  lireInfosEntrepriseSnapshot,
  lireOperateurActifId,
};
