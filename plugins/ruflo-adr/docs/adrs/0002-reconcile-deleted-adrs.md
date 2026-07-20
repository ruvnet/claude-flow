---
id: ADR-0002
title: Reconcile deleted ADRs — a real hard-delete primitive and a drop-and-rebuild reindex skill
status: Accepted
date: 2026-07-14
authors:
  - claude (Claude Code)
tags: [plugin, adr, agentdb, reconcile, memory, hard-delete]
---

## Context

Issue #2666: `adr-index` can add and (once #2660 is fixed) update an ADR in the `adr-patterns`/`adr-edges` namespaces, but has no way to **remove** one. Delete an ADR file, or delete a single relation line from a surviving one, and the row `adr-index` wrote for it survives every future import. `adr-verify` then certifies the resulting graph as healthy — an orphan row has no dangling ref and forms no cycle, so it's invisible to both of `adr-verify`'s checks.

Root cause traced to the underlying `@claude-flow/cli` `memory` command surface, not this plugin's own logic:

- `memory delete` (and the `deleteEntry`/`bridgeDeleteEntry` functions behind it) only ever does `UPDATE memory_entries SET status='deleted'` — a soft tombstone. The row keeps occupying its `UNIQUE(namespace, key)` slot, so a later non-upsert `memory store` for the same key still fails (#2652).
- `memory cleanup` reaps by age/TTL/quality, not by "does the source still exist" — it has no orphan concept.
- Neither the AgentDB v3 bridge (`memory-bridge.ts`) nor the sql.js fallback (`memory-initializer.ts`) exposed any hard, namespace-scoped delete.
- Separately, `import.mjs`'s and `verify.mjs`'s `spawnSync('npx', [...])` calls never passed `cwd`, so `ADR_ROOT=/other/repo node import.mjs` scanned the right files but wrote to whichever `.swarm/memory.db` happened to be under the *caller's* cwd, not `ADR_ROOT` — `getMemoryRoot()` resolves `.swarm/` relative to the CLI subprocess's cwd, confirmed in `v3/@claude-flow/cli/src/memory/memory-initializer.ts:87`.
- No lock exists anywhere around `memory.db` writes (issue #2621 is real and, before this change, completely unaddressed in the codebase).

The only reliable reconcile is therefore a **drop-and-rebuild of both namespaces**, and that requires a genuine hard delete — which didn't exist anywhere in the public CLI/MCP surface.

## Decision

### 1. New CLI primitive: `memory purge --namespace <ns> --force`

Added to `@claude-flow/cli`:
- `bridgePurgeNamespace()` (`memory-bridge.ts`) — a real `DELETE FROM memory_entries WHERE namespace = ?` against the live AgentDB v3 bridge's SQLite handle, routed through the existing `MutationGuard`/`AttestationLog` hooks (`guardValidate`/`logAttestation`, operation `'purge'`).
- `purgeNamespace()` (`memory-initializer.ts`) — tries the bridge first, falls back to the same sql.js whole-file read/mutate/rewrite shape `deleteEntry` already uses (same encryption handling via `readFileMaybeEncrypted`/`writeFileRestricted`), for parity with every other memory operation's bridge-then-fallback structure.
- `withMemoryDbLock()` — a new `<dbPath>.lock` O_EXCL advisory lock, same stale-takeover pattern as `services/global-ai-budget.ts`. Wraps `purgeNamespace`'s body. This protects against a second concurrent purge/delete on the same file; it does **not** close #2621 (a writer that doesn't call this helper — the general `memory store` path, a daemon's own write cycle — is still unprotected). That is a larger, separate change (every writer would need to adopt the same lock) and out of scope here.
- `memory purge` CLI command (`commands/memory.ts`) — requires `--namespace` explicitly (no default, to prevent an accidental blanket wipe), confirms interactively unless `--force`, supports `--dry-run`.

No new MCP tool was added deliberately — a hard, irreversible, whole-namespace delete callable by any agent without a human in the loop is a larger safety-surface increase than this issue needs; the CLI command (invoked by a script the user runs, or with explicit `--force`) is the right trust boundary for now.

### 2. `plugins/ruflo-adr/scripts/reindex.mjs`

New script, paired with the new `/adr-reindex` skill:
1. Purge `adr-patterns` and `adr-edges` via `memory purge --force`.
2. Re-scan every ADR currently on disk (same dual-format parser `import.mjs` uses) and store fresh.
3. Re-list `adr-patterns` and assert the count equals the number of files just scanned — a `storedRecords != 0` tally cannot see the failure this exists to prevent (issue's point 3): if the purge got clobbered by a concurrent writer (#2621) between step 1 and step 2, every store in step 2 still reports "ok", landing on top of resurrected rows. Only a fresh recount catches it. Exits non-zero on failure.

Full-namespace wipe rather than a selective orphan diff, deliberately: `adr-edges` keys always carry a fresh `timestamp-rand` suffix (`import.mjs`), so edges are never deduplicated across repeated imports — a selective "only remove orphans" pass would still leave duplicate edge rows accumulating for ADRs that *do* still exist. A full rebuild is simpler, avoids that accumulation as a side effect, and — as a bonus, not the goal — incidentally fixes the separate staleness problem (#2660) where a changed-but-still-present ADR's stored content never refreshes, since a fresh insert after a full purge has nothing to conflict with.

### 3. `import.mjs`/`verify.mjs` cwd fix

Every `spawnSync('npx', [...])` call in both scripts now passes `cwd: ROOT`, so `ADR_ROOT` genuinely controls which `.swarm/memory.db` gets read/written, not just which files get scanned.

### 4. Shared parser extraction

`findAdrs`/`parseAdr` (and their frontmatter/body sub-parsers) moved from `import.mjs` into `scripts/lib/parse-adrs.mjs`, imported by both `import.mjs` and `reindex.mjs`. Avoided duplicating ~150 lines of dual-format parsing a second time; `import.mjs` shrank from 322 to 156 lines with no behavior change (verified: dry-run scan of this repo still reports the same 530 ADRs / same status and relation breakdown before and after the refactor).

## Consequences

### Positive
- The repro in the issue (`rm` an ADR, re-run `adr-index`, `adr-verify` reports healthy) is now closeable: `adr-reindex` removes the orphan and the post-condition check proves it.
- `memory purge` is a general primitive, not ADR-specific — any other plugin/skill that owns a namespace and needs the same reconcile shape can reuse it directly.
- `ADR_ROOT` now does what its own doc comment always claimed.

### Negative
- One more CLI subcommand to maintain, and one more way to lose data if misused outside the reindex flow (`--namespace` is required with no default specifically to raise the bar against that).
- Doesn't fully close #2621 — documented as a known residual risk in the skill, the ADR, and the reindex script's own post-condition messaging, rather than silently claimed as fixed.

### Neutral
- `plugin.json` bumps `0.3.0 → 0.4.0` (new skill + script, backward compatible — nothing existing changed behavior except the cwd fix, which only changes behavior when `ADR_ROOT` differs from cwd, previously a latent bug).

## Verification

```bash
bash plugins/ruflo-adr/scripts/smoke.sh
# Expected: "N passed, 0 failed"

# End-to-end repro + fix, against a scratch repo with a local CLI build:
#   1. Two ADRs, adr-index → adr-patterns has 2.
#   2. rm one ADR file, adr-index again → adr-patterns still has 2 (bug reproduced).
#   3. adr-reindex → adr-patterns has 1, post-condition OK, exit 0.
```

Also see: `v3/@claude-flow/cli/__tests__/memory-purge-namespace-2666.test.ts` — unit coverage for `purgeNamespace`/`withMemoryDbLock`, including the specific #2652 regression (non-upsert re-store of a purged key must succeed, proving it's a real delete and not a tombstone).

## Related

- Issue #2666 — the bug this ADR resolves
- Issue #2652 — the UNIQUE(namespace, key) tombstone-blocks-restore bug this ADR's hard-delete works around (not itself fixed — `memory delete`'s soft-delete semantics are unchanged; `memory purge` is a new, separate, namespace-scoped primitive)
- Issue #2621 — the general memory.db concurrent-write race; partially, not fully, mitigated here
- Issue #2660 — convergence (update-in-place staleness); not this ADR's target, incidentally improved by the full-rebuild approach
- `plugins/ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md` — namespace ownership + smoke-as-contract this ADR continues
- `v3/implementation/adrs/` — `services/global-ai-budget.ts`'s O_EXCL lock pattern, reused for `withMemoryDbLock`
