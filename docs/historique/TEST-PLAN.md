# Plan de test — Belvie ERP

Ce document distingue deux catégories bien séparées :

- **Partie 1** : ce qui a déjà été testé de façon automatisée pendant le développement (base de données,
  logique métier, compilation), avec de vrais outils — pas une simple relecture de code.
- **Partie 2** : ce qui **doit impérativement être testé manuellement sur votre ordinateur**, car cet
  environnement de développement n'a ni accès réseau pour installer Electron/React, ni affichage
  graphique pour ouvrir une fenêtre. Aucune interface n'a donc jamais été cliquée réellement avant de
  vous être livrée.

---

## Partie 1 — Tests automatisés déjà exécutés et validés

Ces tests ont été réalisés avec de vrais outils à chaque étape du développement (moteur SQLite natif de
Node pour la base de données, vrai compilateur TypeScript). Ils couvrent la logique, pas l'affichage.

| Test | Outil utilisé | Résultat |
|---|---|---|
| Compilation TypeScript de l'ensemble du projet | `tsc --noEmit` réel | Zéro erreur |
| Installation vierge (aucune donnée fictive) | Base SQLite réelle | 0 commande, 0 article, 0 opérateur ; seule la configuration structurelle (étapes, tailles, saisons, rayons) est présente |
| Chargement des données de démonstration | Base SQLite réelle | Refusé si de vraies commandes existent déjà ; jeu complet chargé sinon |
| Suppression des données de démonstration | Base SQLite réelle | Commandes et articles de démo supprimés, valeurs de référence désactivées (pas supprimées), vraies données non affectées |
| Migration depuis chaque version antérieure | Bases reconstituées fidèlement | Aucune perte de donnée à chaque étape (texte vers listes, ajout photos, multi-tailles, cycle de vie/articles) |
| Création "Nouveau", puis réassort R01, puis R02 | Base SQLite réelle | Références générées correctement, refus d'un 2e "Nouveau" sur le même article |
| Cycle de vie complet (Brouillon jusqu'à Archivée/Désarchivée) | Base SQLite réelle | Chaque transition testée individuellement, avec et sans opérateur actif |
| Verrouillage des champs structurants hors Brouillon | Base SQLite réelle | Rejet confirmé |
| Blocage / déblocage | Base SQLite réelle | Refus hors statuts autorisés, motif obligatoire vérifié |
| Annulation (depuis Validée et depuis En production) | Base SQLite réelle | Motif obligatoire, statuts finaux corrects |
| Archivage / désarchivage | Base SQLite réelle | Aucune perte de donnée, réapparition confirmée |
| Historique (append-only) | Base SQLite réelle | Nombre d'événements et contenu corrects après chaque action |
| Suppression définitive | Base SQLite réelle | Impossible hors Brouillon, y compris par appel direct à la fonction |

---

## Partie 2 — Tests manuels obligatoires (à faire sur votre ordinateur)

Pour chaque test : suivez les étapes, comparez au résultat attendu, cochez Succès ou Échec.
En cas d'échec, copiez le message d'erreur exact dans la section "Messages d'erreur rencontrés" tout en
bas de ce document, en précisant le numéro du test.

Deux consoles à surveiller en permanence pendant tous les tests :
- Console "Electron" (processus principal) : le terminal dans lequel vous avez lancé `npm run dev`. Les
  erreurs y apparaissent en texte rouge/brut.
- Console "renderer" (interface) : dans la fenêtre de l'application, outils de développement déjà
  ouverts automatiquement en mode `npm run dev` (sinon `Ctrl+Shift+I`), onglet "Console".

### Test 1 — Installation des dépendances
Étapes : `npm install` à la racine du projet.
Résultat attendu : aucune erreur ; se termine normalement (peut prendre plusieurs minutes).
☐ Succès ☐ Échec

### Test 2 — Lancement en mode développement
Étapes : `npm run dev`.
Résultat attendu : une fenêtre s'ouvre sur le tableau de bord "Commandes de production", vide (installation neuve) ou avec vos données si vous avez déjà une base.
☐ Succès ☐ Échec

### Test 3 — Consoles au démarrage
Étapes : juste après le lancement, regardez les deux consoles (voir encadré ci-dessus).
Résultat attendu : aucune ligne rouge/erreur dans les deux consoles.
☐ Succès ☐ Échec

### Test 4 — Build complet
Étapes : fermez l'application, lancez `npm run build`.
Résultat attendu : se termine sans erreur ; un dossier `dist/` et un dossier `release/` sont créés.
☐ Succès ☐ Échec

### Test 5 — Lancement de l'exécutable buildé
Étapes : ouvrez `release/` et lancez l'application installée (ou l'exécutable généré selon votre plateforme).
Résultat attendu : l'application démarre normalement, sans boîte de dialogue d'erreur.
☐ Succès ☐ Échec

### Test 6 — Création d'un article avec photo
Étapes : onglet Articles -> "+ Nouvel article" -> remplir produit/saison/année/rayon/abréviation -> créer -> ouvrir le détail de l'article créé -> "Ajouter une photo" -> choisir une image JPG/PNG.
Résultat attendu : la référence générée s'affiche (ex. SS26-M-JEA-01) ; la photo apparaît en miniature après ajout.
☐ Succès ☐ Échec

