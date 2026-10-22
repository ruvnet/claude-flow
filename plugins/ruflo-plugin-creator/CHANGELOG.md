# Changelog: ruflo-plugin-creator

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.4.3 — 2026-10-11
- fix: create-plugin required-fields list now matches `audit-plugin-manifest` (adds `keywords`, name equals directory, bump the version on every change) and the agentdb tool count is 20
- fix: validate-plugin check 10 now verifies referenced tools exist (`mcp tools`), not only that they carry the right prefix

## 0.4.2 — 2026-10-09
- fix: the mod template's manifest is plugin.json.tmpl, so the claude.ai validator no longer reads templates/mod as a nested plugin; scripts/scaffold-mod.mjs scaffolds it and a smoke step validates and tests the result

## 0.4.1 — 2026-10-05
- feat: status contract in the create-mod template (0.4.1)

## 0.4.0 — 2026-10-04
- feat: function-hook mod (ADR-445)
- fix: CI — keep metaharness last in doctor help; RUFLO_MODS_OWNS escape hatch; self-contained plugin tsconfigs
- chore: create-mod allow-lists by plugin id, not name

## 0.3.0 — 2026-10-01
- feat: scaffold governed Claude Code mods (create-mod + templates/mod, ADR-404)

## 0.2.1 — 2026-07-16
- feat: ADR-130 — unified graph intelligence backend (P1-P6)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: darwin-plugins iter 3 — ruflo-plugin-creator: align smoke check-count claim in SKILL.md (10+ → ≥8) with ADR/README
- chore: darwin-plugins iter 2 — ruflo-plugin-creator: fix validate-plugin contradiction (plugin.json must not have skills/commands/agents arrays)
- chore: bulk-update plugin contract ADR statuses (sweep)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — scaffold the canonical contract + MCP-drift warnings (ADR-0001)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: remove invalid skills/commands/agents arrays from plugin creator template

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
