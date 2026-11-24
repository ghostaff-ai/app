#!/usr/bin/env bash
# The record store of an environment (docs/plans/ongoing/record-store.md): Forgejo on a small VM in
# the environment's project, with no public address. Its data disk has a daily snapshot kept 30 days
# in the EU; the engine and the runner reach it over the VPC (Direct VPC egress, set by the deploy
# scripts). Run by a person with owner rights on the project; safe to re-run, every step checks first.
#
#   bash scripts/setup-record-store.sh beta   # or prod
#
# Needs gcloud signed in as ghostaff.ai@gmail.com (scripts/env.sh picks the configuration) and docker,
# to copy Forgejo's image into our registry: the VM has no way out to the internet, only to Google's
# APIs. The admin's token never passes through here: the VM makes it on its first boot and adds it to
# the secret FORGEJO_ADMIN_TOKEN itself.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh "${1:-}"

ZONE="$R-b"
VM=record-store
DISK=record-store-data
POLICY=record-store-daily
NETWORK=default
ADMIN=ghostaff
FORGEJO_VERSION=15.0.12 # the LTS line; bump on purpose, after reading its release notes
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/record-store/forgejo:$FORGEJO_VERSION"
VM_SA="record-store@$P.iam.gserviceaccount.com"
SECRET=FORGEJO_ADMIN_TOKEN

retry() { local n; for n in 1 2 3 4 5 6; do "$@" >/dev/null 2>&1 && return; sleep 5; done; "$@" >/dev/null; }

echo "== $GHOSTAFF_ENV: the record store in $P ($ZONE)"
gcloud services enable compute.googleapis.com --project "$P"
# Turning Compute Engine on for the first time makes the `default` network; it takes a moment to show.
for i in $(seq 1 24); do
  gcloud compute networks subnets describe "$NETWORK" --region "$R" --project "$P" >/dev/null 2>&1 && break
  [ "$i" = 24 ] && { echo "no subnet $NETWORK in $R: make the default network first" >&2; exit 1; }
  sleep 10
done

echo "== Its own account: write its admin token's secret, pull its image, write logs; nothing else"
gcloud iam service-accounts describe "$VM_SA" --project "$P" >/dev/null 2>&1 ||
  gcloud iam service-accounts create record-store --project "$P" --display-name "Ghostaff record store"
retry gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$VM_SA" --role roles/logging.logWriter --condition None
retry gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$VM_SA" --role roles/monitoring.metricWriter --condition None
gcloud secrets describe "$SECRET" --project "$P" >/dev/null 2>&1 ||
  gcloud secrets create "$SECRET" --project "$P" --replication-policy user-managed --locations "$R" >/dev/null
retry gcloud secrets add-iam-policy-binding "$SECRET" --project "$P" --member "serviceAccount:$VM_SA" --role roles/secretmanager.secretVersionAdder

echo "== Forgejo's image, copied into our registry"
gcloud artifacts repositories describe record-store --location "$R" --project "$P" >/dev/null 2>&1 ||
  gcloud artifacts repositories create record-store --repository-format docker --location "$R" --project "$P"
retry gcloud artifacts repositories add-iam-policy-binding record-store --location "$R" --project "$P" \
  --member "serviceAccount:$VM_SA" --role roles/artifactregistry.reader
if ! gcloud artifacts docker images describe "$IMAGE" --project "$P" >/dev/null 2>&1; then
  # The VM is amd64: pushed for that platform explicitly, or a Mac with Apple Silicon would push its own arm64.
  docker pull --platform linux/amd64 "codeberg.org/forgejo/forgejo:$FORGEJO_VERSION"
  docker tag "codeberg.org/forgejo/forgejo:$FORGEJO_VERSION" "$IMAGE"
  gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
  docker push --platform linux/amd64 "$IMAGE"
  docker logout "https://$REGISTRY" >/dev/null
fi

