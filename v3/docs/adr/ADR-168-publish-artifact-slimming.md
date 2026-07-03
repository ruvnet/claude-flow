# ADR-168 — Publish-Artifact Slimming and Runtime-State Leak Prevention

**Status**: Proposed (2026-07-02)
**Date**: 2026-07-02
**Authors**: claude (drafted with rUv)
**Parent**: ADR-167 (ruflo npm deep review)
**Related**: ADR-128 (init-bundle reduce), ADR-166 (mcp-bridge — the bridge code this ADR stops shipping via npm remains available in-repo)

## Context

Published `ruflo@3.16.3` is 10.3 MB / 549 files. The wrapper's runtime is `bin/ruflo.js`
(3 KB) + `package.json` + README — **99.5% of the artifact is dead weight**, swept in by
`"files": ["bin/**", "src/**", "dist/**", ...]` with no `.npmignore`:

| Shipped path | Size | Reachable from `bin/ruflo.js`? |
|---|---|---|
| `src/ruvocal` (full SvelteKit app, its `package-lock.json`, `.github/`, Helm chart, media) | 6.7 MB / 499 files | No |
| `src/chat-ui` (1.3 MB of it one `omni-welcome.gif`) | 1.3 MB | No |
| `src/mcp-bridge`, `src/nginx`, `src/scripts`, `src/config` | ~150 KB | No |
| `dist/**` | — | phantom entry, directory doesn't exist |
| `LICENSE` | — | listed in `files`, file doesn't exist |

Worse, the published tarball contains **2.12 MB / 23 files of the publisher's runtime
state**: `src/ruvocal/.swarm/hnsw.index` (1.59 MB), `memory.db`, `attestation.db`, and
`.claude-flow/logs/headless/*_prompt.log` / `*_result.log` — full headless-worker prompts
and results from the publishing machine, plus daemon state, session and metrics files.
This publish scanned clean for credentials, but memory DBs and prompt logs are precisely
the file class that leaks secrets. Root cause: `src/**` + no ignore rules + publishing from
a machine where the daemon has run.

The shipped `src/` also creates operational debt: the mcp-bridge scripts (`dev`, `start`)
reference `express`, which is never installed for a consumer (`src/mcp-bridge/package.json`
deps require a manual `install:bridge`), and `docker:*` scripts reference a
`docker-compose.yml` that isn't even in the tarball. A consumer who does
`cd node_modules/ruflo/src/ruvocal && npm install` pulls the app's entire dev toolchain,
including the vitest CVSS-9.8 advisory catalogued in ADR-165.

`@claude-flow/cli@3.16.3` (13.2 MB / 1,389 files) has its own diet items: 4.24 MB of
`.js.map`/`.d.ts.map` (32% of the package), a 190 KB `tsconfig.tsbuildinfo` build cache,
~28 compiled test files under `dist/`, 614 KB of `dist/src/benchmarks`, and 185 KB of
repo-ops scripts of which only `postinstall.cjs` (6 KB) is needed. `.claude` (2.3 MB) is
functionally used by `init` (ADR-128 owns that surface) and is out of scope here.

## Decision

### Phase 1 — ruflo wrapper goes bin-only (one publish)

1. `ruflo/package.json` `files` becomes `["bin/", "README.md", "LICENSE"]`. Add the
   missing `LICENSE` file (MIT, matching the repo).
2. Remove the consumer-meaningless scripts (`dev`, `dev:bridge`, `dev:test`, `start`,
   `docker:*`, `install:bridge`, `deploy`, `package:rvf`, `generate:*`) from the published
   manifest. The bridge/ruvocal sources stay in the repo (`ruflo/src/`) for Docker and
   development; they simply stop shipping to npm.
3. Defense in depth regardless of (1): add `ruflo/.npmignore` entries for
   `**/.claude-flow/`, `**/.swarm/`, `*.db`, `*.index`, `*.log`, `**/logs/` so a future
   `files` regression cannot re-leak runtime state.
4. Add a publish gate to CI (and to the publish checklist in CLAUDE.md): `npm pack
   --dry-run` output must be ≤ 10 files and contain no path matching the state patterns
   above; fail otherwise.

Expected result: tarball 4.6 MB → ~15 KB; unpacked 10.3 MB → ~40 KB; the runtime-state
leak class is eliminated structurally, not procedurally.

### Phase 2 — @claude-flow/cli diet (no behavior change)

1. Publish build sets `sourceMap: false`, `declarationMap: false` (−4.24 MB, 32%).
2. Exclude `tsconfig.tsbuildinfo` (never ship build caches) and test sources
   (`**/tests/**`, `test-*.ts`) from the publish build (−0.3 MB).
3. Exclude `dist/src/benchmarks` from `files` (−0.6 MB).
4. Prune `scripts/` in `files` to `postinstall.cjs` (−0.18 MB).

Expected result: 13.2 MB → ~7.3 MB without touching `.claude` or plugins. Deeper cuts
(`.claude` fetch-on-init, plugin install-on-demand) are ADR-128 scope.

### Phase 3 — relocation of the deployment stack (separate release)

Move `src/ruvocal` + `src/mcp-bridge` + nginx/docker assets to either a dedicated
`ruflo-deploy` package or git-only distribution (tag-pinned clone documented in the
README). Decision on which is deferred until Phase 1 ships; Phase 1 does not depend on it.

## Consequences

- **Positive**: ~99.5% artifact-size reduction for the package every user downloads; the
  publisher-state leak class is closed; `npm audit`-adjacent foot-gun (installing the
  dormant SvelteKit toolchain from inside `node_modules`) disappears; faster `npx` cold
  fetch.
- **Negative / risks**: anyone who (undocumented) ran the bridge from
  `node_modules/ruflo/src/mcp-bridge` breaks — mitigated by Phase 3 giving the stack a
  supported home and a README pointer; the `prepublishOnly` README copy step keeps working
  unchanged.
- **Verification**: `npm pack --dry-run` in `ruflo/` shows ≤ 10 files and < 100 KB;
  CI gate red on any `.swarm/`, `.claude-flow/`, `*.db`, `*.log` path in the pack list;
  `npx ruflo@<next> --version` and `mcp start` smoke-pass post-publish.
