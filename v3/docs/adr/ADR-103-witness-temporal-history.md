# ADR-103: Witness Temporal History + Plugin-Distributed Toolkit

**Status**: Accepted
**Date**: 2026-05-08
**Version**: ruflo-core@0.2.1+ / @claude-flow/cli@3.7.0-alpha.18+
**Related**: ADR-102 (CI smoke harness), ADR-332 (hermetic source verification), #1867, #1859, #1862, project memory `project_verification_process.md`

## Context

The signed witness manifest at `verification.md.json` (described in
`verification.md`) attests that every documented fix in the codebase is
still present, by SHA-256 + marker substring, signed Ed25519 with a
deterministic seed derived from the git commit.

It works well as a snapshot, but has two structural gaps:

### Gap 1 — No temporal data

The manifest is overwritten every regen. A fix that flips `pass → drift →
regressed` carries no history. When CI says "F12 is regressed", you can
only answer "as of HEAD, marker is missing" — not "introduced between
commit X and Y, on date D, in PR #N". For a project with 80+ tracked
fixes across rapid alpha churn, this turns regression triage into a
manual git-bisect every time.

### Gap 2 — Toolkit is ruflo-internal

The regen logic was originally inline in shell heredocs (per the
`project_verification_process.md` memory) and later extracted to
`scripts/regen-witness.mjs`. Both forms hard-code ruflo's paths and
fix list. Other projects can't adopt the witness pattern without
copy-pasting and rewriting. Given that several downstream consumers
of `ruflo` and `@claude-flow/cli` ship their own fixes, this is a
real adoption blocker.

## Decision

### 1. Append-only JSONL temporal history

Each regen appends one line to `verification-history.jsonl`:

```jsonc
{
  "v": 1,
  "commit": "<gitCommit at issuance>",
  "issuedAt": "<ISO timestamp>",
  "branch": "<branch>",
  "manifestHash": "<sha256 of canonical manifest>",
  "summary": { "totalFixes": N, "verified": M, "missing": K },
  "fixes": {
    "F1":   { "sha256": "...", "markerVerified": true },
    "#1867":{ "sha256": "...", "markerVerified": true },
    /* ... one entry per fix, keyed by id ... */
  }
}
```

Format choice: JSONL because

- Append is atomic and cheap (no rewrite of prior lines).
- Git diffs are minimal — one new line per regen.
- Trivially parsable from any tool without binary format support.
- Matches the project's existing convention (`pending-insights.jsonl`).

The file is committed alongside `verification.md.json`. They must move
as a pair — the manifest is the latest signed snapshot, the JSONL is
the timeline that proves it's the latest.

### 2. Ship the toolkit as a `ruflo-core` plugin asset

The witness scripts move to `plugins/ruflo-core/scripts/witness/`:

| File | Purpose |
|---|---|
| `lib.mjs` | Pure functions: `regenerate`, `appendHistory`, `loadHistory`, `findRegressionIntroductions`, `fixTimeline`, `diffLatest` |
| `init.mjs` | Bootstrap empty manifest + history + fix template into any repo |
| `regen.mjs` | Sign the manifest + append history (the canonical workflow) |
| `verify.mjs` | Validate signature + markers against the live tree |
| `history.mjs` | Query the temporal log: `summary`, `regressions`, `timeline`, `list` |

Plus exposure as Claude Code surface area:

| File | Purpose |
|---|---|
| `plugins/ruflo-core/skills/witness/SKILL.md` | Workflow doc + anti-patterns |
| `plugins/ruflo-core/commands/witness.md` | Slash-command thin wrapper |
| `plugins/ruflo-core/agents/witness-curator.md` | Agent for adding fixes / interpreting regressions |

The scripts are project-agnostic: they take `--manifest`, `--history`,
`--fixes`, `--root` flags. Manifest generation probes `<root>` and
`<root>/v3` for `@noble/ed25519`, so it works in monorepo and flat layouts.
As amended by ADR-332, verification uses `node:crypto` and needs no installed
package; `--source-only` authenticates clean source checkouts explicitly.

The ruflo internal entrypoint at `scripts/regen-witness.mjs` is now a
thin wrapper that hard-codes ruflo's paths and reads the
project-specific fix list from `witness-fixes.json`. Single source of
truth lives in the plugin.

### 3. CI integration

The `witness-verify` job in `.github/workflows/v3-ci.yml` (added by
ADR-102 §3) gains a follow-on step that runs `history.mjs summary`
to surface transitions since the previous snapshot. The summary
subcommand exits non-zero on any newly-regressed fix — informational
in the current pipeline, but adopters can promote it to a hard gate
in their own CI.

### 4. Regression-introduction queries

`history.mjs regressions` walks the JSONL backwards to find, for each
currently-regressed fix, the most recent snapshot where it was passing
(`lastPassCommit`). The next snapshot's commit (`regressedAtCommit`)
brackets the regression to a single window. Combined with `git log
lastPassCommit..regressedAtCommit -- <file>`, this collapses bisect
to a small set of commits to read.

## Implementation notes

- `appendHistory` strips the manifest's `desc`/`marker`/`file` fields
  from the per-fix record. Those don't change frequently and would
  bloat the JSONL. If a marker is updated mid-stream, the JSONL still
  records the SHA-256 + verified-status pair from each regen, which is
  the load-bearing signal for regression detection.
- The JSONL keeps fixes keyed by id (object), not array. This makes
  per-fix lookups O(1) without scanning, which matters once history
  reaches 100+ entries.
- `verify.mjs` is parallel to the bundled `ruflo verify` command but
  has no ruflo CLI or package dependency. Generation continues to use
  `@noble/ed25519`; ADR-332 preserves its witness bytes while moving
  standalone verification to Node's built-in Ed25519 implementation.

## Consequences

### Capabilities gained

- Regression introduction time becomes a one-command answer.
- Per-fix status timelines for trend analysis (which fixes flap, which
  drift consistently, which regress permanently).
- Other projects can adopt the witness pattern by copying
  `plugins/ruflo-core/scripts/witness/` and `init`-ing — no ruflo
  install required.
- The CI surface gains a soft gate that highlights *what* regressed,
  not just *that* something regressed.

### Costs

- One extra file in the repo (`verification-history.jsonl`).
- ~2-3 KB per regen entry (81 fixes × ~30 bytes avg). After 1000
  regens, ~3 MB.
- Adopters generating manifests take a development dependency on
  `@noble/ed25519` (~15 KB minified, no transitive deps). Verification
  itself has no package dependency (ADR-332).

### Not addressed (residual)

- No vector-graph similarity over snapshots. The user's original
  question floated `/ruvector` as a substrate. JSONL is sufficient for
  the queries we need today; an HNSW-backed similarity index over
  snapshot fingerprints is a follow-up if pattern-based queries
  ("snapshots most similar to commit X") become valuable.
- No cross-project history aggregation. Each project's JSONL is local.
  Multi-project rollups would need a separate ingestion service.
- The `verify.mjs` script duplicates a small amount of logic with
  `v3/@claude-flow/cli/src/commands/verify.ts`. Acceptable for now
  (the standalone needs to work without the CLI installed); could be
  unified later if both move to the plugin.

## References

- `plugins/ruflo-core/skills/witness/SKILL.md` — adoption guide
- `plugins/ruflo-core/agents/witness-curator.md` — agent definition
- `~/.claude/.../project_verification_process.md` — original inline
  regen process; superseded by this ADR's plugin-extracted form
- ADR-102 — CI smoke harness pattern (this ADR generalizes the
  smoke-test layer to a fully temporal verification layer)
