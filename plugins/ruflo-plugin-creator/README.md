# ruflo-plugin-creator

Scaffold, validate, and publish new Claude Code plugins with proper structure, MCP tool wiring, AND the canonical plugin contract (ADR + smoke + Compatibility + namespace coordination).

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-plugin-creator@ruflo
```

## Features

- **Scaffold plugins**: Generate complete plugin directory structure in seconds, including the canonical contract (ADR-0001, scripts/smoke.sh, README contract sections)
- **Validate format**: Check plugin.json, SKILL.md frontmatter, and file references
- **MCP tool wiring**: Auto-discover and wire ruflo MCP tools into skills, with **drift warnings** for known-broken tool references (`embeddings_embed`, namespace passed to `agentdb_hierarchical-*` / `agentdb_pattern-*`)
- **Marketplace integration**: Update marketplace.json for distribution

## Commands

- `/create-plugin` -- Interactively scaffold a new Claude Code plugin

## Skills

- `create-plugin` -- Generate plugin structure with skills, commands, agents, ADR-0001, smoke test, and contract sections
- `validate-plugin` -- Validate plugin format and catch issues before publishing
- `create-mod` -- Scaffold a Claude Code mod (function hooks) from `templates/mod/` (`scripts/scaffold-mod.mjs <name> <dir>`; the manifest is `plugin.json.tmpl` so validators do not read it as a nested plugin): hybrid `hooks.json` with a classic fallback that stands down while the module runs, a host adapter over literal `$` calls, `userConfig`, engine-kit tests, tsconfig. Validated with `claude plugin validate` and `claude plugin test` (ruflo ADR-404)

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-plugin-creator/scripts/smoke.sh` is the contract.

## Canonical plugin contract (what gets scaffolded)

Every plugin scaffolded by this plugin inherits the same shape every other plugin in the ruflo family adopted via its own ADR-0001:

```
plugins/<name>/
├── .claude-plugin/plugin.json     # version, keywords, mcp keyword
├── skills/<skill>/SKILL.md         # name + description + allowed-tools (no wildcards)
├── commands/<command>.md           # name + description + dispatch logic
├── agents/<agent>.md               # name + description + model
├── docs/adrs/0001-<name>-contract.md   # ADR (Proposed) — pinning, namespace, smoke scope
├── scripts/smoke.sh                # Structural contract, ≥8 checks
└── README.md                       # Compatibility + Namespace coordination + Verification + ADR
```

## MCP-tool drift to avoid

Lessons learned from sibling-ADR fixes — the scaffolder warns about these:

| Bug | Real tool / pattern |
|-----|---------------------|
| `embeddings_embed` referenced as a tool | Use `embeddings_generate` (the `_embed` name does not exist) |
| `namespace` arg passed to `agentdb_hierarchical-*` | Use `tier` (working/episodic/semantic), or use `memory_*` for namespaced reads/writes |
| `namespace` arg passed to `agentdb_pattern-*` | Don't pass it — ReasoningBank routes; fallback writes to `pattern` reserved |
| `pattern` and `patterns` confused | They are **different** reserved namespaces |
| Hard-coded "19 AgentDB controllers" | Defer to `agentdb_controllers` runtime; real count varies (20 MCP tools, 29 controller names) |

## Verification

```bash
bash plugins/ruflo-plugin-creator/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-plugin-creator plugin contract (scaffold-the-canonical-contract, MCP-drift warnings, smoke as contract)](./docs/adrs/0001-plugin-creator-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; `agentdb_controllers` runtime is the canonical controller list
- `ruflo-cost-tracker`, `ruflo-market-data`, `ruflo-migrations`, `ruflo-observability` — each fixed namespace-routing bugs the scaffolder now warns about
- `ruflo-knowledge-graph`, `ruflo-market-data` — each fixed `embeddings_embed` references the scaffolder now warns about

## As a mod

Function-hook mod (ADR-445, pattern of `ruflo-agentdb`), loaded from `hooks/hooks.json` → `hooks/register.ts`. This plugin's own tools only search the plugin store, so there is no guard and no `userConfig`: the mod is a local command and a status file.

- **Command**: `/creator-mod` answers locally with no model call, read-only. Verbs: `status`; `reserved <plugin-dir>` lists the command and skill names a plugin already uses (a mod command must not reuse one); `check <plugin-dir>` summarises its manifest, `hooks.json` modules and `userConfig` options. Paths with `..` are refused.
- **Status file**: `.claude-flow/creator-mod/status.json` (`{version, updatedMs, checked, reserved, lastTarget}`).
- **Safety**: no network, no process spawning.
- **Scaffold status contract** (0.4.1): `/create-mod` scaffolds `hooks/status.ts`, which writes `.claude-flow/<name>-mod/status.json` with the fields the console's Mods section reads: `version: 1`, `summary`, `modVersion`, `guard`, `calls` (a number), `blocked`, `lastDenied` (only once the mod has refused something), plus `updatedMs`/`startedMs`. The scaffold's `tests/status.test.ts` asserts that shape; the steps are in `skills/create-mod/SKILL.md`.
- **Test**: `claude plugin validate plugins/ruflo-plugin-creator`, `claude plugin test plugins/ruflo-plugin-creator`, `bash plugins/ruflo-plugin-creator/scripts/smoke.sh`. The runner sweeps in `templates/mod/tests` (the scaffold's own test, which only passes against a scaffolded mod), so expect that one file to fail from the plugin root. `node plugins/ruflo-plugin-creator/scripts/test-scaffold-mod.mjs` scaffolds a mod from the template and holds it to `claude plugin validate` and `claude plugin test`.
