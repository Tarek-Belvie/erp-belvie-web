// ================================================================================================
// UNE SEULE INSTANCE À LA FOIS — lot 1
// ================================================================================================
//
// LE PROBLÈME. Depuis que la version de développement et la version installée partagent le même
// dossier de données, elles ouvrent le même fichier SQLite. SQLite sait gérer plusieurs processus
// — ce n'est pas un risque de corruption — mais l'application, elle, ne le sait pas : chaque
// fenêtre garde en mémoire ce qu'elle a lu, et deux fenêtres ouvertes affichent très vite deux
// vérités différentes. Pire, une restauration lancée d'un côté ferme et remplace la base que
// l'autre est en train de lire.
//
// LE MÉCANISME, ET POURQUOI IL N'A PAS LE DÉFAUT QUE JE VOUS AVAIS ANNONCÉ.
//
// Je vous avais prévenu qu'un verrou de fichier laisse un verrou mort derrière lui après une
// coupure de courant, et qu'il faudrait alors une façon de le lever. C'est exact — et c'est
// pourquoi CE N'EST PAS CE FICHIER QUI BLOQUE.
//
//   - Le blocage est assuré par `app.requestSingleInstanceLock()` d'Electron, un verrou tenu par
//     le SYSTÈME. Quand le processus meurt — proprement, brutalement, ou par coupure de courant —
//     Windows le libère tout seul. Il ne peut pas rester coincé.
//
//   - Ce fichier-ci ne sert qu'à EXPLIQUER : qui tient le verrou, depuis quand, en version de
//     développement ou installée. Il ne décide jamais rien. S'il est périmé, le pire qui puisse
//     arriver est un message légèrement inexact — jamais une application qui refuse de s'ouvrir.
//
// C'est la raison pour laquelle le fichier est écrit APRÈS que le verrou système a été obtenu, et
// pourquoi une incohérence entre les deux se tranche toujours en faveur du verrou système.

const fs = require("fs");
const path = require("path");

const NOM_FICHIER = "instance-ouverte.json";

function chemin(dossierDonnees) {
  return path.join(dossierDonnees, NOM_FICHIER);
}

function lire(dossierDonnees) {
  try {
    const brut = fs.readFileSync(chemin(dossierDonnees), "utf-8");
    const info = JSON.parse(brut);
    return info && typeof info === "object" ? info : null;
  } catch (_) {
    return null;
  }
}

/**
 * Le processus existe-t-il encore ? `process.kill(pid, 0)` n'envoie aucun signal : il demande
 * seulement si le processus est joignable. C'est ce qui permet de reconnaître un fichier laissé
 * par une application qui ne tourne plus.
 *
 * Un identifiant de processus peut théoriquement être réattribué à un autre programme. On ne s'y
 * fie donc jamais pour BLOQUER — seulement pour choisir le message à afficher.
 */
function processusVivant(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (n === process.pid) return true;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    // EPERM : le processus existe mais appartient à un autre utilisateur.
    return !!(err && err.code === "EPERM");
  }
}

/**
 * Décrit l'instance qui tient le verrou, pour le message d'erreur.
 * Rend null si personne ne le tient de façon crédible.
 */
function occupantProbable(dossierDonnees) {
  const info = lire(dossierDonnees);
  if (!info) return null;
  if (!processusVivant(info.pid)) return Object.assign({}, info, { processus_vivant: false });
  return Object.assign({}, info, { processus_vivant: true });
}

/**
 * Pose la marque, APRÈS que le verrou système a été obtenu.
 *
 * Si une marque est déjà là, elle est forcément périmée : le verrou système ne nous aurait pas
 * été accordé sinon. On la remplace, et on le signale dans le résultat — c'est une information
 * utile (l'application s'est mal fermée la dernière fois), jamais un blocage.
 */
