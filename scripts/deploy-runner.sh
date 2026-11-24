#!/usr/bin/env bash
# Deploys Ghostaff's agent runner (apps/runner) to an environment's Google Cloud project: the Cloud Run
# job `agent-runner` in europe-west1 that the engine starts once per agent run
# (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner»). Each run deploys the current commit.
#
#   bash scripts/deploy-runner.sh beta   # or prod
#
# The project must be set up first (scripts/setup-env.sh), which makes the runner's account (with no
# roles: it proves who it is to the engine with its ID token, and everything it touches the engine
# hands it per run). Runs on a laptop and in CI, like scripts/deploy-engine.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh "${1:-}"

JOB=agent-runner
RUNNER_SA="runner@$P.iam.gserviceaccount.com"
# The engine starts the job, with each run's id and nonce as overrides.
ENGINE_SA="engine@$P.iam.gserviceaccount.com"
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/runner/runner:$(git rev-parse --short HEAD)"

echo "== Build and push $IMAGE"
# Cloud Run runs amd64: built for it even on an Apple Silicon Mac (emulated, slower).
docker build --platform linux/amd64 -f apps/runner/Dockerfile -t "$IMAGE" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker push "$IMAGE"
docker logout "https://$REGISTRY" >/dev/null # the token was only for this push

# Our record store (scripts/setup-record-store.sh) is on the VPC: runs clone from it there. Only private ranges
# go through the VPC; GitHub, Anthropic and the web are reached as before.
NETWORK_FLAGS=()
if gcloud compute addresses describe record-store --region "$R" --project "$P" >/dev/null 2>&1; then
  NETWORK_FLAGS=(--network default --subnet default --vpc-egress private-ranges-only)
fi

echo "== The job"
# One task, no retries: a run that fails reports it, and a person asks again. Three hours, like the longest
# of Órdago's agents; memory for Claude Code and what it runs.
if gcloud run jobs describe "$JOB" --region "$R" --project "$P" >/dev/null 2>&1; then VERB=update; else VERB=create; fi
gcloud run jobs "$VERB" "$JOB" --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$RUNNER_SA" --tasks 1 --max-retries 0 --task-timeout 3h \
  --cpu 2 --memory 4Gi ${NETWORK_FLAGS[@]+"${NETWORK_FLAGS[@]}"} >/dev/null

echo "== The engine may start it, with overrides, and nothing else"
gcloud run jobs add-iam-policy-binding "$JOB" --project "$P" --region "$R" \
  --member "serviceAccount:$ENGINE_SA" --role roles/run.jobsExecutorWithOverrides >/dev/null

echo "Runner job $JOB ($GHOSTAFF_ENV) deployed with $IMAGE, running as $RUNNER_SA."
