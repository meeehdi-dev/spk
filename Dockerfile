# Stage 1: build (native modules need build tools)
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: runtime
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output ./.output
# SQL migrations are read from disk at startup (cwd = /app)
COPY --from=build /app/server/db/migrations ./server/db/migrations
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production NUXT_DATABASE_PATH=/app/data/spk.db PORT=3000 HOST=0.0.0.0
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:3000/api/health
CMD ["node", ".output/server/index.mjs"]
