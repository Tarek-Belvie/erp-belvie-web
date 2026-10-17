# Patches Electron — dette `taille_id`

**À appliquer en un seul changement**, comme demandé : la base réparée ne doit jamais tourner sous une version d'Electron qui joint encore sur `listes_valeurs`.

---

## 0. Découverte préalable : `taille_nom` n'est jamais écrit

`electron/ipc/commandes.js:78` :

```js
"INSERT INTO commande_lignes (commande_id, couleur_id, reference_libre, taille_id, quantite) VALUES (?, ?, ?, ?, ?)"
```

`taille_nom` est absent de l'INSERT, et aucun autre chemin d'écriture ne l'alimente — les occurrences dans `bcPf.js` concernent `bc_pf_lignes.taille_nom`, une autre table. Le filet de sécurité est donc **vide sur les 403 lignes**, y compris les 114 récentes.

Deux conséquences : le patch 4 ci-dessous est nécessaire, sans quoi la dette se reconstitue à chaque commande ; et `taille_nom IS NULL` ne peut pas servir de discriminant, ce qui confirme le recours à un marqueur explicite (ton point 1).

---

## 1. `electron/db/migrate.js` — garde corrigée

### Avant (ligne 1297)

```js
function needsGrillesTaillesMigration(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commande_lignes'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(commande_lignes)").all().map((c) => c.name);
  return !cols.includes("taille_nom");
}
```

### Après

```js
const MARQUEUR_GRILLES_CLE = "migration_grilles_tailles_version";
const MARQUEUR_GRILLES_VALEUR = "2";

// Marqueur explicite, et non inspection des donnees. Deux raisons.
//
// 1. La garde d'origine testait la presence de la colonne taille_nom : creee par
//    schema.sql, elle desarmait la migration avant qu'elle ne travaille.
// 2. Un test du type "taille_id absent de grilles_tailles_valeurs" serait faux sur
//    une base ou un ancien id listes_valeurs collisionne numeriquement avec un id
//    de grille : la ligne paraitrait conforme tout en designant la mauvaise taille.
//    Aucune inspection des donnees ne distingue ce cas ; seul un marqueur le peut.
function needsGrillesTaillesMigration(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commande_lignes'").all();
  if (tables.length === 0) return false;
  const params = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parametres'").all();
  if (params.length === 0) return true; // base tres ancienne : laisser la migration s'executer
  const m = db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(MARQUEUR_GRILLES_CLE);
  return !m || m.valeur !== MARQUEUR_GRILLES_VALEUR;
}
```

Idempotence : le marqueur est posé en fin de migration réussie. Un second passage sort immédiatement. Sur une base neuve créée par `schema.sql`, la migration s'exécute une fois, ne trouve rien à remapper, pose le marqueur et ne se redéclenche jamais.

## 2. `migrate.js` — corps de la migration

`migrateGrillesTailles` doit devenir tolérante à un état partiel, puisqu'elle peut désormais s'exécuter sur une base où `taille_nom` existe déjà :

```js
function migrateGrillesTailles(db) {
  // 1) Colonne de secours, seulement si absente (la garde ne la teste plus).
  const cols = db.prepare("PRAGMA table_info(commande_lignes)").all().map((c) => c.name);
  if (!cols.includes("taille_nom")) db.exec("ALTER TABLE commande_lignes ADD COLUMN taille_nom TEXT");

  // 2) Garde d'ambiguite AVANT toute ecriture. Un id present des deux cotes est
  //    indecidable : mieux vaut echouer que remapper au hasard.
  const ambigus = db.prepare(`
    SELECT COUNT(*) AS n FROM listes_valeurs lv
    JOIN grilles_tailles_valeurs gtv ON gtv.id = lv.id
    WHERE lv.type IN ('taille','pointure')
      AND EXISTS (SELECT 1 FROM commande_lignes cl WHERE cl.taille_id = lv.id)`).get().n;
  if (ambigus > 0) {
    throw new Error(
      "Migration Grilles de tailles : " + ambigus + " identifiant(s) ambigu(s), presents dans " +
      "listes_valeurs ET grilles_tailles_valeurs. Remappage automatique impossible.");
  }

  // 3) Fige les libelles AVANT tout remappage. Priorite a la grille, puis a
  //    l'ancien referentiel RESTREINT aux types taille/pointure — sans cette
  //    restriction, une ligne conforme resoudrait vers un nom de couleur.
  db.exec(`
    UPDATE commande_lignes
    SET taille_nom = COALESCE(
          (SELECT gtv.valeur FROM grilles_tailles_valeurs gtv WHERE gtv.id = commande_lignes.taille_id),
          (SELECT lv.nom FROM listes_valeurs lv
             WHERE lv.id = commande_lignes.taille_id AND lv.type IN ('taille','pointure')))
    WHERE taille_id IS NOT NULL AND taille_nom IS NULL
  `);

  // 4) …création des grilles et remappage — inchangé…

  // 5) Marqueur, en dernier : il n'est pose que si tout ce qui precede a reussi.
  db.prepare("INSERT INTO parametres (cle, valeur) VALUES (?, ?) " +
             "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
    .run(MARQUEUR_GRILLES_CLE, MARQUEUR_GRILLES_VALEUR);
}
```

