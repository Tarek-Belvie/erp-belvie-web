# Déploiement

Deux cibles possibles. **La cible retenue est A (tout sur Vercel).** B reste documentée pour le jour
où un serveur dédié serait préféré (le code fonctionne dans les deux cas, sans modification).

---

## A. Tout sur Vercel — cible retenue

| Élément | Où | Mise à jour |
|---|---|---|
| Interface React | **Vercel**, fichiers statiques (`apps/web/dist`) | automatique à chaque push sur `main` |
| API | **Vercel**, une fonction serverless (`api/index.js`, région `fra1` Francfort) | idem |
| Base PostgreSQL | **Neon**, reliée au projet Vercel (onglet *Storage*), région **Frankfurt** | migrations au build de production |
| Images (photos, croquis, logo) | **Cloudflare R2**, bucket `belvie-backup`, dossier `fichiers/` | — |
| Sauvegardes | **GitHub Actions** → R2, bucket `belvie-sauvegardes`, chaque nuit à 00:00 (Paris), 5 versions | `.github/workflows/sauvegarde.yml` |

> **Latence** : l'API fait de nombreuses petites requêtes par écran ; la fonction (`fra1`) et la base Neon
> doivent être dans la même région (Frankfurt). Une base aux États-Unis rendrait chaque écran lent.

Ce que fait le déploiement (`vercel.json` à la racine) :
- `npm ci`, puis `npm run vercel-build` (`tools/vercel/build.js`) : construit l'interface puis, **en
  production seulement et en dernier**, applique les migrations par la connexion directe
  `DATABASE_URL_UNPOOLED` (une transaction par migration ; si l'une échoue, le build échoue) ;
- `/api/*` et `/media/*` → la fonction `api/index.js` ; tout le reste → l'interface ;
- les PDF sont générés par Chromium serverless (`@sparticuz/chromium`).

Limites propres à Vercel, prises en compte :
- **4,5 Mo par requête et par réponse** : les photos de plus de 3 Mo sont réduites dans le navigateur
  avant l'envoi (`apps/web/src/api/client.ts`, `reduireSiNecessaire`) ; `/media/...` répond par une
  redirection vers un lien R2 signé d'une heure (l'image ne transite pas par la fonction) ; les images
  intégrées aux PDF sont réduites à 1600 px ;
- **pas de disque durable** : tout fichier va dans R2 (`apps/api/src/lib/stockage.js`) ; les téléversements
  abandonnés sont purgés chaque nuit (`apps/api/scripts/nettoyer-televersements.js`) ;
- **pas de `pg_dump`** : l'écran *Paramètres → Sauvegardes* liste les sauvegardes de la nuit, les vérifie
  (relecture complète + SHA-256) et les télécharge par lien signé de 5 minutes. Pas de bouton
  « Sauvegarder maintenant » : GitHub → *Actions* → « Sauvegarde de la base » → *Run workflow*.

### A.1 Base Neon (une fois)

Vercel → projet → *Storage* → *Create Database* → **Neon** → région **Frankfurt (eu-central-1)** → *Connect*
(Production, Preview, Development). Vercel ajoute seul `DATABASE_URL` (pooler) et `DATABASE_URL_UNPOOLED`.

### A.2 Cloudflare R2 : deux buckets, trois clés (une fois)

Les sauvegardes sont séparées des fichiers, et l'application ne peut **que lire** les sauvegardes :
ni un bug ni une fuite des clés de l'application ne peut les effacer.

| Bucket | Contenu |
|---|---|
| `belvie-backup` (existant) | `fichiers/` : photos, croquis, logo (déjà envoyés le 18/10/2026) |
| `belvie-sauvegardes` (à créer) | `base/` : les 5 sauvegardes de la nuit |

R2 → *Manage API tokens* → *Create API token*, chaque fois en **limitant au bucket indiqué** :

| Clé | Permission | Bucket | Utilisée par |
|---|---|---|---|
| `belvie-app` | Object Read & Write | `belvie-backup` | Vercel + GitHub (purge des téléversements) |
| `belvie-sauvegardes-lecture` | Object Read only | `belvie-sauvegardes` | Vercel (écran Sauvegardes) |
| `belvie-sauvegardes-ecriture` | Object Read & Write | `belvie-sauvegardes` | GitHub Actions uniquement |

