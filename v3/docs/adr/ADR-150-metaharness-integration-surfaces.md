# ADR-150 — MetaHarness Integration Surfaces in `npx ruflo`

**Status**: Implemented (Phase 1 ✅ iters 1–3 · Phase 2 ✅ iters 4–32 · Phase 3 §3.1 ✅ iters 33–99 · KRR retrain pending production data · Phase 3 §3.2-§3.5 scoped in [ADR-151](ADR-151-harness-intelligence-layer.md))
**Date**: 2026-06-16 (revised 2026-06-17 — **100 iterations of /loop**)
**Related**: ADR-148 (cost-optimal router lifecycle via `@metaharness/router`), ADR-149 (per-model cost-optimal routing), ADR-026 (3-tier model routing), ADR-097 (federation budget circuit breaker), ADR-124 (optional native dependencies), ADR-144 (agent-authorization-propagation)
**External reference**: [`ruvnet/agent-harness-generator`](https://github.com/ruvnet/agent-harness-generator) — the upstream that publishes `metaharness` + `@metaharness/*`. Same author (rUv), explicitly designed around ruflo primitives.
**Research dossier**: published as a gist (linked from the tracking issue) with full graded-evidence sourcing.

## Context

We just shipped `ruflo@3.11.0` (also `@claude-flow/cli@3.11.0`, `claude-flow@3.11.0`). ADR-148/149 already wired `@metaharness/router` as an `optionalDependency` for cost-optimal model routing behind a triple gate. The remaining MetaHarness surface — twenty-plus `@metaharness/*` packages: kernel, host adapters (9), verticals (13), scaffold/eject CLI — is unused by ruflo despite being authored by the same maintainer specifically around ruflo's architecture.

Three signals make this the right time to commit a broader integration:

1. **MetaHarness is first-party.** Same author (`ruv@ruv.net`), same ADR numbering convention (kernel docs reference ADR-011/022/033/036/040/041/043), explicit framing: *"Scaffold your own focused AI agent harness — like ruflo, uniquely yours."* The `buildRegistryEntry()` doc comment says: *"Mirrors the ruflo plugin registry shape so the same UI can browse it."* The `@metaharness/host-claude-code` adapter emits `.claude/settings.json` in exactly ruflo's format.
2. **The router integration is already live but underutilized.** `@metaharness/router@^0.3.2` is in `optionalDependencies`; `neural-router.ts` imports it behind `CLAUDE_FLOW_ROUTER_NEURAL=1`. The bundled KRR is trained on hand-coded seed scores rather than measured routing outcomes — leaving the DRACO Pareto win unrealized.
3. **No ruflo skill exposes scaffolding/score/genome/threat-model to Claude Code today.** Users discover MetaHarness independently and are confused about the relationship.

### Evidence baseline (measured 2026-06-16)

| Fact | Source | Grade |
|---|---|---|
| `metaharness@0.1.11` ships 24 subcommands across two binaries (`metaharness` factory + `harness` lifecycle) | `dist/index.d.ts`, `dist/subcommands.d.ts`, all `*-cmd.d.ts` | HIGH |
| 20+ `@metaharness/*` packages published; full ecosystem (kernel + 5 host adapters + 13 verticals + 5 platform NAPI binaries) | `npm search @metaharness` | HIGH |
| `@metaharness/router@0.3.2` exports `Router` (k-NN), `TrainedRouter` (KRR), `NativeRouter` (FastGRNN via tiny-dancer), zero runtime deps, 53 kB unpacked | `dist/*.d.ts`, npm registry | HIGH |
| `@metaharness/kernel@0.1.0` exports `loadKernel`, `ToolDispatcher` (claims-checked), `SelfEvolvingRouter`, `TrajectoryStore`, `rankWithDecay` | `kernel-pkg/package/dist/*.d.ts` | HIGH |
| `metaharness` factory exports `buildRepoScorecard()`, `buildGenomeReport()`, `buildScorecard()`, `buildThreatModel()`, `scanMcp()`, `buildOiaManifest()`, `buildRegistryEntry()` — all pure reads, well-typed | `dist/repo-scorecard.d.ts` etc. | HIGH |
| Velocity: `metaharness` 0.1.0 → 0.1.11 in ~23h; `@metaharness/router` 0.1.0 → 0.3.2 in 2.7h on 2026-06-15 | npm `time` field | HIGH |
| Both packages MIT-licensed, same maintainer as ruflo | npm registry | HIGH |
| Existing benchmark proves `@metaharness/router` native backend loads on the test host: `mh_native_available: true` | `docs/benchmarks/runs/router-4way-seed99-2026-06-15T14-12-40Z.json` | HIGH |

## Architectural Constraint (load-bearing invariant)

**MetaHarness may augment ruflo. MetaHarness must never become a required runtime dependency for core orchestration, memory, routing, MCP dispatch, agent execution, or federation.**

Every integration in this ADR, and every future ADR that extends it, must satisfy:

1. **Removable**: ruflo's `npm ls` with all `@metaharness/*` packages removed must still produce a working CLI. The triple-gate pattern used for `@metaharness/router` (env flag + artifact + import success) is the reference implementation.
2. **Optional in `package.json`**: `@metaharness/*` packages MUST appear in `optionalDependencies` or `peerDependencies` (optional), never in `dependencies`.
3. **Graceful degradation**: every code path that imports a `@metaharness/*` symbol must catch `MODULE_NOT_FOUND` and fall back to a built-in path (or a clearly-degraded but functional state).
4. **CI coverage of the absent path**: at least one CI job must run `--ignore-optional` (or equivalent) and assert ruflo still passes its smoke contract. This is the only structural defense against accidentally promoting an optional dep to required.

The intent of this constraint is to prevent ruflo from becoming a hidden second orchestration framework wrapped around its sibling's runtime. Reviewer's framing: *"Ruflo remains operational if every MetaHarness package is removed."* That sentence is now part of the API surface contract — any PR that breaks it is a breaking change requiring its own ADR.

## Decision

Adopt MetaHarness as ruflo's downstream sibling tool, surfaced through three integration channels that match its three distinct contributions:

1. **Static-analysis MCP tools** — `harness-score`, `harness-genome`, `harness-threat-model`, `harness-mcp-scan` as a new `plugins/ruflo-metaharness/` plugin. Subprocess invocation of the `metaharness` / `harness` CLI binaries; no static library dependency added to ruflo's boot path. Read-only operations only.
2. **Live router data pipeline** — replace the hand-coded seed corpus for the bundled KRR with measured routing trajectories collected via the existing `CLAUDE_FLOW_ROUTER_TRAJECTORY=1` recorder; retrain `train-bundled-krr.mjs` against real data. This unlocks the Pareto win ADR-149 forecast but never measured.
3. **CI security gates** — add `harness mcp scan .` and `metaharness score . --json` to `v3-ci.yml`. Both are static, fast, and machine-readable. Asserts no HIGH MCP findings and a non-zero readiness score on every PR.

Three concrete things we ARE NOT doing in this ADR (deferred to Phase 2+):

- Wiring `@metaharness/kernel`'s `ToolDispatcher` into the MCP dispatch core. The kernel is v0.1.0 and the dispatch path is too high-blast-radius for an early-stage replacement.
- Promoting `@metaharness/router` from `optionalDependency` to `dependency`. The triple gate is the right posture until the API stabilizes at 1.0.
- Exposing `from-repo <git-url>` as an MCP tool callable by Claude Code without explicit user confirmation. Untrusted-Git-clone is a deliberate human-in-the-loop step.

### Phased rollout

**Phase 0 — Measurement spike (1–3 days, no code shipped to npm).**
- Run `npx metaharness score .` and `npx metaharness genome .` against the ruflo repo to establish baseline scorecards.
- Enable `CLAUDE_FLOW_ROUTER_TRAJECTORY=1` for ≥50 routing decisions; verify the `.swarm/model-router-trajectories.jsonl` shape matches what `train-bundled-krr.mjs` expects.
- Confirm `import('@metaharness/router')` succeeds from `v3/@claude-flow/cli` and exercise `Router.fromExamples(...)` with the existing benchmark corpus.
- Run `harness mcp scan .` to baseline ruflo's own MCP threat-model score.

Exit criteria: baseline numbers in hand; no surprises in trajectory format or `mcp scan` output.

**Phase 1 — MVP (3–7 days, one MINOR release: 3.12.0).**
1. **`plugins/ruflo-metaharness/`** with three skills (`harness-score`, `harness-genome`, `harness-mint`), conventional structure (`plugin.json`, `skills/*/SKILL.md` with `allowed-tools: Bash`, `scripts/smoke.sh`). Skills shell out to `npx metaharness` / `npx harness` — no library imports. Covered by the fleet meta-smoke and the three existing audits (exit-bypass, frontmatter, manifest).
2. **CI gates** in `v3-ci.yml`: `npx metaharness score . --json` (assert `exitCode === 0`) and `npx harness mcp scan .` (assert no HIGH findings). Both are additive jobs on the existing matrix.
3. **Real seed corpus**: collect trajectory data over Phase-0's recorder runs + a CI pass, retrain via `scripts/train-bundled-krr.mjs`, regenerate the bundled artifact. Validate `routedBy: 'metaharness-krr'` activates on real decisions in the next bench run.

Exit criteria: `plugins/ruflo-metaharness/scripts/smoke.sh` passes; meta-smoke shows 33/33 plugins green; CI score + mcp-scan jobs green on main; new bench run shows `routedBy: 'metaharness-krr'` for ≥ 1 routing decision driven by measured-seed KRR.

Semver: MINOR — additive plugin, additive CI gates, additive MCP tools. No breaking changes.

**Phase 2 — Expansion (1–4 weeks, one or two MINOR releases).**
- `npx ruflo eject` command wrapping `metaharness --from-existing ./` for one-shot harness extraction (attribution preserved via the `<!-- ruflo-attribution-block -->` convention).
- `SelfEvolvingRouter` (from `@metaharness/kernel`) parallel-logged alongside the Thompson bandit in `model-router.ts` for two weeks. **Promotion criteria (AND, not OR — must satisfy all three):**
  1. **Quality**: `qualityScore` improvement > 2% (where `qualityScore` is the existing per-task verdict-weighted reward used by the bandit)
  2. **Cost**: `usdPerDecision` increase < 1% (no expensive regressions hiding behind quality wins)
  3. **Latency**: p95 routing-decision latency increase < 5%
  Each metric measured over an identical workload between bandit-only and SelfEvolvingRouter-only periods, separated by a 24h washout window. Failing any one criterion blocks promotion; the bandit stays primary. This tightening is deliberate — the "OR" form would let quality gains mask cost or latency regressions, which is the exact failure mode ADR-149's Pareto framing was built to prevent.
- Harness entries in the ruflo plugin registry — accept `type: 'harness'` in `discovery.ts`; surface via `npx ruflo plugins list --type harness`.
- 13th background worker `oia-audit` that runs `buildOiaManifest()` + `buildThreatModel()` + `scanMcp()` on a schedule and stores results in the `metaharness-audit` memory namespace.

Each Phase-2 item is independently scoped and can ship as separate MINOR releases.

**Phase 3 — Harness Intelligence Layer (future, scope-only — separate ADR per item).**

A class of capability that exists nowhere else in the agent-framework space, made possible by `buildGenomeReport()` + `buildRepoScorecard()` + `buildRegistryEntry()`'s shared schema:

- **Genome similarity search** — given two harnesses (or one harness + a candidate repo), compute a similarity vector across the 7 genome sections + scorecard dimensions; surface the closest match in the registry.
- **Harness recommendation engine** — given a repo + a user description, recommend (a) the closest existing harness in the registry, (b) the closest template, and (c) the minimum delta to fork from either.
- **Fleet-wide architecture drift detection** — for organisations running multiple harnesses, track genome-section drift over time; alert when a harness diverges from its template lineage beyond a threshold.
- **Cross-harness capability graph** — `compare <a> <b>` already exists in `harness` CLI; lift it into a fleet-aware diff that answers "which harness in our fleet has the closest capability set to this task?".
- **Plugin compatibility analysis** — given a `plugins/X/` and a target harness, predict whether the plugin's `allowed-tools` requirements are satisfied by the harness's MCP server declarations.

These are scope-only in this ADR. Each item gets its own ADR before implementation. They are listed here so the architectural constraint (above) covers them up front — the Harness Intelligence Layer must also satisfy the four removable/optional/graceful/CI-coverage rules.

## Consequences

### Positive

- Closes the "what is the relationship between ruflo and MetaHarness?" question by answering it in the UX rather than the docs.
- Ruflo gains a continuous, machine-readable readiness score and MCP threat-model on every PR — the same primitives we use to score third-party repos for harness viability.
- The ADR-149 Pareto win (per-model cost-optimal routing) becomes measured rather than theoretical, because the KRR is finally trained on real trajectories.
- Phase 1 is entirely additive: no `model-router.ts` dispatch logic changes, no top-level command surface change, no IPFS registry change. Backward-compatible MINOR bump.
- Three integration channels match MetaHarness's three contributions — analysis, routing, hosts — without forcing the kernel's full surface into a position where its 0.x stability would block ruflo releases.

### Negative / risks

- **API stability**: both `metaharness` and `@metaharness/router` are 0.x and ship rapid patch releases. A breaking change in `@metaharness/router@0.4.x` would require immediate `neural-router.ts` updates. Mitigation: pin to `~0.3.2` in `optionalDependencies`; add `scripts/check-metaharness-compat.mjs` to CI exercising the `Router` constructor with a trivial example to catch runtime breakage before publishing.
- **Bus factor**: same maintainer as ruflo, MetaHarness, and ruvector. No change from today, but the dependency edge is now explicit.
- **Sandboxing**: `harness from-repo <url>` clones arbitrary Git URLs. Phase-1 skills NEVER expose this to Claude Code; only `analyze`/`score`/`genome` (pure reads) and `harness-mint` (writes to user-specified target dir, never project root).
- **GCP dependency**: `harness validate` uses GCP Secret Manager via `gcloud`. Ruflo CI must skip those subcommands (or mock them) — explicit `--skip-gcp` flag from the `harness validate` command surface handles this.
- **Phase-1 MCP plugin spawns subprocesses**: subprocess crashes, timeouts, and stdout-parsing edge cases are now in ruflo's failure surface. Mitigation: hard timeout (60s) per invocation, captured stderr in error responses, structured-JSON output enforced via `--json` flag everywhere.

### Neutral / accepted trade-offs

- Subprocess invocation in Phase 1 (rather than library import) adds ~200ms cold-start overhead per call vs. an embedded library. Acceptable for MCP tools that are not in the hot path; the router path (already library-imported) remains as-is.
- Maintaining a `ruflo-metaharness` plugin doubles documentation surface for two sibling tools. Mitigation: skill descriptions explicitly point to the upstream MetaHarness docs as canonical for the underlying functionality; the plugin only documents the ruflo-side adaptation.

## Alternatives Considered

**Alternative A: Ignore MetaHarness, build all scaffolding/score/genome natively in ruflo.**
Rejected. `buildRepoScorecard()`, `buildGenomeReport()`, `scanMcp()`, `buildThreatModel()` are already-tested implementations exposing clean TypeScript APIs. Reimplementing them in ruflo is pure duplication cost with no advantage. The eject path's `rewriteContent()` with attribution-block preservation is subtle.

**Alternative B: Use MetaHarness only as a CLI subprocess everywhere, never as a library import.**
Partially adopted (this is the Phase-1 plugin posture). Wrong for `@metaharness/router` — sub-ms routing latency demands a library import, which ADR-148/149 already accepted.

**Alternative C: Promote `@metaharness/router` from `optionalDependency` to `dependency`.**
Rejected for now. The triple gate (`CLAUDE_FLOW_ROUTER_NEURAL=1` + artifact + import success) is the right posture until the API stabilizes at 1.0.

**Alternative D: Wait for MetaHarness 1.0 before any further integration beyond ADR-148/149.**
Rejected. The static-analysis surface (`score`, `genome`, `mcp scan`, `threat-model`) is already mature (475 files, well-typed, pure reads). Waiting creates a window where users discover MetaHarness independently and are confused about its relationship to ruflo. The Phase-1 plugin answers that question without incurring API-stability risk because the integration is via CLI subprocess, not library import.

**Alternative E: Wire `@metaharness/kernel`'s `ToolDispatcher` as the primary MCP dispatch in Phase 1.**
Rejected. Touching the MCP dispatch core affects all 314 tools and is too high-blast-radius for an early-stage (v0.1.0) component. Deferred to a Phase-3 ADR after the kernel ships a 1.0 with API-stability commitments.

## Open Questions

- Should the Phase-1 plugin's `harness-mint` skill require explicit user confirmation in the Claude Code UI before writing any files? Lean yes — destructive-action-confirmation matches ruflo's "executing actions with care" principle.
- Should the seed-corpus retraining cadence be ad-hoc (Phase-1) or scheduled (e.g., monthly cron in a Phase-2 follow-up)? Defer to Phase-2 once we see the trajectory volume.
- Does the `oia-audit` background worker (Phase 2) belong in `ruflo-loop-workers` or in `ruflo-metaharness`? Probably the latter, since the audit output is MetaHarness-specific.
- How does the architectural constraint's CI gate (the `--ignore-optional` smoke run) interact with the existing `all-plugins-smoke.yml` workflow? Probably a new sibling workflow `no-metaharness-smoke.yml` that re-runs the same matrix with `--ignore-optional`; lighter than adding a second axis to the existing matrix.

## Implementation Notes (revised 2026-06-16)

The integration shipped across eight `/loop` iterations on branch
`feat/metaharness-integration-research`. Status of each Phase milestone:

### Phase 0 — Measurement spike ✅ DONE (iter 1)
- Ruflo baseline scorecard captured: harnessFit 82/100, compileConfidence
  100, taskCoverage 79, toolSafety 100, memoryUsefulness 40 (weakest —
  track), estCostPerRunUsd $0.048, archetype `typescript-sdk-harness`,
  template recommendation `vertical:coding`, scaffoldReady true.
- Ruflo genome: repo_type `node_mcp_ci`, risk_score 0.27 (low),
  publish_readiness 0.9, mcp_surface `remote`.

### Phase 1 — MVP ✅ DONE (iters 1–3)
- `plugins/ruflo-metaharness/` with 6 skills (one more than ADR-150
  originally proposed — `harness-oia-audit` was lifted forward from
  Phase 2 in iter 7): `harness-score`, `harness-genome`,
  `harness-mcp-scan`, `harness-threat-model`, `harness-oia-audit`,
  `harness-mint`.
- Shared `scripts/_harness.mjs` bridge — single subprocess
  invocation point, 60s hard timeout, JSON-mode default, graceful
  degradation via `emitDegradedJsonAndExit`.
- `npx ruflo metaharness <subcommand>` top-level dispatcher in
  `v3/@claude-flow/cli/src/commands/metaharness.ts` (iter 3).
- `metaharness@~0.1.11` and `@metaharness/router@~0.3.2` in
  optionalDependencies of BOTH `@claude-flow/cli/package.json` and
  `ruflo/package.json` (iter 3). Tilde pin, not caret — per
  review-round-1 (upstream had 5 releases in 2.7h).
- CI workflows (iter 2):
  - `metaharness-ci.yml` — score, mcp-scan, router-compat jobs
  - `no-metaharness-smoke.yml` — enforces architectural constraint rule
    #4 by greping every package.json for non-optional metaharness deps
    AND drilling each skill with an unresolvable npm registry
  - `scripts/check-metaharness-compat.mjs` — API-stability tripwire,
    9/9 against current @metaharness/router@0.3.2

### Phase 2 — Expansion (3 of 4 shipped)
- ✅ `npx ruflo eject` (iters 4–5) — Phase-2 differentiator wrapping
  `metaharness --from-existing`. Dry-run default; refuses in-repo
  target + existing-target overwrites. CI dry-run job in
  metaharness-ci.yml validates BOTH the plan output AND the safety
  refusal.
- ✅ `'harness'` PluginType in plugin registry (iter 6) — schema
  extension only, zero runtime overhead. `npx ruflo plugins list
  --type harness` filter works by construction.
- ✅ `harness-oia-audit` composite worker (iter 7–8) — bundles
  oia-manifest + threat-model + mcp-scan into one timestamped record;
  persistence to `metaharness-audit` memory namespace; weekly cron
  workflow `.github/workflows/oia-audit-weekly.yml` at Sundays 04:17 UTC.
- ✅ `SelfEvolvingRouter` parallel-logging — BOTH HALVES LANDED:
  - **Analyzer** (iter 10):
  `plugins/ruflo-metaharness/scripts/router-parallel-analyze.mjs` reads
  paired routing decisions from a JSONL trajectory file and computes
  the 3-criteria AND-gate from review-round-1. Verified end-to-end with
  synthetic fixtures (✓ PROMOTABLE / ⚠ NOT promotable paths both work,
  insufficient-data path exits cleanly at n<30). `@metaharness/kernel`
  added to `optionalDependencies` of `@claude-flow/cli` AND
  `ruflo/package.json` so the future Recording side can dynamic-import
  `SelfEvolvingRouter` without a static dep.
  - **Recorder primitive** (iter 11):
    `v3/@claude-flow/cli/src/ruvector/router-parallel-recorder.ts`
    exports `recordPair(task, bandit, ser)` + `recordPairOutcome(task,
    outcome)` + `parallelRecorderStatus()`. Env-gated via
    `CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1` — no-op when unset (default).
    Every `appendFileSync` wrapped in try/catch with debug-only stderr
    logging; ADR-150 rule #3 satisfied (never throws from the routing
    path). 10MB rotation. Default output path
    `.swarm/router-parallel.jsonl` matches the iter-10 analyzer's
    default `--input`.

  - **Dispatch wiring** (iter 12 — LAST MILE):
    The one-line edit in `model-router.ts` route() shipped in iter 12.
    Fire-and-forget `recordPair({task, bandit, ser})` inside the
    existing `if (abEnabled)` block — same place the A/B disagreement
    counter already lives. Env-gated by
    `CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1'`; no-op when unset, which
    means ZERO overhead on the default routing path. The dynamic-import
    is lazy (one Promise per process); the recordPair call is wrapped
    in try/catch with `.catch(() => {})` on the import promise — the
    routing path NEVER throws, even when the optional kernel is
    completely absent.

    Both arms are attributed at the call site:
      bandit.backend = 'thompson-bandit'
      ser.backend    = neuralPrior ? 'metaharness-router-hybrid' : 'bandit-only'

    The pipeline is now end-to-end:
      route() → recordPair() → .swarm/router-parallel.jsonl
                              → router-parallel-analyze.mjs
                              → 3-criteria AND-gate verdict

