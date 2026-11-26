# Ghostaff's agent runner (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner»): the unmodified
# Claude Code in a container, one run per execution of the Cloud Run job `agent-runner`. Built from the repo
# root (scripts/deploy-runner.sh):
#   docker build -f apps/runner/Dockerfile .
# Ported from ghostaff-ai/agents' imagen/Dockerfile. What is in the image no agent can change: the entry,
# the guard and the constitution are root's and read-only.
FROM node:22-slim

ARG CLAUDE_CODE_VERSION=2.1.330
ARG GOOGLE_CLOUD_CLI_VERSION=594.0.0-0
ENV DEBIAN_FRONTEND=noninteractive \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production

# git for the record; python3 with yaml because the record's own checks use it (Órdago's pre-commit,
# Legal's skill); jq and ripgrep as on a person's machine. The Google Cloud CLI (gcloud, bq) for an
# organisation that gives its agents its own Google Cloud (docs/plans/ongoing/customer-cloud-access.md):
# it only ever holds the run's token as that organisation's account.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git python3 python3-yaml jq ripgrep \
 && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "google-cloud-cli=${GOOGLE_CLOUD_CLI_VERSION}" \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

WORKDIR /opt/runner
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/runner/package.json apps/runner/
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter @ghostaff/runner...
COPY apps/runner/src apps/runner/src

# The constitution every agent reads and none can edit.
COPY apps/runner/managed-settings.json /etc/claude-code/managed-settings.json
# `ghostaff ejecuciones` / `ghostaff leer`: the agent's earlier runs, asked of the runner on 127.0.0.1 (src/cli.ts).
RUN printf '#!/bin/sh\nexec /opt/runner/apps/runner/node_modules/.bin/tsx /opt/runner/apps/runner/src/cli.ts "$@"\n' > /usr/local/bin/ghostaff \
 && chmod 755 /usr/local/bin/ghostaff
RUN chmod -R a-w /etc/claude-code /opt/runner \
 && useradd --create-home --shell /bin/bash agente

# The entry stays root to keep the secrets to itself: it runs git and Claude Code as `agente`, who cannot read
# root's memory or environment.
WORKDIR /opt/runner/apps/runner
CMD ["node_modules/.bin/tsx", "src/main.ts"]
