# MP1 — fondations des bons de commande matières et fournitures

**298 contrôles automatiques, 0 échec** (272 avant MP1 : aucune régression, 26 nouveaux).
Zéro erreur de type dans les fichiers livrés. **MP2 et MP3 ne sont pas commencés.**

---

## Installation

`Belvie-ERP-MP1.zip` **sans dossier racine**, à extraire **à l'intérieur** de votre dossier de
projet. Procédure complète, sauvegardes et retour arrière : `PROCEDURE-INSTALLATION-ET-VERIFICATION.md`.

Au démarrage, **deux lignes de migration**, une seule fois :

```
[migration] OK Termine avec succes : accessoire_catalogue_id ajoutee a achats
[migration] OK Termine avec succes : tables bc_mp creees (vides)
```

Contrôle avant de lancer : `electron\db\migrationsBonsMp.js` et `electron\ipc\bcMp.js` doivent
exister dans votre projet.

---

## 1. Ce qui change pour vous dès ce démarrage

**Une seule chose est visible — et c'est celle qui vous manquait : le « déjà commandé » des
fournitures devient juste.**

Avant MP1, sur un achat de 500 zips noirs déjà affecté à la production :

```
Zip central / Noir : nécessaire 450 | commandé   0 | reste à commander 450   ← on recommandait
```

Après MP1 :

```
Zip central / Noir : nécessaire 450 | commandé 300 | reste à commander 150   ← correct
```

La colonne `achats.accessoire_catalogue_id` permet enfin de rattacher un achat de fourniture au
besoin qu'il sert. **Vous pouvez le vérifier immédiatement** : si vous avez des achats de
fournitures déjà saisis, ouvrez-les dans Finance et renseignez leur composant de catalogue — ils
cesseront d'apparaître dans « achats non rattachés ».

Le reste de MP1 est invisible : les tables du document sont créées **vides**, et rien ne les
remplit encore.

---

## 2. Vos sept décisions, et où chacune est inscrite dans le code

| Votre décision | Où elle vit |
|---|---|
| **1.** Un bon = un fournisseur | `bc_mp.fournisseur_id NOT NULL`, et la création refuse un bon sans fournisseur |
| **2.** Brouillons séparés, colonne « En préparation » | Deux quantités **nouvelles** sur chaque besoin, et **aucune des cinq existantes redéfinie** |
| **3.** Conditionnement = vrai multiplicateur | `quantite = nombre × taille`, calculé et jamais ressaisi à côté |
| **4.** Prix proposés, modifiables, obligatoires à la validation | `prix_unitaire_ht` nullable en brouillon ; `lignes_sans_prix` est compté dès maintenant pour que l'écran le dise avant, pas au dernier moment |
| **5.** Fournitures rattachées au catalogue et aux achats | `achats.accessoire_catalogue_id` + le rapprochement dans le moteur |
| **6.** Coloris des fournitures avant les bons définitifs | Pas dans MP1 — voir le § 5 |
| **7.** Un bon validé engage, mais n'est pas du stock | Tranché, et détaillé au § 4 : c'est l'option A |

### Sur la décision 2, le point important

« Reste à commander » **garde exactement son sens** : nécessaire − commandé. Deux quantités
s'ajoutent à côté :

- **En préparation** — déjà posé sur un bon en brouillon ;
- **Reste à préparer** — ce qu'il reste à poser sur un bon, brouillons déduits.

Les confondre aurait fait disparaître des écrans un brouillon oublié. Les colonnes
n'apparaissent **que lorsqu'un brouillon existe** : tant qu'il n'y en a pas, votre écran est
rigoureusement identique à celui d'hier.

### Sur la décision 3, une précision

Le nombre de conditionnements n'est **pas arrondi à l'entier supérieur** par le code. Un
fournisseur peut accepter un demi-rouleau, et c'est à vous d'en décider. L'écran de MP2
**proposera** l'arrondi au carton entier ; il ne l'imposera pas. Dites-moi si vous préférez
l'inverse.

---

## 3. Ce qui a été vérifié

### Le rattachement des fournitures — 5 contrôles

Un achat relié au catalogue réduit le reste à commander ; un achat **non relié** reste signalé
dans « non rattachés » avec une raison explicite, jamais déduit en silence ; la couleur
discrimine, donc un zip noir ne sert pas le besoin en zips marine ; et **les matières se
comportent exactement comme avant**.

### La numérotation — 6 contrôles

`MP001-26`, `MP002-26`… et **`MP1000-26`** au-delà de 999, sans troncature. Le compteur repart à 1
le 1er janvier avec le nouveau suffixe. **Un compteur désynchronisé après une restauration de
sauvegarde ne produit jamais de doublon** : une boucle vérifie que le numéro est libre, comme le
fait déjà la numérotation des BC PF. Et **supprimer un brouillon ne rend pas son numéro** — un
trou dans la série est lisible, un doublon ne l'est pas.

### Les garde-fous — 9 contrôles

La répartition d'une ligne entre productions doit couvrir **exactement** sa quantité, sinon la
création est refusée et rien n'est écrit. Une ligne doit servir au moins une production. Une unité
d'achat inconnue est refusée avec un message qui dit lesquelles sont acceptées. Un bon qui n'est
plus en brouillon n'est plus modifiable.

### L'absence d'écriture financière — 2 contrôles

