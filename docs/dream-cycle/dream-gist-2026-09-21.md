# Security SOTA Report — 2026-09-21

TL;DR: `validateEnv()`'s loader-hijack denylist (`v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts`) blocked `LD_PRELOAD`/`NODE_OPTIONS`-class vars but not `PATH` itself or the equivalent interpreter/VCS search-path family — a CWE-427 gap flagged grade-A by last night's (2026-09-20) security scan. Added `PATH`, `PYTHONPATH`, `PERL5LIB`, `RUBYLIB`, `GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`, `BASH_ENV`, `IFS` to the denylist, closing the only currently MCP-reachable exposure (`terminal_create`/`terminal_execute`). An independent adversarial critic then found the lookup itself was case-sensitive (`path`/`Path` bypass it, harmless on POSIX but a real bypass on Windows) — fixed same session by case-folding the comparison, which incidentally also hardens the original 9 names.

## What's New in 2026

| Finding | Source | Grade |
|---|---|---|
| CVE-2026-2256 (ModelScope `ms-agent`): a shell-command **denylist** regex was bypassable → full RCE — direct evidence for denylist-fragility, same anti-pattern class | GHSA-4gc2-344q-r2rw, CERT/CC VU#431821 | A |
| CVE-2026-21852 (Claude Code, patched v2.0.65, within 12mo): an untrusted repo's config could set an env-style setting (`ANTHROPIC_BASE_URL`) with no allow/deny gate to exfiltrate API keys — same-vintage precedent for under-gated env settings in an AI coding agent | GHSA-jh7p-qr78-84p7 | A |
| CVE-2026-56074 (PraisonAI): `os.environ.copy()` full-inheritance into a subprocess + approval-cache bypass → ambient API-key exfiltration | GHSA-ffp3-3562-8cv3 | B |
| OpenAI's hosted-sandbox docs explicitly reject caller-set `PATH`/`CODEX_*`/`OPENAI_API_KEY` as "runtime-reserved" names — direct vendor precedent for denylisting `PATH` by name | developers.openai.com (fetched) | A |
| MCP reference SDK's client→server stdio spawn uses a real allowlist (`DEFAULT_INHERITED_ENV_VARS`) — but deliberately *keeps* `PATH` in it (excludes only secret-shaped vars); solves the mirror-image problem (protecting a server from a trusted client's secrets), not a tool's own shell-out | modelcontextprotocol.io SDK source (fetched) | A |
| No MCP-specific advisory or scanner rule (checked mcp-scan-family write-ups) names subprocess env/PATH injection as a known MCP antipattern — a real tooling gap, not evidence the risk is unfounded | dev.to survey (2026) | C |

## Ruflo Current Capability

`terminal_create` validates caller `env` via `validateEnv()` and stores it as `session.env`; `terminal_execute` runs `execSync(command, { env: { ...process.env, ...session.env } })` — `session.env` is spread *after* `process.env`, so an un-denied key silently overrides the real value for every subsequent command in that persisted session (`.claude-flow/terminals/store.json`). The doc comment already named "command resolution" as in-scope for this denylist; `PATH` was simply never added. Full `v3/` sweep (deep-researcher) found exactly one other caller-controlled env merge with **no** validation at all — `rvfa-runner.ts`'s `spawnAsync` (CLI-only `.rvfa` appliance path, not MCP-reachable today) — deferred as a follow-up, out of scope tonight. `ruflo/src/ruvocal/mcp-bridge`'s full-env-inheritance credential leak (ADR-166 finding V4) is a different mechanism, already tracked separately.

## Competitor Comparison

| Framework/Project | Env-sanitization for shell/code-exec | Grade | Source |
|---|---|---|---|
| LangChain/LangGraph `ShellTool`/`ShellToolMiddleware` | None — docs state env is inherited from parent unless explicitly overridden | A | reference.langchain.com |
| AutoGen `LocalCommandLineCodeExecutor` | None found in code despite a docstring claiming a sanitizer; filtering only via opt-in Docker/ACA executor | B | github.com/microsoft/autogen #8239 |
| CrewAI `CodeInterpreterTool` | Docker-sandboxed by default (isolation, not filtering); E2B/sandbox tools use opt-in allowlist `envs` param | B | crewAI-tools source; docs.crewai.com |
| OpenAI Agents SDK / Code Interpreter | Sandboxing (ephemeral VM/container), not env filtering — nothing shared to sanitize | A | developers.openai.com |
| MCP reference SDK (stdio spawn) | Real allowlist, but solves the opposite direction (protect server from client secrets); explicitly keeps `PATH` | A | modelcontextprotocol.io |
| Ruflo's own `SafeExecutor` (`@claude-flow/security`) | None — `env: config.env ?? process.env`, same unfiltered-inheritance pattern as the unmitigated competitors | A | safe-executor.ts:174 (direct read) |

