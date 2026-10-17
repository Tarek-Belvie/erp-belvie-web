# Diagnostic — Photos sur le web

**Diagnostic uniquement. Aucune écriture, aucun upload, aucun bucket créé, aucun code modifié.**

---

## 1. Architecture actuelle

Trois couches, dont une seule est cassée sur le web.

```
FICHIERS        %APPDATA%\Belvie ERP\images\…          (poste Windows uniquement)
                        │
BASE            photo_path = "images/commandes/<uuid>.jpg"   ← chemin RELATIF, portable
                        │
AFFICHAGE       mediaUrl(relPath) → "belvie-media://local/" + relPath
                        │
                ┌───────┴────────┐
         Electron              Navigateur
   protocole enregistré      schéma INCONNU
   main.js:32-46             aucune requête émise
   → sert le fichier         → image cassée
```

Le point remarquable : **la base est déjà portable.** `electron/ipc/photos.js:29` :

```js
// Chemin relatif au dossier de données (jamais un chemin absolu propre à une machine),
// avec des séparateurs "/" uniformes quel que soit l'OS.
function toRelative(absPath) {
  return path.relative(getUserDataDir(), absPath).split(path.sep).join("/");
}
```

Aucun `C:\`, aucun `AppData` en base. **Aucun chemin n'est à réécrire** — c'est ce qui rend la migration peu risquée.

Côté Electron, `main.js:26` déclare le schéma comme `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, et `main.js:34-45` le sert depuis `userData` avec une garde anti-traversée de chemin.

## 2. Tables et champs concernés

### Périmètre web (migré vers PostgreSQL)

| Table | Colonnes | Contrainte | Lot |
|---|---|---|---|
| `article_photos` | `photo_path`, `photo_thumb_path` | **NOT NULL** | **1 — à traiter** |
| `planning_articles` | `photo_path`, `photo_thumb_path` | nullable | 2 |
| `entreprise` | `logo_path` | nullable | 2 |
| `bc_pf` | `photo_snapshot_path`, `entreprise_logo_snapshot_path` | nullable | 2 |

### Hors périmètre web (SQLite seulement)

`ft_croquis.image_path` (NOT NULL) et `accessoires_catalogue.photo_path` appartiennent à la Fiche technique, non migrée. Rien à faire, mais à ne pas oublier le jour où ce module passera au web.

### Un point important sur les commandes

`commandes.photo_thumb_path` **n'existe pas** comme colonne. Les vues de commandes (`CommandesPage`, `CommandeDetailModal`, `LancerProductionScreen`) reçoivent ce champ par jointure depuis la photo principale de l'article. **Traiter `article_photos` répare donc simultanément les vues Articles, Commandes et une partie du Planning** — c'est pourquoi commencer par là est le bon choix.

## 3. Emplacement physique

```
%APPDATA%\Belvie ERP\
└── images\
    ├── commandes\              ← photos d'articles (mal nommé, historique)
    │   ├── <uuid>.jpg              originaux, noms crypto.randomUUID()
    │   └── thumbs\
    │       └── <uuid>.jpg          miniatures JPEG 160×160 qualité 72 (sharp)
    ├── entreprise\             ← logo
    └── bc_pf\                  ← snapshots figés, bcpf-<uuid>.ext
```

`snapshotArticlePhoto()` (`photos.js:169-181`) fait une **copie physique réelle** vers `images/bc_pf/`, pas une référence. Les snapshots de BC PF sont donc des fichiers autonomes : ils ne cassent pas si la photo d'article est supprimée, et ils devront être uploadés séparément au lot 2.

Les photos de planning, elles, **partagent** les fichiers des articles quand elles proviennent d'un article : `shared/planning.js:93` fait `photo_affichee: row.article_photo_path || row.photo_path`. Une partie du planning sera donc réparée gratuitement par le lot 1.

## 4. Forme exacte des chemins

Attendu, à confirmer par le diagnostic SQL : `images/commandes/<uuid>.jpg` pour les originaux, `images/commandes/thumbs/<uuid>.jpg` pour les miniatures.

Cas particulier à surveiller : `photos.js:80` initialise `photo_thumb_path = photo_path` en repli si `sharp` échoue. Une ligne où les deux colonnes sont identiques signale une miniature jamais générée — sans gravité, mais bon à connaître avant l'upload.

PostgreSQL contient exactement les mêmes valeurs : la migration a copié les colonnes telles quelles, sans transformation.

## 5. Les 21 consommateurs de `mediaUrl()`

Un seul point de passage, `src/modules/commandes/uiHelpers.ts:11-14`. C'est le principal atout de cette migration : **une seule fonction à modifier**.

