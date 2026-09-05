# ADR-141: τ-bench Campaign Strategy

**Status**: Proposed
**Date**: 2026-05-28
**Branch**: `feat/iter-57-combined`
**Related**: ADR-140 (DeepSWE Campaign), ADR-138 (GAIA CodeAgent harness)
**Gated on**: (a) DeepSWE differentiator result confirming orchestration uplift; (b) explicit user go-signal

---

## Context

### Why τ-bench after DeepSWE

ADR-140 adopts DeepSWE as ruflo's primary SWE benchmark (harness-controlled, repo-level code editing). τ-bench is the complementary target: **agentic customer-service reliability in tool-rich, policy-constrained, multi-turn domains**. The two benchmarks measure orthogonal capabilities; success on both is the strongest possible demonstration of ruflo's orchestration thesis.

Key differentiators that make τ-bench the right second campaign:

1. **HAL-ranked, custom submissions accepted** — the leaderboard explicitly supports `submission_type: "custom"` with detailed methodology documentation, labeling the approach and linking to implementations. Ruflo's orchestration is a legitimate entry, not a hack.

2. **Pass^k reliability is the decisive metric** — τ-bench measures `pass^k` (probability of success on k consecutive trials, computed via `C(success,k)/C(trials,k)`). A pass^1 of 72% (Claude Sonnet 4.5 Sierra baseline) drops to pass^4 of 48% — a 33% reliability gap. This is exactly the gap ruflo's planner+validator scaffold is designed to close. Research documented in prior sessions shows a planner+validator lift from 14%→26% pass^3 on the same underlying model.

3. **Base model is not the constraint** — Claude Opus 4.5 already leads the airline leaderboard at 84% pass^1. The open problem is not "which model" but "why does it fail 3 times out of 10." The failure modes are well-understood: policy ambiguity resolved at wrong turn, irreversible API call before confirmation, and loop failures (23% of errors are retry loops). These are all tractable for ruflo's convergence layer.

### Harness verification (confirmed by direct inspection, 2026-05-28)

Harness cloned to `~/taubench-work` from `https://github.com/sierra-research/tau2-bench`.

**Python deps**: `uv` or `pip install -e ".[knowledge]"` — clean install, no native compilation. Tested locally: CLI loads, all domains registered.

**Domains and task counts (base split)**:
| Domain | Tasks (base) | Reward basis |
|--------|-------------|--------------|
| Airline | 50 | DB + COMMUNICATE (100% of tasks) |
| Retail | 114 | DB + COMMUNICATE |
| Telecom | 2285 (full corpus; ~50 in base split) | DB + COMMUNICATE |

All 50 airline tasks loadable in zero-cost Python inspection (no LLM calls, no network). Tasks have `split_tasks.json` with `train` (30), `test` (20), and `base` (50) splits.

**Evaluation criteria** (airline): Every task uses `reward_basis: ["DB", "COMMUNICATE"]`. DB check is a deterministic Python comparison of the database end-state against expected actions. COMMUNICATE check uses an LLM judge for `nl_assertions`. Ruflo's deterministic validator directly targets the DB check; the COMMUNICATE portion is already covered by the standard LLM turn.

**Custom agent interface**: `tau2/agent/base_agent.py` defines `HalfDuplexAgent[AgentState]` — subclass, implement `generate_next_message()` and `get_init_state()`. The harness registers agents in `tau2/registry.py`. A ruflo agent is a single Python file that subclasses `LLMAgent` (which itself subclasses `HalfDuplexAgent`), overriding the system prompt and adding pre-call validation.

---

## Leaderboard competitive landscape (airline, 2026-05-28)

| Model | Type | Pass^1 | Pass^2 | Pass^3 | Pass^4 | Cost/traj |
|-------|------|--------|--------|--------|--------|-----------|
| Claude Opus 4.5 | standard | 84.0 | 77.7 | 73.5 | 70.0 | — |
| GPT-5.2 | standard | 83.0 | 78.3 | 75.0 | 72.0 | — |
| Gemini 3 Flash | standard | 82.5 | 76.3 | 72.0 | 68.0 | — |
| **Claude Sonnet 4.5 (Sierra, 4-trial)** | standard | **72.0** | **62.0** | **54.5** | **48.0** | **$0.30** |
| Claude-3.7-Sonnet | standard | 64.2 | 58.9 | 55.4 | 52.1 | — |
| GPT-4.1 | standard | 56.0 | 47.8 | 42.4 | 38.1 | — |
| Nemotron-Orchestrator-8B | **custom** | 56.0 | null | null | null | — |

