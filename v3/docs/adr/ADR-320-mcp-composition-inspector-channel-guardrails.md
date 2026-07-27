# ADR-320 — MCP Tool Composition Inspector + Inter-Agent Channel Guardrails

**Status**: Accepted
**Date**: 2026-07-26
**Related**: dream-cycle #2783 (CLI-only v1 of both scanners), ADR-131 (Tool-Output Guardrail), ADR-144 (Agent Authorization Propagation), ADR-178 (RepE/IPI Detection Hook), ADR-320-plugin-publish-scanner-and-runtime-manifest-enforcement.md (a **different, unrelated** proposal that also claimed the "ADR-320" number — see "Numbering collision" below)

## Context

Two 2026 papers describe attack surfaces this repo did not yet have a general-purpose detector for:

- **ShareLock** (arXiv:2606.27027) — fragments a malicious instruction across multiple MCP tool descriptions (Shamir-secret-sharing style) so no single tool's description looks malicious on its own, defeating per-tool inspection.
- **ChannelGuard** (arXiv:2607.19430) — shows individually-safe agents still propagate prompt injection through unmonitored inter-agent message channels, because each hop's own safety check passes on what is, locally, legitimate output.

### What already existed in this repo before this ADR

Before writing any code, this work verified the codebase rather than trusting the original dream-cycle proposal text. That check found **prior art already merged to `main`**: dream-cycle #2783 (commits `381b7ebcc`, `581cd2bf3`) shipped a CLI-only v1 of both ideas directly, without an ADR:

- `v3/@claude-flow/cli/src/security/mcp-composition-inspector.ts` — an on-demand `ruflo security composition-scan` command using exact common-substring matching, an injection-phrase catalog, and a typosquat check.
- `v3/@claude-flow/cli/src/security/channel-guard.ts` — an on-demand `ruflo security channel-scan` command with its own injection-phrase catalog (`src/security/injection-catalog.ts`).

Both are still in the tree, unmodified by this ADR. Their own doc comments are explicit about scope: the composition inspector's header says it is "a bounded engineering fix rather than an ADR-scope subsystem" and lists **"Future v2: SimHash + LSH for scale"** as deliberately deferred. This ADR is that v2 — not a duplicate. Concretely, the two generations differ:

