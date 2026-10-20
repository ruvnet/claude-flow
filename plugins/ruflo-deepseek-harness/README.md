# ruflo-deepseek-harness

DeepSeek chat and reasoning completions as ruflo skills (see `commands/ruflo-deepseek-harness.md`).

## As a mod

Since this version the plugin is also a function-hook mod (ADR-445 pattern; needs Claude Code 2.1.287 or later). It never calls the network or spawns a process, and it only tightens: it can refuse a call, never allow one.

- **Guard** (default on): refuses Bash commands that run this plugin's `chat.mjs`/`reason.mjs` (they post the prompt to api.deepseek.com) that hold a key, token or password. The reason names the kind of secret, never the value.
- **`/deepseek-mod`**: answered locally, no model turn: `status`, `scan <text>` (would the guard refuse this?).
- **Status file**: `.claude-flow/deepseek-mod/status.json` (`{version, updatedMs, guard, blocked}`), written at session start and when a call is blocked.
- **Option**: `guard` (`on` | `off`, default `on`) in the plugin's `userConfig`.

Test it: `claude plugin test plugins/ruflo-deepseek-harness` and `bash plugins/ruflo-deepseek-harness/scripts/smoke.sh`.
