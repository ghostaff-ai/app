#!/usr/bin/env bash
# Sets up and deploys Ghostaff's agent runner (apps/runner): the Cloud Run job
# `agent-runner` in ghostaff-prod, europe-west1, that the engine starts once
# per agent run (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner»).
# Safe to re-run: every setup step checks first, and each run deploys the
# current commit.
#
#   bash scripts/deploy-runner.sh
#
# Needs a gcloud configuration signed in as ghostaff.ai@gmail.com (named
# `ghostaff` unless CLOUDSDK_ACTIVE_CONFIG_NAME says otherwise) and docker.
# The engine must know the runner's account: scripts/deploy-engine.sh sets
# RUNNER_IDENTITY to the same one.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME:-ghostaff}
P=ghostaff-prod
R=europe-west1
JOB=agent-runner
# Runs every organisation's agents, and has no role at all: it proves who it is to the engine with
# its ID token, and everything it touches (the record, the Claude subscription) the engine hands it per run.
RUNNER_SA="runner@$P.iam.gserviceaccount.com"
# The engine starts the job, with each run's id and nonce as overrides.
ENGINE_SA="engine@$P.iam.gserviceaccount.com"
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/runner/runner:$(git rev-parse --short HEAD)"

echo "== APIs"
gcloud services enable --project "$P" run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com

echo "== The runner's identity, with no roles"
gcloud iam service-accounts describe "$RUNNER_SA" --project "$P" >/dev/null 2>&1 ||
  gcloud iam service-accounts create runner --project "$P" --display-name "Ghostaff agent runner"

echo "== Image registry"
gcloud artifacts repositories describe runner --location "$R" --project "$P" >/dev/null 2>&1 ||
  gcloud artifacts repositories create runner --repository-format docker --location "$R" --project "$P"

echo "== Build and push $IMAGE"
# Cloud Run runs amd64: built for it even on an Apple Silicon Mac (emulated, slower).
docker build --platform linux/amd64 -f apps/runner/Dockerfile -t "$IMAGE" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker push "$IMAGE"
docker logout "https://$REGISTRY" >/dev/null # the token was only for this push

echo "== The job"
# One task, no retries: a run that fails reports it, and a person asks again. Three hours, like the longest
# of Órdago's agents; memory for Claude Code and what it runs.
if gcloud run jobs describe "$JOB" --region "$R" --project "$P" >/dev/null 2>&1; then VERB=update; else VERB=create; fi
gcloud run jobs "$VERB" "$JOB" --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$RUNNER_SA" --tasks 1 --max-retries 0 --task-timeout 3h \
  --cpu 2 --memory 4Gi >/dev/null

echo "== The engine may start it, with overrides, and nothing else"
gcloud run jobs add-iam-policy-binding "$JOB" --project "$P" --region "$R" \
  --member "serviceAccount:$ENGINE_SA" --role roles/run.jobsExecutorWithOverrides >/dev/null

echo "Runner job $JOB deployed with $IMAGE, running as $RUNNER_SA."
