# Security SOTA Report — 2026-10-16

TL;DR: `DENYLISTED_ENV_NAMES` (the loader/runtime-hijack env-var denylist `validateEnv()` enforces before `terminal_create`'s caller-supplied env is merged into every later `execSync`'d command in a terminal session) still had gaps after 2026-09-21's CWE-427 fix — missing credential/arbitrary-command vars in the same git family (GIT_ASKPASS, GIT_PROXY_COMMAND), interpreter-flag-injection vars for Perl/Ruby/Java (PERL5OPT/RUBYOPT/JAVA_TOOL_OPTIONS/_JAVA_OPTIONS/JDK_JAVA_OPTIONS), two more search-path vars (PYTHONHOME, CLASSPATH), and git's numbered `GIT_CONFIG_KEY_<n>`/`VALUE_<n>`/`COUNT` runtime-config-injection family (needs a pattern match, not a fixed name). All additions are source-graded (A/B); two researched candidates (PYTHONEXECUTABLE, PSModulePath) were explicitly rejected on evidence grounds. 12 new entries/patterns, 18 new discriminating tests, zero regressions.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| JAVA_TOOL_OPTIONS officially documented by Oracle as a `-javaagent`/`-agentlib` injection point, "disabled in some cases for security reasons" | docs.oracle.com JDK troubleshooting guide | A |
| GIT_ASKPASS invokes an arbitrary external program and reads its stdout as a credential, unconditionally (non-interactive included) | git-scm.com/docs/gitcredentials | A |
| git's `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` let a caller inject *arbitrary* runtime git config (`core.sshCommand`, `core.hooksPath`, `http.*`, …) — strictly broader than any single fixed name | git-scm.com/docs/git-config §ENVIRONMENT | A |
| CVE-2026-25725, cited by 2026-10-11's own dream-cycle PR as a "future candidate" for this surface, does **not resolve** in NVD/MITRE/any vendor database — likely a garbled/incorrect ID; should not be re-cited without a fresh, verified CVE number | this session, direct NVD/MITRE lookup | A (negative finding) |
| TeamPCP campaign (Feb–Mar 2026, CVE-2026-33634, CISA KEV) used a malicious `.pth` file for arbitrary code at every Python interpreter startup — same attacker goal as PYTHONSTARTUP, different (non-env-var) primitive; no 2026 campaign found that specifically weaponized RUBYOPT/JAVA_TOOL_OPTIONS/GIT_ASKPASS/PSModulePath as the entry vector | this session, direct search | B |
| OpenAI Agents SDK's April 2026 sandbox update, LangChain's Nov 2025 Sandboxes announcement, and CrewAI/AutoGen's container-first code-exec docs all delegate isolation to disposable per-run sandboxes/containers rather than env-name filtering | vendor docs (see Competitor Comparison) | B |

## Ruflo Current Capability

`validateEnv()` (`v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts`) is the single authoritative source for this check — `v3/@claude-flow/cli/src/mcp-tools/validate-input.ts` is a re-export shim over it (confirmed, not a stale duplicate). Its sole real call site is `terminal_create` in `terminal-tools.ts`, whose `{ ...process.env, ...session.env }` merge (in `terminal_execute`) carries any accepted name into every subsequent command for the life of the session — a persistent merge, not a one-shot sandboxed exec. The 2026-08-xx/2026-09-21 denylist covered loader-hijack (`LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`) and the first wave of search-path vars (`PATH`, `PYTHONPATH`, `PERL5LIB`, `RUBYLIB`, `GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`, `BASH_ENV`, `IFS`) but missed the names above. A separate repo-wide check (this session) found other `{...process.env, ...X}` merge sites (`daemon.ts`, `fable-harness.ts`, `rvfa-runner.ts`, etc.) — all either merge only hardcoded/internal values or, in `rvfa-runner.ts`'s case, accept an `env` option that no current caller actually wires to untrusted input (the one CLI caller, `appliance.ts`'s `run` command, never passes `env` into the constructor). `terminal-tools.ts` remains the only live path accepting arbitrary caller-supplied env-var names.

## Competitor Comparison

| System | Env-name filtering before subprocess spawn? | Security framing | Source |
|---|---|---|---|
| LangChain `LocalShellBackend` | No — raw `env`/`inheritEnv` pass-through | Docs explicitly warn against untrusted/production use of this mode | LangChain DeepAgents reference |
| AutoGen / AG2 `CodeExecutorAgent` | No | Fresh Docker container per run is the stated boundary | AG2 docs; cf. CVE-2026-39420 (unrelated project, LD_PRELOAD sandbox bypassed via `env -i`) |
| CrewAI | No | Deprecated its own Docker tool; delegates to external sandboxes (E2B/Modal) | CrewAI tool docs |
| OpenAI Agents SDK / `openai/swarm` | No | Pluggable disposable sandbox providers (E2B, Modal, Daytona, …), per-op scoping | OpenAI Agents SDK, Apr 2026 update |

**Why "None," honestly assessed:** not an unpatched industry gap — a framework-shape difference. All four assume a disposable, isolated exec per call (capping blast radius structurally) or explicitly disclaim their local-shell mode as unsafe. None document Ruflo's exact primitive: a persistent terminal session with a one-time env merge that then applies to every later command. That persistence is what makes a name-based denylist necessary here specifically.

## Hypothesis

