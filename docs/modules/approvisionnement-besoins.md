# 5. Approvisionnement — calcul des besoins

## 1. Rôle

Pour une production, le moteur calcule ce qu'il faut acheter : pour chaque composant de la recette
(matière ou fourniture) et chaque coloris, le besoin brut, le nécessaire avec pertes, ce qui est
déjà commandé, le reste à commander et le reste à recevoir. Toute donnée manquante devient une
**anomalie nommée**, la ligne reste visible. C'est **le seul** calcul de besoins de l'application
(R0.2) : l'écran des besoins, la préparation des BC MP et la révision de fiche s'en servent.

## 2. Règles métier (document fonctionnel §5)

### Moteur unique ✅ (§5.1)
`approvisionnement:calculerBesoins` / `calculerPourCommande` est **le seul** calcul de besoins.
- **RB1** — 🟦 `commandes:besoinsMatieres` (ancien calcul : matières seules, mode moyenne, sans
  fournitures ni engagements) est **retiré** ; l'écran du détail de commande est rebranché sur le
  moteur unique en conservant : bandeau repliable avec synthèse, **ouverture automatique en cas
  d'anomalie**, tableau par matière et couleur, absence du bloc s'il n'y a ni fiche ni matière.
- **RB2** — `finance:comparaisonConsommationCommande` utilise un théorique issu des **estimations**
  (et non de la fiche) ; l'interface doit le préciser : « théorique issu de l'estimation, non de la
  fiche technique ».

### Formules (§5.2)
```
besoin brut           = Σ (consommation applicable × quantité produite)   par composant × coloris
nécessaire            = besoin brut × (1 + perte % / 100)
déjà commandé         = quantités engagées et affectées à la production
reste à commander     = max(0 ; nécessaire − déjà commandé)
reste à recevoir      = commandé − reçu
```
Consommation applicable, par priorité : (1) propre au coloris ; (2) par taille (mode `par_taille`) ;
(3) consommation de la ligne (fixe/moyenne).
- **RB3** — Le stock n'est pas déduit tant qu'un module Stock fiable n'existe pas.
- **RB4** — Ne jamais additionner des unités différentes d'un même composant.
- **RB5** — La consommation unitaire peut être ajustée pour une commande **sans toucher la fiche**.

### Quantité non couverte 🟨 (§5.3)
Proposé : `quantite_production_non_couverte` et la mention « dont N pièces sans consommation ».

