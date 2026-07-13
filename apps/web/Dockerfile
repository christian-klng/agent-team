# Agent Team — Web (Next.js, standalone)
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11
# Dev-only-Pakete (lokales Postgres/Redis für `pnpm dev:services`) dürfen im
# Image keine Binaries kompilieren — im Build-Image fehlt make/gcc bewusst.
ENV REDISMS_DISABLE_POSTINSTALL=1
COPY . .
RUN pnpm install --frozen-lockfile
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