Une empreinte de **13 tables** — dont `achats`, `achats_affectations`, `paiements`,
`prix_fournisseurs` — est prise avant, puis après avoir créé un bon, l'avoir modifié, ajouté une
ligne, changé une quantité, recalculé les besoins et supprimé le bon. Elle est **identique**.

Et un contrôle lit le code source du module pour vérifier qu'il n'écrit que dans ses quatre
tables. Si une écriture financière y apparaissait un jour, le test le dirait avant vous.

---

## 4. Ce qui est prévu à MP3 — stocks et écritures financières

Vous avez demandé à le voir avant. Votre décision 7 tranche la question qui restait ouverte.

### Les écritures, à la validation d'un bon

**Une transaction unique**, et rien d'autre :

```
pour chaque ligne du bon :
    INSERT achats (fournisseur, catégorie, désignation, catalogue, couleur,
                   quantité, unité, montant_engage = quantité × prix, reference = n° MP)
    pour chaque production servie :
        INSERT achats_affectations (achat, commande, quantité affectée)
    UPDATE bc_mp_lignes SET achat_id = …
UPDATE bc_mp SET statut = 'valide', validated_at = …, + copies figées du fournisseur
```

**Aucune facture, aucune réception, aucun paiement, aucune échéance.** La réception, la facture et
le paiement restent trois événements distincts, saisis plus tard.

### Ce que cela change dans vos chiffres — annoncé, pas découvert

1. **La dette fournisseur ne bouge pas.** `detteFournisseur()` calcule
   `dette_restante = facturé − payé` : un engagement n'y entre pas. Il apparaît dans
   `engagement_restant`, une grandeur distincte déjà affichée.
2. **Le coût suivi de la production augmente** du montant engagé, dans `provisoire_restant` —
   jamais dans `facture_reel`. C'est juste : l'argent est engagé. Mais le chiffre **changera** le
   jour de votre premier bon validé, et il faut le savoir avant.

### Le stock — c'est votre décision 7, et elle demande une correction

Aujourd'hui, `stockDisponibleMatiere()` compte la quantité **commandée** comme achetée :

```js
achete += lot.quantite || 0;   // la quantité de l'achat, pas celle qui est arrivée
```

Tant que vous saisissez les achats à la livraison, la différence ne se voit pas. Dès qu'un bon
validé crée l'achat, **une matière commandée mais pas encore livrée apparaîtrait en stock** — ce
que vous avez explicitement refusé.

**Correction prévue à MP3**, conforme à votre décision 7 :

```js
achete += quantité REÇUE du lot (somme de achats_receptions), et non la quantité commandée
```

Et une grandeur **nouvelle** à côté, `en_commande`, pour voir ce qui est attendu sans le
confondre avec ce qui est là.

C'est la seule fonction financière existante que MP3 modifiera. Elle sera livrée **seule**, avec
une comparaison avant/après sur vos chiffres réels : stock de chaque matière, coût de chaque
production, dette de chaque fournisseur, synthèse globale. Tout écart autre que ceux annoncés
ci-dessus arrêtera la livraison.

---

## 5. Ce qui reste avant d'obtenir un PDF exploitable

**MP2** — l'écran de préparation : sélectionner plusieurs productions, regrouper leurs besoins,
attribuer un fournisseur par ligne, ajuster quantités et conditionnements, enregistrer en
brouillon. Plus l'écran de suivi des bons. **Aucune écriture financière.**

**MP3** — la validation, les écritures ci-dessus, et le PDF.

**Et B3 — les coloris de fournitures.** Rappel du chiffre mesuré : modéliser un zip qui dépend de
la couleur en créant deux lignes donne **1 160 zips au lieu de 580**. Tant que B3 n'est pas fait,
**ne générez pas de bons définitifs pour un article dont une fourniture se décline par couleur.**
Vos décisions 5 et 6 le reconnaissent. Dites-moi si vos premiers bons sont concernés : si oui, B3
passe avant MP2 ; sinon MP2 peut suivre immédiatement.

---

# Tests manuels

## Groupe F — le rattachement des fournitures *(le plus important)*

- **F1** Finance → un achat de fourniture existant. S'il n'est relié à aucun composant du
  catalogue, il apparaît toujours dans « achats non rattachés » sur l'écran des besoins — c'est
  normal, la colonne est vide pour les achats anciens.
- **F2** Créez un achat de fourniture **relié au catalogue**, affectez-le à une production, puis
  ouvrez Approvisionnement → cette production : la colonne **Commandé** de la fourniture doit
  enfin être renseignée, et le reste à commander diminuer d'autant.
- **F3** Un achat de zips **noirs** ne doit pas réduire le besoin en zips **marine**.
- **F4** Les matières : **aucun chiffre ne doit avoir changé.** C'est le test de non-régression le
  plus direct — relancez `verifier-besoins.js` avant et après si vous voulez la preuve mécanique.

## Groupe G — les migrations

- **G1** Deux lignes de migration au premier démarrage, aucune au second.
- **G2** `%APPDATA%\belvie-erp\belvie.db` : les tables `bc_mp`, `bc_mp_lignes`,
  `bc_mp_ligne_productions` et `compteurs_bc_mp` existent et sont **vides**.

## Groupe R — non-régression

- **R1** Approvisionnement : la liste et le détail s'ouvrent, les chiffres des matières sont
  inchangés.
- **R2** Finance : coût d'une commande, dette d'un fournisseur, synthèse — **aucun changement**.
- **R3** Fiche technique : « Modifier la nomenclature », révisions, PDF — inchangés.
- **R4** Commandes de production et BC PF — inchangés.
