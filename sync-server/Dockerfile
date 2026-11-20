# syntax=docker/dockerfile:1.7
# Sync (WebSocket) server. Build context is the repo root (needs the root package.json).

# ---- deps: production node_modules only ----------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime ------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node sync-server ./sync-server

USER node
EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "sync-server/server.mjs"]
