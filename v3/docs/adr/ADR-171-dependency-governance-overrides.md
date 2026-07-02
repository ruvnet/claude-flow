# ADR-171 — Dependency Governance: Inert Overrides, Real CVE Floors, and a Single Source of Truth

**Status**: Proposed (2026-07-02)
**Date**: 2026-07-02
**Authors**: claude (drafted with rUv)
**Parent**: ADR-167 (ruflo npm deep review)
**Related**: ADR-165 (security/CVE posture — several of its "override floor" remediations are re-opened by this finding), issue #2112

## Context

### The core finding: ruflo's `overrides` block does nothing for consumers

npm applies `overrides` **only from the root package of an install**; overrides declared
in a dependency are ignored. When a user runs `npx ruflo`, npx synthesizes a root
(`.npm/_npx/<hash>/package.json` containing `{"dependencies":{"ruflo":"^3.16.3"}}`) and
installs ruflo as a *dependency* of it. `npm install ruflo` in a project behaves the same.
The only context where ruflo's 31-key block applies is developing inside `ruflo/` itself.

Verified empirically (2026-07-02) in both a project install and a real npx cache tree:

| ruflo override | Resolved in consumer tree |
|---|---|
| `agentdb: ">=3.0.0-alpha.17"` | 2.0.0-alpha.3.7 (via `@claude-flow/aidefence`) |
| `better-sqlite3: ">=12.8.0"` | 11.10.0 |
| `uuid: ">=14.0.0"` | 9.0.1 (npm printed the deprecation warning) |

**Consequence**: every CVE "security floor" in the block (undici, tar, minimatch,
protobufjs, path-to-regexp, …) provides zero protection to the users the block was added
for, and the #2112 lesson ("root overrides do NOT propagate to the published ruflo
wrapper — duplicate them") produced a duplication that is itself a no-op for consumers.
ADR-165 remediations recorded as override floors are not actually deployed.

### Secondary findings

1. **Drift**: 18 of 41 union keys differ between the root and ruflo blocks. Present only
   in root: `hono`, `express`, `qs`, `axios`, `fast-uri`, `vite`, `ws`, `@grpc/grpc-js`,
   `form-data`, `http-proxy-middleware`. Present only in ruflo: `agentdb`,
   `agentic-flow`, six exact `@opentelemetry/*otlp*` 0.52.1 pins. Where values differ,
   ruflo's are the stale/weaker side: `undici >=7.18.0` vs root `>=8.5.0` (ADR-165 Phase
   1d requires ≥8.5.0 to clear GHSA-38rv-x7px-6hhq et al.); `protobufjs >=7.5.6` — a floor
   *inside* the vulnerable `<=7.6.2` range — vs root `>=8.2.0`; `@hono/node-server
   >=1.19.10` vs `>=1.19.14`.
2. **Stale exact pins**: `@opentelemetry/core|resources|sdk-trace-base` pinned at
   `1.25.1`, below the 2.8.0 fix for GHSA-8988-4f7v-96qf (W3C Baggage unbounded-memory
   DoS); the 0.52.1 exporter pins are the same generation.
3. **Landmine**: ruflo's `agentic-flow: ">=2.0.14"` would (if it ever applied) resolve to
   a 2.x that cannot satisfy the CLI's `^3.0.0-alpha.1` optional range.
4. **Unbounded floors**: 16 of 31 entries are `>=` with no ceiling — had they applied,
   future majors of tar/minimatch/cacache/undici would be adopted silently and untested.
5. **Wrapper pairing**: `ruflo` depends on `@claude-flow/cli: ^3.10.3`; since the three
   packages publish in lockstep (CLAUDE.md policy), the caret only permits untested
   wrapper/CLI skew (6 minors of drift today).
6. **Optional-range skew** is what creates the ×3–×4 duplicate trees quantified in
   ADR-169: `@metaharness/darwin` alone is wanted as `~0.3.1` (ruflo), `^0.2.2`
   (metaharness), and `^0.7.0` (agentic-flow).

## Decision

### 1. Stop treating consumer-side overrides as a security control

Reclassify both overrides blocks as **developer-context tooling** (they govern `npm
install` runs inside the repo/package during development — nothing else). Remove any
documentation or ADR language implying they protect end users; add a corrective note to
the ADR-165 tracking issue re-opening each remediation that shipped only as an override
floor.

### 2. Deploy real floors where they belong: the owning packages' dependency ranges

For each security-motivated override, bump the actual dependency range in whichever
package declares the vulnerable transitive (`@claude-flow/cli`, `@claude-flow/mcp`,
`agentdb` upstream, …) so consumers resolve the fixed version through normal semver
resolution. Priority floors from the current audit: `undici >=8.5.0`, `protobufjs
>=7.6.3` (or `>=8`), `hono >=4.12.25`, OTel core/resources/sdk-trace-base `>=2.8.0` with
matching exporter generation. Where the owner is third-party (agentdb), file the upstream
bump and pin the fixed release in our ranges meanwhile.

### 3. Single generated source of truth for the two dev-context blocks

Keep one `config/overrides.json`; generate the `overrides` blocks of the root and
`ruflo/package.json` from it (script under `scripts/`), and add a CI check that fails on
drift. This mechanically ends the 18/41-key divergence and retires the manual #2112
ritual. Replace unbounded `>=` entries with `>=fixed <next-major` ranges as they are
regenerated.

### 4. Pin the wrapper exactly

`ruflo` pins `@claude-flow/cli` to the exact lockstep version at each publish (the
publish script already bumps all three packages together — make the pin part of that
step). Alignment of the metaharness/agentdb/ruvector optional ranges is executed under
ADR-169 Phase 2; this ADR supplies the governance rule (one declared range per package
across the workspace, enforced by the drift check).

## Consequences

- **Positive**: security floors become real for consumers instead of decorative; one
  source of truth ends silent drift; exact wrapper pinning makes `npx ruflo` behavior
  reproducible per release; the audit story in ADR-165 regains integrity by
  distinguishing "fixed by range bump" from "papered by inert override".
- **Negative / risks**: range bumps in owning packages are real dependency upgrades and
  need their test suites (unlike overrides, they can't be slipped in); upstream agentdb
  latency may leave a window where a floor exists only as a dev-context override — such
  entries must be tagged `pending-upstream` in `overrides.json` so the gap is visible.
- **Verification**: a CI job installs the published `ruflo` into a scratch project and
  asserts resolved versions (`npm ls --json`) meet every security floor — the empirical
  test that exposed this finding becomes the permanent regression gate; drift check green;
  `npm audit` counts tracked against the ADR-165 baseline.
