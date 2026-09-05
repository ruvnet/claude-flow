# ADR-151 — Harness Intelligence Layer (Phase 3 scope shell)

**Status**: Proposed (scope-only; each sub-capability gets its own ADR)
**Date**: 2026-06-16
**Related**: ADR-150 (MetaHarness Integration Surfaces — Phase 1+2 implemented across iters 1–32 on `feat/metaharness-integration-research`)
**Successor**: each Phase-3 capability below will be assigned its own ADR-152, 153, 154, 155, 156 once it moves from "scope" to "decided"
**Architectural inheritance**: this ADR explicitly inherits ADR-150's four load-bearing constraints. Every sub-ADR MUST honor them or supersede them.

## Context

ADR-150 Phase 1+2 shipped (32 /loop iterations on the integration branch). The visible result: ruflo can score / scaffold / audit / route / diff harnesses via plugin skills, top-level CLI subcommands, MCP tools, and CI workflows. The latent result: the static-analysis surface (`harness score`, `harness genome`, `harness mcp-scan`, `harness threat-model`, `harness oia-manifest`) produces structured per-harness fingerprints — and we are now accumulating those fingerprints over time via the iter-7 `oia-audit` worker.

A fingerprint is a vector. Vectors enable similarity. Similarity enables a class of capabilities that don't exist anywhere else in the agent-framework space today, all built on the same already-shipped instrumentation:

- "Find the closest existing harness to this repo."
- "Recommend the smallest delta from a template that would harness-fit this team's needs."
- "Alert when fleet-wide harness drift exceeds a threshold."
- "Map every capability across N internal harnesses — find duplicates, find gaps."
- "Predict whether plugin X will work in harness Y."

ADR-150's Phase-3 section listed these as scope-only with the rule "each gets its own ADR before implementation." This ADR is the parent: it catalogs them, establishes the architectural invariants they all inherit, and orders them by build-on dependency so future implementation work has a clear sequence.

## Decision

Adopt the **Harness Intelligence Layer** as a Phase-3 capability cluster, scoped to five sub-capabilities below. Each sub-capability:

1. Inherits all four ADR-150 architectural constraints (removable / optional-only / graceful / CI-gate).
2. Gets its own ADR before implementation begins.
3. Must measure its value against the existing instrumentation it builds on — no new metric inventions allowed at this layer; every claim resolves to a number `harness score` / `genome` / `threat-model` / `oia-audit` already emits.
4. May not assume a centralized fleet-tracking server. Operate over what's locally inspectable + what's published to the IPFS-pinned ruflo plugin registry (which iter-6 made `type: 'harness'`-aware).

### Phase-3 sub-capabilities (in implementation-dependency order)

#### 3.1 — Genome Similarity Search ([ADR-152](ADR-152-genome-similarity-search.md), ACCEPTED iter 35 — spike landed, both invariants pass)

**What:** Given two harnesses (or one harness + a candidate repo), compute a similarity score across the 7 genome sections and the 5 scorecard dimensions. Return a normalized 0..1 number plus a per-dimension breakdown.

**Who it serves:** Devs evaluating "is this repo close enough to harness X that I should fork-and-adapt vs scaffold-from-scratch?"

**Builds on:** `harness genome <repo>` (iter-1 wired) + `harness score <repo>` (iter-1 wired) + ruflo's existing embeddings infrastructure for tokenized text (e.g. the repo's README, agent prompts).

**Riskiest assumption:** that the 7-section genome + 5-dim scorecard are sufficient signal for similarity. Counter-evidence would be two harnesses with identical genomes but radically different behavior. Mitigation: include a behavioral fingerprint from `harness threat-model` (the categorized findings) as a tie-breaker.

**Smallest demonstrable spike:** cosine similarity between two `metaharness genome` JSON outputs. Pure-function, zero deps beyond what's already in ruflo.

#### 3.2 — Harness Recommendation Engine (ADR-153)

**What:** Given a repo + a user description, recommend (a) the closest existing harness in the registry, (b) the closest template, (c) the minimum delta to fork from either. Output is an ordered list with confidence scores.

