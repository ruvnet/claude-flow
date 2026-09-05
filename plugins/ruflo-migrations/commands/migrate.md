---
name: migrate
description: Database migration operations — create, apply, rollback, validate, and inspect migration history
---

Migration commands:

**`migrate create <name>`** -- Create a new migration with sequential numbering.
1. Scan the migrations directory for the highest existing migration number
2. Compute the next number (zero-padded to 3 digits)
3. Generate `NNN_<name>.up.sql` and `NNN_<name>.down.sql` files
4. Populate with SQL template appropriate for the name (create table, add column, add index)
5. Store migration metadata via `mcp__plugin_ruflo-core_ruflo__memory_store --namespace migrations` (the `memory_*` family routes by namespace; `agentdb_hierarchical-*` routes by tier, not namespace)
6. Report: file paths created, migration number, template used

**`migrate up [--dry-run]`** -- Apply pending migrations.
1. Recall migration history to determine which migrations have been applied
2. Find all unapplied migrations in sequential order
3. If `--dry-run`, display the SQL for each pending migration without executing
4. If not dry-run, execute each `.up.sql` file in order, recording results
5. Store execution results (success/failure, duration) in `migrations` namespace
6. Report: migrations applied, total duration, any errors

**`migrate down [--steps N]`** -- Rollback the last N migrations (default: 1).
1. Recall migration history to find the most recently applied migrations
2. Execute corresponding `.down.sql` files in reverse order
3. Record rollback results in `migrations` namespace
4. Report: migrations rolled back, any errors

**`migrate status`** -- Show migration status.
1. List all migration files found in the migrations directory
2. Cross-reference with applied migration history
3. Display: migration number, name, status (applied/pending), applied date, duration

**`migrate validate`** -- Validate pending migrations for safety.
1. Parse all pending `.up.sql` and `.down.sql` files
2. Check foreign key targets exist in the current schema or prior migrations
3. Verify NOT NULL columns have DEFAULT values
4. Flag destructive operations (DROP TABLE, DROP COLUMN)
5. Check that every UP statement has a corresponding DOWN
6. Verify naming conventions (tables plural, columns snake_case)
7. Report: errors, warnings, and info-level suggestions

**`migrate history`** -- Show full migration execution history.
1. Recall all entries from `migrations` namespace
2. Display: migration number, name, direction (up/down), timestamp, duration, status
3. Highlight any failed migrations that may need attention