| Module | Appels | Colonne source | Lot |
|---|---|---|---|
| `articles/` | 2 | `article_photos.*` | **1** |
| `commandes/` | 4 | photo principale de l'article (jointure) | **1** |
| `wizard/` | 2 | `article_photos.photo_thumb_path` | **1** |
| `planning/` | 4 | article ou photo propre | 1 partiel, 2 |
| `bcpf/` | 2 | `bc_pf.*_snapshot_path` | 2 |
| `entreprise/`, `settings/` | 2 | `entreprise.logo_path` | 2 |
| `ficheTechnique/` | 3 | `ft_croquis`, `accessoires` | hors périmètre |

Le lot 1 couvre donc 8 appels directs, plus une partie du planning.

## 6. Stratégie proposée pour Supabase Storage

**Principe directeur : le chemin en base reste la clé.** Le bucket reproduit l'arborescence `images/commandes/...` à l'identique, de sorte que `photo_path` serve tel quel de clé d'objet. Aucun `UPDATE`, aucune colonne ajoutée, aucune remigration.

Supabase plutôt que R2 : déjà configuré, authentifié, payé, et les variables `R2_*` de `.env.example` sont vides. Un fournisseur de moins à gérer.

**`mediaUrl()` devient sensible à l'environnement.** Sous Electron, le protocole actuel, inchangé. Sur le web, l'URL publique Supabase préfixant le même chemin relatif. La détection se fait sur la présence de `window.api` natif ou sur `import.meta.env`, comme le fait déjà `webApiShim`.

**L'upload est à sens unique et non destructif** : lecture seule côté disque, aucune suppression, aucun déplacement. Les originaux restent en place, Electron continue de fonctionner à l'identique. Le script sera idempotent — un objet déjà présent est ignoré — et journalisé, sur le modèle de celui de la migration.

**Deux décisions t'appartiennent avant que je code.**

*Bucket public ou URLs signées.* Public : `mediaUrl()` reste une simple concaténation, les images se mettent en cache, mais toute personne connaissant l'URL y accède — sachant que les noms sont des UUID aléatoires, donc non devinables. Signé : contrôle d'accès réel, mais il faut un appel API par image et une gestion d'expiration, ce qui complique `mediaUrl()` qui devient asynchrone. Pour des photos de vêtements, je recommande **public** — sauf si tu considères ton catalogue comme confidentiel.

*Miniatures.* Les uploader aussi, ou les régénérer côté Supabase. Uploader est plus simple et fidèle à l'existant ; c'est ce que je recommande pour le lot 1.

## 7. Risques

**Electron : aucun.** Le protocole n'est pas touché, les fichiers ne bougent pas, la base non plus. La seule modification côté client est une branche supplémentaire dans `mediaUrl()`, inactive sous Electron. Risque résiduel : une erreur de détection d'environnement ferait basculer Electron sur les URLs web — à couvrir par un test explicite des deux branches.

**Web.** Un fichier absent du bucket donnera un 404 au lieu d'une image cassée : plus lisible, mais toujours pas d'image. D'où le contrôle de couverture après upload — chaque ligne d'`article_photos` doit avoir son objet.

**Photos historiques : le vrai risque.** `article_photos.photo_path` et `photo_thumb_path` sont **NOT NULL** : toute ligne pointe vers un fichier censé exister. Si un fichier a été supprimé du disque sans que la ligne le soit, l'upload le signalera. Il faut alors décider — retrouver le fichier, ou accepter une image manquante — mais **jamais** supprimer la ligne, qui porte `est_principale` et `ordre`, structurants pour l'affichage.

**Divergence après upload.** Une photo ajoutée depuis Electron après l'upload n'existera pas dans le bucket : le web affichera un trou. Trois issues possibles — relancer périodiquement le script, faire écrire Electron dans les deux emplacements, ou faire de Supabase Storage la source unique. Le lot 1 n'a pas à trancher, mais la question devra l'être avant un usage web quotidien.

**Ce que le lot 1 ne répare pas** : le logo d'entreprise, les snapshots de BC PF et les photos de planning propres resteront cassés sur le web. C'est le lot 2, et c'est cohérent avec ta consigne de commencer par les articles et commandes.

---

## Ce qui manque pour chiffrer

Les deux diagnostics livrés précédemment et non encore exécutés :

- `diagnostic-photos.sql` — contenu réel des 19 lignes, nature des chemins, miniatures identiques à l'original, recensement des autres colonnes.
- `compter-fichiers-photos.ps1` — nombre de fichiers physiques, en distinguant originaux et miniatures.

Attention en comparant : `images/commandes/` peut contenir des fichiers orphelins issus de photos supprimées, `cleanupOldPhoto` n'étant appelé que sous condition. **Un nombre de fichiers supérieur à 19 est normal et sans gravité.** L'inverse — moins de fichiers que de lignes — serait le vrai signal d'alerte.
