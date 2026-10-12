
## As a mod

Function hooks (ADR-445 pattern, `hooks/register.ts`) that need no model call, no network and no process:

- **Tool guard** (default on, tighten-only: it can only deny). Refuses business_pod_validate / business_pod_route_backend calls whose template holds a secret or a credential-named field, or whose template path climbs with `..`, points at a credentials location (`.env`, `.ssh`, `.aws`, ...) or is not a `.json` file. A refusal never echoes the offending value.
- **`/pods-mod`** answers locally: `status`, `scan <text>` and `path <template.json>` (would the guard let this path be read?). (A distinct name from the plugin's own commands/skills, which no hook can answer.)
- **Status file** `.claude-flow/pods-mod/status.json` (`version`, `updatedMs`, `checked`, `blocked`, `byRule`) is written at session start and after each refusal; the console reads it.

Options (`userConfig`): `guard` (on/off, default on).

Test: `claude plugin validate plugins/ruflo-business-pods && claude plugin test plugins/ruflo-business-pods && bash plugins/ruflo-business-pods/scripts/smoke.sh`.
