# 6. Approvisionnement — bons de commande matières premières (BC MP)

## 1. Rôle

Le BC MP est le document envoyé à **un** fournisseur pour acheter matières et fournitures. Il est
préparé à partir des besoins de plusieurs productions (regroupement inter-productions) et, une fois
validé, **alimentera** la mécanique financière existante (`achats`) sans en créer une seconde.
Avancement : **MP1 ✅** (tables, numérotation), **MP2 ✅** (préparation, brouillons, suivi),
**MP3 ⏸** (validation, écritures financières, PDF, stock) hors périmètre actuel.

## 2. Règles métier (document fonctionnel §6)

### Numérotation ✅ (§6.3)
- **RN1** — Format `MP001-26` … `MP999-26`, puis `MP1000-26` (pas de troncature).
- **RN2** — Compteur **par année**, remis à 1 au 1er janvier avec le nouveau suffixe.
- **RN3** — Boucle anti-collision.
- **RN4** — Compteur et insertion dans **la même transaction** ; un lot refusé ne fait pas avancer le compteur.
- **RN5** — Un numéro attribué n'est **jamais réutilisé**, même pour un bon annulé.
- **RN6** — Compteur **propre** aux BC MP (non partagé avec les BC PF).

### Cycle de vie (§6.4)
```
brouillon ──valider──> validé ──envoyer──> envoyé ──(réceptions, factures)──> soldé
    │                     │                   │
    └─ supprimable        └─ annulable        └─ annulable (avec motif)
```
| Statut | Règle |
|---|---|
| **brouillon** | Modifiable, supprimable sans trace, **invisible pour la Finance** (rien dans `achats`) |
| **validé** 🟦 MP3 | Numéro définitif ; un `achats` par ligne + un `achats_affectations` par production servie, **une seule transaction** ; fournisseur et entreprise figés ; **plus modifiable** |
| **envoyé** | Purement documentaire, aucun effet financier |
| **soldé** | Tout reçu et facturé — **calculé, jamais saisi** |
| **annulé** | Motif obligatoire ; les `achats` créés ne sont supprimés que s'ils n'ont **ni réception, ni facture, ni affectation consommée** |

- **RBC1** — **Un bon = un fournisseur.** `creerLot` refuse deux bons pour le même fournisseur.
- **RBC2** — Le montant d'une ligne = quantité × prix, recalculé, jamais saisi.

### Préparation (MP2) ✅ (§6.5)
Depuis la page des besoins, « Préparer les bons MP », trois temps : **sélection** (lignes dont le
reste à commander > 0, cochées par défaut ; anomalies bloquantes visibles, non cochées, avec motif ;
quantité incalculable affichée « — », jamais 0), **fournisseur par ligne** (proposé sans ambiguïté
depuis les tarifs, regroupement un bon par fournisseur), **ajustement** (quantités, références,
couleurs, unités, conditionnements, prix). Rien n'est créé avant « Créer les brouillons » / « Ajouter
au brouillon ».
- **RP1** — Le regroupement appelle le **même moteur** que l'écran des besoins.
- **RP2** — Clé de regroupement : `type | catalogue_id | cible_cle | unité de la fiche` ; composant
  identifié par son **identifiant de catalogue**, jamais par sa désignation ; un composant non relié
  reçoit une clé propre et est signalé.
- **RP3** — Plusieurs productions peuvent alimenter une même ligne ; `bc_mp_ligne_productions` garde
  la part de chacune.
- **RP4** — Répartition **uniquement** dans `bcMp.repartirParPoids` (prorata des poids envoyés par
  l'écran, la dernière part absorbe l'arrondi ; 1 000 → 1 500 sur 800/200 donne 1 200/300).
- **RP5** — `enregistrerPreparation` traite nouveaux bons et ajouts aux brouillons en **une seule transaction**.
- **RP6** — On n'ajoute pas de ligne depuis le détail d'un bon : les lignes viennent des besoins.

