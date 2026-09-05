# ADR-154 — `@metaharness/kernel` per-platform NAPI-RS binaries: WASM-only at runtime, native fast-path unreached

**Status**: Accepted (WASM-only path is functional; native fast-path tracked upstream)
**Date**: 2026-06-17
**Related**: [ADR-150](ADR-150-metaharness-integration-surfaces.md) (MetaHarness integration surfaces), [ADR-153](ADR-153-metaharness-darwin-mode-integration.md) (Darwin Mode integration), ADR-124 (optional native dependencies), ADR-148 (cost-optimal router lifecycle), [ADR-152](ADR-152-genome-similarity-search.md) (genome similarity)
**Upstream**: [`ruvnet/agent-harness-generator/packages/kernel-js`](https://github.com/ruvnet/agent-harness-generator/tree/main/packages/kernel-js)
**Affects**: `ruflo@3.12.3+`, `@claude-flow/cli@3.12.3+`, `claude-flow@3.12.3+`
**Affected packages**: `@metaharness/kernel@~0.1.0` (already in `optionalDependencies` per ADR-150)

## Context

[ADR-150](ADR-150-metaharness-integration-surfaces.md) integrated `@metaharness/kernel@~0.1.0` as an optional peer of `@claude-flow/cli` (and transitively `ruflo`). The kernel exposes `loadKernel()`, `kernelDiagnostics()`, `ToolDispatcher` (claims-checked), `SelfEvolvingRouter`, `TrajectoryStore`, and `rankWithDecay` to ruflo's intelligence layer.

The upstream design intent (per `packages/kernel-js/README.md`) is:

> At load time, `loadKernel()` prefers the per-platform native package; falls back to wasm. The native packages (`@metaharness/kernel-darwin-arm64`, `-linux-x64-gnu`, etc.) are declared as `optionalDependencies` — npm installs only the one for your platform.

`@metaharness/kernel@0.1.2`'s `package.json` declares **five** per-platform NAPI-RS native binaries as `optionalDependencies`:

```json
{
  "optionalDependencies": {
    "@metaharness/kernel-darwin-arm64": "0.1.0",
    "@metaharness/kernel-darwin-x64":   "0.1.0",
    "@metaharness/kernel-linux-x64-gnu":   "0.1.0",
    "@metaharness/kernel-linux-arm64-gnu": "0.1.0",
    "@metaharness/kernel-win32-x64-msvc":  "0.1.0"
  }
}
```

## Current state (verified 2026-06-17)

**None of the five per-platform binaries are published to npm:**

```
@metaharness/kernel-darwin-arm64         NOT_PUBLISHED
@metaharness/kernel-darwin-x64           NOT_PUBLISHED
@metaharness/kernel-linux-x64-gnu        NOT_PUBLISHED
@metaharness/kernel-linux-arm64-gnu      NOT_PUBLISHED
@metaharness/kernel-win32-x64-msvc       NOT_PUBLISHED
```

**Runtime evidence** — fresh install of `ruflo@3.12.3` on a darwin-arm64 host (Mac mini M4 Pro, the platform the upstream-intended `@metaharness/kernel-darwin-arm64` should serve):

```bash
$ npm install ruflo@3.12.3
added 1163 packages

$ find node_modules/@metaharness/kernel-* -maxdepth 0 2>/dev/null
(no matches — none of the platform packages were resolved during install)

$ node -e "(await import('@metaharness/kernel')).loadKernel().then(k => console.log(k.backend))"
wasm
```

`loadKernel()` falls back to WASM cleanly. Functionality is intact; performance is the WASM tier, not the native tier the README advertises.

## Decision

**Accept the WASM-only runtime path as the supported configuration for ruflo `3.12.3+`.** Do not block on the upstream native-binary publish gap. Specifically:

1. **No code change in ruflo.** `@metaharness/kernel` stays in `optionalDependencies` as it is today. `loadKernel()` already does the right thing — prefers native, falls back to WASM. The fallback is reached because the optional native packages don't resolve, which is the documented graceful path.
2. **Treat WASM as the steady-state baseline** for benchmarks, smoke tests, and CI gates. Any "native vs WASM" performance comparison in ruflo's perf docs must mark the native column as "unverified — binaries not published" rather than copying upstream's claimed numbers.
3. **Add a smoke gate** in `plugins/ruflo-metaharness/scripts/smoke.sh` that asserts `loadKernel().backend === 'wasm'` is reachable. This is the inverse of a regression check: if the upstream ever ships natives, the smoke alerts so we can re-baseline.
4. **Per ADR-150 architectural constraint #3** (graceful degradation) the kernel-absent case is already handled — ruflo continues to work if `@metaharness/kernel` itself is uninstalled. The platform-binary absence is a *softer* degradation: kernel API surface is fully available, only the hot-path acceleration is missing.

## Why not block on upstream

Three reasons:

1. **WASM is functionally complete.** `loadKernel().backend === 'wasm'` exposes the same API as the native backend. The router's `SelfEvolvingRouter` parallel-logging gate from ADR-150 Phase 2 works against the WASM kernel; ADR-152 §3.1 genome similarity is pure-TS and doesn't touch the kernel at all. No ruflo feature is blocked by the missing natives.
2. **The performance ceiling isn't binding yet.** ruflo's measured router path is dominated by the LLM call latency (seconds), not kernel dispatch (microseconds). Even if the native path were 10× faster than WASM, the user-visible improvement on a real query would be sub-percent. We'd capture that improvement later, when we have the natives, without architectural changes.
3. **The fix is upstream-only.** Publishing five NAPI-RS binaries requires release-engineering on `ruvnet/agent-harness-generator` (CI matrix → upload to npm). Ruflo can't ship the natives ourselves without forking — which would violate the "MetaHarness is first-party" framing from ADR-150.

## Consequences

### Positive

- **No regression risk.** This ADR is descriptive — it changes the documentation, not the code. Today's behavior is the future behavior.
- **Honest perf surface.** The smoke gate prevents accidentally claiming native speedups in benchmarks.
- **Self-correcting.** When the upstream publishes the natives, `loadKernel()` will silently pick them up on the next install. The smoke gate fires, we audit, and decide whether to re-baseline ruflo's perf docs.
- **Aligns with [ADR-124](ADR-124-optional-native-deps.md)** — same pattern as `better-sqlite3`, `hnswlib-node`, sharp et al: declare optional natives, ship a WASM/JS fallback, never crash when the native is absent.

### Negative

- **The README claim "wasm primary, NAPI-RS native fallback" is currently inverted in practice** — wasm IS the fallback, but it's *also* the only thing that exists. Cross-link this ADR from any user-facing doc that mentions kernel performance.
- **Cold-start cost.** WASM init is reportedly slower than NAPI-RS on first call. We accept this cost (and the user accepts it via npx cold cache anyway).
- **One more upstream-coupling risk to monitor.** If `@metaharness/kernel@0.2.x` introduces a new API that's native-only and silently no-ops in WASM, the smoke gate catches reachability but not behavioral parity. ADR-150 Phase 3 §3.4 (Capability Graph) is the right place to enforce per-API parity.

### Neutral

- **Tracking.** The upstream gap is recorded in this ADR + the linked issue. No internal sprint commitment to chase the publish.

## Implementation notes

### Smoke gate (one-time addition)

Add to `plugins/ruflo-metaharness/scripts/smoke.sh`:

```bash
step "18a. @metaharness/kernel loadKernel returns wasm backend (ADR-153)"
miss=""
# Only run if kernel is installed (graceful per ADR-150 constraint #3)
if node -e "import('@metaharness/kernel').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
  BACKEND=$(node --input-type=module -e "
    const { loadKernel } = await import('@metaharness/kernel');
    const k = await loadKernel();
    process.stdout.write(k.backend || 'unknown');
  " 2>/dev/null)
  case "$BACKEND" in
    wasm)
      : # expected — see ADR-153
      ;;
    native|napi|napi-rs)
      # Upstream published the natives — re-baseline ruflo's perf docs
      miss="$miss kernel-now-native-rebaseline-perf-docs"
      ;;
    *)
      miss="$miss kernel-unknown-backend:$BACKEND"
      ;;
  esac
fi
[[ -z "$miss" ]] && ok || bad "$miss"
```

### Doctor surface

`npx ruflo doctor --component metaharness` should already report the kernel backend; verify that the JSON includes a `kernelBackend: 'wasm' | 'native' | 'absent'` field. If not, add it as part of the next doctor revision.

### Benchmark docstring

Wherever ruflo's perf docs cite kernel dispatch latency, add a one-liner:

> *Measured against `@metaharness/kernel`'s WASM path. NAPI-RS native binaries (`@metaharness/kernel-{darwin-arm64,linux-x64-gnu,…}`) are declared but not yet published upstream — see [ADR-153](v3/docs/adr/ADR-153-metaharness-kernel-platform-binaries.md).*

## Cross-references

- [ADR-150](ADR-150-metaharness-integration-surfaces.md) — MetaHarness integration surfaces (where `@metaharness/kernel` was first added as `optionalDependency`)
- [ADR-124](ADR-124-optional-native-deps.md) — Optional native dependencies pattern (the precedent this follows)
- [ADR-148](ADR-148-cost-optimal-router-lifecycle.md) — Cost-optimal router (consumes `@metaharness/router`, parallel-logs via the kernel's `SelfEvolvingRouter`)
- **Upstream tracking**: TBD — file an issue on `ruvnet/agent-harness-generator` for the per-platform publish (PR welcome, since the build matrix lives upstream)

## Open questions

1. **When to re-baseline perf docs.** Trigger: smoke gate fires `kernel-now-native-rebaseline-perf-docs`. Action: re-run the relevant benchmarks, compare WASM vs NAPI-RS, update the docs with side-by-side numbers, drop the ADR's "currently inverted" caveat.
2. **Whether ruflo should publish its own NAPI-RS binaries as a fallback fallback.** No — out of scope. ruflo is a downstream consumer of `@metaharness/kernel`, not a native-binary publisher. If upstream stays unpublished for >1 quarter, revisit this decision.
3. **Whether the kernel API surface differs at all between WASM and NAPI-RS.** Spot-checked the WASM path on darwin-arm64; the exports match the TS declarations. ADR-150 Phase 3 §3.4 (Capability Graph) is the systematic answer for behavioral parity at API level — that's where to add a row per kernel method.
