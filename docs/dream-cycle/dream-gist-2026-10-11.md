# Security SOTA Report — 2026-10-11

TL;DR: In 2026, planting a malicious `SessionStart` hook in a coding agent's
settings file is a live, named attack pattern ("Mini Shai-Hulud" npm worm;
CVE-2026-25725 in Claude Code itself) — and Ruflo's own settings-risk
scanner, which already protects `init`/`--upgrade`, was never wired into
the one path that fires automatically on every real session boot:
`hook-handler.cjs`'s `session-restore` command. Tonight closes that gap.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| "Mini Shai-Hulud" npm worm plants a `SessionStart` hook in `.claude/settings.json` that re-fires its payload on every session, surviving removal of the infected package | Securonix / Security Boulevard writeups | B |
| CVE-2026-25725 (GHSA-ff64-7w26-62rf, fixed Claude Code 2.1.2): sandbox left `settings.json` unprotected, letting sandboxed code plant a persistent `SessionStart` hook that escalates to host privileges on restart | Corgea CVE advisory | A |
| OWASP Top 10 for Agentic AI (2025-12-09): memory/context poisoning is ASI06 — closest fit for state a `SessionStart` hook plants that survives session resets | promptfoo + blckalpaca summaries | B |
| A benchmarked fixture ("AST02 SessionStart Hook Hijack") now exists naming this exact attack shape | mcpmarket.com listing | C |
| OWASP MCP Top 10 names "Intent Flow Subversion" (MCP06); 30–40+ MCP CVEs disclosed Jan–May 2026 — context for treating an auto-executed config path as high severity | Cycode, UltraViolet Cyber | B |
| No vendor or community source describes a built-in automatic re-scan of `SessionStart`-loaded config anywhere (negative finding, explicitly searched) | — | — |

## Ruflo Current Capability

`settings-risk-scanner.ts`'s `scanSettingsForRisk()` (shipped 2026-08-16,
#3043) detects CVE-2025-59536-class hook/allow-rule tampering and runs at
`init`/`--upgrade`. A second call site (the `hooks_session-restore`
MCP/CLI tool handler) is mid-review on #3835 (2026-10-06), itself disclosing
this exact remaining gap: "the automatic `SessionStart` path
(`hook-handler.cjs`→`session.cjs`) doesn't get this warning yet... scoped
to a future, larger, separate night." Confirmed live this session: this
hook is literally what printed `[AutoMemory]`/`Session started: ...` at
this transcript's own boot.

## Competitor Comparison

| Competitor | Startup config re-scan for tampering? | Evidence | Confidence |
|---|---|---|---|
| LangGraph | No — disclosed CVEs (deserialization RCE, SQLi in checkpointer) sit at a different layer | CVE-2025-64439, CVE-2025-67644 | B |
| AutoGen | No — "AutoJack" chain caught pre-release; "Prompts Become Shells" research covers runtime injection, not config re-validation | HackerNews/Aviatrix; DeepInspect | B |
| CrewAI | No — CERT/CC VU#221883 chains prompt injection→sandbox escape/SSRF, not a startup YAML scan | CERT/CC, SecurityWeek | B |
| OpenAI Agents SDK | No committed tamper-check for session state; `SQLiteSession` plaintext | Inferred from community docs | C |
| Qdrant/Weaviate/Milvus/LanceDB | Different threat model (authenticated services, not LLM-interpreted files); Weaviate validates schema, not injected content | Weaviate runtime-config docs | B/C |

Synthesis: this class — an auto-loaded, locally-tamperable file read before
any user interaction — is unsolved industry-wide, not a Ruflo-specific
gap. The real analogues are Cursor's CVE-2025-54136 "MCPoison" (an
approved MCP config silently swapped, trusted forever) and CVE-2026-25725
above — both confirm this is exploited, not theoretical. No surveyed
competitor ships a session-start re-scan; Ruflo's `init`/`--upgrade`
scanner is already ahead of the field, and closing the `hook-handler.cjs`
gap would be a genuine first.

## Hypothesis

