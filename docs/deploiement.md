# Déploiement

Cible retenue :

| Élément | Où | Mise à jour |
|---|---|---|
| Interface React | **Vercel** (projet relié au dépôt GitHub, dossier `apps/web`) | automatique à chaque push sur `main` |
| API + fichiers + sauvegardes | **Serveur** (Docker Compose : `api`, `sauvegarde`, `caddy`) | `git pull && docker compose up -d --build` |
| Base PostgreSQL | **Neon** (recommandé : région Europe — Frankfurt) *ou* conteneur `postgres` sur le serveur | migrations appliquées au démarrage de l'API |
| Sauvegardes hors site | **Cloudflare R2**, bucket `belvie-backup` | chaque nuit à 00:00 (Paris), 5 versions |

> **Latence** : l'API fait de nombreuses petites requêtes par écran. L'API et la base doivent être dans la **même région** (serveur en Europe → base Neon en `aws-eu-central-1`). Une base aux États-Unis avec un serveur en Europe rendrait chaque écran lent de plusieurs secondes.

---

## 1. Serveur (une fois)

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

## 2. Reprise des données de la version Electron (une fois)

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


## 3. Vercel (une fois)

1. *Add New → Project* → importer `Tarek-Belvie/erp-belvie-web`.
2. **Root Directory** : `apps/web`. Les commandes d'installation et de construction viennent de `apps/web/vercel.json`.
3. Dans `apps/web/vercel.json`, remplacer `api.exemple.fr` par le vrai domaine de l'API (deux lignes), puis commit sur `main`.
4. Aucune variable d'environnement n'est nécessaire côté Vercel : l'interface appelle `/api/...` sur sa propre origine, et Vercel relaie vers le serveur. Les cookies de session restent donc sur le domaine de l'interface.

## 4. Mettre à jour

```bash
# Interface : automatique (push sur main → Vercel).
# API, sur le serveur :
cd /opt/belvie && git pull && docker compose up -d --build
docker compose logs --tail 50 api
```

Une migration en attente est appliquée au démarrage, dans une transaction. Si elle échoue, l'API ne démarre pas et l'erreur est dans le journal ; la base reste intacte. Avant une mise à jour qui contient une migration de données : `docker compose exec sauvegarde npm run sauvegarde:r2` (règle D29).

## 5. Variables d'environnement

Toutes sont décrites dans [`.env.example`](../.env.example). Celles qui sont secrètes (`DATABASE_URL`, `R2_SECRET_ACCESS_KEY`, `SMTP_PASS`…) n'existent **que** dans le `.env` du serveur (droits 600), jamais dans Git.
