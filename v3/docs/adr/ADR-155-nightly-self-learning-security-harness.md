# ADR-155 — Nightly Self-Learning Security Harness (GitHub Actions)

**Status**: Proposed (2026-06-18)
**Date**: 2026-06-18
**Related**:
- ADR-150 (MetaHarness Integration Surfaces — Phase 2 `oia-audit-weekly.yml` already runs the static surface)
- ADR-151 (Harness Intelligence Layer — Phase 3 scope shell, parent of self-learning capabilities)
- ADR-074 (Self-learning wiring) / ADR-075 (Unified learning stats) / ADR-076 (Structured distillation) / ADR-078 (Hybrid retrieval and outcome signal)
- ADR-026 (3-tier model routing — the cost-budget mechanism this ADR relies on)
- ADR-097 (Federation budget circuit breaker — bounding-spend pattern)
**Triggering event**: CWE-78 in `agentic-flow ≤ 2.0.13` (ruvnet/agentic-flow#169 / GHSA-vcv2-r9jh-99m5) — a partial-fix gap reachable through MCP tool parameters. Caught by a third-party reporter, not by our own gates. This ADR closes the class.
**Architectural inheritance**: explicitly inherits ADR-150's four load-bearing constraints (removable / optional in `package.json` / graceful degradation / CI-absent-path coverage). Every job in the harness MUST honor them.

## Context

We currently have **four orthogonal but disconnected security signals** in CI:

| Workflow | What it does | Cadence | Self-learning? |
|---|---|---|---|
| `codeql.yml` | CodeQL semantic analysis of JS/TS source | push + Fri 22:42 | no |
| `oia-audit-weekly.yml` | `harness oia-audit` (composite of `threat-model` + `mcp-scan` + `oia-manifest`) | Sun 04:17 | no — diff vs prior artifact, no learned weights |
| `no-metaharness-smoke.yml` | Enforces ADR-150 removability | per PR | no |
| `cost-tracker-smoke.yml`, others | Smoke contracts | per PR / nightly | no |

**Three gaps the CWE-78 incident exposed:**

1. **No CVE-DB cross-check.** `agentic-flow ≤ 2.0.13` was vulnerable for months. We do not run `npm audit` / `osv-scanner` / `gh advisory list` nightly against our published packages and pin-set. The downstream `ruflo@3.12.x` `latest` line could have shipped a vulnerable transitive at any time without our knowledge.
2. **No active pentest of the MCP attack surface.** The `harness mcp-scan` and `threat-model` jobs are **static** — they read `.mcp/servers.json` and our claims policy. They do not actually invoke the MCP tools with adversarial payloads to confirm the implementation is hardened. Our regression test in `agentic-flow/tests/security/cwe-78-mcp-execsync.test.ts` is the right shape but lives only in one package, runs only on commits to that package, and was added _after_ the report.
3. **No learning loop.** Every finding is a one-shot. Tomorrow's run has no memory of yesterday's false positive, yesterday's confirmed real bug, the per-finding fix latency, or the empirical CVSS-vs-impact calibration. The system pays full attention to every alert forever, which means it pays partial attention to all of them.

The signal that the CWE-78 fix exists, was published, and is now propagated should _itself_ become a training datum: the harness should learn "MCP tool parameters interpolated into `execSync()` is a high-yield class to keep probing for, prioritize over CodeQL noise on style violations."

### Evidence baseline (measured 2026-06-18)

| Fact | Source | Grade |
|---|---|---|
| Today's CWE-78 fix had **zero** CI gate that would have caught it pre-publish in ruflo's tree | grep audit of `.github/workflows/*.yml` | HIGH |
| `oia-audit-weekly` runs once/week, retains 90 days of artifacts, has structural-similarity drift detection (ADR-152) | `.github/workflows/oia-audit-weekly.yml`, ADR-152 | HIGH |
| `harness oia-audit` already persists into `metaharness-audit` AgentDB namespace when run locally; the workflow uploads artifacts but does not write memory | `plugins/ruflo-metaharness/scripts/oia-audit.mjs`, workflow lines 1–40 | HIGH |
| `gh advisory list` exists as a GHSA query endpoint usable from Actions | gh CLI docs, used in `gh api repos/.../security-advisories` in today's session | HIGH |
| `npm audit --json` returns a stable schema; `osv-scanner` ships a SARIF reporter; both work in unauthenticated Actions runs | npmjs/openssf docs | HIGH |
| ADR-148/149 router can be trained on routing-outcome trajectories — same pattern works for "is this finding worth alerting on" | ADR-148, `train-bundled-krr.mjs` | HIGH |
| Anthropic API + the Tier-1 codemod path can together close ~80% of dependency CVEs autonomously (bump version, run smoke, open PR) | observation from today's session: full agentic-flow 2.0.14 → ruflo 3.12.4 release was 4 tool turns without human intervention | MEDIUM |

## Architectural Constraint (load-bearing invariant)

**The nightly security harness MUST be advisory by default. It MUST NOT auto-publish, auto-merge, or auto-modify production code without an explicit human-in-the-loop gate.** The learning layer learns _what to surface and what to suppress_, not _what to ship._ The default action for any finding is to open an issue or PR; the default action for any auto-fix is to draft it for review.

Three escape hatches the learning layer is **forbidden** from removing:

1. **Sev:HIGH+ findings always alert**, regardless of suppression learning. The model can downgrade "noisy" lints; it cannot downgrade an active CVE.
2. **The human-in-the-loop merge gate** for any harness-authored PR. Even after 1000 successful auto-bumps, the 1001st still goes through review.
3. **Drift-from-history threshold** (ADR-152). If the model's behavior drifts more than N% from baseline in a week, page a maintainer rather than self-correct.

This constraint exists because a learned system that decides which CVEs to silence is a backdoor by design. The learning layer is allowed to be wrong; it is not allowed to be silent.

## Decision

Adopt a **single nightly composite workflow** — `nightly-security-harness.yml` — that fans out into five orthogonal scan dimensions, then converges into one **learned triage step** that ranks, dedupes, and routes findings. Persist every run's outcomes to `metaharness-security-audit` AgentDB namespace so tomorrow's run learns from today's.

### Five fan-out dimensions

Each runs in its own job, in parallel, with caching. Each emits a SARIF or our own `{ findings: [...] }` schema so the triage step can merge.

| # | Dimension | Tool(s) | Inputs | Output |
|---|---|---|---|---|
| 1 | **Dependency CVEs** | `npm audit --json`, `osv-scanner --format sarif`, `gh advisory list -R . --json` | `package.json`, `package-lock.json`, ecosystem advisory DBs | SARIF + raw |
| 2 | **MCP static surface** | `harness mcp-scan` + `harness threat-model` (already in oia-audit) | `.mcp/servers.json`, `.harness/claims.json` | composite worst severity |
| 3 | **MCP active pentest** | `tests/security/*.test.ts` from every plugin + a **new** shared `mcp-pentest-harness` that replays a corpus of known injection payloads against every MCP tool's `inputSchema` | live MCP server process per tool category | per-tool pass/fail |
| 4 | **CodeQL semantic** | existing `codeql.yml` extracted as a callable workflow | source tree | SARIF |
| 5 | **Differential** | `harness drift-from-history --threshold 0.85` (ADR-152) | prior 30d audit snapshots from AgentDB | structural-similarity score + worsening-severity flag |

### One converging triage step

A single job (`triage`) consumes all five fan-out outputs and runs the **harness-intelligence learned triage policy**:

1. **Dedupe**: same finding from CodeQL + osv + npm audit is one issue, not three. Dedupe key = `(cwe, package, version_range, file)`.
2. **Rank** by a KRR-trained scorer over four features: `severity_in_cve_db`, `proximity_to_runtime_path` (does this dep ship in our `bin/`?), `historical_false_positive_rate` for this finding pattern, `time_since_last_seen`.
3. **Suppress** findings that have been confirmed-and-suppressed previously (the suppression has a TTL — re-evaluated weekly to prevent permanent backdooring).
4. **Route**: HIGH+ → open issue + label `security` + page maintainer. MEDIUM → open issue, no page. LOW + known-pattern → drop into a daily digest. NEW pattern (model unsure) → log to AgentDB, surface in next week's review.

### Self-learning hooks (the core of this ADR)

This is where we explicitly differ from "schedule a static scan and hope." Every triage decision is recorded with its outcome so the model learns:

```
trajectory := {
  finding,                       // the raw finding object
  ranked_severity,               // what the model said
  routed_action,                 // issue / digest / drop
  human_outcome,                 // (resolved later) confirmed_real / false_positive / wontfix
  fix_latency_hours,             // (resolved later) time-to-merge for the fix PR
  cwe,
  package,
  found_by_dimension,            // which fan-out caught it
  caught_only_by_dimension,      // boolean — did ONLY this dimension flag it?
}
```

Three learning loops, each owning a distinct decision:

| Loop | Decision | Algorithm | Training data | Reward signal |
|---|---|---|---|---|
| **A** | Per-dimension confidence weighting (when sources disagree, who wins?) | weighted-average with KRR-learned weights, retrained nightly | accumulated `(finding, dimension, human_outcome)` tuples | +1 for confirmed_real, −1 for false_positive |
| **B** | Severity calibration (is "HIGH" really HIGH for _our_ stack?) | isotonic regression of CVSS → realized severity | accumulated `(cvss, realized_impact)` from closed issues | realized = (was_exploited × 10) + (caused_revert × 5) + (no_op × 0) |
| **C** | Auto-fix bid (can we resolve this without human?) | binary classifier: "can a Tier-1 codemod + smoke run + PR close this?" | accumulated `(finding, auto-fix-attempted, succeeded)` from past auto-fix runs | +1 for merged-without-revert, −1 for either rejection or revert |

Reward signals are deliberately conservative — the model only gets credit for findings that were eventually closed and stayed closed. This makes the loops slow to learn but robust to gaming.

### Optimization (the cost side)

The harness runs nightly. Naïvely it pays full LLM-judge inference on every finding every night. Three optimizations make it cheap:

1. **Cache by content hash.** A finding's identity is `(file_sha, rule_id, line, column)`. If we ranked it yesterday and the underlying lines haven't changed (git blame), reuse yesterday's rank. Re-evaluate only on touch.
2. **Route via ADR-026 tiers.** Most ranking decisions are Tier-1 codemod-grade pattern matches (e.g. "exact CVE in `package.json`, known fix version"). Only ambiguous cases — typically <5% — go to Sonnet. The KRR confidence score gates this: confidence > 0.85 → no LLM call. Cost projection: budget per nightly run target **≤ $0.50**, alert at $1.00.
3. **Budget circuit breaker** (ADR-097 pattern). If the run exceeds the budget cap, fail-soft: emit what it has, mark the rest as "deferred to next run," do not block the workflow on cost.

### Decisions explicitly NOT in scope for this ADR

- **Auto-merge.** Never. Even after the auto-fix classifier reaches 0.99 precision, PRs still require a human reviewer click.
- **Replacing CodeQL.** CodeQL is a known-good baseline. We _consume_ its SARIF, we don't compete with it.
- **Pen-testing live production / federation peers.** This harness scans the repo only. Live-target pentesting is its own ADR with its own authorization model.
- **Training on private vulnerability data from federation peers.** Reward signals come from our own merged-and-stayed-closed history; no cross-installation learning until ADR-097's federation budget circuit breaker is extended to bound learning-data flow.

### Phased rollout

**Phase 1 (this PR, ~3 days work).** Land the workflow with the five fan-out dimensions wired and the triage step doing dumb max-severity ranking (no learning). Issue-creation routing. Cost budget cap. This alone closes the CWE-78-class regression: `npm audit` + `gh advisory list` would have caught `agentic-flow ≤ 2.0.13` on day one.

**Phase 2 (loop A — confidence weighting, ~1 week).** Accumulate 30 days of `(finding, human_outcome)` from Phase 1. Train initial KRR weights for per-dimension confidence. Promote loop A behind `CLAUDE_FLOW_NIGHTLY_LEARN_A=1` env flag (same triple-gate pattern as `@metaharness/router`).

**Phase 3 (loop B — severity calibration, ~2 weeks after Phase 2).** Once 50+ findings have been triaged-and-closed, fit the isotonic CVSS→realized regression. Promote behind `CLAUDE_FLOW_NIGHTLY_LEARN_B=1`. The risk here is the model deciding a high-CVSS in a dep we don't actually use isn't HIGH for _us_; this needs the suppression-TTL safety rail (see Constraint #1).

**Phase 4 (loop C — auto-fix, scope-only).** Builds on the agentic-flow→ruflo release flow we just demonstrated: bump the dep, run the smoke, open the PR. This phase needs its own ADR (ADR-156, future) because the auto-fix bid touches the human-in-the-loop gate explicitly. **Phase 4 is OUT OF SCOPE for this ADR** beyond reserving the integration point.

### Failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| GHSA-DB query rate-limited mid-run | exponential backoff, fall back to cached advisory list, mark dimension as `degraded` (does not fail the run) |
| `osv-scanner` panics on a malformed lockfile | dimension reports `errored`, triage continues with remaining 4 |
| Triage model regresses (e.g. starts suppressing real CVEs) | drift-from-history (ADR-152) fires; weekly ratio of `confirmed_real / total_triaged` is itself tracked; if it falls > 20%, training is paused and the model resets to baseline |
| Active-pentest job creates noisy MCP server logs | logs go to artifact only, never to issue body; explicit log-redaction step for any token-shaped strings |
| Cost runs away (LLM tier-3 ranks N=1000 findings) | budget circuit breaker fails-soft at $1.00, emits partial result with `deferred_count: K` |
| Suppression catalog becomes a backdoor (someone suppresses a real CVE) | every suppression has a TTL of 7 days; suppression require a justification field stored alongside; suppression diffs surface in the weekly review |

## Workflow surface

The single new workflow file:

```yaml
# .github/workflows/nightly-security-harness.yml
name: nightly-security-harness

on:
  schedule:
    - cron: '23 3 * * *'       # nightly at 03:23 UTC (off-peak, off-hour)
  workflow_dispatch:
    inputs:
      dimensions:
        description: 'Comma-separated dimensions to run (default: all)'
        type: string
        default: 'deps,mcp-static,mcp-pentest,codeql,differential'
      learn:
        description: 'Enable learning loops (A, B, or both)'
        type: choice
        options: ['none', 'A', 'B', 'A,B']
        default: 'A'
      budget_usd:
        description: 'Maximum spend per run'
        type: string
        default: '0.50'

jobs:
  fan-out:
    strategy:
      fail-fast: false
      matrix:
        dimension: [deps, mcp-static, mcp-pentest, codeql, differential]
    # … each dimension job emits artifact `findings-${{ matrix.dimension }}.json`

  triage:
    needs: fan-out
    # downloads all 5 artifacts, runs `node scripts/security-triage.mjs`
    # which: dedupes, ranks (optionally with KRR if env flag set),
    # opens issues, writes to AgentDB namespace, emits SARIF for code-scanning view
```

Three supporting files:

| File | Purpose |
|---|---|
| `scripts/security-triage.mjs` | the converging triage step — dedupes, ranks, routes, persists |
| `scripts/security-train.mjs` | nightly KRR retrain (loop A); writes `data/security-triage-weights.json` checked into the repo so the model is reproducible and auditable |
| `tests/security/cwe-78-mcp-execsync.test.ts` pattern, generalized | one `tests/security/*.test.ts` per CWE class we've fixed; the active-pentest dimension runs `vitest run tests/security/` |

## Cross-cutting concerns

### Memory contract

Findings persist to AgentDB namespace `metaharness-security-audit`. Each record:

```jsonc
{
  "run_id": "2026-06-18T03:23:00Z",
  "finding": { /* original SARIF or harness-format object */ },
  "rank": { "score": 0.92, "dimension_weights": { /* loop A output */ } },
  "routed_to": "issue#2417",
  "outcome": null,                  // populated when issue closes
  "outcome_resolved_at": null,
  "cost_usd": 0.0023
}
```

Outcome resolution is performed by a separate **`outcome-collector.yml`** workflow that runs daily and inspects closed security-labeled issues, classifying their close reason via the GH API. This separation is intentional — the triage workflow does not read from outcomes it does not yet have, which prevents temporal-leak training-data corruption.

### Observability

- Each run emits a one-line summary to the daily digest: `2026-06-18: 47 findings, 3 issues opened, 1 HIGH, budget $0.31 / $0.50`
- KRR weights checkpointed weekly as a tag (`security-weights-2026-W25`); rollback to any prior week is one `git checkout`
- Active-pentest payload corpus checked into `tests/security/payloads.json`; PRs against it require security-team review

### Compliance with ADR-150 four constraints

| Constraint | How this ADR honors it |
|---|---|
| Removable | `.github/workflows/nightly-security-harness.yml` can be deleted; nothing in `src/` imports it |
| Optional in `package.json` | the `osv-scanner` binary is downloaded inline; no new npm `dependencies` added |
| Graceful degradation | every dimension can mark itself `degraded` or `errored`; triage continues with what it has |
| CI-absent-path coverage | a separate `no-metaharness-smoke.yml`-style job asserts the harness can run with `harness` CLI missing (falls back to static SARIF only) |

## Open questions

1. **Where does the suppression catalog live?** A `data/security-suppressions.json` in the repo is auditable but PR-overhead per suppression. An AgentDB record is lower-friction but invisible. Defaulting to repo-file for v1 with the explicit annotation that v2 may move it.
2. **Cross-package reuse.** `agentic-flow` and `metaharness` could consume the same `scripts/security-triage.mjs` as a published package. Worth doing once it stabilizes (~Phase 2).
3. **Whether to expose the triage decisions as an MCP tool.** Agents could query "what's blocking us from releasing?" Tracked as a follow-up; this ADR does not commit to it.

## Decision drivers

- The CWE-78 incident demonstrated that **we caught a vulnerability via reporter goodwill, not via our own gates**. That is the wrong dependency to ship. This ADR makes the gates first-party.
- Every primitive needed already exists in ruflo: AgentDB for persistence, KRR for learning, MCP tools for surfacing, ADR-026 routing for cost-bounding, ADR-150 oia-audit for the static dimensions. This is composition, not greenfield.
- The learning loops are aligned with how the system already learns elsewhere (ADR-074/075/076/078). Treating security findings as another trajectory class fits the existing intelligence architecture.

## References

- [ruvnet/agentic-flow#169 — CWE-78 advisory](https://github.com/ruvnet/agentic-flow/issues/169)
- [GHSA-vcv2-r9jh-99m5 — published advisory](https://github.com/ruvnet/agentic-flow/security/advisories/GHSA-vcv2-r9jh-99m5)
- ADR-150 (MetaHarness Integration Surfaces) — the static surface this builds on
- ADR-151 (Harness Intelligence Layer) — the parent scope shell; this ADR is a Phase-3 sibling
- ADR-152 (Genome similarity search) — provides drift detection used by dimension 5
- ADR-148 (`@metaharness/router` lifecycle) — KRR pattern reused for loop A
- ADR-026 (3-tier model routing) — cost-bounding for triage
- ADR-097 (Federation budget circuit breaker) — fail-soft pattern reused
- ADR-074/075/076/078 — self-learning patterns reused
