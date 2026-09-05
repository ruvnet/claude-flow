---
name: migrate-create
description: Create a new sequentially numbered database migration with up/down SQL files
argument-hint: "<name>"
allowed-tools: Read Write Glob Bash mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search
---

# Migrate Create

Generate a new database migration with sequential numbering and up/down SQL file pair.

## When to use

When you need to create a new database migration for schema changes such as creating tables, adding columns, creating indexes, or modifying constraints.

## Steps

1. **Determine next number** -- use `Glob` to scan the migrations directory for existing migration files and find the highest number, then increment by 1 (zero-pad to 3 digits)
2. **Select template** -- based on the `<name>`, choose the appropriate SQL template:
   - Names starting with `create_` -> CREATE TABLE template
   - Names starting with `add_` -> ALTER TABLE ADD COLUMN template
   - Names starting with `drop_` -> DROP with safety checks
   - Names containing `index` -> CREATE INDEX template
   - Other -> generic migration template with placeholder comments
3. **Generate up migration** -- write `NNN_<name>.up.sql` with the appropriate SQL using IF NOT EXISTS for idempotency
4. **Generate down migration** -- write `NNN_<name>.down.sql` with the reverse operation using IF EXISTS
5. **Search past patterns** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` (ReasoningBank-routed; **don't** pass a `namespace` argument — pattern-* tools ignore it).
6. **Store metadata** -- call `mcp__plugin_ruflo-core_ruflo__memory_store --namespace migrations` to record the migration with number, name, status (pending), and file paths. The `memory_*` tool family routes by namespace; `agentdb_hierarchical-*` does NOT (it routes by tier `working|episodic|semantic`), so use `memory_*` here. See [ruflo-agentdb ADR-0001 §"Namespace convention"](../../../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md).
7. **Report** -- display: migration number, file paths created, template used, any similar past migrations found

## CLI alternative

```bash
npx @claude-flow/cli@latest memory store --namespace migrations --key "migration-NNN_NAME" --value '{"number": NNN, "name": "NAME", "status": "pending"}'
```
