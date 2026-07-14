---
name: adr-reindex
description: Reconcile the ADR index against a DELETED ADR file or relation line by dropping and rebuilding adr-patterns + adr-edges from scratch (scripts/reindex.mjs). Use when adr-index alone leaves stale rows behind.
argument-hint: ""
allowed-tools: Bash mcp__claude-flow__memory_list
---

# ADR Reindex

`adr-index` only ever **adds** or upserts rows — it has no way to remove one. Delete an ADR file (or a single relation line from a surviving file) and the row `adr-index` wrote for it survives every future `adr-index` run, forever, with no dangling-ref or cycle ever pointing at it. `adr-verify` then certifies the resulting graph as healthy, because an orphan row with zero edges in or out is invisible to both its checks. See issue #2666.

This is a different failure mode from staleness (an ADR that changed but whose stored record didn't) — that's convergence, `adr-index`'s job. This is **reaping** — the source of truth (the ADR file) is gone, so the derived cache row for it must be gone too. The only reliable way to reap is to drop both namespaces and rebuild from what's actually on disk right now.

## When to use

- After deleting an ADR file (or removing a relation line from one)
- Periodically, as a scheduled reconcile (`adr-verify` can't catch what `adr-reindex` catches — see below)
- If `adr-verify`'s ADR count looks higher than `find docs/adr -name '*.md' | wc -l`

## Steps

```bash
node plugins/ruflo-adr/scripts/reindex.mjs
```

Optional env:
- `REINDEX_FORMAT=json` — JSON instead of markdown
- `REINDEX_DRY_RUN=1` — report what would happen, purge/write nothing
- `ADR_ROOT=/path` — scan root **and** the root the underlying `memory purge`/`memory store` subprocesses run from (must match whatever root `adr-index` was last run with, or you'll reconcile the wrong repo's namespace)

## What it does

1. **Purge** — hard-deletes every row in `adr-patterns` and `adr-edges` via `memory purge --namespace <ns> --force` (the CLI's real `DELETE FROM memory_entries`, not `memory delete`'s soft tombstone that still blocks a same-key re-store — see "Why not `adr-index` + `memory delete`" below).
2. **Rebuild** — re-scans every ADR currently on disk (same dual-format parser `adr-index` uses) and stores it fresh.
3. **Post-condition** — re-lists `adr-patterns` and asserts the count equals the number of ADR files just scanned. This is stronger than `adr-index`'s "N stored, 0 errors" tally: if a concurrent memory.db writer clobbered the purge (see Caveats), the store loop would still report success on every call — only a fresh recount catches that.

Exits non-zero if the post-condition fails.

## Why not `adr-index` + `memory delete`

`memory delete` is a **soft** delete (`UPDATE ... SET status='deleted'`) — the row keeps occupying its `UNIQUE(namespace, key)` slot, so a later non-upsert `memory store` for that same key still fails. `memory cleanup` only reaps entries by age/TTL/quality, not by "does its source file still exist" — it has no orphan concept. Neither gets you back to a clean graph; only a real namespace-scoped `DELETE FROM` does, which is what `memory purge` (and this skill) uses.

## Caveats

- **Irreversible.** This purges the *entire* namespace, not a diff — always safe here because step 2 immediately rebuilds from the current on-disk truth, but don't call `memory purge` directly against `adr-patterns`/`adr-edges` outside this flow.
- **#2621 (unaddressed):** the purge is lock-protected against a second concurrent purge/delete on the same `memory.db`, but not against every writer — a daemon or MCP server mid a read-modify-write cycle on the sql.js fallback path can still flush an older image afterward and resurrect what this just purged. The post-condition check exists specifically to surface this; re-run the skill if it fails.
- Cross-repo `related`/`depends-on` edges pointing at an ADR that was never scanned in *this* root (a legitimate sibling-repo reference, not an orphan) are dropped by the rebuild the same as everything else in `adr-edges` — they only come back if the sibling repo's ADRs are indexed in the same run. This matches `adr-verify`'s own documented "dangling ref, common cause: sibling repo" caveat; it isn't new drift introduced by this skill.

## Cross-references

- `adr-index` — convergence (add/upsert); this skill is reaping (remove what's gone)
- `adr-verify` — read-back integrity check; run after reindex to confirm `adrCount` matches disk
- `scripts/reindex.mjs` — implementation
- ADR-0002 (`docs/adrs/`) — the decision record for this skill
