# Agent Team — Worker (Sync, Agent-Runtime, Decision-Execution)
# bookworm-slim statt alpine: die Claude-Code-CLI der Agent SDK läuft auf glibc stabiler.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@11
# Dev-only-Pakete (lokales Postgres/Redis für `pnpm dev:services`) dürfen im
# Image keine Binaries kompilieren — im Build-Image fehlt make/gcc bewusst.
ENV REDISMS_DISABLE_POSTINSTALL=1
# pnpm-11-Supply-Chain-Checks im Image aus: sie feuern Hunderte Extra-Requests
# (Metadaten/Attestations) und scheitern auf schwachen Leitungen an Timeouts.
# Der Lockfile wurde bereits bei der Entwicklung gegen die Policies verifiziert.
ENV npm_config_minimum_release_age=0
ENV npm_config_trust_policy=off
ENV npm_config_fetch_retries=5
# Bevorzugt IPv4 — schützt vor Socket-Abbrüchen bei kaputtem IPv6-Routing.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
COPY . .
# Gefilterter Install: nur worker + Workspace-Abhängigkeiten. Überspringt die
# Root-Dev-Dependencies (embedded-postgres, redis-memory-server) komplett.
RUN pnpm install --frozen-lockfile --filter "worker..."
RUN pnpm --filter worker build
# Isolierte Produktions-node_modules nur mit Worker-Dependencies.
RUN pnpm --filter worker --prod deploy --legacy /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV AGENT_DATA_DIR=/data
ENV CLAUDE_CONFIG_DIR=/data/claude
ENV MIGRATIONS_DIR=/app/migrations
RUN groupadd -r app && useradd -r -g app -m app \
  && mkdir -p /data && chown app:app /data
COPY --from=builder --chown=app:app /out/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/apps/worker/dist ./dist
COPY --from=builder --chown=app:app /app/packages/db/migrations ./migrations
USER app
VOLUME /data
CMD ["node", "dist/index.js"]
