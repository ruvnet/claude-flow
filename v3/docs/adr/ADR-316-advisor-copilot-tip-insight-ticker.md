# ADR-316: Fable co-pilot advisor tip in the statusline insight ticker

- **Status**: Implemented
- **Date**: 2026-07-11
- **Deciders**: ruv
- **Related**: [ADR-172](ADR-172-fable-advisor-harness.md) (the cost-disciplined Fable harness this ADR reuses, not reinvents), the local insight ticker built earlier this session (`src/funnel/insights.ts`, priority-ordered candidates: CVEs pending, uncommitted changes, power-saver active, flywheel status), [ADR-313](ADR-313-sponsored-downtime-proxy-mode.md)/[ADR-314](ADR-314-power-saver-mode-and-sponsored-abuse-prevention.md)/[ADR-315](ADR-315-free-user-flywheel-training-pipeline.md) (the consent-domain pattern this ADR follows exactly)

## Context

"Integrate ruflo's copilot advisor into the promo ticker."

There is no existing "ruflo copilot advisor" feature — grounded against the real corpus (RuvNet Brain `search_ruvnet`, direct source reads), the closest real, shipped primitive is **ADR-172's Fable Advisor Harness** (`src/services/fable-harness.ts`): a cost-disciplined, opt-in, budget-capped headless `claude -p --model claude-fable-5` judge/reflector, currently consumed only by the memory-distillation oracle (`distill-oracle.ts`) for judging trajectory completions and GEPA reflective mutation. Nothing wires it into the statusline. `ADR-147` (Copilot SDK adapter) and `agent-harness-generator`'s Copilot-as-host ADR are both unrelated — different products (GitHub Copilot integration, a third agent platform), not an advisor tip.

This ADR is the missing wiring: reuse the existing Fable harness to generate ONE proactive, actionable tip and surface it through the local insight ticker already built this session — without violating either subsystem's existing invariants:

- The insight ticker (`insights.ts`) is deliberately synchronous, local, $0 — its own doc comment states "NEVER a network call from here." A Fable call is a real network-bound `claude -p` spawn with real cost, so it categorically cannot live in the ticker's hot path.
- ADR-309's "no raw prompt/command/path content, ever" bar is about a *different* data flow (ruflo's own telemetry) but the same discipline applies here for a different reason: anything sent to Fable is visible to that model call, so the query must never carry raw session content — only the same closed set of structural signals the ticker already surfaces (security scan status, swarm state, git-uncommitted count).
- ADR-172's harness is OFF by default and spends nothing unless a budget cap is explicitly configured — this feature must preserve that (a new, separate, never-bundled consent domain, exactly like every other decision in this feature family).

## Decision

### Data flow

```
consent + 24h TTL gate (advisor-tip.ts)
        │  (only when both pass)
        ▼
FableHarness.adviseCoPilotTip(structuralSnapshot)   [services/fable-harness.ts]
        │  writes
        ▼
~/.ruflo/advisor-tip.json  { _ts, headline, detail }
        │  read synchronously, $0, no network
        ▼
insights.ts's advisorTipInsight()  →  local insight ticker  →  statusline
```

### 1. `FableHarness.adviseCoPilotTip()` (services/fable-harness.ts)

A third entry point alongside `judgeBatch`/`reflectFailures`, same cost/cwd/parsing discipline (fresh empty temp cwd, `--append-system-prompt`, `--max-budget-usd`, stdin-piped payload — never an argv positional). Takes a `CoPilotSnapshot` (security status, swarm state, git-uncommitted count, context-window %) and returns one `CoPilotTip { headline, detail, confidence }` or `null`. The system prompt explicitly instructs the model: no prompt/command/file content is present in the input, never invent facts not present in the snapshot, and an empty array is a valid "nothing worth saying" answer — not a parse failure.

### 2. `funnel/advisor-tip.ts` — the safety wrapper

Three hard gates before any spend:
1. **Consent** — new `advisor-tips` domain (`types.ts`/`consent.ts`), never bundled with `sponsored-downtime`/`power-saver`/`training-data-sharing` or anything else.
2. **TTL** — `readStateJson`-backed cache, checked BEFORE constructing the harness. At most one real spend per `ADVISOR_REFRESH_TTL_MS` (24h) regardless of session count. A "no tip" answer still stamps `_ts` so the same question isn't re-asked (and re-billed) within the same window.
3. **Budget** — `ADVISOR_DEFAULT_BUDGET_USD` (0.40 — a single unbatched call uses the ~$0.34 clean-cwd cost anchor, not the ~$0.02 batched anchor which only applies across ~20 items), overridable via `RUFLO_ADVISOR_MAX_BUDGET_USD`, enforced by FableHarness's own `--max-budget-usd` pass-through to the real `claude -p` call.