Le `throw` remonte à `runRebuildMigration`, qui restaure la sauvegarde prise par `migrationSafety.backupBeforeMigration` — le mécanisme de secours existant est réutilisé tel quel.

Ta base ayant déjà été traitée par le script autonome, cette migration y trouvera le marqueur et ne s'exécutera pas. Elle protège les autres bases.

---

## 3. Les trois jointures

Correspondance des colonnes : `listes_valeurs.nom` → `grilles_tailles_valeurs.valeur`, `listes_valeurs.ordre` → `grilles_tailles_valeurs.ordre`. Substitution directe, les deux colonnes existent.

### 3.1 `electron/ipc/commandes.js:89-95`

```js
// AVANT
"SELECT cl.id, cl.couleur_id, co.nom AS couleur, cl.reference_libre AS couleur_reference, cl.taille_id, t.nom AS taille, t.ordre AS taille_ordre, cl.quantite " +
"FROM commande_lignes cl " +
"JOIN listes_valeurs co ON co.id = cl.couleur_id " +
"LEFT JOIN listes_valeurs t ON t.id = cl.taille_id " +
"WHERE cl.commande_id = ? " +
"ORDER BY co.nom COLLATE NOCASE ASC, t.ordre ASC"

// APRES — taille lue depuis la grille ; COALESCE sur taille_nom pour qu'une
// valeur retiree de sa grille conserve son libelle historique a l'ecran.
"SELECT cl.id, cl.couleur_id, co.nom AS couleur, cl.reference_libre AS couleur_reference, cl.taille_id, " +
"COALESCE(t.valeur, cl.taille_nom) AS taille, t.ordre AS taille_ordre, cl.quantite " +
"FROM commande_lignes cl " +
"JOIN listes_valeurs co ON co.id = cl.couleur_id " +
"LEFT JOIN grilles_tailles_valeurs t ON t.id = cl.taille_id " +
"WHERE cl.commande_id = ? " +
"ORDER BY co.nom COLLATE NOCASE ASC, t.ordre ASC"
```

### 3.2 `electron/ipc/bcPf.js:31-36` — le plus sensible

Alimente le `taille_nom` **figé** d'un BC PF. Avec l'ancienne jointure et des `taille_id` remappés, elle produirait `NULL` ou un libellé faux dans un document officiel.

```js
// AVANT
"LEFT JOIN listes_valeurs ta ON ta.id = cl.taille_id "
// APRES
"LEFT JOIN grilles_tailles_valeurs ta ON ta.id = cl.taille_id "
// et dans le SELECT : ta.nom AS taille_nom  ->  COALESCE(ta.valeur, cl.taille_nom) AS taille_nom
```

### 3.3 `electron/ipc/system.js:155` — export Excel

Même substitution que 3.1.

---

## 4. `electron/ipc/commandes.js:78` — alimenter `taille_nom`

```js
// AVANT
"INSERT INTO commande_lignes (commande_id, couleur_id, reference_libre, taille_id, quantite) VALUES (?, ?, ?, ?, ?)"

// APRES — le libelle est fige des la creation, plus jamais a reconstituer.
"INSERT INTO commande_lignes (commande_id, couleur_id, reference_libre, taille_id, taille_nom, quantite) " +
"VALUES (?, ?, ?, ?, (SELECT valeur FROM grilles_tailles_valeurs WHERE id = ?), ?)"
```