function poser(dossierDonnees, info) {
  const precedent = lire(dossierDonnees);
  const marque = {
    pid: process.pid,
    mode: (info && info.mode) || "inconnu",
    version: (info && info.version) || null,
    executable: (info && info.executable) || null,
    demarre_le: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(dossierDonnees, { recursive: true });
    fs.writeFileSync(chemin(dossierDonnees), JSON.stringify(marque, null, 2), "utf-8");
  } catch (err) {
    // Ne jamais empêcher l'application de démarrer parce qu'un fichier d'information n'a pas pu
    // être écrit. Le verrou système, lui, a déjà fait son travail.
    return { marque, ecrit: false, erreur: err && err.message, precedent_perime: !!precedent };
  }
  return {
    marque,
    ecrit: true,
    // Vrai quand la fermeture précédente ne s'est pas faite proprement.
    precedent_perime: !!precedent,
    precedent,
  };
}

/** Retire la marque, à la fermeture. Ne retire que la sienne : si un autre processus a repris la
 *  main entre-temps, sa marque ne nous appartient pas. */
function liberer(dossierDonnees) {
  const info = lire(dossierDonnees);
  if (!info || Number(info.pid) !== process.pid) return { libere: false };
  try {
    fs.unlinkSync(chemin(dossierDonnees));
    return { libere: true };
  } catch (_) {
    return { libere: false };
  }
}

/**
 * Le second garde, indépendant du verrou système.
 *
 * POURQUOI DEUX GARDES. Le verrou d'Electron est keyé sur le dossier de données, donc il devrait
 * couvrir à lui seul les deux versions. « Devrait » : je n'ai pas pu le vérifier sur une machine
 * Windows depuis ici, et une protection qui repose sur un « devrait » n'en est pas une. Ce
 * second garde, lui, vit dans le dossier de données partagé : il couvre le cas quoi qu'il arrive.
 *
 * ET POURQUOI IL NE PEUT PAS RESTER COINCÉ. Il ne bloque que si le processus inscrit est
 * RÉELLEMENT VIVANT. Une marque laissée par une application qui a été coupée ne bloque rien :
 * elle est simplement remplacée. C'est la liveness, et non l'existence du fichier, qui décide.
 */
function verifierOccupation(dossierDonnees) {
  const occupant = occupantProbable(dossierDonnees);
  if (!occupant) return { occupe: false, occupant: null };
  if (Number(occupant.pid) === process.pid) return { occupe: false, occupant };
  if (!occupant.processus_vivant) {
    // Marque périmée : la fermeture précédente s'est mal passée. On ne bloque pas.
    return { occupe: false, occupant, marque_perimee: true };
  }
  return { occupe: true, occupant };
}

/** Le texte montré à la seconde instance. Écrit ici pour être éprouvable. */
function messageOccupe(occupant, dossierDonnees) {
  const lignes = ["Belvie ERP est déjà ouvert sur cet ordinateur.", ""];
  if (occupant && occupant.processus_vivant) {
    const quand = occupant.demarre_le
      ? String(occupant.demarre_le).slice(11, 16).replace(":", "h")
      : null;
    lignes.push(
      "L'application en cours est "
      + (occupant.mode === "developpement" ? "la version de développement (npm run dev)"
        : occupant.mode === "installee" ? "la version installée"
        : "une autre instance")
      + (quand ? ", démarrée à " + quand + "." : ".")
    );
    lignes.push("");
    lignes.push("Les deux versions utilisent désormais le même dossier de données. Les ouvrir en");
    lignes.push("même temps afficherait deux vérités différentes, et une sauvegarde lancée d'un");
    lignes.push("côté remplacerait la base que l'autre est en train de lire.");
  } else {
    lignes.push("Une autre fenêtre de l'application est déjà ouverte.");
  }
  lignes.push("");
  lignes.push("Fermez d'abord celle qui est ouverte, puis relancez.");
  lignes.push("Aucune donnée n'a été modifiée.");
  // La sortie de secours, écrite noir sur blanc. Le cas est très improbable — il faudrait que
  // Windows ait réattribué le numéro d'un processus disparu — mais s'il arrive, personne ne doit
  // rester bloqué faute de savoir quoi faire.
  if (dossierDonnees) {
    lignes.push("");
    lignes.push("Si vous êtes certain qu'aucune autre fenêtre n'est ouverte, supprimez ce fichier");
    lignes.push("puis relancez :");
    lignes.push("    " + chemin(dossierDonnees));
  }
  return lignes.join("\n");
}

module.exports = {
  NOM_FICHIER, chemin, lire, processusVivant, occupantProbable,
  verifierOccupation, poser, liberer, messageOccupe,
};
