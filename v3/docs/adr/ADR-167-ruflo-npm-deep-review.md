# ADR-167 — Ruflo npm Package Deep Review: Measured Baseline and Optimization Roadmap

**Status**: Proposed (2026-07-02)
**Date**: 2026-07-02
**Authors**: claude (drafted with rUv)
**Related**: ADR-128 (init-bundle reduce), ADR-165 (security/CVE posture), ADR-166 (mcp-bridge RCE remediation), issues #1641, #1653, #2112, #2253, #2256
**Children**: ADR-168 (publish-artifact slimming), ADR-169 (install-footprint reduction), ADR-170 (cold-start optimization), ADR-171 (dependency governance / overrides semantics)

## Context

`ruflo` is the package users actually run (`npx ruflo`). It is a thin wrapper — one 3 KB bin
script delegating to `@claude-flow/cli` — yet a deep review of the published artifact, the
install chain, the runtime startup path, and the dependency governance surfaced systemic
problems in all four areas. This ADR records the measured baseline and indexes the four
strategy ADRs that remediate it. All numbers were measured on 2026-07-02 (linux x64,
node 22, npm 10) against published `ruflo@3.16.3` / `@claude-flow/cli@3.16.3` unless noted.

## Measured baseline (2026-07-02)

### Publish artifact

| Metric | Value |
|---|---|
| `ruflo` published unpacked size | 10.3 MB / 549 files |
| `ruflo` local `npm pack --dry-run` | 8.2 MB / 526 files (4.6 MB tarball) |
| Files the wrapper needs at runtime | ~40 KB / 3 files (`bin/ruflo.js`, `package.json`, README) |
| Dead weight share | **99.5%** (SvelteKit `src/ruvocal` 6.7 MB, `src/chat-ui` 1.3 MB gif, mcp-bridge, nginx, scripts) |
| Publisher runtime state in the published tarball | **2.12 MB / 23 files** — `.swarm/hnsw.index` (1.59 MB), `memory.db`, attestation DB, headless-worker prompt/result logs |
| `@claude-flow/cli` unpacked | 13.2 MB / 1,389 files — 4.24 MB source maps (32%), 2.3 MB `.claude`, 190 KB `tsconfig.tsbuildinfo`, compiled test files, 614 KB benchmarks |

The published-state leak happens because `files` includes `src/**`, there is no `.npmignore`,
and the publish ran on a machine where the daemon had produced `.swarm/` and `.claude-flow/`
state under `src/ruvocal/`. The shipped logs were scanned: no credentials this time, but
headless prompt/result logs and memory DBs are exactly the class of file that leaks secrets
on a future publish. → **ADR-168**.

### Install footprint

| Scenario | node_modules | Packages | Time |
|---|---|---|---|
| `npm install ruflo` (fresh) | **865 MB – 1.4 GB** (varies with which optionals succeed) | 640–835 | ~3 min |
| `npx -y ruflo@3.16.3` (fresh cache) | 858 MB | 474 | — |
| `npm install ruflo --omit=optional` | **108 MB** | 154 | ~10 s |

~92% of the footprint is optional-dependency fan-out. Verified on the 108 MB tree:
`--version`, `--help`, `swarm status`, and `mcp start` (JSON-RPC `initialize`) all work.
Dominant weights: `@opentelemetry/*` ≈ 270 MB total (pulled as *hard* deps of `agentdb`
via `auto-instrumentations-node`), a 2023-era extraneous `onnxruntime-node@1.14.0` (93 MB),
`agentdb` ×4 copies (one 2.0.0-alpha.3.7 via `@claude-flow/aidefence` + three
3.0.0-alpha.17 nested), `ruvector` ×4 copies (0.2.33 + three 0.1.100), `better-sqlite3`
×3 copies each compiled from source with node-gyp. → **ADR-169**.

### Cold start

| Invocation | Measured | Why |
|---|---|---|
| `ruflo --version` | 40–97 ms | #2256 fast path in the wrapper (works) |
| `ruflo --help` | **1.5–3.7 s** | full eager import graph + 26 lazy command loads just to print help |
| `ruflo status` | ~1.4 s | same eager graph |