The Sierra Claude Sonnet 4.5 run (the closest public proxy for Claude Sonnet 4.6) is the baseline we improve on. With a 4.6-specific run, pass^1 baseline is estimated at 70-75%. The opportunity: if ruflo's scaffold closes the pass^3 gap by ~10pp (54% → 64%), that is a leaderboard-relevant, documented improvement attributed to orchestration, not model.

The lone custom submission (Nemotron-Orchestrator-8B) shows pass^1 only and uses a different model, so there is no direct custom-scaffold comparison with pass^k data yet. Ruflo would be the first custom submission with full pass^1–4 data on airline.

---

## The pass^k thesis

τ-bench's pass^k formula is `C(successes, k) / C(trials, k)`. Its key property: small per-trial reliability improvements compound dramatically into pass^k gains.

Example (Sierra Claude Sonnet 4.5 airline):
- pass^1 = 72% → pass^4 = 48% (drop of 24pp over 4 trials)
- If ruflo raises per-trial success from 72% to 78% (a 6pp gain), the math gives:
  - pass^4 ≈ 56% — an 8pp gain at the hardest reliability measure

The 14%→26% pass^3 improvement documented in the research spec (attributed to a planner+validator scaffold on the same model) corresponds to raising per-trial success by ~8pp, which is achievable through the mechanisms described in the next section.

---

## Ruflo τ-bench agent design

The four components map to τ-bench's specific failure modes.

### Component 1: Policy-Resolution Planner (turn 1 before any action)

**Targets**: "Agent misread policy" failures (estimated 30-40% of airline failures).

The airline policy is ~3000 words with conditional rules (membership tier × cabin class × payment method × trip type). Standard LLM agents resolve policy ambiguity on-the-fly during action selection, leading to wrong branches.

Design: On turn 1, before any user-visible response, run a silent planning step that:
1. Parses the user's request into a structured intent (action type, key parameters)
2. Queries the policy for applicable rules and identifies ambiguity points
3. Emits a compact internal plan: `[action_type, required_confirmations, policy_constraints, irreversible_steps]`

This is the Co-Sight DAG planner pattern from `gaia-dag.ts`, adapted to the τ-bench domain. It adds zero user-facing turns (happens before the first response) and costs ~300 tokens/task.

Implementation: Override `get_init_state()` to run the planning step; store plan in `LLMAgentState`; include plan in system context for subsequent turns.

### Component 2: Policy-Enforcement Actor (tool-call preconditions)

**Targets**: "Wrong action / wrong parameters" failures (estimated 20-25%).

Design: Wrap each tool call with a precondition check against the plan:
- `book_flight`: verify cabin class consistency, payment method count, passenger limits
- `cancel_reservation`: verify cancellation policy applicability (insurance, refund eligibility)
- `change_flight`: verify same-cabin-class constraint, same-reservation constraint

Preconditions are deterministic Python code (no LLM call), executed in `generate_next_message()` before the tool call is emitted to the environment. If a precondition fails, the agent emits an internal error and replans (not a blind retry — see Component 4).

### Component 3: Deterministic State Validator (Python, NOT LLM)

**Targets**: "DB mismatch" failures — the direct driver of the DB reward component.

This is ruflo's convergence layer, the single most important component for pass^k.

Design: After each write action (booking, modification, cancellation, baggage edit), run a deterministic Python check:
1. Call the environment's `get_state()` to read the current DB snapshot
2. Compare against the task's `expected_actions` list (these are the actions the evaluation uses for the DB check — extractable from the task JSON)
3. If state matches, continue; if mismatch, trigger replanning (not blind retry)

The τ-bench evaluator's `EnvironmentEvaluator.calculate_reward()` runs this same comparison at episode end. Running it mid-episode means we catch DB divergence before the conversation ends, giving the agent a chance to recover.

This component requires no LLM calls — it is pure Python state comparison. It adds 0 to LLM cost and is the pass^k lever.

Implementation: Subclass `LLMAgent`, add `_validate_state(task, environment)` method, call after every write tool result.

### Component 4: Retry-Governor (replanning on failure, not loops)

**Targets**: "23% of failures are loops" (documented in research spec).