echo "== The network: Google's APIs without a public address; Forgejo's port open to the VPC only"
gcloud compute networks subnets update "$NETWORK" --region "$R" --project "$P" --enable-private-ip-google-access >/dev/null
gcloud compute firewall-rules describe record-store-from-vpc --project "$P" >/dev/null 2>&1 ||
  gcloud compute firewall-rules create record-store-from-vpc --project "$P" --network "$NETWORK" \
    --direction INGRESS --action allow --rules tcp:3000 --source-ranges 10.128.0.0/9 --target-tags record-store >/dev/null
gcloud compute addresses describe "$VM" --region "$R" --project "$P" >/dev/null 2>&1 ||
  gcloud compute addresses create "$VM" --region "$R" --project "$P" --subnet "$NETWORK" >/dev/null
IP=$(gcloud compute addresses describe "$VM" --region "$R" --project "$P" --format 'value(address)')
# Deploying the engine and the runner onto the VPC (Direct VPC egress) needs these on the deployer: using the
# subnet, and reading the record store's address (scripts/deploy-engine.sh, deploy-runner.sh).
retry gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$DEPLOYER_SA" --role roles/compute.networkUser --condition None
retry gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$DEPLOYER_SA" --role roles/compute.networkViewer --condition None

echo "== The data disk and its daily snapshot, 30 days, in $R"
gcloud compute resource-policies describe "$POLICY" --region "$R" --project "$P" >/dev/null 2>&1 ||
  gcloud compute resource-policies create snapshot-schedule "$POLICY" --region "$R" --project "$P" \
    --daily-schedule --start-time 02:00 --max-retention-days 30 --on-source-disk-delete keep-auto-snapshots \
    --storage-location "$R" >/dev/null
gcloud compute disks describe "$DISK" --zone "$ZONE" --project "$P" >/dev/null 2>&1 ||
  gcloud compute disks create "$DISK" --zone "$ZONE" --project "$P" --type pd-balanced --size 20GB >/dev/null
gcloud compute disks describe "$DISK" --zone "$ZONE" --project "$P" --format 'value(resourcePolicies)' | grep -q "$POLICY" ||
  gcloud compute disks add-resource-policies "$DISK" --zone "$ZONE" --project "$P" --resource-policies "$POLICY" >/dev/null

echo "== The VM"
if gcloud compute instances describe "$VM" --zone "$ZONE" --project "$P" >/dev/null 2>&1; then
  echo "$VM already there (to change its cloud-init: delete the VM, keep the disk, re-run)"
else
  INIT=$(mktemp)
  trap 'rm -f "$INIT"' EXIT
  sed -e "s|__REGISTRY__|$REGISTRY|g" -e "s|__IMAGE__|$IMAGE|g" -e "s|__IP__|$IP|g" -e "s|__ADMIN__|$ADMIN|g" \
    scripts/record-store/cloud-init.yaml >"$INIT"
  gcloud compute instances create "$VM" --zone "$ZONE" --project "$P" \
    --machine-type e2-small --image-family cos-stable --image-project cos-cloud \
    --boot-disk-size 10GB --boot-disk-type pd-balanced \
    --disk "name=$DISK,device-name=forgejo-data,mode=rw,boot=no,auto-delete=no" \
    --network "$NETWORK" --private-network-ip "$IP" --no-address --tags record-store \
    --service-account "$VM_SA" --scopes cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata-from-file user-data="$INIT" >/dev/null
fi

echo "== Waiting for the admin's token in $SECRET (the VM makes it on its first boot)"
for i in $(seq 1 40); do
  if gcloud secrets versions list "$SECRET" --project "$P" --filter 'state=ENABLED' --format 'value(name)' | grep -q .; then
    echo "$SECRET has a version. The record store is at http://$IP:3000 on the VPC."
    echo "Next: the engine's deploy passes FORGEJO_URL=http://$IP:3000 and the secret (scripts/deploy-engine.sh)."
    exit 0
  fi
  sleep 15
done
echo "no token after 10 minutes: read the VM's boot log with" >&2
echo "  gcloud compute instances get-serial-port-output $VM --zone $ZONE --project $P | grep -i -E 'forgejo|cloud-init'" >&2
exit 1
