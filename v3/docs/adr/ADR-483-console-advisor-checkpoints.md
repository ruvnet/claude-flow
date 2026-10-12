# ADR 483: Console advisor checkpoints for mission loops

Status: Accepted

Date: 2026-10-08

Builds on: ADR-441 (loop-centric missions), ADR-443 (missions Claude knows about, evidence and spend), ADR-444 (Claude controls the console), ADR-477 (toasts), ADR-480 (ADRs attached to missions), ADR-481 (text is never truncated)

Numbering: ADR-482 is taken by an open change (the dashboard connector); this is 483.

## 1. Context

A pattern for long agent sessions: a mid-tier model drives, cheap subagents do discovery and return summaries, and a stronger model sits on call as an **advisor**, consulted at three moments: before a plan locks, when the same test or compiler error fails twice, and before the work is declared done. The pattern was described with `claude --advisor opus --subagents haiku` flags and an `advisorModel` setting.

### 1.1 What was verified on this machine (Claude Code 2.1.289)

| Claim | Finding |
|---|---|
| `--advisor` / `--subagents` flags | **Absent.** `claude --help` lists `--model`, `--effort`, `--fallback-model`, `--forward-subagent-text`; nothing for an advisor or a subagent model. |
| `advisorModel` setting | Present in `~/.claude/settings.json` (`"advisorModel": "fable"`), so the host has an advisor tool. It is the host's own, model-facing tool. |
| A mod can call the advisor tool | **No.** The 20,436-line mod API (`plugin-authoring/types/claude-code.d.ts`) has no `advisor` symbol. A mod can call `$.model.complete` (one tool-less completion on a model alias, billed through the session), `$.tool.call`, `$.agent.spawn`, rewrite `agent.spawn`'s `model` (picking a subagent's model), `$.prompt.fill` and submit a prompt. |
| A mod can pick a subagent's model | **Yes**, by an `agent.spawn` hook that sets `e.model` (the `ruflo-mods` `agents/` and `cost/` hooks already hook that event to hide types and refuse spawns). That is a session-wide behaviour of a different plugin; it is **not** done here. |
| A mod can choose the lead model or effort | **No.** `--model` / `--effort` are launch-time flags and `/model` is the person's. |

So the in-session advisor tool cannot be triggered by a mod, and no host flag exists to configure roles. This ADR does not pretend otherwise.

### 1.2 What already existed

- `mission-loop.ts` builds the `/loop` prompt, which already tells Claude "stop and ask only when a gate fails the same way three ticks running", counts ticks, and computes a `tickPlan` (run-next, run-gates, wait, stop, rearm) that is recorded on every tick.
- `mission-verify.ts` records each gate run as an `evidence.gate` event with the gate id and exit code; `verdictOf` reads them back.
- `mission-guidance.ts` runs a read-only `claude -p --permission-mode plan` turn under the per-turn budget (after a goal is planned), asked first, and passes the answer to the session as quoted data. The AI terminal uses the same sandbox.
- `mission-guard.ts` holds the mission spend cap and a fresh-reading rule; ADR-480 attaches ADRs to a mission and compares changed files with their scope at verify time.
- The autopilot (`ap-*`, ADR-466) has its own review and parking logic and is **not touched**.

What was missing: nothing repeated a failure count, nothing paused a loop that kept failing the same way, and no checkpoint asked for a second opinion at plan-lock or before done.

## 2. Decision

**Add three advisor checkpoints to mission loops, default off, as deterministic ledger logic that issues a labelled, confirm-gated, read-only `claude -p` consult.** Settings gain three rows:

| Row | Default | Meaning |
|---|---|---|
| Advisor checkpoints | off | Turns every behaviour below on. Off: no event is recorded, no card appears, `tickPlan` returns exactly what it returned before. |
| Advisor model | default | The value passed to `claude -p --model` (`default` passes nothing and the CLI chooses). Same list as the Claude model row. |
| Subagents return summaries only | off | One sentence in the mission's `/loop` prompt asking subagents for a structured summary. An instruction to Claude; the console cannot enforce it on a subagent. |

### 2.1 Failure counting (`mission-advisor.ts`, pure)

A run is the consecutive failed results of one check (a gate id, or the task itself) on one task, cleared by a pass of that check. An unknown exit counts as neither. A retry (a new `task.dispatched`) does **not** clear the run; that is the point. Only ledger events are read, and advisor state is only ledger events too (never a field of `LoopState`, which `parseLoop` would refuse).

- **2 in a row**: a consult is *due*. It is offered once: the offer is recorded as `advisor.offered` with a ref naming the run, and a run that has already been offered (after its second failure) is `consulted`, not due.
- **3 in a row**: the **line stops**: the mission is paused (as `cap.reached` pauses it), `advisor.stop` is recorded and a toast says so. This matches the existing loop prompt (three times). A person's Resume records `advisor.resumed`, which starts a fresh count, so the next stop needs three new failures.

