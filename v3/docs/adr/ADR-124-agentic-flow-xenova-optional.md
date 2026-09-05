# ADR-124 — Upstream `agentic-flow` fix: move `@xenova/transformers` to optionalDependencies

**Status**: Proposed (2026-05-19)
**Date**: 2026-05-19
**Authors**: claude (drafted with rUv)
**Related**: [`agentic-flow@2.0.11`](https://www.npmjs.com/package/agentic-flow), [ruvnet/agentic-flow](https://github.com/ruvnet/agentic-flow), ADR-118 (AIDefence 2.3.0), ADR-121 (embeddings RuVector upgrade — long-term Xenova migration), ADR-122 (browser substrate), supply-chain hardening PR #2050, ruflo issue #2046
**Supersedes**: nothing (upstream-targeted)

## Context

After landing the supply-chain hardening in PR #2050 (`scripts/audit-supply-chain.mjs` + `.github/supply-chain/allowed-deps.json` + dependency-review-action), the audit caught a real HIGH CVE in `@claude-flow/browser`'s fresh-install dep graph:

```
ruflo-browser-consumer
  └── @claude-flow/browser
        └── agentic-flow ^2.0.11
              ├── @xenova/transformers ^2.17.2  ← HIGH CVE via onnxruntime-web → protobufjs
              └── agentdb (opt) ^3.0.0-alpha.14
                    └── @opentelemetry/sdk-node (opt) ^0.52.0  ← HIGH CVE, fixed in our root overrides
```

The `agentdb → @opentelemetry/sdk-node` chain was fixed in [PR #2050 commit `9a8c9c464`](https://github.com/ruvnet/ruflo/commit/9a8c9c464) by bumping agentdb to `3.0.0-alpha.14` + npm overrides pinning `@opentelemetry/sdk-node ≥ 0.218.0`. Overrides do NOT cascade across separate npm projects, so the same block was duplicated in `v3/@claude-flow/browser/package.json` to keep standalone installs clean.

What remains: **`@xenova/transformers` is a direct dependency of `agentic-flow`**, and `agentic-flow` is a direct dependency of `@claude-flow/browser`. Overrides on the consumer side can pin to a newer Xenova version — but the latest is 2.17.2, and the only fix-available is `@xenova/transformers@2.0.1` (a *downgrade* via a major version-bump). Upgrading would break Xenova's runtime API in ways the agentic-flow embedding code paths aren't prepared for, and downgrading to 2.0.1 sheds three years of ONNX-runtime improvements.

The **right fix lives upstream** in `agentic-flow` itself.

## What we found in the upstream source

`/Users/cohen/Projects/agentic-flow/agentic-flow/src/` — the published package's source. Six call sites import `@xenova/transformers`. Five of them already use **dynamic import** (`await import('@xenova/transformers')`):

| File | Pattern | Notes |
|---|---|---|
| `src/core/embedding-service.ts` | dynamic | in a try/catch that throws a typed error on failure |
| `src/services/embedding-service.ts` | dynamic | identical pattern |
| `src/embeddings/optimized-embedder.ts` | dynamic | inside the "ONNX Runtime not available" fallback branch |
| `src/utils/model-cache.ts` | dynamic | model-cache helper |
| `src/router/providers/onnx.ts` | dynamic | already wrapped in try/catch with `'npm install @xenova/transformers'` hint when missing |
| `src/reasoningbank/utils/embeddings.ts` | **static top-level** `import { pipeline, env } from '@xenova/transformers'` | the only blocker |

Five-out-of-six already gracefully degrade when the module is absent. The only file that doesn't is `src/reasoningbank/utils/embeddings.ts` — a static import at the top of the file. That's the single change we need to make upstream to qualify the entire package for moving Xenova to `optionalDependencies`.

## Decision

Land **`agentic-flow@2.0.12`** with three coupled changes:

1. **Convert the one static import to dynamic** in `src/reasoningbank/utils/embeddings.ts` so the file loads even when `@xenova/transformers` is absent. Wrap in try/catch with a typed error matching the pattern in `src/router/providers/onnx.ts`.
2. **Move `@xenova/transformers` from `dependencies` to `optionalDependencies`** in `agentic-flow/package.json`. Installs default to `--include=optional` so existing users who actually want embeddings see no behavior change; users who don't (the `@claude-flow/browser` substrate path is one) can `npm install --omit=optional` and get a clean CVE-free tree.
3. **Bump version to `2.0.12`** (patch — behavior is preserved for consumers that have `@xenova/transformers` installed; the change is purely about *who decides to install it*).

After upstream ships:

- Bump `agentic-flow` to `^2.0.12` in `v3/@claude-flow/browser/package.json`
- Remove the corresponding entry from `.github/supply-chain/accepted-findings.json` (the audit will pass cleanly without an exception)
- The fresh-install end-user audit on `@claude-flow/browser` drops from **7 HIGH** (after PR #2050) to **0 HIGH** when `--omit=optional` is used, or remains the same when the user opts into the embedding feature explicitly

## Why this is the right shape of fix

The agentic-flow embedding code was **already engineered for graceful degradation** — five of six call sites already use dynamic import, and the `router/providers/onnx.ts` file already prints a clear `'npm install @xenova/transformers'` message when the module isn't present. The intent was clearly "make this optional", and the only thing missing is removing the eager top-level import that forces installation.

Moving `@xenova/transformers` to `optionalDependencies` is **not a breaking change** under npm semantics:
- npm 7+ defaults to `--include=optional` on `npm install` (so existing users see the same install)
- The dynamic-import pattern means consumers that don't invoke embedding code paths never load the module
- Users who deliberately want a clean CVE-free install can pass `--omit=optional` and get one

This is *exactly* the optional-dependency contract npm was designed for.

## Acceptance

- `agentic-flow@2.0.12` published with the three changes above
- `agentic-flow` test suite passes (especially `src/reasoningbank/` tests — that's the file we touched)
- `npm install agentic-flow@2.0.12 --omit=optional` results in `npm audit` reporting **0 HIGH/CRITICAL** for the `agentic-flow` direct surface
- `npm install agentic-flow@2.0.12` (default, includes optional) preserves all existing embedding-feature functionality

## Update ruflo after upstream ships

1. Bump `v3/@claude-flow/browser/package.json` → `agentic-flow ^2.0.12`
2. Run `pnpm install --lockfile-only` from `v3/` to refresh `v3/pnpm-lock.yaml`
3. Run `npm install --legacy-peer-deps` at root to refresh `package-lock.json`
4. Remove the `cve[]` entry for `agentic-flow → @xenova/transformers` from `.github/supply-chain/accepted-findings.json`
5. Re-run `node scripts/audit-supply-chain.mjs` — should pass with 0 unaccepted findings AND no accepted entries
6. Open a PR amending PR #2050 (or follow-on PR) titled `fix: bump agentic-flow to 2.0.12 (closes the last accepted CVE)`

## Out of scope

- **Full Xenova retirement** — ADR-121 Phase 4 tracks the larger migration to `ruvector-onnx-embeddings-wasm`. This ADR is a tactical patch that lets ruflo ship a clean supply-chain audit *now*; the strategic migration continues independently.
- **Bumping `@xenova/transformers` itself to v3** — v3 was renamed to `@huggingface/transformers`. That migration involves API changes and is what ADR-121 Phase 4 addresses. Not in scope here.
- **Touching `@claude-flow/embeddings`** — also covered by ADR-121.

## Open questions

1. **Should we backport to `agentic-flow@3.0.0-alpha.X`?** The 3.x line also has the same static import. Backporting is trivial (same patch). Recommend yes if the 3.x line is going to ship before ADR-121 lands.
2. **Should we ship a typed export for users who *do* want the embedding code path?** Currently the dynamic import returns `any`. Improving the typed surface is a separate cleanup PR and not blocking.

## References

- [`agentic-flow` repo](https://github.com/ruvnet/agentic-flow)
- [`agentic-flow@2.0.11` on npm](https://www.npmjs.com/package/agentic-flow)
- [`@xenova/transformers` retirement notice](https://www.npmjs.com/package/@xenova/transformers)
- [`@huggingface/transformers` (successor)](https://www.npmjs.com/package/@huggingface/transformers)
- [npm `optionalDependencies` semantics](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies)
- ADR-121 (long-term Xenova migration)
- ADR-122 (browser substrate consumer)
- ruflo PR #2050 (supply-chain hardening that surfaced this)
- ruflo issue #2046