### Phase-1 item #3 — Real seed corpus retraining 🔄 PENDING
Requires production trajectory data. The pipeline is wired:
`CLAUDE_FLOW_ROUTER_TRAJECTORY=1` writes JSONL;
`scripts/train-bundled-krr.mjs` rebuilds the artifact. The blocker is
data collection — needs a 50+ decision production sample. Plan: enable
the recorder on the next merged-to-main release; collect a week of
real routing data; retrain in a follow-up PR.

### Fleet status (post-iter-8)
- 33 plugins in `scripts/smoke-all-plugins.mjs` (was 32; +1 for
  ruflo-metaharness)
- 19 structural invariants in `plugins/ruflo-metaharness/scripts/smoke.sh`
- Three fleet audits green (exit-bypass / SKILL.md frontmatter /
  plugin.json manifest)
- 117 SKILL.md files across 34 plugins (was 117/32 — adding
  6 new SKILL.md files from this plugin pushed the count)

### Phase 2 continued (iters 13–32)
Additional Phase-2 surface landed over iters 13-32, all on the same
`feat/metaharness-integration-research` branch:

- **iter 15** `audit-trend.mjs` — diff two `oia-audit` records (drift
  detection). Pulls baseline + current snapshots from
  `metaharness-audit` namespace; reports composite severity delta +
  per-component status + introduced/cleared findings.
