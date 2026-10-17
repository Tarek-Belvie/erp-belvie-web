# 10. Bons de commande produits finis (BC PF)

## 1. Rôle

Le BC PF est le document remis à l'atelier pour une commande de production : article, atelier,
répartition couleurs × tailles, coordonnées de l'entreprise. Il est le **modèle de référence pour
tout document émis** : numérotation annuelle, cycle de statuts, copies figées à l'émission, PDF
généré par un moteur dédié.

## 2. Règles métier (document fonctionnel §10)

- Compteur annuel `compteurs_bc_pf` + `genererNumeroBcPf()` avec boucle anti-collision (numéro
  `PF-AAAA-NNNN`, jamais réutilisé).
- Cycle brouillon → validé → lancé → remplacé / annulé.
- Copies figées à l'émission (nom, adresse, logo de l'entreprise ; photo de l'article) — R0.1.
- PDF `bcPfPdf.js`, moteur générique `genererPdfDepuisFenetreDediee(html, outputPath)`.
- **RPF1** — La validation du BC PF verrouille la répartition couleurs × tailles de la production
  (cf. RCM3).
- **RPF2** — `bcPf.js` et `bcPfPdf.js` **ne sont pas modifiés** par les travaux BC MP.

Règles inscrites dans le code (constat) :
- un BC PF ne peut exister que pour une commande **validée ou à une étape ultérieure** ;
- un seul BC PF actif (hors `remplace`/`annule`) par commande et par atelier ;
- seul un brouillon est modifiable (`updateBrouillonDoc`) ou resynchronisable avec la commande
  (`mettreAJourDepuisCommande`) ; seul un brouillon se valide ; seul un document validé se lance ;
- remplacer (`remplacerBcPf`) exige un **motif** et ne s'applique qu'à un document validé ou lancé :
  l'ancien passe en `remplace`, un nouveau brouillon est créé avec `remplace_bc_pf_id` ;
- **lancer** marque le document comme lancé, **puis** fait passer la commande en production si elle
  est encore `validee` — jamais l'inverse (route spéciale `POST /api/bcPf/lancer`, reprise de
  l'ancien `main.js`).

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `bc_pf` | `uuid` et `numero` (UNIQUE), `commande_id`, `atelier_id`, `statut` (`brouillon, valide, lance, remplace, annule` — commentaire, sans `CHECK`), `remplace_bc_pf_id`, `motif_remplacement`, copies figées de la commande (`commande_numero`, `article_nom`, `article_reference`, `atelier_nom`…) et de l'entreprise (`entreprise_*`, `entreprise_logo_snapshot_path`), `photo_snapshot_path`, `notes_atelier`, `observations_internes`, `commande_synced_at`, `validated_at`, `launched_at` |
| `bc_pf_lignes` | `couleur_nom`, `couleur_reference`, `taille_nom`, `quantite` (libellés figés, pas d'identifiants) |
| `compteurs_bc_pf` | dernier numéro par année |

Images figées : `images/bc_pf/`.

## 4. Code

- `bcPf.js` : `creerBcPf`, `getByCommandeId`, `listForCommande`, `get`, `updateBrouillonDoc`,
  `mettreAJourDepuisCommande`, `validerBcPf`, `lancerBcPf`, `remplacerBcPf` ; dépend de `photos`
  (`snapshotArticlePhoto`).
- `bcPfPdf.js` : `buildBcPfHtml(bc, entreprise)` et `genererPdfDepuisFenetreDediee(html, chemin)`,
  qui utilise désormais `lib/fenetreImpression.js` (Chromium sans interface) à la place d'une fenêtre
  Electron cachée ; la mise en page (pied de page repoussé en bas de chaque page) est inchangée.
- Appelé par `commandes.js` (RCM3 : la répartition n'est plus modifiable une fois le BC validé).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/bcPf/getByCommandeId` | `commandeId` | `bcPf.getByCommandeId` |
| GET | `/api/bcPf/listForCommande` | `commandeId` | `bcPf.listForCommande` |
| GET | `/api/bcPf/get` | `id` | `bcPf.get` |
| POST | `/api/bcPf/creer` | `commandeId` | `bcPf.creerBcPf` |
| POST | `/api/bcPf/update` | `id`, `patch` | `bcPf.updateBrouillonDoc` |
| POST | `/api/bcPf/mettreAJourDepuisCommande` | `id` | `bcPf.mettreAJourDepuisCommande` |
| POST | `/api/bcPf/valider` | `id` | `bcPf.validerBcPf` |
| POST | `/api/bcPf/remplacer` | `id`, `motif` | `bcPf.remplacerBcPf` |

Routes spéciales : `POST /api/bcPf/lancer` (`id`) et `GET /api/bcPf/telechargerPdf`
(`id`, `suggestedName`) — le PDF est renvoyé en téléchargement au lieu d'être enregistré via une
boîte de dialogue Windows.

## 6. Interface

`apps/web/src/modules/bcpf/BcPfDetailModal.tsx`, `BcPfRepartitionTable.tsx` ; ouverture depuis
`apps/web/src/modules/commandes/CommandeDetailModal.tsx`.

## 7. Tests

`scenario-productions.test.js` : création, modification, validation, lancement, remplacement,
refus métier, et génération du HTML du PDF.

## 8. Points ouverts / dette technique

- *Constat* : `bc_pf.statut` n'a pas de contrainte `CHECK` (pas plus que `bc_mp.statut`) ; la liste
  des valeurs n'est garantie que par le code.
- *Constat* : le statut `annule` est prévu (commentaire du schéma, filtres `NOT IN ('remplace','annule')`)
  mais aucune fonction de `bcPf.js` ne l'attribue aujourd'hui.
