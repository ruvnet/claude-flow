# ADR-0001: Multi-tenant service boundary

Status: Proposed

## Context

RuFlo Federation is a public coordination gateway with a service identity. AI Team stores private team state and must not reuse that identity, public-read policy, database, or release lifecycle.

## Decision

Ship `plugins/ruflo-ai-team` as a separate OAuth resource server. Derive tenancy exclusively from verified issuer, audience, subject, and tenant claims. Require a tenant context on every repository method and make foreign and absent IDs indistinguishable. The public MCP surface has exactly twelve tools in v0.1 and contains no credential, tenant, raw shell, federation-administration, or provider-key input.

The plugin contract pins compatibility to Ruflo v3.48. It owns the `ruflo-ai-team-*` namespace and is verified by `scripts/smoke.sh`.

## Consequences

The service can evolve independently and avoids confused-deputy access to Federation. It requires its own OAuth client/audience, Cloud Run service account, Firestore IAM policy, monitoring, and release gate.
