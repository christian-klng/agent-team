# Agent Team — Web (Next.js, standalone)
FROM node:22-alpine AS builder
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
# Gefilterter Install: nur web + Workspace-Abhängigkeiten. Überspringt die
# Root-Dev-Dependencies (embedded-postgres, redis-memory-server) komplett.
RUN pnpm install --frozen-lockfile --filter "web..."
RUN pnpm --filter web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S app && adduser -S app -G app
# Standalone-Output enthält Server + benötigte node_modules (Monorepo-Layout).
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
