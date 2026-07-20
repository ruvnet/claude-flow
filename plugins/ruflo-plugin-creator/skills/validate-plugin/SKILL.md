---
name: validate-plugin
description: Validate a Claude Code plugin structure, frontmatter, and MCP tool references
argument-hint: "[plugin-path]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__transfer_plugin-info Bash Read Glob Grep
---

# Validate Plugin

Validate that a plugin follows the correct Claude Code plugin format.

## When to use

After creating or modifying a plugin, run validation to catch structural issues before publishing.

## Checks performed

1. **Directory structure** — `.claude-plugin/plugin.json` exists at plugin root
2. **plugin.json schema** — required fields present (name, description, version)
3. **Skills auto-discovery** — every `skills/<name>/SKILL.md` is a valid skill (Claude Code auto-discovers from directory; `plugin.json` MUST NOT list a `skills` array)
4. **Commands auto-discovery** — every `commands/<name>.md` is a valid command (auto-discovered; no `commands` array in `plugin.json`)
5. **Agents auto-discovery** — every `agents/<name>.md` is a valid agent (auto-discovered; no `agents` array in `plugin.json`)
6. **No legacy arrays in plugin.json** — presence of `skills`, `commands`, or `agents` arrays in `plugin.json` is a validation error (they cause Claude Code to reject the plugin)
7. **SKILL.md frontmatter** — each skill has `name`, `description`, and `allowed-tools` (no wildcards)
8. **Agent frontmatter** — each agent has `name`, `description`, and `model`
9. **No files in wrong locations** — skills/commands/agents not inside `.claude-plugin/`
10. **MCP tool references** — tools in `allowed-tools` are valid `mcp__plugin_ruflo-core_ruflo__*` identifiers

## Steps

1. Read the plugin's `plugin.json` and assert no `skills` / `commands` / `agents` arrays present
2. Glob `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md` and validate each frontmatter
3. For each SKILL.md, verify frontmatter has required fields and `allowed-tools` has no wildcards
4. For each agent .md, verify frontmatter has required fields
5. Report pass/fail for each check with actionable fix suggestions
