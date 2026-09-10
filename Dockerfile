# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Node 26 liefert corepack nicht mehr mit; pnpm wird deshalb direkt
# installiert. Version identisch mit packageManager in package.json.
RUN npm install -g pnpm@11.25.0 && pnpm --version
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/kompass/package.json apps/kompass/
COPY packages/core/package.json packages/core/
COPY packages/documents/package.json packages/documents/
COPY packages/markdown/package.json packages/markdown/
COPY packages/mcp/package.json packages/mcp/
COPY packages/site-template/package.json packages/site-template/
COPY packages/modules/animals/package.json packages/modules/animals/
COPY packages/modules/contacts/package.json packages/modules/contacts/
COPY packages/modules/dms/package.json packages/modules/dms/
COPY packages/modules/site/package.json packages/modules/site/
COPY templates/verein-basis/package.json templates/verein-basis/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# next build rendert Seiten vor und laeuft dabei durch (shell)/layout.tsx,
# das readEnv() aufruft. Zur Bauzeit gibt es keine .env, deshalb ein
# Platzhalter — zur Laufzeit wird die Umgebung erneut gelesen, aus env_file.
RUN SESSION_SECRET=build-time-only-not-a-real-secret-0000000000 pnpm --filter @kompass/app build

FROM node:26-bookworm-slim AS runner
ARG TYPST_VERSION=0.15.1
# Zielarchitektur statt fester x86_64-Datei: Sonst zwingt jeder Bau auf einem
# ARM-Rechner das ganze Image in die Emulation, und die Container-Tests werden
# unbrauchbar langsam. Fuer die Registry baut die CI weiterhin amd64.
ARG TARGETARCH
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) typst_arch=x86_64 ;; \
      arm64) typst_arch=aarch64 ;; \
      *) echo "keine Typst-Datei fuer TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils rsync openssh-client sshpass \
 && curl -sSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${typst_arch}-unknown-linux-musl.tar.xz" \
    | tar -xJ -C /usr/local/bin --strip-components=1 "typst-${typst_arch}-unknown-linux-musl/typst" \
 && typst --version \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# Build-Kennung (CI: der Git-SHA; `pnpm image`: der kurze SHA). Erscheint im
# Sidebar-Fuss und unter /api/health. Ohne Argument steht „local".
ARG KOMPASS_BUILD=local
ENV NODE_ENV=production \
    APP_ENV=production \
    KOMPASS_BUILD=${KOMPASS_BUILD} \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/kompass.db \
    MEDIA_PATH=/media \
    SITE_CACHE_DIR=/data/site-cache \
    SITE_PREVIEW_DIR=/data/site-preview \
    KOMPASS_MIGRATIONS_DIR=/app/packages/core/src/db/migrations \
    KOMPASS_TEMPLATES_DIR=/app/packages/documents/templates \
    KOMPASS_FONTS_DIR=/app/packages/documents/fonts \
    KOMPASS_DOCUMENT_TEMPLATES_DIR=/data/document-templates
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/kompass/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/kompass/.next/static ./apps/kompass/.next/static
# Das mitgelieferte Basis-Template und das Paket, das seine Deklaration liest.
# Der Entrypoint kopiert das Template beim ersten Start ins Volume.
COPY --from=build --chown=node:node /app/templates/verein-basis ./templates/verein-basis
COPY --from=build --chown=node:node /app/packages/site-template ./packages/site-template
# Die tsconfig von packages/markdown erweitert die Basisdatei im Wurzel-
# verzeichnis. Ohne sie bricht der Site-Build ab, sobald vite den Markdown-
# Quellcode transformiert: „Tsconfig not found /app/tsconfig.base.json".
COPY --from=build --chown=node:node /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build --chown=node:node /app/packages/markdown ./packages/markdown
COPY --from=build --chown=node:node /app/packages/core/src/db/migrations ./packages/core/src/db/migrations
COPY --from=build --chown=node:node /app/packages/documents/templates ./packages/documents/templates
COPY --from=build --chown=node:node /app/packages/documents/fonts ./packages/documents/fonts
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --chown=node:node scripts/seed-site-template.sh /usr/local/bin/seed-site-template.sh
COPY --chown=node:node scripts/seed-document-templates.sh /usr/local/bin/seed-document-templates.sh
RUN mkdir -p /data /media && chown node:node /data /media \
 && chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/seed-site-template.sh /usr/local/bin/seed-document-templates.sh
USER node
VOLUME ["/data", "/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/kompass/server.js"]