Every invocation parses ~45k LOC: `commands/index.ts` synchronously imports 10 command
modules (~15k LOC, `hooks.ts` alone is 5,361), nine of which import `mcp-client.ts`, which
statically imports ~40 MCP tool modules (~27.4k LOC). The startup auto-update check can
synchronously run `npm install` (`execFileSync`) inside an unawaited promise that races the
`process.exit(0)` teardown workaround. `scripts/postinstall.cjs` defines `augmentExports()`
but never calls it (dead code — the ADR-095 G7 exports patch does not actually run).
The documented `<500 ms` CLI-startup target is currently missed ~3–7×. → **ADR-170**.

### Dependency governance

**The 31-key `overrides` block in `ruflo/package.json` is provably inert for consumers.**
npm honors `overrides` only in the root package of an install; `npx ruflo` synthesizes a
root that depends on ruflo, so ruflo is never the root. Verified empirically in both a
project install and a real npx cache tree:

| Override floor | Actually resolved |
|---|---|
| `agentdb >= 3.0.0-alpha.17` | **2.0.0-alpha.3.7** (via aidefence) |
| `better-sqlite3 >= 12.8.0` | **11.10.0** |
| `uuid >= 14.0.0` | **9.0.1** (deprecated) |

Every "CVE security floor" in that block (undici, tar, minimatch, protobufjs, …) provides
zero protection to `npx ruflo` users — the #2112 duplication is a no-op for consumers.
Additionally, 18 of 41 union keys drift between the root and ruflo blocks, and where they
differ the ruflo side is the stale one (`undici >=7.18.0` vs `>=8.5.0`; `protobufjs
>=7.5.6` — inside the vulnerable `<=7.6.2` range — vs `>=8.2.0`; OTel exact pins at
1.25.1/0.52.1 below the GHSA-8988-4f7v-96qf fix at 2.8.0). → **ADR-171**.

### Post-ADR-166 residuals (verified, tracked there — not re-decided here)

The mcp-bridge RCE remediation is genuinely shipped and test-locked (`test-security-lock.js`,
`test-runtime-security.mjs`). Three residuals remain: (V4) backend children still spawn with
full `{ ...process.env }` (`src/mcp-bridge/index.js:138`); the default `docker compose up` is
DOA (bridge binds loopback inside its container while chat-ui dials `mcp-bridge:3001`); and
no shipped client sends `Authorization: Bearer` when a token is set (the kernel signs
`X-RVF-Signature`, which the bridge never verifies). These stay under ADR-166's open items.

## Decision

Adopt a four-track remediation, one ADR per track, ordered by risk-adjusted leverage:

1. **ADR-168 — Publish-artifact slimming and state-leak prevention** (smallest change,
   removes a data-leak class; `files: ["bin/", "README.md", "LICENSE"]`, defense-in-depth
   `.npmignore`, CLI tarball diet).
2. **ADR-169 — Install-footprint reduction** (108 MB slim-by-default path, dedup of
   agentdb/ruvector/better-sqlite3 skew, cut the OTel hard-dep fan, prebuild policy).
3. **ADR-170 — Cold-start optimization** (lazy tool registry behind a build-time manifest,
   entrypoint split, static help, fix the auto-update and exit-hygiene hazards, wire
   `augmentExports`).
4. **ADR-171 — Dependency governance** (retire the inert-overrides-as-security-control
   claim, push floors into owning packages' ranges, single generated source of truth with
   CI drift check, exact CLI pin in the wrapper).

Success is re-measured against this baseline; each child ADR carries its own testable
criteria. Headline targets: ruflo tarball ≤ 50 KB; default install ≤ 150 MB;
`ruflo --help` ≤ 500 ms; zero inert security claims.

## Consequences

- The baseline table above becomes the reference for all four child ADRs; future claims
  about package size, install weight, or startup latency must cite a re-measurement, not
  this document.
- The overrides finding retroactively weakens ADR-165's remediation story: fixes recorded
  as "override floors" must be re-verified as real range bumps in the owning packages
  (tracked in ADR-171).
- No behavior changes ship from this ADR itself; it is the review record and index.
