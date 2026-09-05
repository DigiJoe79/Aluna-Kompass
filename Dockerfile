# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/kompass/package.json apps/kompass/
COPY apps/site/package.json apps/site/
COPY packages/core/package.json packages/core/
COPY packages/documents/package.json packages/documents/
COPY packages/markdown/package.json packages/markdown/
COPY packages/mcp/package.json packages/mcp/
COPY packages/modules/animals/package.json packages/modules/animals/
COPY packages/modules/website/package.json packages/modules/website/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @kompass/app build

FROM node:26-bookworm-slim AS runner
ARG TYPST_VERSION=0.15.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils rsync openssh-client \
 && curl -sSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
    | tar -xJ -C /usr/local/bin --strip-components=1 "typst-x86_64-unknown-linux-musl/typst" \
 && typst --version \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    APP_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/kompass.db \
    MEDIA_PATH=/media \
    SITE_DIR=/app/apps/site \
    SITE_CACHE_DIR=/data/site-cache \
    SITE_PREVIEW_DIR=/data/site-preview \
    KOMPASS_MIGRATIONS_DIR=/app/packages/core/src/db/migrations \
    KOMPASS_TEMPLATES_DIR=/app/packages/documents/templates \
    KOMPASS_FONTS_DIR=/app/packages/documents/fonts
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/kompass/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/kompass/.next/static ./apps/kompass/.next/static
COPY --from=build --chown=node:node /app/apps/site ./apps/site
COPY --from=build --chown=node:node /app/packages/markdown ./packages/markdown
COPY --from=build --chown=node:node /app/packages/core/src/db/migrations ./packages/core/src/db/migrations
COPY --from=build --chown=node:node /app/packages/documents/templates ./packages/documents/templates
COPY --from=build --chown=node:node /app/packages/documents/fonts ./packages/documents/fonts
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data /media && chown node:node /data /media && chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
VOLUME ["/data", "/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/kompass/server.js"]
