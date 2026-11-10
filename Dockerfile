# Stage 1: build (native modules need build tools)
FROM node:26.13.0-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g corepack && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: runtime
FROM node:26.13.0-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output ./.output
# SQL migrations are read from disk at startup (cwd = /app)
COPY --from=build /app/server/db/migrations ./server/db/migrations
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production NUXT_DATABASE_PATH=/app/data/spk.db PORT=3000 HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:3000/api/health
CMD ["sh", "-c", "mountpoint -q /app/data || { echo 'ERROR: nothing is mounted at /app/data. Mount a persistent volume there, otherwise the database is lost on redeploy.' >&2; exit 1; }; exec node .output/server/index.mjs"]