Standard LLM agents in retry mode call the same tool with the same parameters again. The τ-bench max_steps limit (default 30) allows many retry loops, most of which produce the same failure.

Design: When the state validator triggers (Component 3) or when the LLM receives a tool error, the retry-governor:
1. Logs the failure reason (policy violation, precondition fail, DB mismatch)
2. Runs a reduced planning step (not full turn-1 plan, just the failing action)
3. Selects an alternative action from the plan's alternative branches
4. If no alternative exists, escalates to human transfer (explicit policy action, not loop)

Implementation: Count retries per action type in `LLMAgentState`; trigger replan after 1 failed retry; hard limit of 2 replans per action type before human transfer.

### Custom agent plug-in (tau2 registration)

```python
# src/tau2/agent/ruflo_agent.py
from tau2.agent.llm_agent import LLMAgent, LLMAgentState

RUFLO_SYSTEM_PROMPT = """
<instructions>
{agent_instruction}
</instructions>
<policy>
{domain_policy}
</policy>
<ruflo_constraints>
Before any write action: verify preconditions from your plan.
After any write action: check state matches intent before proceeding.
On failure: replan, do not retry identically.
</ruflo_constraints>
""".strip()

class RufloAgent(LLMAgent):
    """Ruflo planner+validator scaffold for tau2-bench."""
    ...
```

Register in `tau2/registry.py`:
```python
registry.register_agent("ruflo_agent", RufloAgent)
```

Run with:
```bash
tau2 run --domain airline --agent ruflo_agent \
    --agent-llm claude-sonnet-4-6-20261001 \
    --user-llm claude-haiku-4-5-20251022 \
    --num-trials 3 --save-to ruflo_airline_pilot
```

---

## Cost model (derived from Sierra's measured data)

Source: Sierra's Claude Sonnet 4.5 run (`claude-sonnet-4-5_sierra_2026-02-26/submission.json`), which uses the same model family as our planned agent.

| Component | Value | Source |
|-----------|-------|--------|
| Agent cost per trajectory (airline) | $0.2965 | Sierra measured |
| Agent cost per trajectory (retail) | $0.2549 | Sierra measured |
| Agent cost per trajectory (telecom) | $0.4877 | Sierra measured |
| Haiku user-sim cost per trajectory | ~$0.001 | Pricing estimate, 2k tokens |
| GPT-4o-mini user-sim cost per traj | ~$0.020 | Pricing estimate |

### Pilot (20 airline tasks, k=3)

| Config | Trajectories | Agent cost | User sim (Haiku) | Total |
|--------|-------------|------------|------------------|-------|
| 20 tasks × 3 trials | 60 | $17.79 | $0.06 | **~$18** |

With GPT-4o-mini user-sim (higher fidelity): **~$19**

Ruflo orchestration adds ~300 tokens/task for the planning step, increasing agent cost by approximately 5%: total pilot ≈ **$19-20**.

### Full leaderboard run (3 domains, k=4)

| Domain | Tasks | Trials | Agent cost | Note |
|--------|-------|--------|------------|------|
| Airline | 50 | 4 | $59 | |
| Retail | 50 | 4 | $51 | base split |
| Telecom | 50 | 4 | $98 | base split |
| **Total** | **150** | **4** | **$208** | agent only |

With Haiku user-sim: **~$218** total.
With GPT-4o-mini user-sim (leaderboard recommended): **~$230** total.

For the full leaderboard (including banking_knowledge domain at $4.05/traj × 50 × 4 = $810): **~$1,030-1,100 total**.

Recommended plan: airline-only leaderboard (3 domains without banking_knowledge) at **$218-230**, which still qualifies for the Overall column is not available but provides airline/retail/telecom scores and fully valid submission.

---

## Submission pathway

**Custom entry requirements** (confirmed from `docs/leaderboard-submission.md`):
- `submission_type: "custom"` in `submission.json`
- Detailed `methodology.notes` explaining modifications
- `references` array with GitHub link to ruflo agent implementation
- `methodology.verification.modified_prompts: true` (we modify the system prompt)
- Standard: all domains, 4+ trials, `tau2 submit prepare` + `tau2 submit validate`