L'appel `insertLigne.run(...)` reçoit `taille_id` deux fois : une pour la colonne, une pour le sous-`SELECT`.

C'est le patch qui **empêche la dette de se reconstituer**. Sans lui, chaque nouvelle commande repart avec un `taille_nom` NULL.

---

## 5. Stratégie de rollback

Trois niveaux, du plus fin au plus large.

**Transaction SQLite.** `CREATE`, `INSERT`, `DROP`, `ALTER` et `UPDATE` sont tous transactionnels sous SQLite : un `ROLLBACK` restaure intégralement l'état antérieur, table d'origine comprise. Le `catch` du script émet ce `ROLLBACK` sur n'importe quelle exception. Vérifié : après un dry-run complet allant jusqu'au `DROP TABLE`, la FK réelle est restée `listes_valeurs`, les 49 lignes `taille_id = 39` sont intactes et le marqueur est absent.

**Dry-run par défaut.** Le script exécute la totalité du traitement sur les données réelles, assertions comprises, puis émet un `ROLLBACK` inconditionnel. `--apply` est nécessaire pour conserver, et exige en plus la saisie de `REPARER`.

**Sauvegarde fichier.** En mode `--apply` uniquement, `wal_checkpoint(TRUNCATE)` puis copie horodatée dans `backups/pre-reparation-taille-id/`. Restauration : fermer l'ERP, recopier par-dessus `belvie.db`, supprimer `-wal` et `-shm`. C'est la procédure de `migrationSafety.restoreBackup`.

Le pragma `foreign_keys = OFF` est émis **avant** `BEGIN` — il est sans effet à l'intérieur d'une transaction ouverte — et `foreign_key_check` est exécuté explicitement avant le `COMMIT` pour compenser l'application désactivée.

---

## 6. Idempotence

| Mécanisme | Effet |
|---|---|
| Marqueur `parametres` | second passage : sortie immédiate, aucune transaction ouverte |
| `WHERE taille_nom IS NULL` (figeage) | ne réécrit jamais un libellé déjà figé |
| `WHERE taille_id = <ancien>` (remappage) | les 114 conformes ne sont jamais touchées |
| Mapping dérivé, jamais codé en dur | un second passage recalculerait le même résultat |
| Reconstruction conditionnée par la garde | jamais rejouée une fois le marqueur posé |

Vérifié : après un `--apply` réel, le second passage affiche `migration_grilles_tailles_version = 2 — reparation deja effectuee. Rien a faire.`

---

## 7. Ce que les tests ont réellement montré

Le dry-run a été exécuté sur un jeu reproduisant ta répartition exacte — 403 lignes, 289 anciennes suivant ta ventilation par identifiant, 114 conformes, et des lignes `listes_valeurs` aux identifiants 1 à 12 correspondant à celles que tu as acquittées.

Le mapping dérivé automatiquement reproduit le tien à l'identique : `39 S → 1 S`, `40 M → 2 M`, `41 L → 3 L`, `42 XL → 4 XL`, `43 2XL → 5 2XL`, `44 3XL → 6 3XL`, `47 6XL → 7 6XL` — 7 correspondances, 289 lignes, injectif.

**Un bug a été attrapé par l'assertion elle-même**, dans ma fonction d'empreinte. Elle résolvait le libellé par `COALESCE(taille_nom, lv.nom, gtv.valeur)`, en interrogeant `listes_valeurs` sans restriction de type. Pour les 114 lignes conformes pointant vers les valeurs de grille 1 à 7, elle récupérait le nom de la ligne `listes_valeurs` de même identifiant — une couleur — au lieu du libellé de taille. L'empreinte « avant » était donc fausse, et l'assertion a refusé de valider :

```
AVANT {"id":292,...,"libelle":"Couleur3"}
APRES {"id":292,...,"libelle":"L"}
ECHEC — ROLLBACK EMIS
Erreur : EMPREINTE METIER MODIFIEE
```

C'est précisément le comportement recherché : une assertion trop stricte qui échoue vaut infiniment mieux qu'une assertion trop laxiste qui laisse passer. L'ordre de résolution est désormais grille d'abord, puis `listes_valeurs` restreint aux types `taille`/`pointure`. Après correction, `EMPREINTE IDENTIQUE` sur les 403 lignes.

Même défaut dans la requête « Avant » de la section 6 du plan : elle doit être corrigée de la même façon avant usage.
