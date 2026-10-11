FROM node:22-bookworm-slim AS dependencies

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXUS_HOST=0.0.0.0 \
    NEXUS_DATA_DIR=/var/lib/nexus/data \
    NEXUS_DB_FILE=/var/lib/nexus/data/nexus.db \
    NEXUS_WORKSPACE=/var/lib/nexus/workspace \
    NEXUS_WORKSPACES_DIR=/var/lib/nexus/workspaces

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./

COPY --chown=node:node src ./src
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

RUN mkdir -p /var/lib/nexus/data /var/lib/nexus/workspace /var/lib/nexus/workspaces \
    && chown -R node:node /var/lib/nexus

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
