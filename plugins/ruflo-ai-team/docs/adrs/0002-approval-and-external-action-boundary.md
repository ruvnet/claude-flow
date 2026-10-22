# ADR-0002: Approval and external-action boundary

Status: Proposed

## Decision

The initial public service records coordination only. It performs no external messaging, deployment, arbitrary command execution, purchases, public sharing, membership changes, or credential operations. Those capabilities stay out of the MCP surface until an approval record can bind tenant, immutable action digest, destination, disclosure, estimated units, expiry, and one-time decision.

Future external tools must use incremental scopes, explicit destructive/open-world annotations, idempotency keys, short-lived worker grants, and fail-closed metering. Agents may propose but never approve their own actions.
