# ruflo-metaharness

MetaHarness integration plugin for ruflo. Surfaces the upstream `metaharness` / `harness` / `@metaharness/darwin` CLIs through eleven ruflo skills, honoring [ADR-150](../../v3/docs/adr/ADR-150-metaharness-integration-surfaces.md)'s architectural constraint that MetaHarness must remain a removable augmentation — never a required runtime dependency.

## ADR-150 architectural constraint (load-bearing)

**Ruflo remains operational if every MetaHarness package is removed.** Every code path in this plugin satisfies four rules:

1. **Removable** — no static `import '@metaharness/*'` outside the optional-router path in `v3/@claude-flow/cli/src/ruvector/neural-router.ts`.
2. **Optional in package.json** — `metaharness` is in `optionalDependencies`, never `dependencies`.
3. **Graceful degradation** — every script catches `MODULE_NOT_FOUND`/network failure and emits `{ degraded: true, reason: 'metaharness-not-available' }` JSON, exits 0. The graceful path is the default behavior, not a special case.
4. **CI gate** — `no-metaharness-smoke.yml` runs the plugin smoke with `npm install --no-optional` and asserts the contract still passes.

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `harness-score` | `/harness-score [--path .] [--alert-on-fit-below 70]` | 5-dim readiness scorecard (harnessFit/compile/coverage/safety/memory + cost) |
| `harness-genome` | `/harness-genome [--path .] [--alert-on-risk-above 0.5]` | 7-section categorical report (repo_type/topology/risk/mcp/test/publish) |
| `harness-mcp-scan` | `/harness-mcp-scan [--path .] [--fail-on high]` | Static MCP security findings — pure-read, no dispatch |
| `harness-threat-model` | `/harness-threat-model [--path .] [--fail-on high]` | Enterprise-grade threat model (clean/low/medium/high + findings) |
| `harness-mint` | `/harness-mint --name <id> --template <id> [--confirm]` | Scaffold a custom harness; DRY-RUN by default; refuses project-root writes |
| `harness-similarity` | `/harness-similarity --a a.json --b b.json [--per-dimension] [--alert-below 0.5]` | ADR-152 §3.1 weighted similarity between two harness fingerprints (cosine + categorical + jaccard) |
| `harness-oia-audit` | `/harness-oia-audit [--path .] [--alert-on-worst high] [--dry-run]` | Composite Phase-2 audit (oia-manifest + threat-model + mcp-scan) into `metaharness-audit` namespace |
| `harness-drift-from-history` | `/harness-drift-from-history [--baseline-since 7d] [--threshold 0.95]` | 1-command drift detection — composes audit-list + oia-audit + audit-trend |
| `harness-bench` | `/harness-bench --op create\|verify --repo <path>` | Manage `@metaharness/darwin` bench suites — fixed evaluation corpora for `harness-evolve` |
| `harness-evolve` | `/harness-evolve --repo <path> [--generations 3] [--sandbox real\|mock\|agent]` | Run `@metaharness/darwin evolve` — mutate seven policy surfaces, sandbox-score variants, promote measured wins |
| `harness-security-bench` | `/harness-security-bench [--population 2] [--cycles 1] [--alert-on-fail]` | "Darwin Shield" / ADR-155 — evolve a security-detection harness against a 10-vuln corpus |
| `harness-learn` | `/harness-learn --host <h> --model <m> --slice <manifest> [--repo <checkout>] [--run]` | metaharness@0.3.0 / upstream ADR-235 — GEPA learning run; $0 dry-run default, `--run` to spend; needs a metaharness repo checkout |
| `harness-gepa` | `/harness-gepa --op genome\|validate\|render\|analyze [--path <genome.json>]` | darwin@0.8.0 GEPA library surface — genome load/validate/render + transcript failure analysis; `gepaOptimize` stays library-only |

## Phase-0 baseline (ruflo itself, 2026-06-16)

```json
{
  "harnessFit": 82,
  "compileConfidence": 100,
  "taskCoverage": 79,
  "toolSafety": 100,
  "memoryUsefulness": 40,
  "estCostPerRunUsd": 0.048,
  "recommendedMode": "CLI + MCP",
  "archetype": "typescript-sdk-harness",
  "template": "vertical:coding",
  "scaffoldReady": true,
  "risk_score": 0.27,
  "publish_readiness": 0.9
}
```

## Architecture

All skills use subprocess invocation through the `_harness.mjs` shared helper:

```
skills/X/SKILL.md → scripts/X.mjs → scripts/_harness.mjs → spawnSync('npx', ['metaharness', …])
                                                  ↘ on MODULE_NOT_FOUND → emit degraded JSON, exit 0
```

This means:
- No library import overhead on ruflo's boot path
- 60s hard timeout per subprocess (bounded blast radius)
- `--json` flag forced for structured parsing
- Graceful degradation is a single helper used by every skill

## Cross-links

- [ADR-150](../../v3/docs/adr/ADR-150-metaharness-integration-surfaces.md) — decision + architectural constraint
- [Issue #2399](https://github.com/ruvnet/ruflo/issues/2399) — phase rollout tracker
- [Research dossier](https://gist.github.com/ruvnet/19d166ff9acf368c9da4172d91ac9113) — full graded-evidence sourcing
- [Upstream](https://github.com/ruvnet/agent-harness-generator) — `metaharness` source
- ADR-148/149 — `@metaharness/router` cost-optimal routing (sibling integration)
