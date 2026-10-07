# syntax=docker/dockerfile:1.7
# Live Class server image. Portable: runs on Render, Railway, Fly, a VPS or any Docker host.
# Build context is the repository root:  docker build -t live-class-server .

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS build
ENV CI=true
RUN npm install -g pnpm@12.9.1
WORKDIR /app

# Manifests first so dependency installation is cached independently of source changes.
# Every workspace package.json is copied so the lockfile's importers match the workspace.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/react/package.json packages/react/
COPY packages/server/package.json packages/server/
COPY apps/demo/package.json apps/demo/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @live-class/shared --filter @live-class/server --ignore-scripts=false

COPY packages/shared packages/shared
COPY packages/server packages/server
RUN pnpm --filter @live-class/shared build \
 && pnpm --filter @live-class/server build \
 && pnpm --filter @live-class/shared --filter @live-class/server prune --prod \
 && rm -rf packages/shared/src packages/server/src

# --- runtime -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "packages/server/dist/index.js"]