### 3. CLI surface (`src/commands/advisor.ts`)

`ruflo advisor enable --yes` / `disable` / `status`, mirroring the disclosure-then-confirm shape of `proxy.ts`'s sponsored/power-saver/training-share subcommands. Unlike those, `advisor` has **no proxy-config.toml mirror** — this feature never touches the meta-proxy Rust binary; it calls `claude -p` directly, client-side only. Registered as its own top-level lazy-loaded command (`commands/index.ts`), not nested under `proxy`.

### 4. Background refresh wiring (mirrors the ADR-311 promo-cache fix exactly)

`ruflo hooks refresh-advisor` (new subcommand in `commands/hooks.ts`, alongside the existing `refresh-funnel`) builds a snapshot via the shared `funnel/local-signals.ts` helpers (see below) and calls `refreshAdvisorTipIfStale`. `hook-handler.cjs`'s `session-restore` handler spawns this **detached + unref'd**, same pattern as `spawnDetachedFunnelRefresh` — this is load-bearing: a fire-and-forget call from a short-lived subprocess never completes (the exact bug the promo-cache fix addressed earlier this session), so the refresh needs a properly-awaited, longer-lived invocation. Safe to call unconditionally on every session-restore: the TTL/consent checks inside `refreshAdvisorTipIfStale` make an unconsented or already-fresh install a fast local file read, never a network call.

### 5. Shared structural-signal extraction (`funnel/local-signals.ts`, new)

`getSecurityStatus()`, `getSwarmStatus()`, `getGitUncommittedCount()` were previously private closures inside `commands/hooks.ts`'s `statuslineCommand` action. Extracted to a shared module so the statusline and the (separately-invoked) `refresh-advisor` CLI subcommand can never silently drift on what these signals mean — a single source of truth, same behavior, zero duplication.

### 6. Insight ticker wiring (`insights.ts`)

`advisorTipInsight()` — priority 45 (between uncommitted-changes at 50 and flywheel-status at 40) — re-checks `hasConsent('advisor-tips')` even though it's just reading a cache: this is what actually enforces "disable means off" the instant a user revokes consent, without needing to also delete the cache file on disable.

## A real bug found and fixed along the way

Both `advisor-tip.ts`'s `isCacheStale`/`readAdvisorTip` and the pre-existing `flywheelInsight` in `insights.ts` used `!cache._ts` to check for a missing timestamp. Since `0` is falsy in JS, a legitimate `_ts: 0` (epoch) is indistinguishable from "no timestamp at all" — surfaced by a test using `new Date(0)` for a deterministic clock. Fixed in both places: `typeof cache._ts !== 'number'`. Benign in production (`Date.now()` is never 0), but a real latent defect, now closed in both call sites since it's the identical pattern.

## Consequences

- Reuses ADR-172's harness exactly as designed — no new cost-discipline primitive invented, no duplicate `claude -p` wrapper.
- The one insight source in the whole ticker family that spends real money and makes a real network call is isolated behind three independent gates (consent, TTL, budget), any one of which alone would make runaway spend impossible.
- `local-signals.ts` extraction is a pure refactor (no behavior change) that removes a source of future drift between the statusline and any other consumer of the same structural signals.
- Not addressed here (future work, if ever wanted): a settings surface to tune `ADVISOR_REFRESH_TTL_MS` per-user, or feeding `contextPctUsed` into the snapshot (the type field exists in `CoPilotSnapshot` but nothing populates it yet — deliberately left for a future iteration rather than wiring a rough estimate now).

## References

- [ADR-172: Fable Advisor Harness](ADR-172-fable-advisor-harness.md) — the harness this ADR wires up, unchanged in its own cost model
- [ADR-315: Free-user flywheel training pipeline](ADR-315-free-user-flywheel-training-pipeline.md) — the consent-domain pattern (`training-data-sharing`) this ADR's `advisor-tips` domain mirrors exactly
- `src/funnel/insights.ts` — the local insight ticker this ADR adds a fifth source to
