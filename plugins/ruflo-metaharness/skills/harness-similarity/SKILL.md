---
name: harness-similarity
description: ADR-152 — weighted similarity between two harness fingerprints (genome + score JSON). Returns overall score in [0,1] plus per-component breakdown (cosine over 9 numerics, categorical agreement over 4 enums, jaccard over agent_topology). Unblocks ADR-151 §3.2 Recommender, §3.3 Drift Detection, §3.5 Plugin Compat. Pure-TS, no `@metaharness/*` dep — preserves ADR-150's four architectural constraints.
argument-hint: "(--a a.json --b b.json | --a-key X --b-key Y) [--per-dimension] [--alert-below 0.5] [--format json|table]"
allowed-tools: Bash
---

Surfaces the production similarity function from [`scripts/_similarity.mjs`](../../scripts/_similarity.mjs) as a callable skill. Use when an agent needs to:

- decide whether to fork an existing harness vs scaffold a new one
- rank candidate templates against a target repo's genome
- diff two harnesses produced by different teams to find duplicate work
- generate the confidence number that ADR-151 §3.2's Recommender wraps

## Algorithm (from ADR-152 §Decision)

```
overall = 0.60·cosine + 0.25·categorical + 0.15·jaccard
```

- **cosine** — over a 9-dim numerical vector of normalized scorecard + genome dims
- **categorical** — fraction of 4 enum fields that match (`repo_type`, `archetype`, `template`, `recommendedMode`)
- **jaccard** — `|A ∩ B| / |A ∪ B|` over the `agent_topology[]` array

The 3-component design is load-bearing: numerical cosine alone is too coarse (the iter-35 spike showed LEGAL vs DEVOPS at cosine=0.97 despite being unrelated verticals). Categorical + jaccard pull the composite to the correct ordering.

## Reference outputs (iter-35 spike fixtures)

| Pair | overall | cosine | categorical | jaccard |
|---|---:|---:|---:|---:|
| `LEGAL` × `LEGAL` (self) | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| `LEGAL` × `SUPPORT` | 0.8296 | 0.9987 | 0.7500 | 0.2857 |
| `LEGAL` × `DEVOPS` | 0.5840 | 0.9734 | 0.0000 | 0.0000 |

Both invariants from ADR-152 §"Smallest demonstrable spike" hold:
1. `similarity(X, X) === 1` exactly
2. `similarity(LEGAL, DEVOPS) < similarity(LEGAL, SUPPORT)` (vertical affinity)

## Architectural constraint inheritance (ADR-150)

- **Removable** — pure-TS function, zero static `@metaharness/*` imports.
- **Optional** — no new dep in `package.json`.
- **Graceful** — malformed inputs emit `{ degraded: true, reason }` with exit code 2; never throws.
- **CI-gate** — smoke step 17y locks the contract: module exports, spike fixtures reproduce, CLI dispatcher entry registered, MCP tool registered.

## Usage

```bash
# File inputs
npx ruflo metaharness similarity --a a.json --b b.json

# Memory inputs (records persisted by oia-audit.mjs)
npx ruflo metaharness similarity --a-key harness-X --b-key harness-Y

# Per-dimension breakdown (used by ADR-151 §3.2 Recommender)
npx ruflo metaharness similarity --a a.json --b b.json --per-dimension

# Alert when too-dissimilar (used by ADR-151 §3.3 Drift Detection)
npx ruflo metaharness similarity --a a.json --b b.json --alert-below 0.5
```

## Implementation

Production module: [`scripts/_similarity.mjs`](../../scripts/_similarity.mjs)
CLI skill: [`scripts/similarity.mjs`](../../scripts/similarity.mjs)
MCP tool: `mcp__plugin_ruflo-core_ruflo__metaharness_similarity` (registered in `v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts`)
Spike anchor: [`scripts/_spike-similarity.mjs`](../../scripts/_spike-similarity.mjs) (regression suite — invariants locked here)