### Codes d'anomalie (§5.4)
| Code | Signification |
|---|---|
| `consommation_absente` | Aucune consommation renseignée |
| `consommation_invalide` | Consommation ≤ 0 ou incohérente (distincte de l'absence) |
| `consommation_taille_absente` | Mode par taille, taille commandée sans consommation |
| `unite_absente` | Fourniture sans unité |
| `correspondance_couleur_absente` | Couleur commandée sans coloris déclaré (composant décliné) |
| `coloris_non_choisi` | Correspondance déclarée, coloris non arrêté |
| `catalogue_non_relie` | Composant sans identifiant de catalogue |
| `perte_invalide` | Perte invalide, ramenée à zéro et signalée |

Une ligne en anomalie s'affiche **avec ses quantités**, et nomme le composant concerné.
Matrice complète (fiche / brouillon BC MP / validation BC MP) : document fonctionnel §12.1, reprise
dans [bc-matieres-premieres.md](bc-matieres-premieres.md).

### Engagements non rattachés ✅ (§5.5)
Un achat qui ne correspond à aucune ligne de besoin (couleur retirée, composant retiré, fourniture
sans catalogue…) apparaît à part **avec sa raison** ; ni perdu ni déduit d'autre chose.

### Suppléments et excédents 🟦 (§5.6)
`recu_excedentaire` (excédent de réception nommé) ; **supplément de conditionnement** (écart
*commandé − nécessaire* issu d'une ligne de BC MP avec conditionnement : affiché, n'entre ni dans le
reste à commander, ni dans le reçu, jamais assimilé à du stock) ; **commandé au-delà du besoin**
(achat saisi directement) — distinction par `bc_mp_lignes.achat_id`.

### Correction depuis l'Approvisionnement 🟨 (§5.7)
« Corriger la fiche technique » sur chaque anomalie ouvre la fiche sur l'onglet et la ligne concernés.

## 3. Données

Aucune table propre : **le module lit, il n'écrit jamais** (`besoins.js`). Sources lues :
`commandes`, `commande_lignes`, `articles`, `fiches_techniques`, `ft_matieres`,
`ft_matiere_consommations_taille`, `ft_matiere_couleurs`, `matiere_couleurs`, `ft_accessoires`,
`ft_fourniture_tailles`, `ft_fourniture_couleurs`, `commandes_recette_figee` (recette figée),
`achats` / `achats_affectations` / `achats_receptions` (déjà commandé, reçu),
`bc_mp` / `bc_mp_lignes` / `bc_mp_ligne_productions` (brouillons « en préparation »).

## 4. Code

| Fichier | Rôle |
|---|---|
| `calculBesoins.js` | **le calcul**, sans SQL : `calculerBesoins(entree)`, résolution de la cible couleur (`resoudreCible`, cible `*`), de la consommation applicable (`resoudreConsommation`), codes `ANOMALIES` et `LIBELLES_ANOMALIES`. Vérifiable sans base. |
| `besoins.js` | accès aux données : `lireRecetteFigee` (recette figée lisible / illisible / absente), `lireProduction`, `lireMatieres`, `lireFournitures`, `lireEngagements`, `lireEnPreparation` ; points d'entrée `calculerPourCommande(db, commandeId, options)` (option `lignes_simulees` : simulation de quantités sans rien écrire), `etatsApprovisionnement(db, commandeIds)` (état résumé pour trier/filtrer la liste), `construireRecette(db, ficheId)` (entrée du moteur, figée par `revisionsFiche`) |

Dépendances : appelé par `preparationBcMp.regrouper` et `revisionsFiche` (`construireRecette`).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/approvisionnement/calculerBesoins` | `commandeId`, `options` | `besoins.calculerPourCommande` |
| GET | `/api/approvisionnement/etatsApprovisionnement` | `commandeIds` | `besoins.etatsApprovisionnement` |

## 6. Interface

`apps/web/src/modules/approvisionnement/` : `ApprovisionnementPage.tsx`, `BesoinsListe.tsx`
(liste des productions et état d'approvisionnement), `BesoinsDetail.tsx` (détail par composant et
coloris, anomalies, engagements non rattachés, source de la recette : figée / fiche / figée illisible),
`approvisionnementTypes.ts`.

## 7. Tests

- `scenario-appro-finance.test.js` : « besoins, simulation et préparation des BC MP » (anomalies,
  coloris, mode par taille, hors approvisionnement, simulation) et « besoins sur recette figée ».
- Balayage des lectures sur une copie de la base réelle : `calculerBesoins` sur toutes les
  productions, `etatsApprovisionnement` sur la liste complète — identiques à la version Electron.

## 8. Points ouverts / dette technique

- RB1, §5.6 : 🟦 ; §5.3, §5.7 : 🟨.
- *Incohérence document / code* : le document (§6.7 et §12.3, décision ouverte n° 2) présente la
  colonne **« en préparation »** comme une recommandation 🟨 non tranchée. Le moteur la calcule déjà :
  `lireEnPreparation` lit les lignes des BC MP **brouillons** et chaque ligne de besoin porte
  `quantite_en_preparation` et `reste_a_preparer` (`calculBesoins.js`), sans modifier les cinq
  quantités existantes. À confirmer côté métier.
- *Constat* : `calculBesoins.js` connaît deux codes absents du tableau §5.4 : `production_vide`
  (« Aucune quantité de production ») et `aucun_composant` (« La fiche technique ne contient ni
  matière ni fourniture »).
- *Constat* : les gardes `tableExiste` / `colonneExiste` (bases SQLite anciennes) sont toujours vraies
  avec le schéma PostgreSQL et peuvent être retirées.
