# ADR-0003: Tenant-scoped RuVector memory

Status: Proposed

## Decision

Firestore is the canonical tenant store. `@ruvector/core` is a rebuildable derived index, instantiated separately for each tenant/team and held in a bounded LRU cache. An index key is derived inside the service and never accepted from tools. Retrieval is capped at ten results, safety-scanned, provenance-labelled, and fenced as untrusted data.

The current local embedding is a 256-dimensional feature hash. It must be reported as `lexical-degraded`, not semantic search. This portable backend is the default. Native RuVector acceleration requires the explicit `RUFLO_AI_TEAM_VECTOR=native` opt-in and a successful runtime binary self-test, and is then reported separately as `ruvector-native`; neither backend is a cross-tenant learning system. AgentDB controllers, SONA adaptation, and native RVF evidence remain internal or deferred until their tenant isolation and integrity contracts are accepted.