Given a `.claude/settings.json` containing a hook command or
`permissions.allow` rule matching an existing `STANDALONE_RISK_PATTERNS`/
`DANGEROUS_COMMAND_WORDS`/`RISKY_PREAPPROVE_WORDS` signature, when the
existing TS scanner's logic is also ported and invoked (as
`scanSessionStartSettingsForRisk()`) from `hook-handler.cjs`'s
`session-restore` command — the handler Claude Code's own `SessionStart`
hook fires unconditionally on every real session boot — then that boot
should print an advisory `[WARN]` naming the location/reason, where today
it is silent. Subject to: (1) no change to detection logic — a faithful
CJS port; (2) advisory-only, never mutates settings.json, never blocks
session-restore beyond one local file read+parse; (3) `init`/`--upgrade`
and the separate #3835 MCP handler unaffected; (4) all existing tests
green; (5) deterministic, $0, zero LLM calls; (6) root/package
`hook-handler.cjs` copies stay byte-identical.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, deterministic, $0. New file
`v3/@claude-flow/cli/__tests__/session-start-hook-settings-risk-scan.test.ts`
(12 tests: 7 unit-level direct-require, 2 end-to-end `spawnSync` of the
real `session-restore` command, 2 CJS/TS behavioral-parity checks across
representative inputs, 1 root/package byte-identity guard).

An independent adversarial critic subagent reviewed the diff before commit
and found one real, narrow issue: the first draft's `JSON.parse` catch
copied #3835's MCP-tool posture (narrow to `SyntaxError`, let anything else
surface) onto a path that runs unconditionally on every session boot —
where a non-`SyntaxError` parse failure (e.g. a V8 `RangeError` on
pathological input) would have aborted session-restore itself, contradicting
the advisory-only guarantee. Fixed same session: the catch now treats any
parse failure as "can't scan," never as a reason to abort restore; a new
test forces a mocked `RangeError` through `JSON.parse` to pin this.

Stash-isolated baseline (candidate `.cjs` files stashed, test kept): **10/12
fail** exactly as predicted (`scanSessionStartSettingsForRisk is not a
function`, the e2e tampered-settings assertion, the parity checks, the
RangeError-mock case); the 2 non-discriminating controls (e2e clean-settings
silence, baseline root/package identity) pass unchanged on both. Candidate:
**12/12 pass**.
Related existing suites (`hook-handler-artifact-parity`,
`settings-risk-scanner`) unaffected: 71/71 pass alongside the new file (one
unrelated pre-existing environmental failure in a different file,
`session-restore-selection.test.ts`, caused by an unbuilt sibling
`@claude-flow/cli-core` package — confirmed unrelated to this diff).

## Darwin Results

Skipped — binary detection-wiring fix (call an existing, already-tested
pure-logic port from a second entry point), not a continuous parameter
with a fitness gradient for Darwin's real interface
(`ruvector harness darwin <config> --execute`, confirmed available) to
search over. Same skip class as nearly every accepted security-night
candidate since 2026-08-18 (#3043, #3102, #3138, #3151, #3290, #3384,
#3834 all skipped Darwin for the identical reason).

## Flywheel Evidence

No `.claude-flow/flywheel/` state exists, and `ruvector harness flywheel
--help`'s real interface targets LLM-task-corpus evidence, not this
deterministic correctness/detection-wiring fix class (same finding #3835
recorded). Evidence retained as: 11 new discriminating tests, this gist,
the stash-isolated comparison, and the witness below.

## SOTA Proof & Witness

See the linked issue's §13 for the computed witness stamp (session commit
+ this file's SHA-256, chained per the standard verifier procedure).

## Scan Findings (intelligence, swarm — seeds for future nights, not acted on tonight)

**intelligence**: EWC Fisher-granularity may be too coarse for LLM-scale
continual learning (C, two preprints); MoE aux-loss-free bias-nudging now
the 2025 default but can thrash without z-loss (B, Cerebras+ICLR); HNSW
"ghost vector"/tombstone staleness is a documented production bug class —
testable seed for ReasoningBank (B, usearch/ScyllaDB/LatticeDB cross-check).

**swarm**: shared rate-limited resource contention causes silent agent
failure under no backpressure (A, arXiv 2604.17111); tool-call/response
ordering races across concurrent agents (B, LangChain forum); no-quorum
stall needs an explicit escape hatch (B, AutoGen `NoEligibleSpeakerError`);
starvation under priority scheduling with no aging/boost (B, AgentRM/
Justitia arXiv).

## Recommended Next Steps

1. Merge tonight's candidate (#TBD) — closes the disclosed #3835 gap using
   the real, most-executed automatic hook path.
2. A future `automation`/meta night: consider whether `hook-handler.cjs`'s
   growing list of hand-ported TS logic (this scan, plus whatever comes
   next) warrants a tiny build step instead of further manual CJS mirrors.
3. A future `security` night: investigate CVE-2026-25725's specific
   sandbox-escalation angle (verifying settings.json ownership/permissions
   before trusting it, not just content) — a different, larger candidate
   than tonight's content scan, flagged but out of scope tonight.