- **iter 16** `audit-list.mjs` — enumerate timestamped records in
  `metaharness-audit` namespace, with `--since 30d`-style filtering.
- **iter 20-23** `metaharness-tools.ts` MCP surface — 7 tools registered:
  score, genome, mcp-scan, threat-model, oia-audit, audit-list,
  audit-trend. Each backed by subprocess invocation through the same
  `_harness.mjs` bridge. `test-mcp-tools.mjs` enforces the runtime
  contract: `{success, data, degraded, exitCode}` shape, never-throws
  invariant.
- **iter 27-29** mint hardening — explicit npx argv (was a single
  string token), `cwd: dirname(target)` + `basename(target)` as cliName
  workaround for upstream `--target` bug (now fixed at metaharness@0.1.13).
- **iter 30-32** `.harness/mcp-policy.json` + manifest.json — security
  posture: default-deny, allow shell/network/file-write: false,
  audit-log on; iter-31 exact-pins close LOW severity vector; iter-32
  manifest documents witness-key gap.

### Phase 3 §3.1 — Genome Similarity Search (iters 33–59)
Phase-3 §3.1 from [ADR-152](ADR-152-genome-similarity-search.md) shipped
across 27 iterations. The implementation is now deeply integrated across
**14 distinct surfaces**:

| # | Surface | Iter |
|---|---|---|
| 1 | Spike with 2 invariants (selfMatch, verticalAffinity) | 35 |
| 2 | Production module `_similarity.mjs` (5 exports) | 36 |
| 3 | CLI skill `similarity.mjs` (file + memory inputs) | 36 |
| 4 | MCP tool `metaharness_similarity` | 36 |
| 5 | CLI dispatcher entry | 36 |
| 6 | MCP runtime contract test (74→115 assertions) | 37, 43, 52 |
| 7 | Pipeline consumers (oia-audit fingerprint + audit-trend) | 38 |
| 8 | 53 unit-test assertions over 8 phases | 39 |
| 9 | Dedicated CI job `similarity-tests` | 40 |
| 10 | Performance benchmark with regression gate | 41 |
| 11 | End-to-end pipeline roundtrip test | 47, 49, 51 |
| 12 | CI job `metaharness-real-data` running roundtrip | 48 |
| 13 | Doctor health check distinct from upstream | 45, 52 |
| 14 | `drift-from-history` one-command primitive + MCP tool | 53, 54 |

