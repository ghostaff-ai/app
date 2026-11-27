# Ghostaff's agent runner (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner»): the unmodified
# Claude Code in a container, one run per execution of the Cloud Run job `agent-runner`. Built from the repo
# root (scripts/deploy-runner.sh):
#   docker build -f apps/runner/Dockerfile .
# Ported from ghostaff-ai/agents' imagen/Dockerfile. What is in the image no agent can change: the entry,
# the guard and the constitution are root's and read-only.
# One image for every agent, media tools included (docs/architecture.md, «The runner's image»).
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
# Media, for an agent that makes audio or video (Órdago's La Mesa, Productor and Orgánico, and any agent's
# ~/outbox/ audio): ffmpeg and ffprobe to cut, mix and encode; chromium to render a page headless, with a
# text font and the colour emoji one so neither comes out as boxes. chromium also brings the libraries the
# headless Chrome that Remotion downloads for itself needs (ordago-reels).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git python3 python3-yaml jq ripgrep \
      ffmpeg chromium fonts-liberation fonts-noto-color-emoji \
 && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "google-cloud-cli=${GOOGLE_CLOUD_CLI_VERSION}" \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# chromium without its own sandbox, which needs user namespaces (blocked in a container) or a setuid-root
# helper (chromium-sandbox) that would hand `agente` a way towards root, who holds the run's secrets. Without
# it a page chromium renders can do what `agente` can already do with Bash, no more; the container stays the
# boundary. Remotion's headless Chrome passes the same flag on its own.
RUN printf '# Ghostaff (apps/runner/Dockerfile): no user namespaces and no setuid helper in the runner.\nexport CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox"\n' > /etc/chromium.d/ghostaff-no-sandbox

# uv for the Python a repo pins for itself (ordago-reels' bin/instalar makes its venv with Python 3.14 and its
# requirements) and for scripts that declare their dependencies inline (`uv run`). What it downloads goes to
# the agent's home, never to the image. The version ghostaff-ai/agents' image runs Órdago's agents with, in
# the glibc build as that image's (pip's wheel): the static musl one's resolver fails where glibc's works.
# A bump changes the two checksums too (each release's uv-<arch>-unknown-linux-gnu.tar.gz.sha256). Root's,
# whatever owner the archive names (its uid is 1001, which is `agente`'s here).
ARG UV_VERSION=0.11.26
ARG UV_SHA256_AMD64=6426a73c3837e6e2483ee344cbc00f36394d179afcba6183cb77437e67db4af0
ARG UV_SHA256_ARM64=befa1a59c91e96eb601b0fd9a97c03dd666f17baba644b2b4db9c59a767e387e
RUN case "$(dpkg --print-architecture)" in \
      amd64) arch=x86_64 sum="$UV_SHA256_AMD64" ;; \
      arm64) arch=aarch64 sum="$UV_SHA256_ARM64" ;; \
      *) echo "uv: no checksum for $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/uv.tar.gz "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${arch}-unknown-linux-gnu.tar.gz" \
 && echo "$sum  /tmp/uv.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/uv.tar.gz -C /usr/local/bin --no-same-owner --strip-components=1 "uv-${arch}-unknown-linux-gnu/uv" "uv-${arch}-unknown-linux-gnu/uvx" \
 && chown root:root /usr/local/bin/uv /usr/local/bin/uvx && chmod 755 /usr/local/bin/uv /usr/local/bin/uvx \
 && rm /tmp/uv.tar.gz \
 && uv --version

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
# GitHub's `gh`, for an agent that handles a repo's pull requests (agents.repos `prs`; Órdago's Desarrollo lands
# its own with `pnpm pr:land`). The real one is /usr/bin/gh; /usr/local/bin/gh, first in the agent's PATH, asks
# the runner for that repo's token on each call (src/gh.mjs), so no token is ever in the agent's environment.
ARG GH_VERSION=2.103.3
ARG GH_SHA256=e3bafef96328d1a67de3a968bdfe1cc2ffd58cf6aba8b5e201356897ed06bb3d
RUN curl -fsSL -o /tmp/gh.deb "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.deb" \
 && echo "${GH_SHA256}  /tmp/gh.deb" | sha256sum -c - \
 && dpkg -i /tmp/gh.deb && rm /tmp/gh.deb \
 && printf '#!/bin/sh\nexec node /opt/runner/apps/runner/src/gh.mjs /usr/bin/gh "$@"\n' > /usr/local/bin/gh \
 && chmod 755 /usr/local/bin/gh
RUN chmod -R a-w /etc/claude-code /opt/runner \
 && useradd --create-home --shell /bin/bash agente

# The entry stays root to keep the secrets to itself: it runs git and Claude Code as `agente`, who cannot read
# root's memory or environment.
WORKDIR /opt/runner/apps/runner
CMD ["node_modules/.bin/tsx", "src/main.ts"]