Puis **supprimer l'ancienne clé** à droits étendus (celle qui a circulé pendant la mise en place).

### A.3 Variables d'environnement Vercel (une fois)

Vercel → projet → *Settings* → *Environment Variables*, environnement **Production** :

| Variable | Valeur |
|---|---|
| `STOCKAGE` | `r2` (obligatoire : sans elle, l'API refuse de démarrer plutôt que de perdre des fichiers) |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `belvie-backup` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | clé `belvie-app` |
| `R2_SAUVEGARDES_BUCKET` | `belvie-sauvegardes` |
| `R2_SAUVEGARDES_ACCESS_KEY_ID`, `R2_SAUVEGARDES_SECRET_ACCESS_KEY` | clé `belvie-sauvegardes-lecture` |

Réglages du projet : *Root Directory* = **vide** (racine du dépôt) ; *Framework Preset* = **Other**.
Les commandes viennent de `vercel.json`.

**Prévisualisations** (branches autres que `main`) : elles recevraient sinon la base et le bucket de
production. Dans l'intégration Neon, activer la **création d'une branche de base par prévisualisation** ; ne
pas donner les variables R2 à l'environnement *Preview* (une prévisualisation ne peut alors pas enregistrer
de photo, ce qui est voulu).

### A.4 Secrets GitHub pour la sauvegarde (une fois)

GitHub → dépôt → *Settings* → *Secrets and variables* → *Actions* :

| Secret | Valeur |
|---|---|
| `DATABASE_URL_UNPOOLED` | Vercel → Storage → base Neon → `.env.local` → ligne `DATABASE_URL_UNPOOLED` |
| `R2_ENDPOINT` | comme sur Vercel |
| `R2_SAUVEGARDES_BUCKET` | `belvie-sauvegardes` |
| `R2_SAUVEGARDES_ECRITURE_ACCESS_KEY_ID`, `R2_SAUVEGARDES_ECRITURE_SECRET_ACCESS_KEY` | clé `belvie-sauvegardes-ecriture` |
| `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `belvie-backup` + clé `belvie-app` |
| facultatif : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_DESTINATAIRE` | e-mail de compte rendu |

Premier essai : *Actions* → « Sauvegarde de la base » → *Run workflow*, puis vérifier dans l'application
(*Paramètres → Sauvegardes → Vérifier*).

> GitHub suspend les tâches planifiées d'un dépôt sans aucun commit pendant 60 jours : il envoie alors
> un e-mail ; un clic sur *Enable workflow* les relance.

### A.5 Bascule des données Electron (une fois)