#### Real-data bug-discovery arc (iters 47-51)
End-to-end roundtrip caught FOUR latent bugs that synthetic-fixture
tests had missed for 9+ iterations each:
- **iter 47** — schema mismatch: oia-audit captured fingerprint via
  the wrong CLI binary (harness vs metaharness; different schemas).
  Fingerprint silently fed wrong shape to `_similarity.mjs`. Fixed by
  routing score+genome through `runMetaharness`.
- **iter 49** — mcp-scan dead-code: `audit-trend` read `json.findings`
  expecting an array, but mcp-scan emitted text-only. Flagged.
- **iter 50** — closed (b) via shared `parseMcpScanText` parser in
  `_harness.mjs`, wired into both mcp-scan.mjs and oia-audit.mjs.
- **iter 51** — proved drift detection actually fires on mutated
  audits, not just confirms self-match. Stage 7 mutates all 3
  similarity components; verdict flips from near-identical to
  moderate-drift; alert at 0.95 fires.

#### Anti-regression locks (iters 42-44)
- **iter 42** — fixed dispatcher's flag-drop bug (silent for 6 iters).
  Iter-36 wired SUBCOMMANDS but only `context.args` (positionals) were
  forwarded to subprocess. Now reads `context.flags` and re-kebabs
  camelCase→kebab. Affects ALL metaharness subcommands.
