const { DatabaseSync } = require("node:sqlite");

const dbPath = process.env.APPDATA + "\\belvie-erp\\belvie.db";
const d = new DatabaseSync(dbPath, { readOnly: true });

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const rows = d.prepare(`
  SELECT
    ft.id,
    ft.fiche_id,
    ft.nom,
    ft.grille_valeur_id,
    f.article_id,
    a.produit_id,
    pgt.grille_id,
    gtv.valeur AS pointe_vers,
    (
      SELECT COUNT(*)
      FROM ft_mesures_valeurs
      WHERE ft_taille_id = ft.id
    ) AS nb_valeurs
  FROM ft_tailles ft
  JOIN fiches_techniques f
    ON f.id = ft.fiche_id
  LEFT JOIN articles a
    ON a.id = f.article_id
  LEFT JOIN produit_grille_taille pgt
    ON pgt.produit_id = a.produit_id
  LEFT JOIN grilles_tailles_valeurs gtv
    ON gtv.id = ft.grille_valeur_id
`).all();

const stat = {
  correct: 0,
  reparable: 0,
  ambigu: 0,
  sans_grille: 0
};

for (const r of rows) {
  if (!r.grille_id) {
    stat.sans_grille++;
    r.cas = "SANS GRILLE";
    continue;
  }

  const correspondances = d.prepare(`
    SELECT id, valeur
    FROM grilles_tailles_valeurs
    WHERE grille_id = ?
  `).all(r.grille_id).filter(
    (v) => norm(v.valeur) === norm(r.nom)
  );

  if (
    correspondances.length === 1 &&
    correspondances[0].id === r.grille_valeur_id
  ) {
    stat.correct++;
    r.cas = "CORRECT";
  } else if (correspondances.length === 1) {
    stat.reparable++;
    r.cas = "REPARABLE -> " + correspondances[0].id;
  } else {
    stat.ambigu++;
    r.cas = "AMBIGU (" + correspondances.length + " corresp.)";
  }
}

console.table(
  rows.map((r) => ({
    id: r.id,
    nom: r.nom,
    pointe_vers: r.pointe_vers,
    valeurs: r.nb_valeurs,
    cas: r.cas
  }))
);

console.log("--- Résumé ---");
console.log(stat);

console.log("--- produit_grille_taille ---");
console.log(
  d.prepare("SELECT COUNT(*) AS n FROM produit_grille_taille").get()
);

console.log("--- produits distincts avec grille ---");
console.log(
  d.prepare(`
    SELECT COUNT(DISTINCT produit_id) AS n
    FROM produit_grille_taille
  `).get()
);

console.log("--- articles ---");
console.log(
  d.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(produit_id) AS avec_produit
    FROM articles
  `).get()
);
console.log("\n--- GRILLES EXISTANTES ---");

const grilles = d.prepare(`
  SELECT
    g.id,
    g.nom,
    g.actif,
    (
      SELECT COUNT(*)
      FROM grilles_tailles_valeurs
      WHERE grille_id = g.id
    ) AS nb_valeurs
  FROM grilles_tailles g
  ORDER BY g.id
`).all();

console.table(grilles);

console.log("\n--- VALEURS PAR GRILLE ---");

for (const g of d.prepare(`
  SELECT id, nom
  FROM grilles_tailles
  ORDER BY id
`).all()) {
  const valeurs = d.prepare(`
    SELECT valeur
    FROM grilles_tailles_valeurs
    WHERE grille_id = ?
    ORDER BY ordre
  `).all(g.id);

  console.log(
    `${g.nom} : ${valeurs.map(v => v.valeur).join(" | ")}`
  );
}

console.log("\n--- PRODUITS AVEC GRILLE ---");

const avecGrille = d.prepare(`
  SELECT
    lv.nom AS produit,
    g.nom AS grille
  FROM produit_grille_taille p
  JOIN listes_valeurs lv
    ON lv.id = p.produit_id
  JOIN grilles_tailles g
    ON g.id = p.grille_id
  ORDER BY lv.nom
`).all();

console.table(avecGrille);

console.log("\n--- PRODUITS ACTIFS SANS GRILLE ---");

const sansGrille = d.prepare(`
  SELECT nom
  FROM listes_valeurs
  WHERE type = 'produit'
    AND actif = 1
    AND id NOT IN (
      SELECT produit_id
      FROM produit_grille_taille
    )
  ORDER BY nom
`).all();

console.table(sansGrille);