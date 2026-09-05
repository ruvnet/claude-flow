# ADR-153 — `@metaharness/darwin` (Darwin Mode) integration: population-based harness self-improvement in ruflo

**Status**: Proposed
**Date**: 2026-06-17
**Related**: [ADR-150](ADR-150-metaharness-integration-surfaces.md) (MetaHarness integration surfaces), [ADR-151](ADR-151-harness-intelligence-layer.md) (harness intelligence layer), [ADR-152](ADR-152-genome-similarity-search.md) (genome similarity), [ADR-148](ADR-148-cost-optimal-router-lifecycle.md) (router lifecycle), ADR-103 (witness-signed releases), ADR-144 (agent-authorization-propagation)
**Upstream package**: [`@metaharness/darwin@0.1.0`](https://www.npmjs.com/package/@metaharness/darwin) (MIT, zero runtime deps, 266 KB, published 2026-06-17)
**Upstream ADRs**: ADR-070…075 in [`ruvnet/agent-harness-generator/packages/darwin-mode`](https://github.com/ruvnet/agent-harness-generator/tree/main/packages/darwin-mode)
**Affects**: `@claude-flow/cli`, `ruflo` wrapper, `plugins/ruflo-metaharness/`

## Tagline

> **The model is frozen; the harness evolves.**

## Context

[ADR-150](ADR-150-metaharness-integration-surfaces.md) integrated `metaharness`, `@metaharness/router`, and `@metaharness/kernel` as the **read** + **routing** layers of harness analysis: score, genome, mcp-scan, threat-model, oia-audit, similarity, drift detection. Those surfaces let ruflo *describe* a harness; none of them *change* one.

`@metaharness/darwin@0.1.0` is the **write** layer. It implements the Darwin Gödel Machine pattern at the harness level: generate child variants of a harness's policy surfaces, sandbox-score them, archive the lineage, and promote only **measured, safe** wins. The foundation model never changes; the operating system around it (planner, context builder, reviewer, retry/tool/memory/score policy) does.

This closes the loop ADR-150 opened. Score+genome+audit tell you where the harness is. Darwin Mode tells you which mutation makes it provably better, without retraining anything.

### What Darwin Mode is (concretely)

```
repo
  → profile      RepoProfile (pkg mgr, test cmd, source/risk files)
  → baseline     generate the seven mutation-surface files
  → mutate       pick ONE approved surface, perturb it (behind the gate)
  → sandbox      safety-inspect → run the test command (no shell, no net, no secrets)
  → score        weighted base score − hard penalty layer
  → archive      record parent→child as a TREE (not a single best branch)
  → select       sample the next generation from the WHOLE archive
  → repeat
```

The CLI is one verb: `metaharness-darwin evolve <repo> [--generations N] [--children N] [--concurrency N] [--seed N]`.

Output lands under `<repo>/.metaharness/{archive.json, lineage.json, variants/, runs/, reports/winner.json}`. The archive is a *tree*, not a flat list — see [ADR-073](https://github.com/ruvnet/agent-harness-generator/blob/main/packages/darwin-mode/docs/adr/ADR-073-archive-tree.md) (upstream). Sampling the next generation from the **whole archive** prevents premature convergence onto a single lineage.

### The seven mutation surfaces

Authoritative per upstream `safety.ts` / [ADR-071](https://github.com/ruvnet/agent-harness-generator/blob/main/packages/darwin-mode/docs/adr/ADR-071-mutation-surfaces.md):

| Surface | What it owns |
|---|---|
| `planner` | task decomposition / step ordering policy |
| `contextBuilder` | what gets fed into the prompt |
| `reviewer` | self-critique / verification of agent output |
| `retryPolicy` | when + how to retry on failure |
| `toolPolicy` | which tools the agent may use under which conditions |
| `memoryPolicy` | what to persist, what to recall, what to forget |
| `scorePolicy` | how the agent grades its own output |

A variant is **a single mutation to a single surface**. Multi-surface mutations are not allowed in 0.1.0 — one degree of freedom per generation keeps the causal attribution clean.

### Safety model (load-bearing)

Darwin Mode writes generated code into variant directories. Before any variant runs:

1. **Static inspection** — `inspectVariant(dir)` rejects nested dirs, symlinks, non-regular files, filename or content matching blocked patterns (secrets, VCS keys, shell-out, network, env, dynamic-eval).
2. **Content validation** — `validateGeneratedCode(code)` runs BEFORE write, independent of inspection (defense in depth).
3. **Sandbox** — variants run via the test command with **no shell, no net, no secrets**.
4. **Penalty layer** — secret-exposure, destructive-action, hallucinated-file, tool-loop, cost-overrun each subtract from the score. A variant scoring less than the parent (by `promotionDelta`) is NOT promoted.

Exit code 99 is reserved for "disqualified by safety". This is a designed-in tripwire, not an exception.

## Decision

**Integrate `@metaharness/darwin` as `ruflo`'s harness-evolution layer, behind the same four ADR-150 architectural constraints (removable / optional / graceful / CI-gate).** Specifically:

1. Add `@metaharness/darwin@~0.1.0` to `optionalDependencies` of `@claude-flow/cli` + `ruflo` wrapper. **Never** to `dependencies`.
2. Expose a new CLI surface: `npx ruflo evolve <repo>` (top-level, mirroring `ruflo eject`) → delegates to the `metaharness-darwin evolve` binary via `runScript`-style spawn. ADR-150's `metaharness mint` is the **birth** verb; `eject` is the **rename** verb; **evolve** is the **growth** verb.
3. Expose a new MCP tool: `mcp__claude-flow__metaharness_evolve` with the same `{success, data, degraded, exitCode}` contract as the other 9 metaharness tools.
4. Stay graceful: when `@metaharness/darwin` is uninstalled, both the CLI and the MCP tool degrade with `{degraded: true, reason: 'metaharness-darwin-not-installed', hint: 'npm i -D @metaharness/darwin@latest'}` and exit 0 — same pattern as the other metaharness optional surfaces.
5. **DO NOT auto-evolve `ruflo` itself in CI.** Darwin Mode is a human-initiated *operation* on a harness; it's not a continuous background optimization. The CI gate verifies graceful degradation, not that an evolution converges.

## Architecture (the 4 constraints, restated for darwin)

| # | Constraint | Enforcement |
|---|---|---|
| 1 | **Removable** | `npm ls --without @metaharness/darwin` must produce a working CLI. Verified by `.github/workflows/no-metaharness-smoke.yml`'s drill (extend to include darwin). |
| 2 | **Optional in `package.json`** | Add to `optionalDependencies`, never `dependencies`. Smoke 17z74 (cross-file pin alignment) extended to cover `@metaharness/darwin`. |
| 3 | **Graceful degradation** | CLI's `ruflo evolve` + MCP `metaharness_evolve` catch `MODULE_NOT_FOUND` from the darwin spawn and emit the standard degraded payload (mirrors `score.mjs`, `genome.mjs`, etc.). |
| 4 | **CI gate** | Extend `metaharness-ci.yml` with a new `darwin-dryrun` job: runs `metaharness-darwin evolve --generations 1 --children 1 --concurrency 1 --seed 0` against a tiny seed repo, asserts the archive.json + lineage.json + winner.json artifacts exist. Wall-clock budget: 5 minutes. |

## Surfaces to add (Phase 1 MVP)

### CLI

```
npx ruflo evolve <repo> [--generations N] [--children N] [--concurrency N] [--seed N] [--dry-run]
```

Flags pass through to `metaharness-darwin evolve` unchanged except for `--dry-run`, which short-circuits at the profile step and prints the would-be plan without writing under `<repo>/.metaharness/`. The first run on a repo prints a one-time **safety summary** (the seven surfaces, the blocked patterns, the sandbox model) so users know what's about to happen.

### MCP tool

```ts
{
  name: 'metaharness_evolve',
  description: 'ADR-153 — population-based self-improvement of an agent harness. ' +
    'Generates child variants by mutating ONE of seven approved policy surfaces ' +
    '(planner/contextBuilder/reviewer/retryPolicy/toolPolicy/memoryPolicy/scorePolicy), ' +
    'sandbox-scores them, archives the lineage as a tree, and returns the winner + ' +
    'lineage. Model is frozen; harness evolves. Use when you have a measurable ' +
    'benchmark (test command) and want empirical improvement of the agent OS around ' +
    'the model without retraining the model. Manually-tweaking-prompts is wrong ' +
    'because (a) you lose the lineage record, (b) you skip the safety inspector that ' +
    'rejects secret-exposure/destructive-action patterns BEFORE running, and (c) the ' +
    'promotion gate prevents noise-driven regressions.',
  category: 'metaharness',
  inputSchema: {
    type: 'object',
    properties: {
      path:         { type: 'string', description: 'Repo to evolve (default: cwd)', default: '.' },
      generations:  { type: 'number', description: 'Number of generations', default: 3 },
      children:     { type: 'number', description: 'Children per parent per generation', default: 4 },
      concurrency:  { type: 'number', description: 'Max variants evaluated concurrently', default: 4 },
      seed:         { type: 'number', description: 'Deterministic seed for mutation selection', default: 0 },
      dryRun:       { type: 'boolean', description: 'Profile + plan only, no variants written', default: false },
    },
  },
  handler: async (input) => {
    const args = [...];
    const r = await runScript('evolve.mjs', args);   // wrapper around metaharness-darwin evolve
    return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
  },
}
```

### Plugin script

`plugins/ruflo-metaharness/scripts/evolve.mjs` — thin spawn wrapper that:

1. Tries `await import('@metaharness/darwin')` — if it throws `MODULE_NOT_FOUND`, emit degraded payload, exit 0.
2. Spawns the `metaharness-darwin` binary with the forwarded args.
3. After completion, reads `<repo>/.metaharness/reports/winner.json` and includes it in the JSON output as `winner`.
4. Includes the leaderboard (top-N from `archive.json`, scored descending) so the user can see WHY the winner won.

### Doctor extension

`npx ruflo doctor --component metaharness` already reports `metaharness` / `@metaharness/router` / `@metaharness/kernel`. Extend it to surface `@metaharness/darwin` availability + a quick `metaharness-darwin --version` smoke.

## Phase rollout

| Phase | Scope | Gate |
|---|---|---|
| **1** (this ADR, MVP) | CLI `ruflo evolve`, MCP `metaharness_evolve`, plugin script, doctor entry, smoke + CI dry-run job | All four ADR-153 constraints green |
| **2** | Witness-sign winning archives (ADR-103) so a promoted variant carries cryptographic provenance | ADR-103 manifest schema extension |
| **3** | Federated archives — share lineage trees across ruflo installations via the IPFS pattern from `hooks transfer` | ADR-097 federation budget integration |
| **4** | Surface mutation-surface choice as a per-repo policy: "evolve only contextBuilder + memoryPolicy, leave my planner alone" | Policy file `.metaharness/policy.json` |

Phases 2–4 are out of scope for this ADR; tracked as follow-ups.

## What this does NOT do

1. **Does not change ruflo's model layer.** No fine-tuning, no LoRA, no embedding training. The model is frozen — that's the entire point.
2. **Does not auto-evolve ruflo in CI.** Evolution is a user-initiated operation. CI verifies graceful degradation + the dry-run path, never the actual evolve.
3. **Does not bypass any existing safety.** Darwin's safety inspector is additive to ruflo's existing CVE / threat-model / mcp-scan checks. ADR-150's `mcp-scan` runs against the harness's CURRENT mcp surface; Darwin runs against generated variants BEFORE they execute.
4. **Does not promote across machines.** Each repo's `.metaharness/` is local. Phase 3 (federation) is the future answer.
5. **Does not mutate ruflo's own seven surfaces.** When you run `ruflo evolve <some-other-repo>`, Darwin mutates THAT repo's harness surfaces. Running `ruflo evolve .` against the ruflo repo itself works (it's just a repo), but the variants land under `./.metaharness/variants/`, not in `v3/@claude-flow/cli/src/`. Promoting a variant means *manually copying it back* — and going through normal PR review. This is deliberate: ADR-103 + the witness manifest still gate every commit to `main`.

## Consequences

### Positive

- **Closes the read-write loop.** ADR-150's measurements feed Darwin's selection pressure; Darwin's archive feeds ADR-152's similarity search.
- **No new runtime dependency.** Darwin is `optionalDependencies`. Users who don't install it never pay for it.
- **Zero-dep, Node-built-in-only upstream.** `@metaharness/darwin` has no transitive deps — install footprint is just the package itself. No CVE chain, no postinstall scripts.
- **Empirically grounded.** Variants are scored by running the user's actual test command. There's no "we believe this is better" claim; only "this variant beat the parent by Δ on the benchmark."
- **Composable with the rest of the metaharness surface.** A user can `oia-audit → drift-from-history → evolve` as a single pipeline: audit, detect regression, evolve to recover.

### Negative

- **Time + compute.** A 3-generation × 4-children evolution runs 12 sandboxed variants. Each variant runs the test command at least once. For ruflo's own test suite (~3 minutes) that's 36+ minutes per evolution. Document this honestly.
- **Sandbox tax.** Darwin's safety inspector rejects variants that touch the filesystem, network, env, etc. — perfectly correct, but it means **mutation surfaces are limited to pure policy logic**. Anything that needs side effects (e.g., a `memoryPolicy` that wants to flush an external cache) won't survive inspection. This is by design; mention it prominently.
- **Lineage tree storage.** The `.metaharness/` directory grows linearly with generations × children × surfaces. Phase 4 will need a `--prune` flag and an archive retention policy.

### Neutral

- **Upstream coupling.** `@metaharness/darwin@~0.1.0` is in `optionalDependencies` with a **tilde pin** (matches ADR-150's iter-110 tilde-pin invariant). Upstream API changes within 0.1.x land cleanly; 0.2.x is opt-in via a deliberate range bump + smoke regen.

## Implementation notes

### Pin

```diff
// v3/@claude-flow/cli/package.json + ruflo/package.json
"optionalDependencies": {
+  "@metaharness/darwin": "~0.1.0",
   "@metaharness/kernel":  "~0.1.0",
   "@metaharness/router":  "~0.3.2",
   "metaharness":          "~0.1.11"
}
```

### Smoke (graceful-degradation drill)

Extend `plugins/ruflo-metaharness/scripts/smoke.sh` with:

```bash
step "18. metaharness evolve CLI + MCP tool present + graceful degradation (ADR-153)"
miss=""
# CLI surface
CLI="$ROOT/../../v3/@claude-flow/cli/src/commands/metaharness.ts"
grep -q "'evolve'" "$CLI" 2>/dev/null || miss="$miss no-evolve-subcommand"
# MCP tool
TOOLS="$ROOT/../../v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts"
grep -q "name: 'metaharness_evolve'" "$TOOLS" 2>/dev/null || miss="$miss no-evolve-mcp-tool"
# Plugin script
[[ -x "$ROOT/scripts/evolve.mjs" ]] || miss="$miss no-evolve-script"
# Optional dep in all 3 pkg.json
for pj in "$ROOT/../../package.json" "$ROOT/../../ruflo/package.json" "$ROOT/../../v3/@claude-flow/cli/package.json"; do
  grep -q "@metaharness/darwin" "$pj" 2>/dev/null || miss="$miss no-darwin-pin-in-$(basename $(dirname $pj))"
done
# Runtime: degraded path emits the right shape
OUT=$(NODE_PATH=/tmp/no-darwin node "$ROOT/scripts/evolve.mjs" --dry-run --format json 2>/dev/null)
echo "$OUT" | grep -q '"degraded": true' || miss="$miss no-degraded-path"
echo "$OUT" | grep -q '"reason": "metaharness-darwin-not-installed"' || miss="$miss wrong-degraded-reason"
[[ -z "$miss" ]] && ok || bad "$miss"
```

### CI (`metaharness-ci.yml` extension)

```yaml
darwin-dryrun:
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - name: Install @metaharness/darwin
      run: npm install --no-save @metaharness/darwin@latest
    - name: Dry-run evolve on a minimal seed repo
      run: |
        mkdir -p /tmp/seed && cd /tmp/seed
        echo '{"name":"seed","scripts":{"test":"exit 0"}}' > package.json
        npx @metaharness/darwin evolve . \
          --generations 1 --children 1 --concurrency 1 --seed 0
        test -f /tmp/seed/.metaharness/archive.json
        test -f /tmp/seed/.metaharness/lineage.json
        test -f /tmp/seed/.metaharness/reports/winner.json
        echo "✓ darwin dry-run produces all 3 artifacts"
```

### CLAUDE.md surface

Add to the MetaHarness section in `CLAUDE.md`:

```
# CLI subcommands (npx ruflo metaharness …)
…existing list…

# Dedicated commands
npx ruflo eject  --name foo --confirm        # ADR-150 Phase 2
npx ruflo evolve <repo> [--generations N]    # ADR-153 — Darwin Mode

# MCP tools
…existing list…
mcp__claude-flow__metaharness_evolve            # ADR-153 — population-based self-improvement
```

## Open questions

1. **Surface name: `evolve` vs `metaharness evolve`.** Going with top-level `ruflo evolve` (mirroring `ruflo eject`) because Darwin Mode is operationally distinct from the read-only `metaharness *` cluster. If users find that confusing, fold it back under `metaharness evolve` in a later patch.
2. **How to handle `--generations` budget on real repos.** A user typing `ruflo evolve` against their production codebase shouldn't accidentally run a 4-hour evolution. Default to a conservative `--generations 1` with a one-line "increase with --generations N" hint. The benchmark CI uses the same defaults to anchor expectations.
3. **What's the winner-promotion ceremony?** v0.1.0 of darwin just leaves the winner under `.metaharness/`. Phase 2 (witness-signed archives) is the right home for "promote this variant to a PR". Don't preempt that here.
4. **Does the archive land in ruflo's intelligence layer?** ADR-151 §3.2 (Recommender) could consume Darwin archives as additional training signal. Out of scope for Phase 1 — flag as a Phase 4 candidate.

## Cross-references

- [ADR-150](ADR-150-metaharness-integration-surfaces.md) — MetaHarness integration surfaces (the read layer; this ADR is the write layer)
- [ADR-151](ADR-151-harness-intelligence-layer.md) — Harness intelligence layer (the recommender that could consume Darwin archives)
- [ADR-152](ADR-152-genome-similarity-search.md) — Genome similarity (the metric Darwin's archive should ALSO be evaluated against, not just task success)
- [ADR-148](ADR-148-cost-optimal-router-lifecycle.md) — Router lifecycle (the policy Darwin mutates is the same one ADR-148 optimizes)
- ADR-103 — Witness-signed releases (Phase 2 dependency)
- ADR-144 — Agent authorization propagation (relevant when Darwin variants are run with restricted credentials in the sandbox)
- **Upstream**: [`@metaharness/darwin@0.1.0`](https://www.npmjs.com/package/@metaharness/darwin) on npm · [`ruvnet/agent-harness-generator/packages/darwin-mode`](https://github.com/ruvnet/agent-harness-generator/tree/main/packages/darwin-mode) on GitHub · upstream ADR-070…075 for the design rationale

## Tracking

Open a tracking issue with the Phase 1 checklist:

- [ ] Add `@metaharness/darwin@~0.1.0` to all 3 `package.json` `optionalDependencies`
- [ ] Add `plugins/ruflo-metaharness/scripts/evolve.mjs`
- [ ] Add `'evolve'` to `SUBCOMMANDS` in `v3/@claude-flow/cli/src/commands/metaharness.ts` (OR top-level `evolve.ts` mirroring `eject.ts`)
- [ ] Add `metaharness_evolve` to `v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts` with ADR-112 "Use when" guidance
- [ ] Extend `npx ruflo doctor --component metaharness` to report darwin availability
- [ ] Add `darwin-dryrun` job to `.github/workflows/metaharness-ci.yml`
- [ ] Extend `plugins/ruflo-metaharness/scripts/smoke.sh` with step 18 (above)
- [ ] Extend `no-metaharness-smoke.yml` to verify graceful degradation when `@metaharness/darwin` is absent
- [ ] Update `CLAUDE.md` MetaHarness section with `ruflo evolve` + `metaharness_evolve`
- [ ] Update `docs/metaharness-user-guide.md` with a "Darwin Mode" section
