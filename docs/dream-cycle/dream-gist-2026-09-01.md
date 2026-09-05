# MCP Tool-Call Rate-Limit Reset Semantics SOTA Report — 2026-09-01

TL;DR: Ruflo's opt-in MCP governance policy enforcer (shipped 2026-08-31, PR #3139, still unmerged) tracked `maxToolCallsPerTurn` as a **session-lifetime cumulative counter that never resets** — a long legitimate session could get permanently locked out until the server process restarted. Tonight (2026-09-01) research across 5 parallel roles found convergent 2026 evidence that the right fix is a **wall-clock sliding window**, not a turn-count reset (which is gameable) and not a token bucket (wrong shape for a hard per-window ceiling). Implemented, tested (24 tests, 9 new), and pushed as a follow-up on top of #3139's branch.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MCP spec mandates "rate limit tool invocations" with zero mechanism guidance | modelcontextprotocol.io/specification/2025-06-18/server/tools (direct read) | A |
| MCP's 2026-07-28 revision (SEP-2567) removes the protocol-level session concept entirely | SEP-2567 spec text (direct read) | A |
| Cloudflare's production sliding-window-counter rate limiter: 0.003% wrong-decision rate across 400M requests | Cloudflare rate-limiting engineering writeups | A |
| Google ADK's `RunConfig.max_llm_calls` is a session-lifetime cumulative counter with no documented reset — the same latent bug class | google.github.io/adk-docs; adk-python issue #3828 | B |
| FastMCP middleware and the PolicyLayer MCP firewall both anchor resets to wall-clock time (token-bucket / fixed-calendar-window), never to turn count | gofastmcp.com/python-sdk docs; policylayer.com/blog (direct quotes) | A |
| "Resilient Consensus in Agentic AI" (arXiv:2606.15024): unfiltered LLM-agent consensus fails classical resilient-consensus guarantees; explicit filter/weighting layers recover it | arXiv:2606.15024, controlled experiment | B |

## Ruflo Current Capability

