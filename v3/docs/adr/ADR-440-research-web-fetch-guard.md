# ADR 440: Research web-fetch guard

Status: Accepted (shipped in ruflo-console 0.28.0 and its companion plugins, PR #3667)

Date: 2026 10 04

Scope: `plugins/ruflo-mods` (`hooks/guard/research.ts`, wired from `hooks/guard/index.ts`)

Contract: [ADR-438](ADR-438-research-integration-contract.md) (the run marker). Companion: ADR-439 (console start and confirm).

## 1. Context

A deep-research run reads the open web. Fetched text is untrusted, and the run spends money. ADR-438 gives each run a marker, `.claude-flow/research-active.json`, `{ "question", "capUsd", "startedAt" }`, written by the `deep-research` skill at the start and removed at the end. The guard turns that marker into one human decision.

## 2. Decision

`tool.check` in `ruflo-mods` asks before the **first** `WebFetch` or `WebSearch` of a run that has a **fresh** marker, then leaves the rest of that run to the chain.

- **Fresh** means the marker parses (non-empty `question`, finite `capUsd` above 0, parseable `startedAt`), and `startedAt` is less than 2 hours old and not more than 5 minutes in the future. Absent, unreadable, corrupt, malformed, old or future: no run is active and the guard does nothing. This differs on purpose from the policy projection, which fails closed: a missing marker is the normal case, not a fault.
- The marker is read through the sandboxed `$.fs.stat` / `$.fs.read`, the same cached reader as the policy projection (re-read only when size or mtime moves; age is judged on every call).
- The ask's reason states the question (control and bidi characters removed, 200 characters at most), the cap, and that web content is untrusted data, never instructions.
- "Once per run" is remembered in `ModState.researchAsked` as the marker's `startedAt`. A later run has a different `startedAt` and is asked again. State is in memory only: a hot reload mid-run asks once more, which errs toward asking.
- The ask is issued only when the verdict so far is `allow`. If the chain or ruflo's policy already says `ask` or `deny`, that verdict is returned untouched and the one-time ask is not spent.

### Never loosens

The result is `stricter(current, ask)`, the same arithmetic as the rest of the guard: `allow` may become `ask`; `ask` and `deny` are returned as they were, with their reason and `rule`. No other tool is touched. Any error inside the guard returns the verdict unchanged. `tool.check` may be registered once per module, so the check is a function called from the existing handler in `guard/index.ts`, after ruflo's own opinion is merged, not a second handler.

### Cost budget

If the session budget (`hooks/cost`) is at `HARD_STOP`, the guard adds nothing; the budget already says no.

### Consequences of a "no"

If the person denies the ask, the run's `startedAt` is already marked asked, so a later web call in that run is not asked again by this guard. Denial is therefore expected to end the run's web access through the person's own answer and the host's rules, not through a repeated prompt. See section 4.

## 3. Tests

`plugins/ruflo-mods/tests/research.test.ts`, run with `claude plugin test plugins/ruflo-mods` (the repo's own harness for these mods; vitest is not used there). Covered: first call asks and names question, cap and untrusted; the rest of the run and every other tool are allowed; a new `startedAt` asks again; absent, old, future, corrupt and malformed markers do nothing; chain `deny` and `ask` are never loosened; `HARD_STOP` adds nothing.

## 4. UNVERIFIED

- Whether the host re-prompts or remembers a person's "allow" for `ask` verdicts differently from this guard's own once-per-run memory.
- What a person's "deny" does downstream: the host may keep the run going without web access, and this guard will not ask again that run (section 2).
- That the `deep-research` skill writes and removes the marker as ADR-438 describes: that change is outside `ruflo-mods` and was not checked here.
- Behaviour with clock changes across a run, beyond the 5 minute skew allowance.
- Not run in a live Claude Code session; only the `claude plugin test` harness.