### Test 7 — Création et modification d'un brouillon
Étapes : Commandes -> "+ Nouvelle commande" -> "Nouvel article" -> sélectionner l'article créé au test 6 -> remplir responsable/atelier/dates -> cocher au moins une couleur et une taille -> saisir une quantité -> "Enregistrer le brouillon". Puis rouvrir la fiche -> "Modifier" -> changer la quantité -> enregistrer.
Résultat attendu : le brouillon apparaît dans le tableau avec l'étiquette "Brouillon" (pas de numéro) ; la modification est bien prise en compte.
☐ Succès ☐ Échec

### Test 8 — Validation
Étapes : dans Paramètres, vérifiez qu'un opérateur actif est sélectionné (sinon choisissez-en un). Ouvrez le brouillon du test 7 -> "Valider la commande" -> confirmer.
Résultat attendu : un numéro officiel (CMD-AAAA-0XX) apparaît ; le statut passe à "Validée" ; un événement "Commande validée" apparaît dans l'historique.
☐ Succès ☐ Échec

### Test 9 — Check-list de lancement : bouton désactivé puis activé
Étapes : sur la commande validée -> "Lancer la production". Ne cochez d'abord AUCUNE case : observez le bouton "Lancer la production" en bas. Cochez les cases une par une en observant le bouton à chaque fois. Cochez-les toutes.
Résultat attendu : le bouton reste désactivé (grisé) tant que toutes les cases ne sont pas cochées ; il devient cliquable uniquement une fois toutes cochées (et un opérateur actif défini).
☐ Succès ☐ Échec

### Test 10 — Fermeture de l'écran de lancement sans conséquence
Étapes : rouvrez l'écran de lancement, cochez quelques cases, cliquez "Retour" (sans aller au bout). Rouvrez la fiche.
Résultat attendu : le statut est resté "Validée" (pas "En production") ; aucun événement ajouté à l'historique — fermer l'écran sans cliquer "Lancer la production" ne doit rien enregistrer.
☐ Succès ☐ Échec

### Test 11 — Tous les boutons et dialogues, statut par statut
Étapes : faites progresser une commande de test à travers tout le cycle : Lancer -> Entrer en contrôle qualité -> Terminer la production -> Archiver -> Désarchiver. Pour une autre commande de test : Valider -> Bloquer -> vérifier le badge "Bloquée" dans le tableau -> Débloquer -> Annuler (avec motif).
Résultat attendu : à chaque étape, seuls les boutons prévus pour ce statut sont visibles ; chaque dialogue affiche le bon texte, exige un motif quand c'est prévu, et refuse de se fermer si le motif est vide.
☐ Succès ☐ Échec

### Test 12 — Rafraîchissement du tableau après chaque transition
Étapes : après chaque action du test 11, refermez la fiche et vérifiez le tableau principal : statut, indicateurs Bloquée/Archivée et étape affichés.
Résultat attendu : mise à jour immédiate et correcte à chaque fois, sans avoir besoin de recharger l'application.
☐ Succès ☐ Échec

### Test 13 — Vue "Bloquées"
Étapes : bloquez une commande (si ce n'est déjà fait) -> cliquez sur l'onglet "Bloquées" du tableau de bord.
Résultat attendu : seules les commandes actuellement bloquées apparaissent ; le nombre entre parenthèses sur l'onglet correspond.
☐ Succès ☐ Échec

### Test 14 — Vue "Archivées"
Étapes : archivez une commande terminée -> cliquez sur l'onglet "Archivées".
Résultat attendu : la commande y apparaît et disparaît des autres vues (Toutes, En cours...).
☐ Succès ☐ Échec

### Test 15 — Impression
Étapes : ouvrez une commande "Terminée" -> "Imprimer".
Résultat attendu : la boîte de dialogue d'impression de votre système s'ouvre. Voir limite connue ci-dessous : la mise en page n'est pas encore optimisée pour l'impression, c'est attendu à ce stade.
☐ Succès ☐ Échec

### Test 16 — Export
Étapes : depuis une fiche de commande "Terminée" -> "Exporter". Ouvrez ensuite le fichier généré.
Résultat attendu : un fichier Excel s'ouvre avec toutes les commandes (pas seulement celle consultée — voir limite connue). Vérifiez que les colonnes et les accents s'affichent correctement.
☐ Succès ☐ Échec

### Test 17 — Vérification visuelle à différentes résolutions
Étapes : redimensionnez la fenêtre de l'application (petite, moyenne, plein écran) ; ouvrez la fiche détaillée et le formulaire de commande à chaque taille.
Résultat attendu : pas de texte coupé ni de boutons inaccessibles ; le tableau reste lisible (défilement horizontal acceptable sur petite fenêtre).
☐ Succès ☐ Échec

---

## Limites connues

- Impression : utilise actuellement la fonction d'impression standard du navigateur (window.print()), sans mise en page dédiée. Fonctionnelle mais non optimisée visuellement pour cette v1.
- Export depuis la fiche d'une commande : exporte actuellement l'ensemble des commandes de la base, pas uniquement celle consultée. Un export filtré à une seule commande n'a pas encore été développé.
- Aucun test graphique n'a pu être exécuté dans l'environnement de développement (pas d'accès réseau pour installer Electron/React, pas d'affichage disponible). Tout ce qui touche à l'apparence, aux clics et à l'ergonomie réelle repose donc entièrement sur les tests manuels de la Partie 2 ci-dessus.

---

## Messages d'erreur rencontrés

(à remplir par vous si un test échoue — indiquez le numéro du test, puis collez le message exact copié depuis la console concernée)

Test n° :
```
(coller ici le message d'erreur exact)
```
