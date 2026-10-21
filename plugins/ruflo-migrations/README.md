# ruflo-migrations

Schema migration management -- generate, validate, dry-run, and rollback database migrations.

## Overview

Generates sequentially numbered database migrations with up/down SQL pairs for rollback safety. Includes dry-run mode to preview SQL without executing, validation checks for foreign key consistency, index coverage, and naming conventions, plus full migration history tracking in AgentDB.

## Installation

```bash
claude --plugin-dir plugins/ruflo-migrations
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `migration-engineer` | sonnet | Generate sequential migrations, create up/down pairs, dry-run validation, rollback safety checks |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `migrate-create` | `/migrate-create <name>` | Create a new sequentially numbered migration with up/down SQL files |
| `migrate-validate` | `/migrate-validate` | Validate pending migrations for FK consistency, rollback safety, and best practices |

## Commands (6 subcommands)

```bash
migrate create <name>        # Create NNN_name.up.sql and NNN_name.down.sql
migrate up [--dry-run]       # Apply pending migrations (or preview SQL)
migrate down [--steps N]     # Rollback last N migrations (default: 1)
migrate status               # Show applied/pending migration status
migrate validate             # Validate pending migrations for safety
migrate history              # Show full migration execution history
```

## Validation Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Foreign key targets exist | Error | Referenced table/column must exist |
| Index coverage | Warning | WHERE/JOIN columns should be indexed |
| Data type compatibility | Error | ALTER COLUMN type must be compatible |
| NOT NULL without default | Error | Adding NOT NULL column requires DEFAULT |
| Down migration completeness | Warning | Every UP needs a corresponding DOWN |
| Destructive operations | Warning | DROP TABLE/COLUMN flagged for review |
| Naming conventions | Info | Tables plural, columns snake_case |
| Idempotency | Warning | Use IF EXISTS / IF NOT EXISTS |

## Migration File Format

```
migrations/
  001_create_users.up.sql
  001_create_users.down.sql
  002_add_email_index.up.sql
  002_add_email_index.down.sql
```

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-migrations/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `migrations` AgentDB namespace (kebab-case is implicit when the plugin name is the intent — same documented exception as `federation`). Follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`migrations` is accessed via `memory_*` tools (namespace-routed). Tracks migration metadata, applied/pending status, and validation results.

> **Routing note:** Earlier versions of these skills used `agentdb_hierarchical-*` and `agentdb_pattern-store` with namespace arguments — those tool families route by tier/ReasoningBank and ignore namespace strings. ADR-0001 fixed the skills to use `memory_*` for namespaced reads/writes.

## Verification

```bash
bash plugins/ruflo-migrations/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-migrations plugin contract (namespace-routing fix, smoke as contract)](./docs/adrs/0001-migrations-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; defines the routing rules ADR-0001 fixes a violation of
- `ruflo-adr` -- Document schema change decisions as ADRs
- `ruflo-ddd` -- Align migration boundaries with aggregate roots
- `ruflo-observability` -- Track migration execution duration and failure rates

## License

MIT

## As a mod

Function-hook mod (ADR-445 pattern, `hooks/register.ts`). It adds, with no network, no process spawning and no model call:

- **Guard** (tighten-only, default on): refuses a memory write (memory_store, agentdb_*store/batch) that holds a secret or a database URL with an inline password. The deny reason names the rule, never the value.
- **`/migrations-mod`**: local `status` and `scan <text>` (secret check, same rules as the guard); `/migrations-mod scan <sql>` lints SQL for DROP/TRUNCATE/DROP COLUMN/DELETE-without-WHERE (read-only).
- **Status file** `.claude-flow/migrations-mod/status.json` (`{version:1, updatedMs, guard, checked, blocked, ...}`), written at session start and when counters change.

Per-prompt context is deliberately not added: this plugin has nothing worth attaching to every prompt.

| Option | Default | Effect |
|---|---|---|
| `guard` | `on` | refuse the calls above |

Test: `claude plugin validate plugins/ruflo-migrations`, `claude plugin test plugins/ruflo-migrations`, `bash plugins/ruflo-migrations/scripts/smoke.sh`.
