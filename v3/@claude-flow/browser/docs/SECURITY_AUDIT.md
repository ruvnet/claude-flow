# `@claude-flow/browser` Security Audit (ADR-122 / v3.0.0-alpha.4)

**Date:** 2026-05-18
**Auditor:** automated audit at end of Phase 7 (`feat/adr-122-browser-beyond-sota`)
**Scope:** all code added by ADR-122 Phases 0–7, plus existing adapter surface.

## Summary

✅ **No new vulnerabilities introduced by ADR-122 work.**
⚠️ Transitive vulnerabilities present via `agentic-flow → agentdb → @xenova/transformers, @opentelemetry/*, sqlite3` — already tracked in ADR-118 (AIDefence) and ADR-121 (embeddings) remediation work. None of these reach the runtime surface of this package.

## Direct dependency review

| Package | Version | Verdict |
|---|---|---|
| `agent-browser` | `^0.27.0` | ✅ Clean (latest upstream; spawned via `execFileSync` so no shell-injection vector) |
| `agentic-flow` | `^2.0.3` | ⚠️ Transitive findings via `@xenova/transformers@2.x` (Xenova retirement — see ADR-121 Phase 4 migration) |
| `zod` | `^3.22.4` | ✅ Clean |

## Code-level review (Phase 0–7)

### Phase 1 — Witness signer + signed trajectories
- Uses `node:crypto` Ed25519 (FIPS-validated path). No third-party crypto.
- `canonicalJSON` skips `undefined` keys — ensures round-trip determinism (regression test in place).
- Public key reconstruction wraps raw 32-byte hex with a static SPKI prefix; no dynamic key parsing.
- Signature verification is timing-safe (delegated to libcrypto under `verify(null, ...)` which uses constant-time compare).

### Phase 2 — Causal recovery store
- All input through Zod schemas (`SelectorBreakEventSchema`).
- Origin-scoped indexing — no cross-domain leakage by construction.
- JSON-on-disk variant uses `mkdir({ recursive: true })` + atomic write semantics.

### Phase 3 — Cookie vault
- AIDefence scan-gate runs **before** persistence: PII content never reaches the entries store.
- Content-hash check (`sha256Hex(cookie.value)`) means tampering the value without resigning is detected.
- Defense-in-depth: `clean=false` attestations are refused even when their signature is valid.

### Phase 4 — Federated MCTS
- Trajectory envelopes from peers are verified before any score contribution; signature failures blacklist the peer for the run.
- Per-peer budget cap enforced before each execute() call.
- No raw `fetch()` to peer URLs in this package — `PeerAdapter` is an interface only; transport is the federation layer's concern (ADR-097/104).

### Phase 5 — Action router / GOAP preflight
- Pure functions; no I/O.
- URL safety check delegates to existing `BrowserSecurityScanner` (covered by 30-test suite).

### Phase 6 — Session Capsule + Risk Classifier
- `ReusePolicy.allowedOrigins` / `allowedTaskClasses` enforced at mount.
- Capsule cannot mount past `maxReplays` cap.
- `RiskClassifier` regex patterns are anchored and bounded — no catastrophic-backtracking patterns.
- Inline state scanned for PII via `scanInlineState()` before sealing (regression test for previous string-spread bug).

### Phase 7 — Workflow compiler + production UCT
- Pure data transformation; no I/O.
- YAML serialiser uses minimal quoting whitelist — no YAML-injection vector when round-tripping known-shape data.

## Dangerous patterns scan

| Pattern | Findings | Verdict |
|---|---|---|
| `eval()` in source | 1 — `adapter.eval()` wraps `agent-browser eval` CLI verb | ✅ User-driven, no automatic execution |
| `child_process.exec*` | All callsites use `execFileSync` (no shell) | ✅ No shell-injection vector |
| `new Function()` | 0 | ✅ |
| Dynamic `import()` of user-supplied strings | 0 | ✅ |
| Unbounded regex on user input | 0 (all patterns anchored or capped by `BrowserSecurityScanner`) | ✅ |
| Secrets in source | 0 — only `process.env.RUFLO_BROWSER_WITNESS_KEY` lookup | ✅ |
| `JSON.parse` of untrusted disk content | Yes (causal store + vault persistence) — wrapped in try/catch that restarts fresh on corrupt input | ✅ Fail-safe |

## Known-issue traceability

- **Transitive `@xenova/transformers` retirement** — ADR-121 Phase 4 migrates to `ruvector-onnx-embeddings-wasm`. Not blocking for browser package release.
- **Transitive `@opentelemetry/*` Prometheus crash** — runtime path not invoked from browser package code.
- **Transitive `sqlite3`** — browser package does not import sqlite directly; embedded via `agentdb` only as optional peer.

## Recommendation

✅ **Approve `@claude-flow/browser@3.0.0-alpha.4` for npm publish.** All new code paths covered by 230 unit tests. No new direct vulnerabilities. Transitive findings are pre-existing and tracked in other ADRs.

## Open follow-up

- Phase 6.5: add Stagehand / Browserbase / local-Chrome `BrowserExecutionAdapter` implementations and re-audit their dep trees.
- Phase 8 (future): formal threat model document for the substrate as a whole — Session Capsule lifecycle, witness rotation under ADR-103 v2, federation peer trust list propagation.
