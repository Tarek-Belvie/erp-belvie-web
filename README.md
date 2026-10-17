# Belvie ERP

ERP de production textile de Belvie : articles et fiches techniques, commandes de production, planning, bons de commande (produits finis et matières premières), approvisionnement, finance.

Depuis la version 2, c'est une **application web** : une interface React servie par Vercel, et une API Node.js/Express avec une base **PostgreSQL**. Elle remplace l'application de bureau Electron/SQLite 1.0.1, dont le code est conservé dans l'historique Git (tag `electron-1.0.1`).

```
Navigateur ──► Vercel (interface React)
                 │  /api/*  et  /media/*  (réécritures, même origine)
                 ▼
              Serveur : Caddy (HTTPS) ──► API Node/Express ──► PostgreSQL (Neon ou serveur)
                                            │
                                            ├── fichiers (photos, croquis, logo) : volume /donnees
                                            └── sauvegarde quotidienne ──► Cloudflare R2 + e-mail
```

## Démarrer en local

Prérequis : Node.js 22, Docker (ou un PostgreSQL 16+ local).

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL de développement
cp .env.example .env                              # puis DATABASE_URL=postgres://belvie:belvie@localhost:5432/belvie
npm run db:migrer                                 # crée le schéma et les données de référence
npm run utilisateur --workspace apps/api -- creer vous@exemple.fr "Votre nom" admin
npm run dev                                       # API sur :3001, interface sur http://localhost:5173
```

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm run dev` | API (rechargement automatique) + interface Vite |
| `npm test` | Tests unitaires et tests de non-régression ancien/nouveau code |
| `npm run lint` | Contrôle statique de l'API (notamment les `await` oubliés) |
| `npm run db:migrer` | Applique les migrations en attente (`-- --statut` pour voir l'état) |
| `npm run generer --workspace apps/api` | Régénère le client web et `docs/api.md` depuis le registre des routes |
| `npm run utilisateur --workspace apps/api -- …` | Comptes : `creer`, `mot-de-passe`, `desactiver`, `lister` |
| `node tools/reprise-donnees/reprise.js …` | Reprise d'une base SQLite 1.0.x vers PostgreSQL |

## Organisation du dépôt

```
apps/api/            API Express
  src/db/            accès PostgreSQL (point unique) + lanceur de migrations
  src/modules/       code métier, un fichier par domaine (repris de la v1.0.1)
  src/routes/        registre des routes (source unique) + routes spéciales
  migrations/        migrations SQL versionnées (jamais modifiées une fois appliquées)
  scripts/           comptes utilisateurs, sauvegarde R2, génération
  test/              unitaires + non-régression (comparaison avec le code Electron d'origine)
apps/web/            interface React (Vite)
  src/api/client.ts  reconstruit window.api au-dessus de l'API HTTP
tools/               outils ponctuels : reprise des données, conversion du schéma et du code
docs/                architecture, règles de développement, modules, API, déploiement
deploiement/         configuration Caddy
```

## Documentation

- [Architecture et choix techniques](docs/architecture.md)
- [Règles de développement](docs/regles-developpement.md) (projet à valider ensemble)
- [Documentation des modules](docs/modules/README.md)
- [Référence de l'API](docs/api.md) (générée)
- [Déploiement](docs/deploiement.md) et [exploitation : sauvegardes et restauration](docs/exploitation/sauvegarde-restauration.md)
- [Migration depuis Electron : ce qui a changé](docs/migration-electron-vers-web.md)
