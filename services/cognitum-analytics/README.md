# cognitum-analytics — moved out

The RuFlo funnel analytics endpoint now lives in its own repo:

**https://github.com/cognitum-one/ruflo-funnel-api**

per ADR-311 (server-side split from OSS CLI lifecycle).

Client contract (`POST /v1/events`) unchanged — see
[ADR-308](../../v3/docs/adr/ADR-308-cognitum-public-api-contract.md).
Server implementation, Cloud Function source, Firestore schema, and
deploy scripts are all in the dedicated repo.

Client transport (this repo) points at `https://funnel.ruv.io/v1/events`
by default — the Cloud Run domain mapping onto the deployed function.
Override with the `RUFLO_FUNNEL_EVENTS_ENDPOINT` env var for staging or
self-hosted deployments.