**Synthesis**: a two-tier industry pattern, not independent oversight. Tier 1 (LangChain, AutoGen's default path, ruflo's own `SafeExecutor`) inherits the full parent env unfiltered by default; Tier 2 (OpenAI, CrewAI's Docker-first path) sidesteps the problem via process/container isolation instead. Every framework surveyed *also* ships a zero-setup local/"unsafe" path where env filtering is essentially absent — a genuine, still-open gap. The MCP SDK's allowlist is the closest transferable precedent: it deliberately keeps `PATH`, because **blocking `PATH` outright is different from stripping it from the process**. Tonight's fix rejects a caller's attempt to *override* `PATH`/family via `terminal_create`'s `env` field; a caller who omits it still gets the real `process.env.PATH` unmodified.

## Hypothesis

> Given `validateEnv()`'s `DENYLISTED_ENV_NAMES` omitting `PATH` and the wider uncontrolled-search-path family, allowing a `terminal_create` caller to inject an overriding value for any of them into every subsequent `terminal_execute` call in that session, when these 8 names are added to the denylist, then `validateEnv()` should reject any caller-supplied env object containing one of them exactly as it already does for the existing 9 loader-hijack names, closing the CWE-427 gap at the only MCP-reachable call site, subject to: (1) no existing caller/test currently sets these names through `env` (regression safety); (2) the real process's own PATH continues to flow through unmodified for callers who don't override it; (3) all existing `@claude-flow/cli` tests remain green; (4) fully deterministic, $0 evaluation cost.

Frozen before evaluation; not modified after seeing results.

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. Extended existing file `v3/@claude-flow/cli/__tests__/validate-input-env.test.ts` (+8 parametrized cases, reusing its established pattern).

Baseline vs. candidate, isolated via `git stash` of just the source file: exactly the 8 new-name tests fail against baseline (8 failed/19 passed) and pass against candidate; re-verified independently by an adversarial critic (which itself reproduced the stash/rebuild/test cycle twice). After the critic's case-fold caveat was fixed, 5 more discriminating tests were added (`path`/`Path`/`PaTh`/`node_options`/`Node_Options`) and isolated the same way: fail without `.toUpperCase()`, pass with it. Final: **32/32 passing**. Full `@claude-flow/cli` suite run both ways: **failed-file set byte-identical** (36 files, pre-existing unbuilt-monorepo-sibling-package environmental failures — same class documented since #3221/#3243/#3302) — zero new failures introduced. `tsc --noEmit`: 14 pre-existing errors, none touching the changed files.

## Reward Hack Check

No standalone reward-hack CLI reachable this session (`npx ruvector harness --help`: status/route/flywheel/darwin only). Manual checklist, independently re-verified by the adversarial critic: no existing test weakened (diff is purely additive, 0 deletions); no gold/expected data touched (none exists on this path — repo-wide search found only unrelated plugin fixtures); no cherry-picking (denylist Set and test array independently confirmed 1:1, same order); no seed manipulation (deterministic Set-membership logic, no randomness); zero cost.

## Security Review

Not a new attack surface: pure input-validation narrowing on an already-validated API boundary (`terminal_create`'s `env` parameter), fail-closed (the whole call is rejected, not silently stripped). Mechanism independently verified: `terminal-tools.ts:198`'s `{ ...process.env, ...session.env }` merge means a denied/omitted key leaves the real process env untouched — this fix blocks *overriding* PATH/family, not the process's own PATH. Full `v3/` sweep found no other MCP-tool-registry call site with this exposure. One real caveat (case-sensitivity, detailed above) found and fixed same session; one informational note (ADR-165 had already documented `PYTHONPATH` as denylisted before this fix — a pre-existing doc/code drift this change incidentally closes, not something it caused).

## Darwin Results

Skipped — binary denylist-membership fix (a name is either blocked or not), not a continuous parameter with a fitness gradient for Darwin's real interface (`npx ruvector harness darwin --help`, `@metaharness/darwin` confirmed available) to search over. Same skip class as #3110/#3160/#3184/#3221/#3243/#3266/#3302/#3330/#3378.

## Flywheel Evidence

No `.claude-flow/flywheel/` state or signed `@metaharness/flywheel` bundle exists in this repo (confirmed via direct check + `npx ruvector harness flywheel --help`). Evidence retained as: the 8 new discriminating tests, this gist, the linked issue, the stash-isolated baseline/candidate comparison (independently reproduced by the adversarial critic), and the full research trail — consistent with every accepted night since 2026-08-18.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `a4f219935ff4035421bc01157a5a1abc74529ad2` |
| Gist SHA-256 (pre-witness content) | `b331b4d2d0efab6526d4f08d0b12a7bd797be999c3a17e70630738d484221fe6` |
| Witness stamp | `031422884fc93022085007c7c075a9815ab590ada08aa319150ae091b8a802fb` |

Verifier procedure: fetch this gist, strip the witness table's three filled values back to `PENDING`, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: intelligence

**New, highest-priority carry-forward**: `ewc-consolidation.ts`'s `updateFisherFromConfidences()` (wired into the live SONA→`distillLearning()` path, `intelligence.ts:413`) runs its Fisher-matrix EMA **backwards** vs. the other two EMA sites in the same file: old Fisher gets weight `0.01`, the current batch gets `0.99` — every distill pass wipes ~99% of accumulated importance instead of slowly accumulating it, defeating EWC++'s anti-forgetting purpose. 1-line fix; existing tests miss it because they only call from a freshly-zeroed Fisher. Recommend as next `intelligence` DEEP night's lead candidate. Also flagged: MoE `computeLoadBalanceLoss()` mixes a cumulative fraction with a single-sample probability (observability-only, no consumer today); `ReasoningBank.retrieve()`'s MMR redundant `maxSimilarity` recompute (open since 2026-09-20, unfixed).

## Scan Findings: swarm

Two carried-over findings re-confirmed via fresh code read: `hive-mind_consensus` ignores `state.consensusStrategy` (still reads only the narrower per-call `strategy` param); `byzantine.ts`'s `requiredVotes=2f+1` (an absolute count) is never rescaled against the achievable weight sum post-clamp — concrete repro: n=4,f=1→requiredVotes=3, all 4 vote approve at weight 0.5→approvingWeight=2<3→**rejected despite unanimous approval**, while `approvalRate` self-reports 100%. **New**: `UnifiedSwarmCoordinator.recoverAgent()` self-stamps `lastHeartbeat=now` on every "recovery," the same antipattern already fixed once in `AgentPool` (#3242/#3243) but reappearing independently in the coordinator that actually drives task assignment — a dead agent cycles degrade→fake-recover→look-healthy→degrade forever with no cap, silently routing tasks to a corpse. Recommend a future `swarm`/`hive-mind` DEEP night fix all three together (all touch vote/health-state resolution).

## Competitors Reviewed

LangChain/LangGraph, AutoGen/Microsoft Agent Framework, CrewAI, OpenAI Agents SDK (mandated floor); MCP reference SDK + spec (more specific, directly relevant comparison); CWE-427/CERT/CC/GHSA advisories (CVE-2026-2256, CVE-2026-21852, CVE-2026-56074).

## Additional candidates scored (STEP 3.2)

`0.25·fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability`:

1. **[4.60, selected] `validateEnv()` PATH-family denylist** (this candidate).
2. **[4.30] EWC Fisher EMA inversion** (intelligence scan) — off-surface tonight (DEEP=security), deferred per rotation convention.
3. **[4.25] `byzantine.ts` unreachable-accept threshold** (swarm scan) — deferred, off-surface.
4. **[4.10] `recoverAgent()` heartbeat self-stamp** (swarm scan) — deferred, off-surface.
5. **[3.15] `rvfa-runner.ts` unvalidated env merge** (security, same surface) — lower score: not MCP-reachable today, CLI-only local trust boundary.

Highest score matched tonight's DEEP surface naturally; no override needed.

## Recommended Next Steps

1. Merge tonight's linked draft PR (human review required).
2. **`intelligence` DEEP night: fix EWC Fisher EMA inversion** — 1-line, live on every distill cycle, plausibly higher-impact than tonight's fix.
3. **`swarm`/`hive-mind` DEEP night: fix hive-mind consensus-strategy dispatch + byzantine weight-threshold rescaling + `recoverAgent` heartbeat self-stamp together** — all three touch vote/health-state resolution.
4. Route `rvfa-runner.ts`'s env merge through the now-patched `validateEnv()` (lower urgency, CLI-only surface).
5. Consider migrating `terminal-tools.ts` off raw `execSync` onto `@claude-flow/security`'s `SafeExecutor` (no-shell) as a deeper follow-up — noted by tonight's architecture review, not attempted tonight (larger, separate architectural question).
