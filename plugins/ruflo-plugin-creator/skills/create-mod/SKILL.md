---
name: create-mod
description: Scaffold a Claude Code mod (a plugin with a function-hooks module) from ruflo's governed template — hybrid hooks.json with a classic fallback, a host adapter over literal $ calls, userConfig options, engine-kit tests and a tsconfig — then validate and test it. Use when the user asks for a mod, a function hook, or wants Claude Code to modify itself.
argument-hint: "<mod-name>"
allowed-tools: Bash Read Write Edit
---

# Create Mod

Scaffold a mod the governed way, instead of an ad-hoc one: the template already follows the rules ruflo's own mod (ADR-404) was reviewed against.

## Steps

1. **Name it.** kebab-case `<name>`. Commands it registers are namespaced `<name>-<verb>`; never register a built-in's name (`/diff`, `/help`) or another plugin's (`/ruos*`, `ruflo-*`).
2. **Scaffold from the template** with `node plugins/ruflo-plugin-creator/scripts/scaffold-mod.mjs <name> <target-dir>`. It copies `templates/mod/`, turns the manifest template `plugin.json.tmpl` into `.claude-plugin/plugin.json` (the template keeps it under a non-manifest name so plugin validators do not mistake `templates/mod` for a second plugin), and replaces `my-mod` everywhere (plugin.json `name`, the command, `MY_MOD_ACTIVE` → `<NAME>_ACTIVE` in both `hooks/register.ts` and `hooks/classic.cjs`, the status folder). Doing it by hand: copy the folder, move `plugin.json.tmpl` to `.claude-plugin/plugin.json`, and make the same replacements.
3. **Keep the status contract.** `hooks/status.ts` writes `.claude-flow/<name>-mod/status.json`, the file the console's Mods section reads. The folder must be `<name>-mod` (lowercase, digits, hyphens, at most 41 characters): the scaffold script already sets `STATUS_PATH` to `<name>-mod`. Fields: `version: 1` (required, anything else is ignored), `summary` (one line), `modVersion`, `guard` (boolean), `calls` (a **number**, not a per-tool object), `blocked` (number), `lastDenied` (a short reason, only once the mod has refused something), plus `updatedMs`/`startedMs`. Other fields are not shown. `tests/status.test.ts` asserts the shape.
4. **Write the behaviour** in pure functions taking the `Host` (see `hooks/host.ts`). In `register.ts`, build the host from literal `$.noun.method(...)` calls only — the engine reads a module's `$` uses off its source, and `claude plugin validate` refuses `$` passed around, computed (`$[noun]`), or deeper than `$.noun.method(input)`.
5. **Keep the rules:**
   - Observe with `const r = await next(e); …; return r`; rewrite with `next({ ...e, … })`; answer (`{ deny }`) only when you mean to stop the chain.
   - On `tool.check`, only ever tighten (the stricter of `await next(e)` and yours); never answer `allow` of your own.
   - Wrap every `$` call so a refusal degrades instead of failing the turn (admins can withhold any `$` affordance).
   - No `$.process.run` / `$.http.fetch` built from event input. Nothing slow on the hot path (about 10 s per dispatch).
   - Anything that must survive a hot reload goes in `$.store` / `$.state`, not module variables.
   - Options come from `userConfig` in plugin.json, not environment variables.
6. **Keep the fallback honest.** `hooks.json` is hybrid: the classic command hook runs everywhere, the module only where function hooks are on (Claude Code >= 2.1.287; 2.1.277+ with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). The module sets `<NAME>_ACTIVE` at `session.start`; the classic script exits early when it sees it, so nothing fires twice.
7. **Validate and test:**
   ```bash
   claude plugin validate <dir>      # lists hooked events, $ calls, env reads/writes
   claude plugin test <dir>          # tests/*.test.ts on the engine kit
   claude -p --plugin-dir <dir> "/<name>-status"   # writes .claude-plugin/types/ and proves a live load
   npx tsc -p <dir>                  # against those generated types
   ```
8. **Ship it in a plugin marketplace** (`marketplace.json` entry), installed with `/plugin install <name>@<marketplace>` and picked up with `/reload-plugins`. If ruflo-mods is installed with `modTrust: refuse-risky`, a mod using `process.run`, `http.fetch`, `env.set` or `fs.write`, or hooking `tool.check`/`tool.call`/`*`, is refused unless its plugin id (`<name>@<marketplace>`) is in `modTrustAllow` — the template sets `env.set` (the fallback handshake), so allow-list it by id.