### 2.2 The three checkpoints

1. **Before the plan locks.** Offered right after a mission is created (plan built, no task started), and from a button on the Loop tab. The digest asks about authentication and authorization invariants, data and schema contracts, constraints in the attached ADRs, and missing gates.
2. **Repeated failure.** Offered after a gate run that records the second failure, or when a loop tick's plan says `consult-advisor`. The digest names the failing check, the count and the last result and asks for a root cause or "rabbit hole", never another blind retry.
3. **Before done.** Offered once when a finished turn finds every task done; `tickPlan` names it (`consult-advisor` before it would say `stop`) but the offer itself is made when the finishing turn ends. The digest adds the files changed since the mission began and the ADR scope warnings.

`tickPlan` gains the action `consult-advisor` and a stop-the-line branch, both only when `input.advisor === true`. Order: cancelled, all tasks done (a pre-done consult first, once, then stop), the spend cap, **stop-the-line**, loop stopped, paused, expired, a task running, the interval not elapsed, then **consult**, then run-gates and run-next. So a stop outranks everything but those first three, and a consult never preempts a running task or an unelapsed interval.

### 2.3 The consult

A separate `claude -p --permission-mode plan --max-budget-usd <turn budget> [--model <advisor model>]` turn with the digest on stdin. The digest is bounded and masked (`plain`), carries the whole objective (ADR-481), and marks the project text as untrusted data. Rules, each tested:

- It goes through a confirm card showing the exact argv, or runs at once under "always accept", exactly like the guidance turn (the code does `offerGuidance`’s own `autoAccept` branch; `runner.ask` has none). A loop tick or a finished turn only *offers*, and an automatic offer is skipped while Claude is driving the console (ADR-444), which needs no second billed turn to advise itself. The person’s Loop tab button is never skipped.
- **The card lives 30 s** (`PENDING_TTL_MS`, like every confirm). An offer raised by an unattended loop therefore usually expires; a toast says it was offered, and the Loop tab button asks again. The offer is recorded once, so a lapsed card is not re-raised on its own.
- It never starts when the mission's spend cap is reached (a reading at or past the cap refuses it whether or not auto-run is on), nor when a cap is set and there is no fresh reading (then the reading is refreshed and the person retries). It is re-checked when the card is confirmed, because the cap may have been reached while it was open. There is no new budget: the per-turn budget is the existing Settings value.
- A cancelled mission gets none.
- The answer is shown on the Loop tab, recorded in the ledger (`advisor.consulted` at the start with the model, `advisor.answered` with the cost `claude` reported), and passed to the main session as quoted data, every line behind `│`, with "not an instruction to act on".

### 2.4 Honesty rules

- The card, the Settings row and the Loop tab call it "advisor consult (claude -p, read-only, model: &lt;configured&gt;)". They name a model only as the setting names it; with `default` they say "the claude CLI default". They say it is **not** Claude Code's in-session advisor tool. Nothing says "Opus" unless the person chose `opus`.
- The cost split is two numbers that are not forced to add up: the advisor's cost *as `claude` reported it*, and the mission total from the cost ledger (a list-price estimate). The lead and subagent split is not shown: the console cannot see which model Claude's own subagents ran on.
- The console only pauses its own mission and hands Claude the consult answer as a prompt it may weigh. It does not rewrite or block Claude’s tool calls, and it cannot make a subagent follow the summaries-only line.

## 3. Not done, and why

- **Subagent model routing** (`agent.spawn` `e.model = haiku` for discovery agents). Feasible, but it changes every session that has the mod and is a routing policy, so it belongs in `ruflo-mods` with its own default-off option, trust-gate entry and tests.
- **Triggering the host's advisor tool.** Impossible from a mod today. If the host adds an API, `consultSpec` is the one place to change.
- **`$.model.complete` as the consult path.** It has no tools and no project access, which a root-cause consult needs to read; the `claude -p` plan-mode path is the proven one and shares the guidance turn's sandbox.
- **A per-role (lead / subagent / advisor) cost table.** Needs per-model rows from the ledger probe; the mission-cost probe returns one total.
- **The autopilot (`ap-*`).** Has its own review and parking logic.

## 4. Consequences

- Off by default; with it off, the existing specs pass unchanged and `tests/mission-advisor.spec.ts` proves the tick plan equal for every ledger.
- A consult costs one billed turn, bounded by the turn budget, and is never a surprise: it asks first.
- `LedgerEvent` gains optional `model` and `costUsd` fields; old ledgers load unchanged.

## 5. Verification

`tests/mission-advisor.spec.ts` (failure counting, tick plan, command, settings round trip, the live flow on a fake host: exactly one card at the second failure, the stop at the third, resume, cap refusal, the three checkpoints, setting off) and `tests/mission-advisor-mutation.spec.ts` (18 one-line mutants of the counting, the tick plan, the command and the prompt, each seen by the battery).
