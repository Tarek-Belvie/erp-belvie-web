# Image de l'API Belvie ERP (et du planificateur de sauvegardes, même image).
FROM node:22-bookworm-slim

# pg_dump/pg_restore (sauvegardes), Chromium (génération des PDF), polices.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tar gzip \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 chromium fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    DOSSIER_DONNEES=/donnees/fichiers \
    DOSSIER_SAUVEGARDES=/donnees/sauvegardes \
    PORT=3001

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --omit=dev --no-audit --no-fund
COPY apps/api apps/api
# Outil de reprise des données de la version Electron (base SQLite → PostgreSQL).
COPY tools/reprise-donnees tools/reprise-donnees

WORKDIR /app/apps/api
RUN mkdir -p /donnees/fichiers /donnees/sauvegardes && chown -R node:node /donnees
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3001/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
