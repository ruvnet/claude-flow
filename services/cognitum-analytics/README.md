# cognitum-analytics — funnel-events Cloud Function (reference impl)

Endpoint the RuFlo funnel client posts batched telemetry to. Implements the
ADR-308 contract (`POST /v1/events`) with:

- Idempotent batches keyed by `Idempotency-Key` header
- Closed event vocabulary (ADR-305 §events) — unknown events are dropped
- Firestore writes: raw events (`funnel_events` collection) + rolling
  aggregates (`funnel_aggregates`) + per-tenant daily credit ledger
  (`funnel_credit`) + idempotency journal (`funnel_idem`)
- Credit ceiling — replies 402 `COGNITUM_CREDIT_EXHAUSTED` when the tenant
  exceeds `CREDIT_CEILING_PER_DAY`. The client's transport picks this up
  and surfaces the ADR-303 recovery UX asynchronously via
  `credit-notifier.ts`.

## Layout

| File | Purpose |
|---|---|
| `index.js` | Function source — one HTTP handler, no framework beyond functions-framework |
| `package.json` | Node 22 runtime, Firestore + functions-framework deps |
| `sample-batch.json` | Fixture for local + smoke-test POSTs |
| `deploy.sh` | gcloud CLI deploy — HUMAN-DRIVEN (autonomous loop never runs it) |

## Local run

```bash
cd services/cognitum-analytics
npm install
GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json \
  npm start
# In another shell:
npm run test:local
```

Requires `gcloud auth application-default login` first.

## Deploy

```bash
cd services/cognitum-analytics
gcloud auth login
gcloud config set project cognitum-20260110
./deploy.sh
```

Deploy runs `gcloud functions deploy --gen2` with the settings baked into
the script. Environment overrides:

| Var | Default | Effect |
|---|---|---|
| `PROJECT_ID` | `cognitum-20260110` | GCP project |
| `REGION` | `us-central1` | Cloud Function region |
| `FUNCTION_NAME` | `cognitum-analytics` | Function name (also the URL hash prefix) |
| `FIRESTORE_COLLECTION` | `funnel_events` | Raw event collection |
| `AGG_COLLECTION` | `funnel_aggregates` | Rolling aggregates |
| `CREDIT_CEILING_PER_DAY` | `1000000` | Per-tenant credit ceiling |

The deploy script smoke-tests the freshly-deployed endpoint by POSTing
`sample-batch.json` and printing the JSON response.

## Client wiring

The client transport ships with:

```
DEFAULT_ENDPOINT = process.env.RUFLO_FUNNEL_EVENTS_ENDPOINT ??
  'https://cognitum-analytics-63rzcdswba-uc.a.run.app/v1/events'
```

If the Cloud Run URL hash differs after the first deploy, either update
`DEFAULT_ENDPOINT` in `v3/@claude-flow/cli/src/funnel/event-transport.ts`
and re-publish, or (recommended) point the domain
`https://cognitum.one/v1/events` at the function via Cloud Run mapping
and set `DEFAULT_ENDPOINT` there. Same result, doesn't break on hash
change.

## Verification (post-deploy)

```bash
gcloud functions logs read cognitum-analytics --region=us-central1 --limit=20
gcloud firestore documents list "funnel_events" --limit=5
```

Client-side:

```bash
# From a project with telemetry consent recorded:
node -e "require('./v3/@claude-flow/cli/dist/src/funnel/event-transport.js').flushEvents().then(console.log)"
```