### Unité d'achat et conditionnement (§6.5)
- **RU1** — Le besoin reste en unité de **consommation** ; la ligne porte l'unité d'**achat**
  (`kg`, `m`, `piece`, `lot`) et rappelle `unite_fiche`.
- **RU2** — Traduction automatique **uniquement des cas certains** ; `bobine`, `paire`, `jeu`, `cm`
  exigent un choix explicite.
- **RU3** — Le conditionnement vit **sur la ligne du bon**, jamais sur le composant ; quantité =
  nombre de conditionnements × taille.
- **RU4** — L'arrondi au conditionnement est **proposé, jamais imposé** (nombre exact, arrondi,
  quantité arrondie, supplément).
- **RU5** — 🟦 Conditionnement par défaut sur le tarif fournisseur : simple préremplissage.

### Prix et fournisseurs proposés (§6.5)
- **RPX1** — Deux sources : `prix_fournisseurs` (le tarif valide le plus récent gagne) et
  l'historique d'`achats` (**sans prix**).
- **RPX2** — ⛔ Aucun prix reconstitué par division montant/quantité.

### Contrôles : enregistrement vs validation (§6.6 et matrice §12.1)
| Situation | Enregistrement du brouillon | Validation du bon (MP3) |
|---|---|---|
| Pas de fournisseur | **refusé** | — |
| Pas d'unité / unité d'achat indéterminée | **refusé** | — |
| Pas de quantité | **refusé** | — |
| Prix absent | accepté | **refusé** — jamais mis à zéro |
| `correspondance_couleur_absente` | accepté, signalé | **bloquant** sauf cible `*` |
| `coloris_non_choisi` | accepté, signalé | **bloquant** |
| `catalogue_non_relie` | accepté, signalé | **bloquant** |
| `unite_absente` | — | **bloquant** |
| `consommation_absente` / `invalide` / `taille_absente` | listé à part | **bloquant** |
| `perte_invalide` | — | non bloquant |
| Cible `*` | rien | non bloquant |

- **RCB1** — La cible `*` décide objectivement ; toute autre cible exige un coloris. **On ne devine
  rien à partir du libellé.**
- **RCB2** — Le détail d'un bon **ne refait pas** le contrôle des coloris et le dit explicitement.

### Brouillons et « reste à commander » 🟨 (§6.7) — voir point ouvert.
### PDF 🟦 MP3 (§6.8)
Fichier séparé `bcMpPdf.js`, réutilisant `genererPdfDepuisFenetreDediee` sans modifier `bcPf.js` ni
`bcPfPdf.js` ; la répartition par production n'apparaît pas sur le PDF.
### Suivi des bons ✅ (§6.9)
Liste (numéro, fournisseur, date, nombre de lignes, montant HT, statut, productions), recherche,
filtres, tris ; détail : lignes, productions servies, états commandé / reçu / facturé / payé.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `compteurs_bc_mp` | `annee`, `dernier_numero` |
| `bc_mp` | `numero` (UNIQUE, `MP001-26`), `uuid`, `fournisseur_id`, `statut` (`brouillon, valide, envoye, solde, annule` — commentaire, sans `CHECK`), `motif_annulation`, dates, `conditions_paiement`, `notes`, `observations_internes`, copies figées `fournisseur_*` / `entreprise_*`, `validated_at`, `envoye_at`, `cree_par_id`, `valide_par_id` |
| `bc_mp_lignes` | `type` (CHECK `matiere/fourniture`), `matiere_catalogue_id` **ou** `accessoire_catalogue_id` (CHECK : pas les deux), `designation`, `reference`, `couleur`, `unite` (CHECK `kg/m/piece/lot` ou NULL), `unite_fiche`, `conditionnement_libelle`, `conditionnement_quantite` (> 0, défaut 1), `nombre_conditionnements`, `quantite` (> 0), `prix_unitaire_ht` (≥ 0 ou NULL), `achat_id` (NULL en brouillon), `ordre` |
| `bc_mp_ligne_productions` | `bc_mp_ligne_id`, `commande_id`, `quantite_affectee` (> 0), `achat_affectation_id` (NULL en brouillon) ; `UNIQUE(bc_mp_ligne_id, commande_id)` |
| `achats.accessoire_catalogue_id` | ajout : un achat peut désigner une fourniture |