**Who it serves:** Users approaching ruflo for the first time. Currently `ruflo init` produces a generic scaffold; this would let `ruflo init --recommend` propose a *specific* harness.

**Builds on:** 3.1 (similarity search) + the IPFS-pinned ruflo plugin registry's `type: 'harness'` entries (iter-6) + `metaharness analyze` for the no-exec recommendation path.

**Riskiest assumption:** that user descriptions are reliable signal. Most users describe what they *think* they want, not what they need. Mitigation: weight repo-genome evidence over user-description at the recommender's confidence calculation.

**Smallest demonstrable spike:** seed the recommender with the 13 metaharness verticals (devops, support, legal, etc.) + ruflo itself. Test on 5 real OSS repos. Compare to a human's recommendation.

#### 3.3 — Fleet-Wide Architecture Drift Detection (ADR-154)

**What:** For organizations running multiple harnesses, track per-harness genome over time and alert when any one drifts beyond a threshold from its template lineage. Lift iter-15's `audit-trend` from single-harness drift to fleet-wide drift.

**Who it serves:** Enterprise-scale users with 5+ harnesses where each was originally forked from a template and is now diverging individually.

**Builds on:** iter-7's `oia-audit` worker (already accumulates timestamped records per harness) + iter-15's `audit-trend` (already diffs two records) + the recommender's similarity score (3.1).

**Riskiest assumption:** that drift is bad. Sometimes drift is healthy specialization. Mitigation: surface drift as informational unless it crosses BOTH a structural-distance threshold AND a regression in `threat-model worst` — coupling fights false positives.

**Smallest demonstrable spike:** the existing `audit-trend` already does this for one harness; extend the JSON shape to accept a list of harness keys.

#### 3.4 — Cross-Harness Capability Graph (ADR-155)

**What:** Given a fleet of harnesses, emit a graph where nodes are capabilities (skills, MCP tools, agent roles) and edges are "X harness includes capability Y". Lets ops answer "which harness has the closest capability set to this new task?" without leaving the registry.

**Who it serves:** Multi-harness orgs deciding where new work belongs.

**Builds on:** `harness compare <a> <b>` (already exists upstream — manifest diff + per-file fingerprint) + the iter-6 plugin-registry harness entries + 3.1 similarity for ranked traversal.

**Riskiest assumption:** that capability lists are stable and orthogonal. They aren't — overlap and aliasing are the norm. Mitigation: cluster capabilities by behavioral fingerprint (use embeddings on the SKILL.md descriptions), not by name.

**Smallest demonstrable spike:** walk `npx ruflo plugins list --type harness --format json` (works post-iter-6) and dump nodes+edges to a flat JSON. Visualize separately.

#### 3.5 — Plugin Compatibility Analysis (ADR-156)

**What:** Given a `plugins/X/` and a target harness, predict whether the plugin's `allowed-tools` requirements are satisfied by the harness's MCP server declarations + agent roles. Return verdict: `{compatible: bool, missingTools: [...], policyConflicts: [...]}`.

**Who it serves:** Plugin authors checking distribution targets; harness maintainers vetting incoming plugin proposals.

**Builds on:** the iter-87 SKILL.md frontmatter audit (already enforces `allowed-tools` is non-empty) + iter-30's mcp-policy schema (already declares what's allowed/denied) + 3.1 similarity (for "closest compatible harness if this one fails").

**Riskiest assumption:** that static `allowed-tools` declarations are reliable. Plugins sometimes use tools they didn't declare. Mitigation: cross-check declarations against actual MCP-tool-call audit logs (the iter-7 `oia-audit` records include MCP usage in its threat-model output).

**Smallest demonstrable spike:** read `plugins/X/skills/*/SKILL.md::allowed-tools`, intersect with target harness's `.claude/settings.json::mcpServers`, return the set difference.

## Architectural Inheritance from ADR-150

Every Phase-3 sub-ADR MUST satisfy the four load-bearing constraints from ADR-150, repeated here for explicit inheritance:

1. **Removable** — `npm ls --without @metaharness/*` must still produce a working CLI. Phase-3 capabilities may NOT introduce a static `@metaharness/*` import on the boot path. The single allowed exception remains `v3/@claude-flow/cli/src/ruvector/neural-router.ts` (dynamic import, triple-gated).

2. **Optional in package.json** — every `@metaharness/*` package goes in `optionalDependencies` or `peerDependencies` (optional), never `dependencies`. Static-grep enforced by `no-metaharness-smoke.yml`.

3. **Graceful degradation** — every Phase-3 code path catches `MODULE_NOT_FOUND` and emits a structured degraded payload. The reference implementation is `_harness.mjs::emitDegradedJsonAndExit` (iter 1, fixed iter 27).

4. **CI gate on the absent path** — at least one CI job runs without any `@metaharness/*` installed and asserts the system continues to function. `no-metaharness-smoke.yml` already does this; Phase-3 work extends its drill list.

A sub-ADR that breaks any of these is a breaking change that requires its own meta-ADR superseding ADR-150's constraint clause.

## Consequences

### Positive

- Establishes a **build-on dependency order** for the five Phase-3 capabilities, so implementation can start on 3.1 immediately and the others can be planned in parallel without coordination overhead.
- Phase-3 work is **scope-only** — no code lands until each sub-ADR is decided. Avoids the trap of letting the architecture grow ahead of the use case.
- Inheritance from ADR-150's four constraints means Phase-3 capabilities can NEVER become a hard runtime dependency, no matter how useful they get. The boundary is permanent.
- Every Phase-3 capability **builds on already-shipped instrumentation** (genome, score, threat-model, mcp-scan, oia-audit, audit-trend, plugin-registry harness entries). No new measurement layer required — the existing ones are sufficient signal.

### Negative / risks

- **Scope creep**: a parent ADR for five capabilities risks the trap of "well, since we're planning all this, let's just build it." Mitigation: this ADR is explicitly scope-only; no code lands without a sub-ADR.
- **Capability overlap**: 3.1 (similarity) is used by 3.2, 3.3, and 3.5 — making 3.1 a critical path. Mitigation: ship 3.1 first as a standalone; only THEN attempt to layer on the consumers.
- **Recommender confidence inflation**: a recommendation engine that says "I'm 99% sure this template fits" when the actual signal is noisy is worse than no recommender. Mitigation per 3.2: weight repo-genome evidence over user-description.

### Neutral

- The Harness Intelligence Layer doesn't change ruflo's runtime behavior. It's all about helping humans + agents make better choices about WHICH harness to use, BEFORE the harness runs. Strictly additive to the existing flow.

## Open Questions (for sub-ADR authors)

- Should Phase-3 capabilities live in `plugins/ruflo-metaharness/` or a new `plugins/ruflo-harness-intelligence/` plugin? Lean toward the latter — clean separation of "wrap upstream metaharness" (existing) from "compute similarity/recommendation atop it" (new).
- Should the recommendation engine (3.2) be invocable as an MCP tool, so Claude Code agents can call it during conversation? Strong yes — that's the deepest integration.
- Should fleet drift (3.3) be a paid/enterprise feature? Lean no — drift detection is a defensive capability and gating it behind a paywall hurts adoption of the underlying observability.
- Should the capability graph (3.4) export to standard graph formats (DOT, GraphML, Mermaid) or stay in JSON only? Probably JSON + a thin renderer skill; visualizers are a separate tool category.

## References

- [ADR-150](ADR-150-metaharness-integration-surfaces.md) — Phase 1+2 implementation (32 /loop iterations on `feat/metaharness-integration-research`)
- [Issue #2399](https://github.com/ruvnet/ruflo/issues/2399) — phase tracker
- [Research dossier](https://gist.github.com/ruvnet/19d166ff9acf368c9da4172d91ac9113) — graded evidence per claim
- [OIA implementation walkthrough](https://gist.github.com/ruvnet/9056701d13d5a5b5148d0459ff10b7c3) — plain-language guide
- [`ruvnet/agent-harness-generator`](https://github.com/ruvnet/agent-harness-generator) — upstream MetaHarness