> Given a caller-supplied environment-variable name in `terminal_create`'s `env` input matching one of 11 newly-added fixed names (GIT_ASKPASS, GIT_PROXY_COMMAND, GIT_CONFIG_NOSYSTEM, PERL5OPT, RUBYOPT, JAVA_TOOL_OPTIONS, _JAVA_OPTIONS, JDK_JAVA_OPTIONS, PYTHONHOME, CLASSPATH, PYTHONSTARTUP) or the new `GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)` pattern, when `validateEnv()` runs, then it should reject that name (`valid:false`, `sanitized:{}`, error contains "denylisted") exactly as it already does for the pre-existing 17 names, subject to: zero change to validation of any name outside this extended set; case-insensitive matching preserved (Windows semantics, per 2026-09-21's own fix); all 33 pre-existing tests in the file stay green; deterministic, $0, zero-LLM evaluation.

## Benchmarks

No `.harness/bench.json` corpus exists for this surface (confirmed, same as every recent security night — this is a unit-level correctness fix, not a benchmarked metric). Real evaluator: Vitest 4.1.8 against a freshly `pnpm install`-ed `v3/` workspace (was never installed in this checkout; installed this session) + `@claude-flow/cli-core` built via `tsc`.

## Evaluation

**evaluated: accepted.** Stash-isolated baseline (`git stash` on just the two changed files): of 19 new test cases, **18 discriminate and fail** exactly as predicted (`expected true to be false` on every new denylisted name/pattern); the 19th is a non-discriminating negative control (`GIT_CONFIGURATION_PROFILE` must NOT be rejected) that correctly passes on both baseline and candidate. The 32 pre-existing cases in the same file pass unchanged on baseline. Candidate: **51/51 pass** (32 + 19). An independent adversarial-critic subagent re-ran this exact stash/pop cycle itself and caught an arithmetic error in the first pass of this count (originally miscounted as "33 pre-existing / 18 new") — corrected here. Full `@claude-flow/cli` vitest suite: baseline 1650 suites/5210 tests, candidate 1651 suites/5229 tests (the +1 suite / +19 tests is the new test file itself); **failed-suite lists are byte-identical between baseline and candidate** (60 pre-existing failures both ways, diffed directly) — zero regressions. `npx tsc --noEmit` in `cli-core`: 0 errors, confirmed independently by the critic.

**Independent adversarial critique: CONFIRMED-WITH-CAVEATS** (no blocking issues). The critic additionally: verified the `GIT_CONFIG_ENV_RE` regex against real git source (`config.c`) and found it a safe superset with no realistic false negatives; found and the candidate fixed forward two documentation gaps — `GIT_CONFIG_NOSYSTEM`'s denylist rationale was undocumented despite this repo's own `guidance/mod-sources.ts` setting that same var defensively elsewhere (now explained in-source); and `PYTHONSTARTUP`'s comment overclaimed that execSync's non-interactive child "cannot enter" Python's interactive mode — empirically, a caller-supplied `python3 -i` command can still trigger it even off non-tty stdin (now corrected in-source, with the net conclusion — no new capability gained, since that caller already has unrestricted command execution — unchanged). Checked for a second caller-controlled env→child-process path (none found; the only other env-merging exec call, `guidance/mod-sources.ts`'s git() helper, builds a fully internal/hardcoded env and never takes caller-supplied names) and confirmed no stale third copy of `validate-input.ts` exists in the repo.

## Darwin Results

Skipped — binary detection-wiring fix (extend a denylist Set + one regex check), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available) to search over. Same skip class as nearly every accepted security-night fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   1882006a02487590c8c66a7eec8d7504f6af33c3
Candidate commit: (this branch's head — see PR for exact SHA)
Gist SHA-256 (pre-witness, this block stripped back to PENDING): 6fdcc3866bc6b3a66c61871a94c2cb7639e44a2847aecf5ab236231c672f77c3
Witness stamp:    fd98a162d7f7ea730b2c18712ef071444162dc33cbf8ce25e1a910e621df49e4
```
Verifier: fetch `docs/dream-cycle/dream-gist-2026-10-16.md` from this branch, strip this witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Rejected on evidence, don't re-propose without new grading**: PYTHONEXECUTABLE (confirmed macOS-only, cosmetic `sys.argv[0]` override, not a search-path vector) and PSModulePath (single third-party source, no primary Microsoft confirmation found — Grade C, insufficient per this routine's own evidence rule).
2. **Needs independent verification before shipping**: GEM_PATH/GEM_HOME (plausible RubyGems `require`-resolution hijack, not independently source-verified this session).
3. **intelligence scan**: `agentdb-retrieval-guard.ts` (ADR-377 Phase 1, citing arXiv:2606.12703's 93–100% undefended retrieval-poisoning attack success) ships **off by default** (`CLAUDE_FLOW_RETRIEVAL_GUARD`) and only flags rather than drops unsafe content unless a second env var (`_STRICT`) is also set — a real dormant-defense gap, candidate for a future `intelligence` night.
4. **swarm scan**: `RaftConsensus.startElection()` requests votes from peers **sequentially** (`for...await`), unlike the same file's `replicateToFollowers()`, which correctly fans out via `Promise.allSettled` — election latency scales linearly with peer count instead of being bounded by one round-trip. Candidate for a future `swarm`/`performance` night.