## 4. Code

- `preparationBcMp.js` — **lecture seule** : `regrouper(db, commandeIds)` (appelle
  `besoins.calculerPourCommande` pour chaque production puis regroupe par `cleRegroupement`),
  `fournisseursProposes`, `deduireUniteAchat` (RU2), `proposerConditionnement` (RU4).
- `bcMp.js` — écritures des **brouillons seulement** (aucune écriture dans `achats` ni dans la
  finance) : `creer`, `creerLot`, `enregistrerPreparation`, `get`, `list`, `mettreAJour`, `supprimer`,
  `ajouterLigne`, `mettreAJourLigne`, `supprimerLigne`, `genererNumero` / `formaterNumero`,
  `resoudreQuantite`, `repartirParPoids`. Transactions via `db.transaction` (`enTransaction`).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/bcMp/regrouper` | `commandeIds` | `preparationBcMp.regrouper` |
| POST | `/api/bcMp/creerLot` | `bons` | `bcMp.creerLot` |
| POST | `/api/bcMp/enregistrerPreparation` | `payload` | `bcMp.enregistrerPreparation` |
| POST | `/api/bcMp/creer` | `payload` | `bcMp.creer` |
| GET | `/api/bcMp/get` | `bonId` | `bcMp.get` |
| GET | `/api/bcMp/list` | `filtres` | `bcMp.list` |
| POST | `/api/bcMp/mettreAJour` | `bonId`, `patch` | `bcMp.mettreAJour` |
| POST | `/api/bcMp/supprimer` | `bonId` | `bcMp.supprimer` |
| POST | `/api/bcMp/ajouterLigne` | `bonId`, `ligne` | `bcMp.ajouterLigne` |
| POST | `/api/bcMp/mettreAJourLigne` | `ligneId`, `patch` | `bcMp.mettreAJourLigne` |
| POST | `/api/bcMp/supprimerLigne` | `ligneId` | `bcMp.supprimerLigne` |

## 6. Interface

`apps/web/src/modules/approvisionnement/` : `PreparationBons.tsx` (les trois temps de la
préparation), `BonsListe.tsx` (suivi), `BonDetail.tsx` (détail, modification et suppression de
lignes d'un brouillon).

## 7. Tests

`scenario-appro-finance.test.js` : « besoins, simulation et préparation des BC MP » — regroupement,
enregistrement de préparation, lots, création directe, modifications, lignes, numérotation, refus
(fournisseur en double, quantité manquante…), ancien = nouveau.

## 8. Points ouverts / dette technique

- MP3 ⏸ (validation, écritures `achats`/`achats_affectations`, PDF `bcMpPdf.js`, correction du stock
  dérivé) ; RU5 🟦 ; décisions ouvertes §12.3 n° 1 (moment de création de l'engagement) et n° 4
  (création au catalogue des fournitures non reliées depuis le bon).
- *Incohérence document / code* : §6.7 présente la colonne « en préparation » comme 🟨 proposée ; le
  moteur de besoins la calcule déjà à partir des brouillons (voir
  [approvisionnement-besoins.md](approvisionnement-besoins.md)).
- *Incohérence de nom* : RU4 cite `proposerArrondi` ; la fonction s'appelle `proposerConditionnement`
  (`preparationBcMp.js`) et rend bien nombre exact, arrondi, quantité arrondie et supplément.
- *Constat* : RP6 (« pas d'ajout de ligne depuis le détail d'un bon ») n'empêche pas l'existence de la
  route `bcMp/ajouterLigne` ; l'écran `BonDetail.tsx` ne l'utilise pas (il modifie et supprime seulement).
