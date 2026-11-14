# The engine's HTTP service, built from the repo root:
#   docker build -f apps/engine/Dockerfile .
# Runs the TypeScript directly with tsx, like apps/sync: @ghostaff/shared is
# source, not a built package.
FROM node:22-slim
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/engine/package.json apps/engine/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ghostaff/engine...
COPY packages/shared packages/shared
COPY apps/engine apps/engine
WORKDIR /repo/apps/engine
ENV NODE_ENV=production PORT=8080
USER node
CMD ["node_modules/.bin/tsx", "src/server.ts"]
