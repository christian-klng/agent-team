# Agent Team — Worker (Sync, Agent-Runtime, Decision-Execution)
# bookworm-slim statt alpine: die Claude-Code-CLI der Agent SDK läuft auf glibc stabiler.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@11
COPY . .
RUN pnpm install --frozen-lockfile
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