- **iter 43** — generalized iter-42's catch into 16 structural
  positive-case assertions on the MCP runtime test.
- **iter 44** — MCP wrapper `success = (exitCode === 0)` (was
  `!degraded`). Affects all 9 metaharness MCP tools. Documented 3
  observable cases.

#### Parallelization sweep (iters 56-59)
Composite operations now use Promise.all where dependency graph allows:
- **iter 56** — oia-audit's 5 subprocess calls parallelize → 4.59x
  measured speedup on Apple Silicon / Node 22 (close to theoretical 5x).
- **iter 58** — drift-from-history's audit-list + oia-audit
  parallelize → ~30% reduction. Folded the iter-57 probe into the same
  batch.
- **iter 59** — `timing.{wallMs, sumComponentMs, parallelSpeedup}`
  field in oia-audit output. Smoke gate asserts speedup > 2.0 to catch
  silent serialization regression.

#### Iter-55 graceful-degradation drill expansion
The architectural-constraint workflow (`no-metaharness-smoke.yml`)
drilled only 4 skills pre-iter-55. Extended to 7. Discovered 3 latent
gaps (oia-audit timeout, mint marker missing, drift-from-history exit
code), all closed in iters 56-57.

#### Upstream contribution
Two issues filed at `ruvnet/agent-harness-generator`:
- [#15](https://github.com/ruvnet/agent-harness-generator/issues/15) —
  harness vs metaharness CLI schema confusion (iter 47 discovery)
- [#16](https://github.com/ruvnet/agent-harness-generator/issues/16) —
  harness mcp-scan plain text instead of JSON (iter 50 discovery)
Both still OPEN as of iter 59. Downstream workarounds remain in place.

### Fleet status (post-iter-59)
- Smoke step count: 19 → 62 (43 new structural invariants since iter 8)
- MCP tool runtime contract: 115 assertions across 9 tools
- Real-data roundtrip: 31 pipeline assertions
- Unit tests: 53 similarity-module assertions
- Total ruflo-metaharness smoke surface: ~260 assertions
- 33/33 plugin fleet still green

### Iters 60–82 — performance / observability / contract hardening

A second wave of work after iter 59 focused on three orthogonal
hardening axes: parallelization, anti-regression infrastructure, and
upstream-contract tripwires.

#### Parallelization sweep (iters 56-59 + 65 + 67)
- **iter 56** oia-audit's 5 subprocess calls race via Promise.all
  → 4.59x measured speedup (close to theoretical 5x).
- **iter 58** drift-from-history's audit-list + oia-audit race
  → 1.02-1.03x (audit-list's ONNX warmup dominates; race still
  proves no serial regression).
- **iter 59** oia-audit emits `timing.{wallMs, sumComponentMs,
  parallelSpeedup}` so the speedup is observable and gated against
  silent serial regression.
- **iter 65** drift-from-history surfaces the same timing fields.
- **iter 67** `--baseline-file` fast-path: skips audit-list AND
  audit-trend memory roundtrip → ~19x speedup (1.4s wall on Apple
  Silicon vs ~26s slow path). Iter 66's `--baseline-key` was the
  intermediate ~14x step.

#### Three-tripwire upstream-contract defense (iters 12 + 80 + 81)
| Tripwire | Surface | Iter |
|---|---|---|
| `check-metaharness-compat.mjs` | `@metaharness/router` public API | 12 |
| `check-mcp-scan-format.mjs` | `harness mcp-scan` text-output format | 80 |
| `check-fingerprint-schema.mjs` | `metaharness score`/`genome` JSON fields | 81 |

Each tripwire runs in CI `metaharness-real-data` job BEFORE the
roundtrip — upstream drift fails with a SPECIFIC error pointing at
which surface broke, instead of cascading to downstream symptoms.

#### Anti-regression infrastructure
- **iter 64** rankSeverity + rollup unit tests (22 assertions) —
  iter-63's shared severity util now anchored at primitive level.
- **iter 72** parseMcpScanText edge cases (19 assertions) —
  iter-50's parser now anchored against silent regex drift.
- **iter 73** negative-grep guard: anti-mint-as-MCP enforcement.
- **iter 74** generalized negative guards: from-repo never wrapped;
  no new static `@metaharness/*` imports outside neural-router.ts.

#### Bug-discovery + fix arc (iters 47-77)
The roundtrip test surfaced 4 latent bugs that hand-built-fixture
testing had missed:
- **iter 47** — score/genome schema mismatch (28 iters silent)
- **iter 49** — audit-trend introduced/cleared was dead code
- **iter 50** — fixed via shared parseMcpScanText util
- **iter 51** — proved drift detection fires on mutation, not just
  self-match
- **iter 62** — extended SEVERITY_RANK; iter-50 parser unlocked
  warn/critical findings that the rollup ignored
- **iter 63** — consolidated SEVERITY_RANK + safe rankSeverity()
  across all 3 consumers
- **iters 76-77** — mutation-tested introduced/cleared at all four
  corners: clear, introduce, swap, dedup.

#### Drift-detection autonomous arc (iters 53-79)
- **iter 53** — drift-from-history one-command primitive
  composing audit-list + oia-audit + audit-trend
- **iter 58** — parallel batch
- **iter 65** — observable timing
- **iter 66** — `--baseline-key` fast-path (~14x)
- **iter 67** — `--baseline-file` fastest-path (~19x)
- **iter 68** — roundtrip Stage 8 exercises wrapper end-to-end
- **iter 69** — weekly cron AUTO-runs drift detection every Sunday;
  downloads prior artifact via `gh run download`
- **iter 70** — drift steps use `if: always() && has_prior` so
  failure-path artifacts (the most valuable) still get uploaded
- **iter 75** — Stage 9 proves the fastpath catches drift, not just
  self-match
- **iter 78** — `--alert-on-new-severity` orthogonal alert gate
  (catches "new CRITICAL finding with similarity intact")
- **iter 79** — weekly cron passes `--alert-on-new-severity high`,
  closing the production wiring

#### Doctor expansion (iters 45 + 52 + 61)
- iter 45 separates ruflo-side integration health from upstream-dep
  presence (different remediation paths)
- iter 52 verifies parseMcpScanText export
- iter 61 verifies iter-56 async exports (runHarnessAsync /
  runMetaharnessAsync) — missing = oia-audit parallelization breaks

#### MCP-CLI parity (iters 53 → 71)
All 9 MCP tools have CLI-level flag parity. Iter 71 specifically
fixed drift-from-history (iter-66/67 flags were CLI-only until then).
Iter 73's anti-mint negative guard enforces the deliberate
asymmetry: 10 CLI subcommands, 9 MCP tools (mint cli-only per
§Sandboxing).

#### Artifact-tracking family (iters 7 + 69 + 82)
| Artifact | Workflow | Iter |
|---|---|---|
| `oia-audit-${run_id}` | weekly cron | 7 |
| `drift-trend-${run_id}` | weekly cron | 69 |
| `bench-similarity-${run_id}` | per-PR CI | 82 |

All 90-day retention for cross-artifact comparability.

### Fleet status (post-iter-82)
- Smoke step count: 19 → 85 (+66 invariants since iter 8)
- MCP tool runtime contract: 117 assertions across 9 tools
- Real-data roundtrip: 66 pipeline assertions across 12 stages
- Unit tests: 94 similarity + severity + parser assertions
- 3 compat tripwires (router API / mcp-scan text format / fingerprint schema)
- 33/33 plugin fleet still green
- 4 CI workflows (metaharness-ci, no-metaharness-smoke, oia-audit-weekly,
  metaharness-real-data sub-job)

### Iters 83-99 — cross-reference integrity + observability

Eighteen more iters of hardening after iter 82's ADR refresh. Two
coherent arcs: cross-reference integrity matrix and fast-path
observability.

#### Cross-reference integrity matrix (iters 73, 84, 89-94)

Eight cross-reference surfaces now smoke-gated. Each detects a specific
class of "thing X must point at thing Y" drift before it reaches
production:

| Source                  | Target                  | Iter |
|-------------------------|-------------------------|------|
| description string      | SUBCOMMANDS keys        | 73   |
| SUBCOMMANDS values      | scripts/*.mjs           | 89   |
| MCP handler runScript() | scripts/*.mjs           | 90   |
| SKILL.md inline refs    | scripts/*.mjs           | 91   |
| MCP enum                | SEVERITY_RANK keys      | 92   |
| MCP tool names          | CLAUDE.md catalog       | 93   |
| SUBCOMMANDS keys        | CLAUDE.md catalog       | 94   |
| CI workflow run steps   | tripwire scripts        | 84   |

Plus 3 negative-guard invariants from iters 73+74 (mint-not-in-MCP,
no `from-repo` skill/script/MCP tool, no new static `@metaharness/*`
imports outside neural-router.ts).

#### Fast-path observability arc (iters 95-99)

iter-66/67 added the `--baseline-key` (~14x) and `--baseline-file`
(~19x) fast-paths. iter-95-99 made them observable at every consumption
layer:

- **iter 95** — derived `timing.path` field in JSON payload
- **iter 96** — CLI table mode shows `Path: file (wall N ms)`
- **iter 97** — Weekly cron `GITHUB_STEP_SUMMARY` shows the same
- **iter 98** — CI dispatcher round-trip asserts JSON shape contract
- **iter 99** — CI dispatcher round-trip ALSO asserts wall < 30s

A creeping regression (e.g., fastpath quietly degrading from 1.4s to
15s over weeks) is now visible in the Actions UI's wall annotation
before it breaches the 30s ceiling.

#### Anti-regression pattern reinforcement (iters 83-92)

- **iter 84** — positive-presence guards for all 3 compat tripwires
- **iter 86** — bench-parse-mcp-scan perf characterization
- **iter 87** — fixed bench-scripts JSON-output contamination (iter-82
  CI step was silently broken; iter-87 caught it during iter-87's
  own dry-run; both bench scripts patched, runtime parse-roundtrip
  smoke assertion added)
- **iter 88** — family-wide JSON-output contract gate (8 scripts
  × parse-roundtrip)
- **iter 92** — MCP enum aligned with SEVERITY_RANK (subset+complement
  check)

### Fleet status (post-iter-99 / 100-iter milestone)

- Smoke step count: 85 → 102 (+17 since iter 82)
- MCP tool runtime contract: 117 → 120 assertions
- Real-data roundtrip: 66 (12 stages, unchanged since iter 79)
- Unit tests: 94 (similarity + severity + parser)
- Compat tripwires: 3 (router API / mcp-scan text / fingerprint schema)
- Cross-reference integrity surfaces: 8 smoke-gated
- Negative-guard invariants: 3 smoke-gated
- Bench scripts in CI with artifact tracking: 2
  (bench-similarity, bench-parse-mcp-scan; both produce parseable JSON)
- 33/33 plugin fleet still green
- CI workflows: 4 (metaharness-ci, no-metaharness-smoke,
  oia-audit-weekly, metaharness-real-data)
- ~290 total ruflo-metaharness smoke assertions

### 100-iter retrospective

The integration shipped across 100 /loop iterations spanning the major
arcs documented above. Two patterns emerged that are worth naming:

1. **Bug-discovery via end-to-end tests** (iters 47-51, 87) — every
   significant latent bug surfaced when a test exercised the REAL
   CLI/MCP chain end-to-end, not when smoke greps verified source
   markers. iter-47's schema bug hid for 9 iters; iter-50's parser
   gap hid for 28 iters; iter-87's JSON-contamination hid for 5 iters.
   The lesson: smoke-grep on source is a complement to, not a
   substitute for, real-output verification.

2. **Cross-reference integrity** (iters 73, 84, 89-94) — when one
   source file references another by name, drift is the default
   without an explicit gate. Eight surfaces are now gated; each
   produces a specific named failure when the reference rots.

The dep is now: production code with 14+ surfaces, 102 smoke steps,
120 MCP runtime assertions, 66 roundtrip pipeline assertions, 94 unit
tests, 8 cross-reference gates, 3 negative-guard invariants, 3 compat
tripwires, 4 CI workflows, weekly autonomous drift detection, two
upstream issues filed (#15, #16, both still open).

### Quote architecture invariant — no static metaharness imports

The single non-test ruflo source file that statically imports a
`@metaharness/*` package is:

```
v3/@claude-flow/cli/src/ruvector/neural-router.ts  ← @metaharness/router
                                                     (dynamic import,
                                                      triple-gated)
```

All other ruflo code reaches MetaHarness exclusively through the
`_harness.mjs` subprocess bridge. The `no-metaharness-smoke.yml`
workflow continually enforces this with both a static grep (every
package.json) and a runtime drill (each skill against an unresolvable
npm registry, asserting graceful degradation).

## References

- [Research dossier (gist)](https://gist.github.com/ruvnet/19d166ff9acf368c9da4172d91ac9113) — full graded-evidence sourcing.
- [Tracking issue #2399](https://github.com/ruvnet/ruflo/issues/2399) — phase checklist.
- ADR-148 — Cost-optimal router lifecycle via `@metaharness/router`.
- ADR-149 — Per-model cost-optimal routing (Pareto framing).
- ADR-097 — Federation budget circuit breaker (cost-spend telemetry pattern reused by metaharness plugin).
- `metaharness@0.1.11` on npm: <https://www.npmjs.com/package/metaharness>
- `@metaharness/router@0.3.2` on npm: <https://www.npmjs.com/package/@metaharness/router>
- `@metaharness/kernel@0.1.0` on npm: <https://www.npmjs.com/package/@metaharness/kernel>
- Upstream: <https://github.com/ruvnet/agent-harness-generator>
