// Calcul des besoins en matières et fournitures pour une production.
//
// Fonction PURE, sans aucune dépendance : ni base de données, ni Electron, ni réseau. Elle reçoit
// la production et les composants déjà normalisés, et rend des lignes de besoin. C'est ce qui
// permet de la vérifier seule, sur des cas tordus, sans monter une base — et c'est aussi ce qui
// rend la simulation possible : simuler, ici, c'est simplement appeler la même fonction avec
// d'autres quantités de production. Rien n'est écrit nulle part.
//
// ------------------------------------------------------------------------------------------
// Les trois règles de consommation, par ordre de priorité
// ------------------------------------------------------------------------------------------
// 1. COULEUR  : une consommation propre à une couleur produit, renseignée exceptionnellement
//               (un imprimé à raccorder consomme davantage que l'uni). Elle l'emporte sur tout.
// 2. TAILLE   : la grille de consommations par taille, quand le composant est en mode par_taille.
// 3. FIXE     : la consommation unique du composant.
//
// La règle réellement appliquée est reportée sur chaque ligne de résultat. Ce n'est pas un détail
// de confort : sans elle, un écart de besoin serait impossible à expliquer à l'atelier.
//
// ------------------------------------------------------------------------------------------
// Ce que le calcul ne fait PAS
// ------------------------------------------------------------------------------------------
// - Il ne déduit aucun stock : il n'existe pas de module Stock à ce jour, et inventer un solde
//   serait pire que de l'ignorer.
// - Il ne considère jamais une matière commandée comme reçue. Les deux quantités sont portées
//   séparément sur chaque ligne, et seule la quantité COMMANDÉE ET AFFECTÉE réduit le reste à
//   commander — ce qui est déjà engagé n'a pas à l'être deux fois, mais n'est pas pour autant
//   arrivé à l'atelier.
// - Il n'additionne jamais deux unités différentes : l'unité fait partie de la clé de
//   regroupement, et un composant qui en changerait produirait deux lignes distinctes.

const REGLE_COULEUR = "couleur";
const REGLE_TAILLE = "taille";
const REGLE_FIXE = "fixe";

// Codes d'anomalie. Volontairement explicites : ils sont affichés tels quels à l'utilisateur,
// et c'est par eux qu'une fiche technique incomplète se fait remarquer AVANT de coûter cher.
const ANOMALIES = {
  CONSOMMATION_ABSENTE: "consommation_absente",
  // Une valeur EXISTE mais elle est inutilisable (négative, nulle, non numérique). Distinguée de
  // l'absence : « rien n'est saisi » et « ce qui est saisi est faux » ne se corrigent pas de la
  // même façon, et surtout une valeur fausse donne l'illusion d'une fiche remplie.
  CONSOMMATION_INVALIDE: "consommation_invalide",
  CONSOMMATION_TAILLE_ABSENTE: "consommation_taille_absente",
  CORRESPONDANCE_COULEUR_ABSENTE: "correspondance_couleur_absente",
  // La correspondance de couleur est déclarée, mais le coloris exact n'a pas été choisi. Le
  // schéma l'autorise volontairement pendant la mise au point de la fiche. Ce qu'il ne faut pas,
  // c'est ACHETER dans cet état : on ne saurait pas quelle couleur commander.
  COLORIS_NON_CHOISI: "coloris_non_choisi",
  CATALOGUE_NON_RELIE: "catalogue_non_relie",
  UNITE_ABSENTE: "unite_absente",
  PERTE_INVALIDE: "perte_invalide",
  PRODUCTION_VIDE: "production_vide",
  AUCUN_COMPOSANT: "aucun_composant",
};

const LIBELLES_ANOMALIES = {
  consommation_absente: "Consommation non renseignée dans la fiche technique",
  consommation_invalide: "Consommation saisie mais inutilisable (négative, nulle ou non numérique)",
  consommation_taille_absente: "Consommation manquante pour une ou plusieurs tailles",
  correspondance_couleur_absente: "Aucune correspondance de coloris pour une couleur produit",
  coloris_non_choisi: "Coloris de la matière non choisi pour une couleur produit",
  catalogue_non_relie: "Composant non relié au catalogue : impossible à rattacher à un achat",
  unite_absente: "Unité non renseignée",
  perte_invalide: "Pourcentage de perte négatif : ignoré, la perte est comptée à zéro",
  production_vide: "Aucune quantité de production",
  aucun_composant: "La fiche technique ne contient ni matière ni fourniture",
};

