# RuFlo AI Team — Claude Directory Bundle

This review-safe bundle contains only the Claude plugin manifest, MCP endpoint
configuration, skills, agents, commands, and icon. The runtime implementation,
deployment files, tests, dependencies, generated databases, and credentials are
intentionally excluded from the directory upload.

The hosted MCP service is configured at `https://team.ruv.io/mcp` and requires
OAuth for tenant data and team operations. Skills, commands and agents refer to
the connector's tools by their plain names (for example `team_create`), never by a
Claude Code namespaced identifier, so they read correctly in Claude Code, Cowork
and claude.ai. `skills/`, `commands/` and `agents/` here are copies of the
plugin's own directories; `scripts/smoke.mjs` fails if they drift.
