#!/usr/bin/env bash
# Deploy the cognitum-analytics Cloud Function to GCP.
#
# HUMAN-DRIVEN — the RuFlo autonomous loop DOES NOT run this. It's the deploy
# script a human runs when they're ready to expose the endpoint. Runs from
# the project working directory with a live gcloud session.
#
# Prerequisites:
#   1. gcloud auth login (as an account with roles/cloudfunctions.admin +
#      roles/iam.serviceAccountUser + roles/datastore.owner on the project).
#   2. gcloud config set project cognitum-20260110
#   3. gcloud services enable cloudfunctions.googleapis.com run.googleapis.com \
#        firestore.googleapis.com secretmanager.googleapis.com \
#        artifactregistry.googleapis.com cloudbuild.googleapis.com
#   4. A Firestore database must exist (default) in the project.
#
# The function name intentionally mirrors what the client's DEFAULT_ENDPOINT
# is already pointed at, so a successful deploy immediately unblocks the
# client's flush path — no client-side re-config needed.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-cognitum-20260110}"
REGION="${REGION:-us-central1}"
FUNCTION_NAME="${FUNCTION_NAME:-cognitum-analytics}"
RUNTIME="${RUNTIME:-nodejs22}"
ENTRY_POINT="v1Events"
FIRESTORE_COLLECTION="${FIRESTORE_COLLECTION:-funnel_events}"
AGG_COLLECTION="${AGG_COLLECTION:-funnel_aggregates}"
CREDIT_CEILING_PER_DAY="${CREDIT_CEILING_PER_DAY:-1000000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== cognitum-analytics deploy =="
echo "  project: $PROJECT_ID"
echo "  region:  $REGION"
echo "  fn:      $FUNCTION_NAME"
echo "  runtime: $RUNTIME"
echo ""

if ! command -v gcloud >/dev/null 2>&1; then
  echo "error: gcloud CLI is required. https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "error: not authenticated. Run: gcloud auth login" >&2
  exit 1
fi

CURRENT_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
  echo "error: gcloud project is '$CURRENT_PROJECT'; expected '$PROJECT_ID'." >&2
  echo "  Run: gcloud config set project $PROJECT_ID" >&2
  exit 1
fi

echo "-- deploying --"
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --source="$SCRIPT_DIR" \
  --entry-point="$ENTRY_POINT" \
  --trigger-http \
  --allow-unauthenticated \
  --max-instances=100 \
  --min-instances=0 \
  --concurrency=80 \
  --memory=256Mi \
  --cpu=1 \
  --timeout=30s \
  --set-env-vars="FIRESTORE_COLLECTION=${FIRESTORE_COLLECTION},AGG_COLLECTION=${AGG_COLLECTION},CREDIT_CEILING_PER_DAY=${CREDIT_CEILING_PER_DAY}"

echo ""
echo "-- verifying --"
URL="$(gcloud functions describe "$FUNCTION_NAME" --region="$REGION" --format='value(serviceConfig.uri)')"
echo "  endpoint: $URL"

echo ""
echo "-- smoke test: POST /v1/events with sample batch --"
curl -sS -X POST "$URL/v1/events" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: deploy-smoke-$(date +%s)" \
  -H "User-Agent: ruflo-funnel/3.25.6" \
  -d @"$SCRIPT_DIR/sample-batch.json" | tee /tmp/cognitum-analytics-smoke.json

echo ""
echo "== done =="
echo "Point the CLI at this endpoint with:"
echo "  export RUFLO_FUNNEL_EVENTS_ENDPOINT=$URL/v1/events"
echo ""
echo "The client defaults to https://funnel.ruv.io/v1/events, which is a"
echo "Cloud Run domain mapping onto this function. To create the mapping:"
echo "  gcloud beta run domain-mappings create \\"
echo "    --service=$FUNCTION_NAME --domain=funnel.ruv.io \\"
echo "    --region=$REGION --project=$PROJECT_ID"
echo "Then add the CNAME funnel.ruv.io → ghs.googlehosted.com in Cloudflare."