function arrondir(valeur, decimales) {
  const facteur = Math.pow(10, decimales == null ? 3 : decimales);
  return Math.round((Number(valeur) + Number.EPSILON) * facteur) / facteur;
}

function estNombrePositif(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * La valeur a-t-elle été SAISIE ? Distinct de « est-elle utilisable ».
 *
 * Sans cette distinction, une consommation de -4 était traitée exactement comme une case vide :
 * le moteur se rabattait en silence sur la consommation moyenne et sortait un chiffre faux mais
 * plausible. Un chiffre faux non signalé est pire qu'une anomalie.
 */
function estRenseigne(v) {
  return v != null && v !== "" && !(typeof v === "number" && Number.isNaN(v));
}

/** Renvoie le code d'anomalie qui convient à une valeur saisie mais inutilisable, sinon null. */
function anomalieSiInvalide(v) {
  return estRenseigne(v) && !estNombrePositif(Number(v)) ? ANOMALIES.CONSOMMATION_INVALIDE : null;
}

/**
 * Détermine vers quel coloris de composant pointe une couleur de produit fini.
 *
 * Trois cas, et chacun a un sens métier distinct :
 *  - le composant n'a AUCUNE correspondance déclarée : il est le même quelle que soit la couleur
 *    du vêtement (fil, étiquette de composition). Toutes les couleurs se cumulent sur une ligne.
 *  - la correspondance existe pour cette couleur : on l'utilise.
 *  - le composant a des correspondances mais pas pour CETTE couleur : c'est une anomalie, pas un
 *    cas « sans couleur ». On ne sait pas quoi commander, et il faut le dire.
 */
function resoudreCible(composant, couleurId, couleurNom) {
  const correspondances = composant.couleurs || {};
  const aDesCorrespondances = Object.keys(correspondances).length > 0;

  if (!aDesCorrespondances) {
    return { cle: "*", libelle: "Toutes couleurs", reference: composant.reference || null, consommation: null };
  }

  const trouvee = correspondances[couleurId];
  if (trouvee) {
    // Correspondance déclarée mais coloris non arrêté. La clé est propre à CETTE couleur produit,
    // donc le libellé doit la nommer : sans cela, deux couleurs en attente de choix produisaient
    // deux lignes au libellé rigoureusement identique, impossibles à distinguer à l'écran.
    const nonChoisi = trouvee.coloris_choisi === false;
    const nom = couleurNom || "couleur " + couleurId;
    return {
      cle: trouvee.cle != null ? String(trouvee.cle) : "c" + couleurId,
      libelle: nonChoisi ? "Coloris à choisir (" + nom + ")" : (trouvee.libelle || "—"),
      reference: trouvee.reference || composant.reference || null,
      consommation: estNombrePositif(trouvee.consommation) ? trouvee.consommation : null,
      consommation_saisie: trouvee.consommation,
      coloris_non_choisi: nonChoisi,
    };
  }

  return {
    cle: "?" + couleurId,
    libelle: "À définir (" + (couleurNom || "couleur " + couleurId) + ")",
    reference: composant.reference || null,
    consommation: null,
    manquante: true,
  };
}

/**
 * Applique les trois règles, dans l'ordre, et dit laquelle a servi.
 *
 * Règle commune aux trois : une valeur SAISIE mais inutilisable arrête net le calcul de cette
 * ligne et produit `consommation_invalide`. Elle ne laisse jamais la règle suivante prendre le
 * relais. Se rabattre sur la moyenne parce que la valeur de la couleur est négative donnerait un
 * besoin crédible et faux — exactement ce que faisait la version précédente, en silence.
 */
function resoudreConsommation(composant, cible, tailleId) {
  if (cible && estNombrePositif(cible.consommation)) {
    return { valeur: cible.consommation, regle: REGLE_COULEUR };
  }
  const invalideCouleur = cible ? anomalieSiInvalide(cible.consommation_saisie) : null;
  if (invalideCouleur) return { valeur: null, regle: REGLE_COULEUR, anomalie: invalideCouleur };

  if (composant.mode_consommation === "par_taille") {
    const parTaille = composant.consommations_taille || {};
    const valeur = parTaille[tailleId];
    if (estNombrePositif(valeur)) return { valeur, regle: REGLE_TAILLE };
    const invalideTaille = anomalieSiInvalide(valeur);
    if (invalideTaille) return { valeur: null, regle: REGLE_TAILLE, anomalie: invalideTaille };
    // Mode par taille, mais cette taille n'a pas de valeur : on ne se rabat PAS en silence sur
    // la consommation moyenne, qui donnerait un besoin faux sans que personne ne le voie.
    return { valeur: null, regle: REGLE_TAILLE, anomalie: ANOMALIES.CONSOMMATION_TAILLE_ABSENTE };
  }

  if (estNombrePositif(composant.consommation_base)) {
    return { valeur: composant.consommation_base, regle: REGLE_FIXE };
  }
  const invalideBase = anomalieSiInvalide(composant.consommation_base);
  if (invalideBase) return { valeur: null, regle: REGLE_FIXE, anomalie: invalideBase };
  return { valeur: null, regle: REGLE_FIXE, anomalie: ANOMALIES.CONSOMMATION_ABSENTE };
}

/**
 * Calcule les besoins.
 *
 * @param {object} entree
 * @param {Array}  entree.production   lignes { couleur_id, couleur_nom, taille_id, taille_nom, quantite }
 * @param {Array}  entree.composants   composants normalisés (voir besoins.js)
 * @param {Array}  entree.engagements  { composant_cle, cible_cle, quantite_affectee, quantite_recue }
 * @param {Array}  entree.preparations { composant_cle, cible_cle, quantite } — quantités déjà
 *        posées sur des bons de commande EN BROUILLON. Comptées à part, jamais fondues dans le
 *        « commandé » : un brouillon n'engage rien. Omises, elles valent zéro et rien ne change.
 * @returns {{ lignes: Array, anomalies: Array, totaux: object }}
 */
function calculerBesoins(entree) {
  const production = (entree && entree.production) || [];
  const composants = (entree && entree.composants) || [];
  const engagements = (entree && entree.engagements) || [];
  const preparations = (entree && entree.preparations) || [];

  const anomaliesGlobales = [];
  if (production.length === 0 || production.every((l) => !(Number(l.quantite) > 0))) {
    anomaliesGlobales.push(ANOMALIES.PRODUCTION_VIDE);
  }
  if (composants.length === 0) {
    anomaliesGlobales.push(ANOMALIES.AUCUN_COMPOSANT);
  }

  // Clé de regroupement : composant + coloris cible + unité. L'unité en fait partie pour qu'il
  // soit IMPOSSIBLE d'additionner des mètres et des kilogrammes par inadvertance.
  const parLigne = new Map();

  composants.forEach((composant) => {
    const unite = composant.unite || null;

    production.forEach((ligneProd) => {
      const quantite = Number(ligneProd.quantite);
      if (!Number.isFinite(quantite) || quantite <= 0) return;

      const cible = resoudreCible(composant, ligneProd.couleur_id, ligneProd.couleur_nom);
      const conso = resoudreConsommation(composant, cible, ligneProd.taille_id);

      const cle = composant.cle + "|" + cible.cle + "|" + (unite || "?");
      let ligne = parLigne.get(cle);
      if (!ligne) {
        ligne = {
          cle,
          composant_cle: composant.cle,
          composant_nom: composant.nom,
          type: composant.type,
          catalogue_id: composant.catalogue_id != null ? composant.catalogue_id : null,
          cible_cle: cible.cle,
          cible_libelle: cible.libelle,
          reference: cible.reference,
          unite,
          // Une perte négative est ramenée à zéro, jamais appliquée : elle diminuerait le besoin,
          // donc ferait sous-commander. L'anomalie PERTE_INVALIDE, posée plus bas, le dit.
          perte_pourcent: Math.max(0, Number(composant.perte_pourcent) || 0),
          regles: new Set(),
          quantite_production: 0,
          besoin_brut: 0,
          couleurs_produit: new Set(),
          anomalies: new Set(),
          // Part de la production pour laquelle AUCUNE consommation n'a pu être retenue. Sans
          // elle, un besoin partiel s'affichait dans la même colonne qu'un besoin complet : le
          // chiffre était juste pour ce qu'il couvrait, et trompeur pour tout le reste.
          quantite_non_couverte: 0,
          couleurs_non_couvertes: new Set(),
          tailles_non_couvertes: new Set(),
        };
        if (cible.manquante) ligne.anomalies.add(ANOMALIES.CORRESPONDANCE_COULEUR_ABSENTE);
        if (cible.coloris_non_choisi) ligne.anomalies.add(ANOMALIES.COLORIS_NON_CHOISI);
        if (composant.catalogue_id == null) ligne.anomalies.add(ANOMALIES.CATALOGUE_NON_RELIE);
        if (!unite) ligne.anomalies.add(ANOMALIES.UNITE_ABSENTE);
        // Une perte négative diminuerait le besoin : on la signale et on la compte à zéro, plutôt
        // que de l'appliquer ou de masquer la ligne.
        if (Number(composant.perte_pourcent) < 0) ligne.anomalies.add(ANOMALIES.PERTE_INVALIDE);
        parLigne.set(cle, ligne);
      }

      ligne.quantite_production += quantite;
      if (ligneProd.couleur_nom) ligne.couleurs_produit.add(ligneProd.couleur_nom);
      ligne.regles.add(conso.regle);
      if (conso.anomalie) ligne.anomalies.add(conso.anomalie);
      if (conso.valeur != null) {
        ligne.besoin_brut += conso.valeur * quantite;
      } else {
        // Aucune consommation retenue pour cette couleur et cette taille : ces pièces ne sont
        // comptées nulle part. On note combien, et lesquelles — jamais zéro en silence.
        ligne.quantite_non_couverte += quantite;
        if (ligneProd.couleur_nom) ligne.couleurs_non_couvertes.add(ligneProd.couleur_nom);
        if (ligneProd.taille_nom) ligne.tailles_non_couvertes.add(ligneProd.taille_nom);
      }
    });
  });

  // Engagements déjà pris : ce qui est commandé ET affecté à cette production n'a pas à être
  // commandé une seconde fois. La quantité reçue est reportée à part, pour qu'on ne confonde
  // jamais « commandé » et « arrivé ».
  const parEngagement = new Map();
  engagements.forEach((e) => {
    const cle = String(e.composant_cle) + "|" + String(e.cible_cle);
    const cumul = parEngagement.get(cle) || { affecte: 0, recu: 0 };
    cumul.affecte += Number(e.quantite_affectee) || 0;
    cumul.recu += Number(e.quantite_recue) || 0;
    parEngagement.set(cle, cumul);
  });

  const parPreparation = new Map();
  preparations.forEach((p) => {
    const cle = String(p.composant_cle) + "|" + String(p.cible_cle);
    parPreparation.set(cle, (parPreparation.get(cle) || 0) + (Number(p.quantite) || 0));
  });

  const lignes = Array.from(parLigne.values()).map((l) => {
    const besoinBrut = arrondir(l.besoin_brut);
    // Les CINQ quantités, chacune distincte et aucune déduite d'une autre par raccourci :
    //
    //   nécessaire        = besoin brut majoré des pertes
    //   commandée         = ce qui est engagé chez un fournisseur ET affecté à cette production
    //   reçue             = ce qui est physiquement arrivé sur cette part commandée
    //   restant à recevoir = commandée − reçue
    //   restant à commander = nécessaire − commandée
    //
    // Point capital, et c'est le piège qu'il faut nommer : c'est la quantité COMMANDÉE qui
    // réduit le reste à commander, jamais la quantité REÇUE. Une matière reçue a déjà été
    // commandée ; la décompter une seconde fois reviendrait à la soustraire deux fois.
    //
    // Et en sens inverse : faute de module Stock, une quantité reçue n'est JAMAIS considérée
    // comme encore disponible. Elle a été achetée pour cette production, on suppose qu'elle y
    // passe. Supposer le contraire ferait sous-commander sur la foi d'un stock imaginaire.
    const quantiteNecessaire = arrondir(besoinBrut * (1 + l.perte_pourcent / 100));
    const engagement = parEngagement.get(l.composant_cle + "|" + l.cible_cle) || { affecte: 0, recu: 0 };
    const quantiteCommandee = arrondir(engagement.affecte);
    // Une réception ne peut pas dépasser ce qui a été commandé dans ce décompte : au-delà, le
    // surplus relève d'un écart de livraison, pas d'un reste à recevoir négatif.
    const quantiteRecue = arrondir(Math.min(engagement.recu, engagement.affecte));
    const resteARecevoir = arrondir(Math.max(0, quantiteCommandee - quantiteRecue));
    const resteACommander = arrondir(Math.max(0, quantiteNecessaire - quantiteCommandee));
    const enPreparation = arrondir(parPreparation.get(l.composant_cle + "|" + l.cible_cle) || 0);

    return {
      composant_cle: l.composant_cle,
      composant_nom: l.composant_nom,
      type: l.type,
      catalogue_id: l.catalogue_id,
      cible_cle: l.cible_cle,
      cible_libelle: l.cible_libelle,
      reference: l.reference,
      unite: l.unite,
      // Une ligne peut mêler plusieurs règles quand elle agrège plusieurs tailles ou couleurs :
      // on les expose toutes plutôt que d'en élire une arbitrairement.
      regles: Array.from(l.regles).sort(),
      couleurs_produit: Array.from(l.couleurs_produit).sort(),
      quantite_production: l.quantite_production,
      besoin_brut: besoinBrut,
      perte_pourcent: l.perte_pourcent,
      quantite_necessaire: quantiteNecessaire,
      quantite_commandee: quantiteCommandee,
      quantite_recue: quantiteRecue,
      reste_a_recevoir: resteARecevoir,
      reste_a_commander: resteACommander,
      // Reçu au-delà du commandé : ce n'est pas une erreur de calcul, c'est une livraison
      // excédentaire. Signalée plutôt que silencieusement rabotée.
      recu_excedentaire: arrondir(Math.max(0, engagement.recu - engagement.affecte)),
      // --- Bons en préparation -------------------------------------------------------------
      // Deux quantités de plus, et AUCUNE des cinq précédentes n'est redéfinie. « Reste à
      // commander » garde son sens exact — nécessaire moins commandé — et « reste à préparer »
      // dit ce qu'il reste à poser sur un bon, une fois les brouillons déduits. Les confondre
      // ferait disparaître un brouillon oublié des écrans.
      quantite_en_preparation: enPreparation,
      reste_a_preparer: arrondir(Math.max(0, resteACommander - enPreparation)),
      anomalies: Array.from(l.anomalies).sort(),
      // --- Calcul incomplet ---------------------------------------------------------------
      // `calcul_incomplet` dit que les quantités ci-dessus ne couvrent PAS toute la production.
      // Elles restent affichées — elles sont justes pour ce qu'elles couvrent — mais ne doivent
      // jamais être lues comme un total définitif. `calcul_impossible` est le cas extrême : rien
      // n'a pu être calculé, et un « 0 » se lirait alors comme « rien à acheter ».
      quantite_production_non_couverte: l.quantite_non_couverte,
      calcul_incomplet: l.quantite_non_couverte > 0,
      calcul_impossible: l.quantite_non_couverte > 0 && l.quantite_non_couverte >= l.quantite_production,
      couleurs_non_couvertes: Array.from(l.couleurs_non_couvertes).sort(),
      tailles_non_couvertes: Array.from(l.tailles_non_couvertes).sort(),
    };
  });

  // Tri de lecture : les matières d'abord, puis les fournitures, et à l'intérieur par nom de
  // composant puis par coloris — c'est l'ordre dans lequel on prépare une commande fournisseur.
  lignes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "matiere" ? -1 : 1;
    const parNom = String(a.composant_nom).localeCompare(String(b.composant_nom), "fr");
    if (parNom !== 0) return parNom;
    return String(a.cible_libelle).localeCompare(String(b.cible_libelle), "fr");
  });

  const lignesEnAnomalie = lignes.filter((l) => l.anomalies.length > 0).length;

  return {
    lignes,
    anomalies: anomaliesGlobales,
    totaux: {
      lignes: lignes.length,
      lignes_en_anomalie: lignesEnAnomalie,
      composants: new Set(lignes.map((l) => l.composant_cle)).size,
      quantite_production: production.reduce((s, l) => s + (Number(l.quantite) || 0), 0),
      a_commander: lignes.filter((l) => l.reste_a_commander > 0).length,
      // Ce qu'il reste réellement à poser sur un bon : les brouillons en cours sont déduits.
      a_preparer: lignes.filter((l) => l.reste_a_preparer > 0).length,
      lignes_en_preparation: lignes.filter((l) => l.quantite_en_preparation > 0).length,
      // Combien de lignes ne couvrent pas toute la production. Dès que ce nombre dépasse zéro,
      // aucun total de l'écran ne doit être présenté comme définitif.
      lignes_incompletes: lignes.filter((l) => l.calcul_incomplet).length,
      lignes_impossibles: lignes.filter((l) => l.calcul_impossible).length,
    },
    // Vrai dès qu'une seule ligne est incomplète. C'est ce drapeau que les bons MP consulteront
    // pour refuser une validation, et que l'écran utilise pour ne jamais annoncer un total sûr
    // quand il ne l'est pas.
    calcul_incomplet: lignes.some((l) => l.calcul_incomplet),
  };
}

module.exports = {
  calculerBesoins,
  ANOMALIES,
  LIBELLES_ANOMALIES,
  REGLE_COULEUR,
  REGLE_TAILLE,
  REGLE_FIXE,
};