| | CLI v1 (#2783, already merged) | This ADR (v2) |
|---|---|---|
| Composition detection | Exact common-substring scan, O(pairs × description length) | 64-bit SimHash fingerprint + hashed-shingle inverted index, O(1) Hamming distance per pair after O(total shingles) indexing |
| Composition packaging | CLI-only command (`@claude-flow/cli`) | Reusable library (`@claude-flow/security`), callable from a hook before a tool chain executes |
| Channel scan detection | Regex/phrase heuristics, own catalog | Same four detection categories, but **sanitization reuses the real `InputValidator`** (`sanitizeString`) instead of a bespoke catalog |
| Channel scan packaging | CLI-only command | Reusable module (`@claude-flow/hooks`), wired directly into the swarm messaging hot path |

### Numbering collision (documented, not resolved here)

"ADR-320" was independently claimed by an unrelated, still-open proposal — `v3/docs/adr/ADR-320-plugin-publish-scanner-and-runtime-manifest-enforcement.md` (plugin publish-time scanning + permission manifests, PR #2687/#2630) — which had not merged into `main` as of this writing and does not exist in this checkout. Per this ADR's own scope, that collision is **not resolved here**; if both land, one will need renumbering. This document only claims the MCP-composition/inter-agent-channel topic.

## Decision

### 1. MCP Tool Composition Inspector (v2 — SimHash-based)

**Built**: `v3/@claude-flow/security/src/mcp-composition-inspector.ts` (~330 lines)

A dependency-free SimHash implementation (FNV-1a 64-bit shingle hashing + majority-vote bit fingerprint) plus a hashed-shingle inverted index:

```typescript
export function inspectToolComposition(
  tools: readonly McpToolDescriptor[],
  options?: CompositionInspectorOptions,
): CompositionInspectionResult;

export function evaluateToolComposition(
  tools: readonly McpToolDescriptor[],
  options?: CompositionInspectorOptions,
): CompositionGuardResult; // warn+log by default; 'block' when opted in
```

Algorithm: each tool description is split into overlapping 5-word shingles; each tool gets a 64-bit SimHash fingerprint (fast Hamming-distance coarse filter, avoiding an LLM call). A global inverted shingle-hash index gives the *actual* shared text for reporting and enforces the same false-positive guard the CLI v1 pioneered: a shingle shared by more than `maxFragmentPopulation` (default 3) tools is treated as template language, not an attack — Shamir-split fragments concentrate in a small conspiracy of 2-3 tools. A pair is flagged when either the SimHash similarity or the low-population fragment-overlap ratio crosses its threshold (both configurable) **and** at least one low-population shared shingle exists.

Default action is **warn + log** (`console.warn`, one line per finding). Set `CLAUDE_FLOW_MCP_COMPOSITION_BLOCK=1` to switch `evaluateToolComposition`'s `action`/`blocked` fields to `'block'`/`true` — the function itself never throws or aborts anything; the caller (pre-task hook / MCP dispatcher) decides what "blocked" means operationally. No caller currently invokes this before dispatch (see "Deviations" below) — it is exported, tested, and ready to be called from such a hook point.

### 2. Inter-Agent Channel Guard

**Built**: `v3/@claude-flow/hooks/src/workers/channel-guard-worker.ts` (~290 lines)

Reuses `sanitizeString` from `@claude-flow/security`'s real `InputValidator` (not a bespoke catalog) for the general-purpose stripping pass (null bytes, HTML brackets, `javascript:`/`data:` URIs), then layers channel-specific detection on top:

```typescript
export function scanChannelMessage(message: string, options?: ChannelGuardOptions): ChannelScanResult;
export function sanitizeChannelMessage(message: string, options?: ChannelGuardOptions): { sanitized: string; result: ChannelScanResult };
export function guardChannelMessage(message: string, options?: ChannelGuardOptions): ChannelGuardOutcome;
export function isChannelGateEnabled(): boolean;
export function createChannelGuardHandler(): HookHandler; // HookEvent.PostTask-shaped
export function registerChannelGuardHook(registry?: HookRegistry): string;
```

Four detection categories: known injection phrases, mid-message role-shift markers (`system:`/`assistant:`/`user:`/`developer:` — a marker at message offset 0 is a legitimate preamble and is allowed), long base64/hex runs, and zero-width/bidi Unicode obfuscation. Sanitization strips structural markers (role-shift, zero-width chars) and logs findings; it deliberately does **not** try to rewrite injection *phrases* out of natural-language text — that's unreliable — those are reported as findings instead. `CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0` disables the gate entirely (message passes through unchanged, no logging).

**Live wiring** (done, not just documented): `guardChannelMessage()` is called inside `SwarmCommunication.sendMessage()` (`v3/@claude-flow/hooks/src/swarm/index.ts`) — every message constructed by that class (directly, or via `broadcastContext`/`queryAgents`/handoff helpers, which all funnel through `sendMessage`) is sanitized before being stored/emitted.

`@claude-flow/hooks`'s `package.json` gained a `@claude-flow/security` dependency to make the `sanitizeString` import possible (it had none before).

## Deviations from the original proposal

The original (pre-implementation) proposal text assumed two things that didn't hold once the real code was read:

1. **"Hook point: pre-task hook, before MCP tool invocation."** No such hook currently calls the tool registry's descriptions before dispatch in a way this module could attach to without inventing that call site itself, which was out of scope for this ADR (it would be a change to the MCP dispatcher, not the inspector). `evaluateToolComposition` is built, exported, and tested as a ready-to-call library function; wiring an actual pre-dispatch call site is left as follow-up work, same as `ipi-detection-hook.ts` (ADR-178) left its own PreToolUse wiring as the thing *this* module builds on top of, not something *it* rewires elsewhere.
2. **"Swarm coordinator message router (before SendMessage dispatch)."** There is no single swarm-coordinator chokepoint. `SwarmCommunication` (`@claude-flow/hooks/src/swarm/index.ts`) is a real, self-contained messaging class with one `sendMessage()` method used by everything in that class — verified safe and low-risk to wire into, and now wired. Separately, `@claude-flow/swarm`'s topology coordinators (`queen-coordinator.ts`, `unified-coordinator.ts`, and the mesh/hierarchical implementations referenced in the ADR's "Topologies affected" list) do **not** import `SwarmCommunication` — grepped and confirmed (`grep -rl SwarmCommunication v3/@claude-flow --include=*.ts` returns only `hooks/src/index.ts`). They have their own, separate agent-communication code paths. **This means the live wiring covers messages sent through `SwarmCommunication`, but does not automatically cover messages passed directly through `@claude-flow/swarm`'s coordinator classes.** Reaching into those coordinators' internals to add an equivalent gate was judged too invasive to do safely without a much deeper read of each one's message-passing model than this task's scope allowed — per this ADR's own instructions, a correct and well-tested module with a documented (not forced) integration point was chosen over a rushed, unverified wire-up into unfamiliar coordinator internals.
3. **Composition Inspector's "hook point" is similarly not wired to a live call site**, for the same reason as (1).

Both `createChannelGuardHandler`/`registerChannelGuardHook` (a `HookEvent.PostTask`-shaped registration, matching the `registerIpiDetectionHook` convention from ADR-178) exist and are tested, but are **not** eagerly registered on the default `HookRegistry` the way `ipi-detection-hook.ts`'s handler is — `HookContext.data` semantics on `PostTask` vary by caller, and eager registration risked silently misfiring against non-message payloads. Callers who want the `PostTask` lifecycle hook (rather than, or in addition to, the direct `SwarmCommunication` wiring) opt in explicitly by calling `registerChannelGuardHook()`.

## Consequences

**Positive**:
- A genuine SimHash-based composition detector now exists as a reusable library primitive, closing the gap the CLI v1's own header flagged as future work.
- The channel guard is the first of the two #2783-adjacent scanners to actually reuse the real `InputValidator` rather than maintaining a parallel injection-phrase catalog, and the first to be live-wired into an actual message-construction path rather than existing only as an on-demand CLI command.
- Both new env vars default to the safe/non-breaking posture (warn-only composition inspector, enabled-but-non-blocking channel gate) — no behavior change for existing callers who don't opt into strict mode.

**Negative / trade-offs**:
- SimHash + fragment-overlap thresholds (`simhashThreshold` 0.6, `fragmentOverlapThreshold` 0.25 defaults) need real-world calibration against this repo's actual ~314-tool MCP registry; the adversarial and false-positive-guard tests use synthetic fixtures, not that live registry. The CLI v1's own README-style comment about a 92× false-positive reduction from population-capping (152,560 → 1,788 raw substring hits) came from scanning the real registry — this module's thresholds have not yet been run against that same registry to get an equivalent real-world number.
- Neither module is wired into a live pre-dispatch/pre-tool-invocation call site (see "Deviations" above) — they are correct, tested library code, not yet an enforced boundary for MCP tool-chain composition.
- `SwarmCommunication`-only wiring for the channel guard means `@claude-flow/swarm`'s topology coordinators remain unprotected by this specific gate.
- `sanitizeChannelMessage` intentionally leaves injection *phrases* in the text (only structural markers are stripped) — a caller relying on the sanitized output alone to be phrase-free would be wrong; the `findings`/warnings must be consulted too.

## Validation

- `v3/@claude-flow/security/__tests__/mcp-composition-inspector.test.ts` — 11 tests: SimHash/Hamming-distance primitives, an adversarial split-payload pair (individually-benign tool descriptions sharing an injected fragment) correctly flagged, a legitimate 3-tool chain correctly *not* flagged, a 10-tool shared-boilerplate false-positive guard, and `evaluateToolComposition`'s warn-by-default / `CLAUDE_FLOW_MCP_COMPOSITION_BLOCK=1`-opt-in-block behavior.
- `v3/@claude-flow/hooks/__tests__/channel-guard-worker.test.ts` — 18 tests: all four detection categories plus their false-positive counterexamples (leading vs. mid-message role marker, short vs. long encoded run), proof that `sanitizeChannelMessage`'s output equals the real `sanitizeString`'s output on a message with no channel-specific findings (i.e., genuine reuse, not reimplementation), the `CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0` opt-out, the `HookEvent.PostTask` handler/registration, and three live-wiring tests against a real `SwarmCommunication` instance.
- `npx tsc --noEmit` clean in both `@claude-flow/security` and `@claude-flow/hooks`.
- Full package test suites: `@claude-flow/security` 516/523 passing (7 pre-existing, unrelated `path-validator.test.ts` failures — Windows path-separator (`\` vs `/`) assertions, confirmed via `git stash` to fail identically before this change); `@claude-flow/hooks` 134/134 passing, 0 regressions.
- `scripts/audit-env-var-precedence.mjs` passes with both new env vars registered as documented escape hatches.

## References

- arXiv:2606.27027 — ShareLock (MCP tool-description instruction fragmentation)
- arXiv:2607.19430 — ChannelGuard (inter-agent message-channel injection propagation)
- dream-cycle #2783 — prior CLI-only v1 of both ideas (`381b7ebcc`, `581cd2bf3`)
- ADR-178 — RepE/IPI Detection Hook (`registerIpiDetectionHook` convention this ADR's channel-guard hook registration follows)
- ADR-144 — Agent Authorization Propagation (adjacent but orthogonal: governs *who* may call a tool, not *what content* flows between agents)
