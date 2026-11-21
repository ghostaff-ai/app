# The engine's HTTP service, built from the repo root:
#   docker build -f apps/engine/Dockerfile .
# Runs the TypeScript directly with tsx, like apps/sync: @ghostaff/shared is
# source, not a built package.
FROM node:22-slim
# The unmodified Claude Code, pinned: the engine runs its own sign-in for an
# owner connecting a Claude subscription, and `claude -p` for agents answering
# on it (src/claudeCode.ts). `script` (bsdutils) gives the sign-in a terminal.
RUN apt-get update && apt-get install -y --no-install-recommends bsdutils ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@2.1.330 \
  && npm cache clean --force
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
