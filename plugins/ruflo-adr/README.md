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

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-adr/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `adr-patterns` AgentDB namespace. It defers to [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) for naming rules. Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`adr-patterns` follows kebab-case `<plugin-stem>-<intent>` per the convention. The plugin uses it for semantic ADR search and for cross-project pattern transfer (via `hooks_transfer` in `ruflo-intelligence`).

## Pinning the CLI build


`adr-import` (`scripts/import.mjs`) and `adr-reindex` (`scripts/reindex.mjs`)
write to the `adr-patterns` / `adr-edges` namespaces by shelling out to the
`@claude-flow/cli` (`memory store` / `purge`). By default they run the
**registry** build (`npx @claude-flow/cli@latest`). On a host running a locally
patched CLI, that registry build is a *second, unmanaged writer* against the same
`.swarm/memory.db` — the whole-image rename-over it performs can corrupt it. Pin
the writer to your local build so purge, store, and list share one owner.

Resolution order (`scripts/lib/cli-resolve.mjs` → `resolveCli`, the same
convention as `ruflo-cost-tracker/scripts/_npx.mjs`); a pinned bin always wins,
and only the registry fallback still honours `CLI_CORE=1`:

1. **`RUFLO_CLI_BIN`** — absolute path to a `cli.js` (run via `node`) or an
   executable (exec'd directly). Used if the path exists.
2. **`<ADR_ROOT>/.claude-flow/cli-pin.json`** — checked next. For these scripts
   the resolution cwd is `ADR_ROOT`, which is also the DB root (#2666), so the pin
   and the DB stay in agreement. Shape:
   ```json
   { "bin": "/abs/path/to/@claude-flow/cli/bin/cli.js", "reason": "why", "pinnedAt": "2026-07-18T00:00:00Z" }
   ```
   Used if it parses and `bin` exists; a malformed pin file is ignored.
3. **Registry fallback** — `npx -y @claude-flow/cli@latest` (or
   `@claude-flow/cli-core@alpha` when `CLI_CORE=1`), with a one-line stderr
   `[ruflo] memory write using unpinned registry CLI …` notice.


The pin file also accepts an optional `"expiresWhenRegistryHas": "<semver>"`
floor: once the registry's `@claude-flow/cli` version reaches it, the pin
self-expires and resolution returns to the registry automatically. The
decision uses a locally cached registry version (`.claude-flow/registry-version.json`)
refreshed in the background — never a network call on the hook's hot path.

## Verification

```bash
bash plugins/ruflo-adr/scripts/smoke.sh
# Expected: "21 passed, 0 failed"
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