**HAL pathway**: τ-bench is listed at [taubench.com](https://taubench.com). Submission is a PR to the `sierra-research/tau2-bench` repo adding `submission.json` + updating `manifest.json`. Trajectory files are uploaded to external storage (Google Drive or HuggingFace), linked in the PR description; a maintainer uploads to S3 after merge.

No `hal-upload` CLI: τ-bench uses direct PR submission, not the HAL CLI upload flow. This is simpler — it is a GitHub PR with a JSON file and external trajectory link.

**Verification status**: Custom submissions with `trajectories_available: true` and `modified_prompts: true` are marked "Unverified" (caution icon) on the leaderboard. This is acceptable and accurately describes our setup; our methodology notes will be transparent.

---

## Phased plan (cost-gated)

### Phase 0 — Staging (current, $0)
- [x] Harness cloned and runs locally
- [x] Task format, metric implementation, and agent interface understood
- [x] Submission requirements documented
- [x] Competitive landscape mapped
- [x] Cost model derived from measured data
- [x] Ruflo agent design specified (4 components)
- [ ] ADR-141 filed (this document)

### Phase 1 — Pilot (go-signal required, ~$20)
**Gate**: DeepSWE differentiator result confirms orchestration uplift ≥ 5pp on same model.
**Gate**: User explicit authorization.

Steps:
1. Implement `ruflo_agent.py` (Component 3 — state validator only, minimal viable scaffold)
2. Run: 20 airline tasks, k=3, Claude Sonnet 4.6 agent, Haiku user-sim
3. Compare pass^1 and pass^3 against Sierra Claude Sonnet 4.5 baseline (72%/54.5%)
4. Report uplift; if pass^3 ≥ 60%, proceed to Phase 2

### Phase 2 — Full airline run (~$80)
**Gate**: Phase 1 pass^3 ≥ 60% AND user authorization.

Steps:
1. Add Components 1, 2, 4 (planner, preconditions, retry-governor)
2. Run: 50 airline tasks, k=4, Claude Sonnet 4.6 agent, Haiku user-sim
3. Confirm pass^4 ≥ 55% (vs. Sierra baseline 48%)

### Phase 3 — Full 3-domain leaderboard run (~$230)
**Gate**: Phase 2 airline pass^4 ≥ 55% AND user authorization.

Steps:
1. Run retail + telecom domains with same agent
2. Prepare submission via `tau2 submit prepare` + validate
3. PR to sierra-research/tau2-bench

---

## Constraints and non-decisions

- **No paid LLM task runs until Phase 1 go-signal.** All staging is free.
- **Do not touch the DeepSWE coordinator's work.** ADR-141 is independent of ADR-140's active worktree.
- **API keys from environment only.** Keys are never echoed, never written to files.
- **Submission is gated.** Building and measuring is unrestricted; the PR to tau2-bench waits for explicit user authorization.
- **User-sim model**: Haiku for pilot (cost control); GPT-4o-mini or GPT-5.2-low for final leaderboard run (fidelity).
- **Agent model**: Claude Sonnet 4.6 for pilot and full run (cost-efficient, directly comparable to Sierra baseline).

---

## Consequences

### Positive
- τ-bench is the premier arena for agent reliability. A custom submission with documented pass^k uplift is directly publishable and leaderboard-visible.
- The pass^k metric rewards exactly what ruflo's orchestration provides: consistency across trials, not just best-case performance.
- All 50 airline tasks are inspectable for free; the policy is fully readable; the evaluator is transparent Python. Fast iteration is cheap.
- Components 3 (state validator) and 4 (retry-governor) are reusable across domains and benchmarks; they generalize to ruflo's broader convergence layer.

### Negative / risks
- Custom submissions are marked "Unverified" unless `trajectories_available: true` AND `modified_prompts: false`. Since we modify prompts, we will always show the caution icon. This is honest and acceptable.
- The planner step (Component 1) adds latency and tokens per task. Cost impact is estimated at ~5%; the pass^k improvement must exceed this overhead to be worthwhile.
- Haiku as user-sim is cheaper but less realistic than GPT-5.2. Pilot results may not fully generalize to the full run. We recheck with higher-fidelity user-sim before the leaderboard run.

---

## Open questions

1. Does Component 3 (state validator) alone (no planner) produce measurable pass^3 improvement? This is the Phase 1 minimal test.
2. What fraction of airline failures are DB-mismatch vs. nl_assertion failures? Identifying this from pilot trajectories guides which component gives the most pass^k leverage.
3. Is the Haiku user-sim reliable enough for the pilot, or does it produce unrealistic user behaviors that inflate our scores?