1. **Images** : `envoyer-fichiers-vers-r2.bat` (déjà fait le 18/10/2026 ; sans risque à relancer).
2. **Base** : après le premier déploiement de production, sur le PC qui a Belvie ERP Electron :
   **fermer Belvie ERP**, puis double-clic sur `reprise-vers-neon.bat`. Il demande l'URL
   `DATABASE_URL_UNPOOLED`, applique le schéma, fait un contrôle à blanc, demande « OUI », copie tout en une
   transaction avec vérification table par table, puis fait créer le compte administrateur (mot de passe
   saisi à l'écran, jamais affiché). Une base qui contient déjà des données est refusée.
3. À partir de là, **ne plus utiliser l'application Electron.**

Autres comptes : *Paramètres* de l'application, ou `npm run utilisateur -- creer <email> "<Nom>"` avec
`DATABASE_URL` pointant sur Neon.

### A.6 Mettre à jour

Push sur `main` → Vercel construit, migre et publie. Une branche autre que `main` donne une
**prévisualisation** qui utilise la même base mais n'applique jamais de migration : ne pas y tester une
branche qui contient une nouvelle migration. Une migration doit rester compatible avec la version
précédente du code (règle D31) : celle-ci tourne encore pendant le build et en cas de retour arrière.
Sauvegarde manuelle avant toute migration de données (règle D29).

---

## B. Variante : API et fichiers sur un serveur Docker

### B.1 Serveur (une fois)

Prérequis : une machine Linux (2 vCPU, 4 Go de RAM suffisent ; Chromium sert à générer les PDF), Docker et le plugin Compose, et un nom de domaine pour l'API (ex. `api.belvie.fr`) avec un enregistrement DNS **A** vers l'IP du serveur. Ports 80 et 443 ouverts.

```bash
git clone https://github.com/Tarek-Belvie/erp-belvie-web.git /opt/belvie && cd /opt/belvie
cp .env.example .env && chmod 600 .env
nano .env        # DATABASE_URL, DOMAINE_API, R2_*, SMTP_*, MAIL_DESTINATAIRE
```

- **Base Neon** : `DATABASE_URL` = l'URL **sans** `-pooler` (« unpooled »). Les migrations et `pg_dump` ont besoin d'une connexion directe.
- **Base sur le serveur** : `DATABASE_URL=postgres://belvie:<mot de passe>@postgres:5432/belvie` et `POSTGRES_PASSWORD=<mot de passe>`, puis lancer avec `--profile base-locale`.

```bash
docker compose up -d --build                         # base Neon
# ou : docker compose --profile base-locale up -d --build
docker compose logs -f api                           # « 3 migration(s) appliquée(s) » puis « API à l'écoute »
docker compose exec api npm run utilisateur -- creer tarek.bouhejba2@gmail.com "Tarek Bouhejba" admin
curl https://api.belvie.fr/api/sante                 # {"resultat":{"statut":"ok"}}
```

### B.2 Reprise des données

À faire **après** le premier démarrage (schéma créé) et **avant** de donner l'accès aux utilisateurs.

1. Sur le PC de Tarek : **fermer Belvie ERP**, puis copier `%APPDATA%\belvie-erp\belvie.db` et le dossier `%APPDATA%\belvie-erp\images`.
2. Les envoyer sur le serveur (`scp`), dans `/opt/belvie/reprise/`.
3. Contrôle à blanc, puis reprise :

```bash
cd /opt/belvie
docker compose run --rm -v $PWD/reprise:/reprise api \
  node /app/tools/reprise-donnees/reprise.js --sqlite /reprise/belvie.db --pg "$DATABASE_URL"
#   → lit tout, compare les schémas, n'écrit rien. Si une table inconnue est signalée
#     (ex. ft_tailles_new, reste d'une ancienne migration), vérifier puis ajouter --ignorer-table <nom>.
docker compose run --rm -v $PWD/reprise:/reprise api \
  node /app/tools/reprise-donnees/reprise.js --sqlite /reprise/belvie.db --pg "$DATABASE_URL" \
  --ignorer-table ft_tailles_new --archive /reprise/archives --executer
#   → une seule transaction ; « Reprise terminée : contenu identique pour toutes les tables. »
```

4. Fichiers : copier le dossier `images` dans le volume de l'API.

```bash
docker compose cp reprise/images api:/donnees/fichiers/images
docker compose exec -u root api chown -R node:node /donnees/fichiers
```


### B.3 Interface sur Vercel, API sur le serveur

1. *Add New → Project* → importer `Tarek-Belvie/erp-belvie-web`.
2. **Root Directory** : `apps/web`. 
3. Créer `apps/web/vercel.json` avec des réécritures `/api/*` et `/media/*` vers le domaine de l'API (ce fichier n'existe plus depuis le passage au « tout Vercel »).
4. Aucune variable d'environnement n'est nécessaire côté Vercel : l'interface appelle `/api/...` sur sa propre origine, et Vercel relaie vers le serveur. Les cookies de session restent donc sur le domaine de l'interface.

### B.4 Mettre à jour

```bash
# Interface : automatique (push sur main → Vercel).
# API, sur le serveur :
cd /opt/belvie && git pull && docker compose up -d --build
docker compose logs --tail 50 api
```

Une migration en attente est appliquée au démarrage, dans une transaction. Si elle échoue, l'API ne démarre pas et l'erreur est dans le journal ; la base reste intacte. Avant une mise à jour qui contient une migration de données : `docker compose exec sauvegarde npm run sauvegarde:r2` (règle D29).

### B.5 Variables d'environnement

Toutes sont décrites dans [`.env.example`](../.env.example). Celles qui sont secrètes (`DATABASE_URL`, `R2_SECRET_ACCESS_KEY`, `SMTP_PASS`…) n'existent **que** dans le `.env` du serveur (droits 600), jamais dans Git.