`v3/@claude-flow/cli/src/mcp-tools/policy-enforcer.ts` (branch-only, unmerged as of tonight) enforces `auditLog` and `maxToolCallsPerTurn` for the stdio `tools/call` dispatch, fully opt-in via `RUFLO_MCP_ENFORCE_POLICY=1`, fail-closed on missing policy or failed audit writes (PR #3139 review round 1). Prior to tonight, `checkAndRecordCall` kept a `Map<sessionId, {callCount}>` that only incremented — once a session hit the shipped default of 200 calls, it stayed denied for the life of the stdio process. The module's own doc comment already disclosed this as unsafe to enable without a real reset. `.harness/mcp-policy.json` declared the field but no window/reset concept existed anywhere in the schema.

## Competitor Comparison

| Competitor | Rate-limits tool calls? | Reset semantics | Confidence |
|---|---|---|---|
| LangGraph | No built-in mechanism | N/A — `recursion_limit` halts the graph; rate limiting pushed to developer/proxy layer | B |
| OpenAI Agents SDK | Yes, hard cap | `max_turns` per `Runner.run()`; no in-run reset, no time component | A |
| Google ADK | Yes | `max_llm_calls`, session-lifetime cumulative, **no documented reset** — same bug class Ruflo had | B |
| CrewAI | Yes, pacing not budget | `max_rpm` — rolling-minute throttle, closer to leaky-bucket pacing | B |
| Anthropic MCP reference SDK / protocol | No | Deliberately deferred to transport/gateway layer by design | A |
| FastMCP (community MCP middleware) | Yes | Token bucket (default) or sliding window, continuously live, keyed per-client | A |
| PolicyLayer (MCP firewall) | Yes | Fixed calendar-aligned windows (UTC hour/day boundaries), persists across restarts | A |

Synthesis: MCP itself has no rate-limiting concept by design — the convergence is happening *around* the protocol (gateway products), not in it. Among agent frameworks, none implement a real per-turn sliding window for tool calls; what ships is either a hard circuit-breaker, a cumulative counter that never resets (ADK — Ruflo wasn't an outlier, it matched a real shipped default elsewhere), or wall-clock pacing. The two purpose-built MCP rate limiters that got this right both anchor to wall-clock time specifically to avoid a turn-count-reset being gameable by a chatty loop re-arming its own budget.

## Hypothesis

> Given a stdio MCP session under Ruflo's opt-in `RUFLO_MCP_ENFORCE_POLICY` governance, when `maxToolCallsPerTurn` enforcement changes from a permanent session-lifetime cumulative counter to a wall-clock sliding window (new `turnWindowMs` policy field, default 60000ms), then a session that pauses beyond the window has its call budget restored, relative to today's baseline (permanent lockout once exhausted), subject to: (1) default/flag-unset behavior is byte-for-byte unchanged; (2) all existing policy-enforcer and MCP-related tests remain green; (3) fully deterministic coverage via an injectable clock, zero LLM cost; (4) no change required at the `mcp-server.ts` call site.

Frozen before implementation; not modified after seeing results.

## Benchmarks

No benchmark corpus applies — this is a deterministic unit-level correctness fix (a counter either resets on schedule or it doesn't), not a quality/latency tradeoff evaluated against a task corpus.

## Evaluation

**evaluated: accepted.** Real evaluator: `vitest run`, deterministic, $0, zero LLM calls.

- `__tests__/mcp-policy-enforcer.test.ts`: **30/30 passing** (24 pre-existing tests, unmodified, all pass identically since none crossed a window boundary; 6 new — 5 direct `checkAndRecordCall` sliding-window cases [limit+1 denial then restoration, partial roll-off proving a genuine sliding window rather than a periodic full clear, default-window fallback, invalid-window fallback, and an exact-boundary pin (`now === cutoff`) added after independent adversarial review flagged it as untested] + 1 `evaluateToolCall` integration case using `vi.useFakeTimers()`, the existing repo pattern from `__tests__/services/workspace-lease.test.ts`, proving the fail-closed pipeline respects the reset end-to-end).
- Broader regression sweep across all 11 MCP-related test files in the package: **52/56 passing**. The 4 failures trace entirely to two unbuilt sibling packages in this fresh checkout — `@claude-flow/cli-core/dist` and `@claude-flow/neural/dist` (confirmed missing via direct `test -d` before any candidate code was touched) — the same disclosed environmental-gap class as 2026-08-17's and 2026-08-31's nights. `git diff --stat` confirms tonight's diff touches exactly 3 source-adjacent files (`policy-enforcer.ts`, its test, `.harness/mcp-policy.json`) plus the pnpm lockfile from installing dependencies — none of the failing tests import any of them.
- One-time environment fix (not a candidate change, disclosed per the same convention as prior nights): `pnpm install` had never been run for the v3 workspace in this fresh checkout, and `@claude-flow/mcp` (imported only by the unrelated, pre-existing `startHttpServer()` method in the same `mcp-server.ts` file) was unbuilt, breaking Vite's static transform for every test importing that module — built cleanly via plain `tsc` before running tests.

## Darwin Results

Not run. This is a binary correctness fix (the counter resets correctly, or it doesn't) with one tunable numeric parameter (`turnWindowMs`) that is plausibly Darwin-eligible in principle (evolve against a synthetic call-pattern corpus to balance throttling effectiveness vs. false-lockout rate), but building a representative benchmark corpus for that tonight would expand scope well beyond "small, reviewable" — explicitly the bias STEP 1.1 calls for given zero of the last 14 dream-cycle PRs have merged. Flagged as a legitimate future-night candidate rather than attempted here.

## SOTA Proof & Witness

Independent adversarial critique (separate subagent, no authoring context): **CONFIRMED-WITH-CAVEATS**. Both real findings were minor and fixed before this report was finalized: (1) the exact window-boundary case (`now === cutoff`) was untested — added as a pinned test; (2) the audit-log entry's `timestamp` field used wall-clock `Date.now()` instead of the injected `now`, cosmetic-only in production (both default to `Date.now()`) but could desync from the enforcement decision under a synthetic clock in tests — fixed to derive from `now`. No blocking correctness or security issue found. Reward-hack checklist (manual, no generic CLI tool reachable — consistent with every prior night's finding that `@metaharness/weight-eft` is a LoRA-distillation tool, not a diff/benchmark scanner): no test weakened, no benchmark/gold data exists to weaken, no cherry-picked cases, no seed manipulation (fully deterministic), $0 cost confirmed.

Flywheel: no `.claude-flow/flywheel/` state exists in this repo. Evidence retained as the committed test file + issue + this gist, same as every prior algorithmic/correctness dream-cycle candidate.

| Field | Value |
|---|---|
| Session commit | `29f048fc3b556f857cf2b126d2a84c19d2daa0d0` |
| Report SHA-256 (pre-witness content) | `75fa8021ab6b9890ab5202217c7bf343c97ad18a9c4e313c85d09eda3385f990` |
| Witness stamp | `7d93a48202ac2ee6c8568fd6f038b043f96deb624da06d59ae38a77310de91f8` |

Verifier procedure: take this gist's content with the Witness table's two value cells blanked back out, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge #3139 and this follow-up together** (or squash) — tonight's fix is meaningless without last night's enforcer; both are small, reviewable, and address the human reviewer's own round-1 feedback.
2. **A future night should prototype Darwin-tuning `turnWindowMs`** against a synthetic legitimate-burst-vs-abusive-loop corpus now that a real reset mechanism exists to tune.
3. **Thread `QueenCoordinator.weightedConsensus()` trust weights into the actual vote tally** on the next swarm-surface night — now triple-corroborated (2026-08-19 original finding, DySCo on 2026-08-31, and tonight's independent "Resilient Consensus in Agentic AI" + "Predictive Maps of Multi-Agent Reasoning" findings).
