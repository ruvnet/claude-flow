# ruflo-adr

ADR lifecycle management -- create, index, reconcile, supersede, and link Architecture Decision Records to code.

## Overview

Manages Architecture Decision Records through their full lifecycle (proposed, accepted, deprecated, superseded). ADRs are stored as markdown files in `docs/adr/` and indexed in AgentDB with causal edges tracking supersedes/amends/depends-on relationships. Includes compliance checking that scans git diffs for ADR violations, and reconciliation (`adr-reindex`) for ADRs deleted from disk (#2666).

## Installation

```bash
claude --plugin-dir plugins/ruflo-adr
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `adr-architect` | sonnet | ADR lifecycle management, code-ADR linking via grep/blame, AgentDB graph storage |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `adr-create` | `/adr-create <title>` | Create a new ADR with sequential numbering and AgentDB registration |
| `adr-index` | `/adr-index` | Build or rebuild the ADR index and dependency graph in AgentDB (add/update only — never removes) |
| `adr-review` | `/adr-review [--branch BRANCH]` | Review code changes against accepted ADRs for compliance violations |
| `adr-verify` | `/adr-verify` | Read back adr-patterns + adr-edges namespaces, surface dangling refs / supersede cycles / status mismatches; exits 1 on cycles |
| `adr-reindex` | `/adr-reindex` | Reconcile a **deleted** ADR file: drop-and-rebuild adr-patterns + adr-edges from what's on disk right now |

## Commands (7 subcommands)

```bash
# Lifecycle
adr create <title>
adr list
adr status <adr-id> <new-status>
adr supersede <old-id> <new-id>

# Compliance
adr check                    # Scan recent git changes for ADR violations
adr graph                    # Show ADR dependency graph
adr search <query>           # Semantic search across ADRs
```

## ADR Lifecycle

```
proposed --> accepted --> deprecated
                    \--> superseded by ADR-XXX
```

Relationships tracked as causal edges: `supersedes`, `amends`, `depends-on`, `related`.

Body relationship fields accept qualifiers such as `**Amends by scope**:` or
`**Depends-on / confirms**:`, and `Relates` is an alias for `Related`. Wrapped
lists may continue on lines containing only ADR references (including Markdown
links) and separators. Narrative continuation is not scanned for relationships;
declare additional relationships in another bold field.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-adr/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `adr-patterns` AgentDB namespace. It defers to [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) for naming rules. Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`adr-patterns` follows kebab-case `<plugin-stem>-<intent>` per the convention. The plugin uses it for semantic ADR search and for cross-project pattern transfer (via `hooks_transfer` in `ruflo-intelligence`).

## Verification

```bash
bash plugins/ruflo-adr/scripts/smoke.sh
# Expected: "22 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-adr plugin contract (pinning, namespace coordination, smoke as contract)](./docs/adrs/0001-adr-plugin-pattern.md)
- [`ADR-0002` — Reconcile deleted ADRs (hard-delete primitive + drop-and-rebuild reindex)](./docs/adrs/0002-reconcile-deleted-adrs.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; backing store for the ADR graph
- `ruflo-ddd` — document domain decisions as ADRs
- `ruflo-sparc` — Architecture phase (Phase 3) produces ADRs
- `ruflo-migrations` — schema change decisions recorded as ADRs
- `ruflo-jujutsu` — ADR-aware diff analysis on PRs
- `ruflo-intelligence` — `hooks_transfer` ships ADR patterns across projects

## License

MIT

## As a mod

ADR also ships as a function-hook mod (ADR-445 pattern; hooks in `hooks/`, loaded with the plugin). No network, no process, no model call.

- **Guard (default on)**: refuses an ADR write (`agentdb_hierarchical-store`, `agentdb_causal-edge` or `memory_store` into an `adr*` namespace) that holds a key, token or password. It only tightens: it never allows anything the session would deny, and the refusal never repeats the secret. Turn it off with the `guard` option.
- **`/adr-mod`**: answered locally. `/adr-mod status`, `/adr-mod scan <text>`, `/adr-mod format`.
- **Status file**: `.claude-flow/adr-mod/status.json` (`version`, `updatedMs`, counters), written at session start and whenever a call is refused; the console reads it.
- **Options** (`userConfig`): `guard` (`on` by default).

Test: `claude plugin validate plugins/ruflo-adr`, `claude plugin test plugins/ruflo-adr`, and `bash plugins/ruflo-adr/scripts/smoke.sh`.

## Native Codex hooks

The separate `.codex-plugin/plugin.json` selects `hooks/codex-hooks.json`, replacing
the Claude-only module entry for Codex. Claude's manifest and `register.ts` remain
unchanged. The synchronous native `PreToolUse` adapter bundles the existing pure
guard and shared secret screen; it preserves their tool/namespace scope and emits
the native permission-denial envelope before a guarded write. `SessionStart` and
guarded calls maintain private per-session counters in `PLUGIN_DATA`; the existing
version-1 project status file remains a best-effort courtesy view. Status failure
does not permit a denied write. Guarding is enabled for the native adapter.

Existing skills and command files remain available. Claude's dynamic
`$.command.register` / `command.run` mod interception has no native command-hook
equivalent: Codex does **not** get that interception. The same deterministic local
command helpers are available explicitly via
`node <plugin-root>/hooks/codex-hook.cjs --command status` (and the helper's existing
subcommands). This is guard/status compatibility, not full SDK-mod parity.

Maintainers rebuild the committed standalone bundles with
`ESBUILD=<esbuild executable> node scripts/build-codex-mod-hooks.mjs`, then run
`node --test tests/plugins/codex-mod-hooks.test.mjs`. Set `ESBUILD` in that test run
to check byte reproducibility using the same installed builder. Run
`scripts/sync-mod-screen.mjs --check` before bundling when the shared screen changes.
The adapters need Node.js and contain no runtime SDK dependency.

This source change requires a released upstream package or an explicitly owned
source projection to reach installations. It does not patch foreign cache entries,
pin upstream updates, disable plugins, or claim an already published repair.

Release both host manifests with the same patch version. Codex 0.160's published
remote-bundle sync skips downloading a release whose version equals the installed
version; merging same-version source does not establish automatic cache refresh.
Its explicit native plugin install replaces the cached root atomically even at the
same version. An owned projection must therefore refresh its upstream source
generation and explicitly reinstall it; refreshing a marketplace catalog alone
is not installation proof. No foreign cache entry should be edited in place.
