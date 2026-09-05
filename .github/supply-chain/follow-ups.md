# Supply-chain & quality follow-ups

Open issues that the supply-chain audit + recent CI hardening surfaced but require work beyond a single PR. Triaged on 2026-05-19.

## #2047 — Witness manifests report `missing=95 drift=2`

**Status**: HIGH, open. Tracked at https://github.com/ruvnet/ruflo/issues/2047.

**Root cause**: the 12-hour scheduled verification job runs in a bare-source environment (no `npm ci && npm run build`), but the signed witness manifest references 95 compiled `dist/**` artifacts. In a pre-build state those files don't exist on disk → verify reports them as missing. The Ed25519 signature itself is valid; this is *not* tamper.

**Right fix** (when someone has cycles for it):

1. Identify the scheduled runner (it's not in `.github/workflows/`; it's likely an external poll that opens `[verification]` HIGH issues against this repo).
2. Make that runner do `npm ci --legacy-peer-deps && pnpm -C v3 install --frozen-lockfile && pnpm -C v3 build` before invoking `verify.mjs`.
3. Alternative: split the witness manifest into `src/`-only entries (always present) and `dist/`-only entries (built-by-CI), and have verify.mjs treat `missing` on dist entries as `expected-when-not-built` rather than HIGH.

**Interim CI guard** (already in place):
- `witness-verify-precondition-smoke` job in `v3-ci.yml` exercises the verify path on PRs *after* a build, so the manifest stays internally consistent against the buildable surface.
- `witness-marker-drift-smoke` runs the marker-presence layer (no signature, no build, no native deps) on every push/PR.

## #2048 — `agentic-flow/reasoningbank` ESM import fails on Windows (onnxruntime native binding)

**Status**: FIXED upstream + downstream integrated. Tracked at https://github.com/ruvnet/ruflo/issues/2048.

**Root cause**: `import('agentic-flow/reasoningbank')` triggered an eager load of `onnxruntime-node`'s native binding (`onnxruntime_binding.node`), which fails on Windows with "OS cannot run %1" even when the user has VCRedist installed. The chain was `reasoningbank/index.ts → core/distill.ts → router/router.ts → onnx-local.ts (top-level await)`. The top-level `await import('onnxruntime-node')` in `onnx-local.ts` forced the binding load at module-evaluation time, before any user code ran.

**Upstream fix** (PR ruvnet/agentic-flow#155, shipped as agentic-flow@2.0.13):

1. ✅ `src/router/providers/onnx-local.ts` — moved the top-level `await import('onnxruntime-node')` into a lazy `loadOrt()` helper called from `initializeSession()`. The binding now loads only when an explicit inference call happens, never at module import time.
2. ✅ `src/router/providers/onnx-local-optimized.ts` — removed the eager top-level try/catch around `await import('onnxruntime-node')`. It was dead code (the class extends ONNXLocalProvider and never used `ort` directly), but it was still triggering the binding at import time.
3. ✅ `onnxruntime-node` was already in `optionalDependencies` per 2.0.12 — no `package.json` change needed for this fix.

**Downstream integration** (this PR):

- Bumped `agentic-flow` ^2.0.12 → ^2.0.13 in root `package.json` and `v3/@claude-flow/browser/package.json`.
- Regenerated root `package-lock.json`, `v3/@claude-flow/browser/package-lock.json` (npm `--no-workspaces`), and `v3/pnpm-lock.yaml`.

**Acceptance test** (verified locally on 2.0.13):
```bash
# Full install — binding present, but never loaded at module import
npm install agentic-flow@2.0.13
node -e "import('agentic-flow/reasoningbank').then(()=>console.log('OK'))"  # → OK
node -e "import('agentic-flow/router').then(()=>console.log('OK'))"  # → OK

# Simulated Windows: --omit=optional skips the binding entirely
npm install agentic-flow@2.0.13 --omit=optional
node -e "import('agentic-flow/router').then(()=>console.log('OK'))"  # → OK (was: FAIL)
```

**Follow-up CI guard** (now possible):
- Add a Windows-runner smoke job that does `node -e "import('agentic-flow/reasoningbank').then(()=>console.log('OK'))"` under `--omit=optional` to lock the lazy-load contract in place. Add to `v3-ci.yml` alongside the existing supply-chain audit jobs.

**Related**: `--omit=optional` surfaced a separate import (agentdb static import via reasoningbank graph). That's NOT #2048 (which was specifically the Windows native binding crash with the binding present). Tracking separately if it becomes user-facing.

## #2049 — `kg-extract` over-counts type imports + `kg-traverse` mis-wired

**Status**: closed by THIS PR.

- ✅ `kg-extract/SKILL.md` now declares `type-depends-on` as a separate relation with weight `0.1` and includes a regex carve-out for `import type` + inline `type` specifiers.
- ✅ `kg-traverse/SKILL.md` step 3 now calls `agentdb_pattern-search` (enabled) instead of `agentdb_semantic-route` (compiled-out). Both `allowed-tools` lines updated.
- ✅ New CI smoke `scripts/smoke-kg-extract-type-imports.mjs` + workflow job `kg-extract-type-imports-smoke` runs static contract checks on both SKILL.md files PLUS a behavioural fixture test that ensures the published regex correctly separates type-only imports from value imports.
