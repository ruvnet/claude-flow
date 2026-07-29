---
name: harness-genome
description: 7-section repo readiness report from `metaharness genome <path>`. Returns repo_type / agent_topology / risk_score / mcp_surface / test_confidence / publish_readiness. Pure-read; degrades gracefully (ADR-150).
argument-hint: "[--path .] [--alert-on-risk-above 0.5] [--format table|json]"
allowed-tools: Bash
---

Companion to `harness-score`. Where score is a 5-dimension numeric
scorecard, genome is a 7-section categorical/numeric report covering
repo type, agent topology recommendations, risk score (0-1), MCP
surface area, test confidence (0-1), and publish readiness (0-1).

## Algorithm

Implementation: [`scripts/genome.mjs`](../../scripts/genome.mjs).

1. Shell out to `npx metaharness genome <path> --json` (60s hard timeout).
2. Parse the shape: `{ repo_type, agent_topology[], risk_score,
   mcp_surface, test_confidence, publish_readiness }`.
3. Preserve upstream's readiness verdict as `verdict` and
   `verdictExitCode`. Upstream exits 1 for `needs-work` and 2 for `blocked`;
   these are valid reports, so the wrapper returns them successfully.
4. If `--alert-on-risk-above N`: exit 1 when `risk_score > N`.
5. Output JSON (default) or markdown.

## Phase-0 baseline (ruflo, measured 2026-06-16)

```
{
  "repo_type": "node_mcp_ci",
  "agent_topology": ["maintainer", "tester", "security", "release"],
  "risk_score": 0.27,
  "mcp_surface": "remote",
  "test_confidence": 0.8,
  "publish_readiness": 0.9
}
```

Ruflo's `risk_score: 0.27` is low (good). `publish_readiness: 0.9` is
high. The `mcp_surface: "remote"` reflects that ruflo's MCP servers are
hosted, not bundled.

## When to use

- Pre-mint review: "before scaffolding a custom harness from this repo,
  should we?" — genome answers it categorically.
- Drift detection: capture genome snapshots over time, diff via
  cost-diff-style tooling to spot when `agent_topology` recommendations
  drift away from a deliberate architecture choice.
- CI gate: `--alert-on-risk-above 0.5` fails the build when the repo's
  risk profile crosses a threshold.

## Pairs with

- `harness-score` — numeric readiness
- `harness-mcp-scan` — static MCP security findings
- `harness-threat-model` — enterprise-review-grade threat model
