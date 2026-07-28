# ADR-321: Promote metaharness to a hard runtime dependency

- **Status**: Accepted
- **Date**: 2026-07-27
- **Supersedes**: ADR-150 §"Architectural constraint" rule #2 (optional-only) and rule #1 (removable) as they apply to `metaharness` and `@metaharness/router`
- **Related**: ADR-150 (metaharness integration surfaces), ADR-148/149 (router integration)

## Context

ADR-150 established metaharness as a *removable augmentation*: `metaharness`
and every `@metaharness/*` package MUST live in `optionalDependencies` (never
`dependencies`), every code path that touches them MUST catch `MODULE_NOT_FOUND`
and degrade gracefully, and a CI gate (`.github/workflows/no-metaharness-smoke.yml`)
installs ruflo with `--no-optional` and asserts the plugin fleet still passes.

The project has decided to make metaharness a **hard runtime dependency** so it
is always installed alongside ruflo rather than being an opt-in the platform may
skip.

### Material fact (recorded for honesty)

At the time of this decision, the two packages are consumed very differently:

- **`metaharness`** — invoked exclusively via **subprocess** (`npx metaharness …`)
  from `v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts`, which carries
  **zero static `@metaharness/*` imports**. For these MCP tools a hard dependency
  changes nothing functionally; they shell out regardless of whether the package
  is declared. The practical benefit is that the package is present locally, so
  the first `npx` invocation is a cache hit instead of a fetch.
- **`@metaharness/router`** — imported statically by `neural-router.ts` behind the
  `CLAUDE_FLOW_ROUTER_NEURAL=1` triple-gate. This is the one consumer for which a
  *declared* dependency is load-bearing; it was previously expected to be an
  `optionalDependency` (ADR-150) though not consistently declared.

## Decision

1. Add to `v3/@claude-flow/cli/package.json` `dependencies`:
   - `metaharness`: `^0.4.1`
   - `@metaharness/router`: `^0.3.2`
2. Remove them from `optionalDependencies` (no dual declaration).
3. This supersedes ADR-150's optional-only + removable constraints **for these two
   packages only**. The other three ADR-150 rules still hold where they make sense:
   - **Graceful degradation** — code paths keep their `MODULE_NOT_FOUND` /
     subprocess-failure fallbacks. A hard dep should always resolve, but the
     defensive fallbacks are cheap insurance against a broken install and are NOT
     removed.
   - **CI coverage** — `metaharness-ci.yml` still exercises the integration.

## Consequences

- **`no-metaharness-smoke.yml` is neutralized in intent.** `npm install --no-optional`
  only skips `optionalDependencies`; a hard `dependencies` entry is installed
  regardless, so the "works without metaharness" smoke test can no longer actually
  remove metaharness and passes trivially. The workflow is left in place (it still
  validates the plugin fleet's structural contract) but its ADR-150-rule-#4
  enforcement no longer applies to these two packages. A follow-up may repurpose or
  retire it.
- **Install size / surface grows.** metaharness + `@metaharness/router` (+ their
  transitives) are now always fetched. Acceptable per the decision.
- **Version-pin risk.** Both packages are 0.x and ship rapid patches. A breaking
  change in `@metaharness/router@0.4.x` now breaks a hard-dep install, not just an
  opt-in path. Mitigation: the caret ranges (`^0.4.1` / `^0.3.2`) stay within the
  current minor; bump deliberately and re-run `metaharness-ci.yml` on upgrade.
- **Reversibility.** Moving both entries back to `optionalDependencies` restores the
  ADR-150 model with no code changes, because the graceful-degradation fallbacks
  were kept.

## Alternatives considered

- **optionalDependency (ADR-150-compliant).** Zero constraint change, same runtime
  behavior for the subprocess tools. Rejected per the decision to guarantee presence.
- **Subprocess-only, no declared dep.** Lowest footprint; the status quo for
  `metaharness`. Rejected for the same reason.
