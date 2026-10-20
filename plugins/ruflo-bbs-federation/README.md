
## As a mod

Function hooks (ADR-445 pattern, `hooks/register.ts`) that need no model call, no network and no process:

- **Tool guard** (default on, tighten-only: it can only deny). Refuses federation_bbs_* calls that carry a secret in a published message or a credential-named field, a peer URL with embedded credentials or a non-http(s) scheme, and (unless allowed) a serve bind on every interface. A refusal never echoes the offending value.
- **`/bbs-mod`** answers locally: `status`, `scan <text>` (would the guard refuse publishing this?) and `peer <url>` (would it accept this peer URL?). (A distinct name from the plugin's own commands/skills, which no hook can answer.)
- **Status file** `.claude-flow/bbs-mod/status.json` (`version`, `updatedMs`, `checked`, `blocked`, `byRule`) is written at session start and after each refusal; the console reads it.

Options (`userConfig`): `guard` (on/off, default on), `allowWildcardBind` (default off).

Test: `claude plugin validate plugins/ruflo-bbs-federation && claude plugin test plugins/ruflo-bbs-federation && bash plugins/ruflo-bbs-federation/scripts/smoke.sh`.
