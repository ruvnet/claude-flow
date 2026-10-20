# ruflo-mods live paths: evidence, 2026-10-05

Closes review improvement #14 of `mod-capability-review-2026-10.md`: the ruflo-mods rows whose "live-verified" column read **no**.
Method: `scripts/live-ruflo-mods-paths.sh` (new; follows `scripts/live-ruflo-mods.sh`). Each probe is a real headless
`claude -p` session (model `haiku`, `--plugin-dir plugins/ruflo-mods`, `--setting-sources local`, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)
in its own `mktemp -d` git project with a `.claude-flow/` directory (the mod's opt-in boundary). Nothing under `plugins/` was changed.
Spend about $0.5 for all four phases (each probe $0.02 to $0.06; the `/ruflo-mods` probes cost $0). Outputs below are copied from the runs.

Auth screening: every reply and tool result is matched against an auth/account/telemetry pattern before printing. Replies withheld: **0**.
Nothing auth-like appeared, so nothing was omitted; the engine's init message is never stored beyond the plugin names.

## 1. Routing: `prompt.submit` route context (proven)

Prompt asks the model to copy the `[INFO] Routing task:` block from its context, or reply `NONE`.

| Probe | Observed |
|---|---|
| plugin loaded, "write a unit test for the parser" | block with `Agent: tester`, `Confidence: 60.0%`, `Reason: Matched keyword(s) from: test\|tests\|testing\|spec\|spe` |
| plugin loaded, "zzz qqq" (no keyword) | block with `Agent: coder`, `Confidence: 30.0%`, `Reason: Default routing - no specific keyword matched` (the #3567 no-match wording) |
| plugin loaded, `routeContext: false` | the same tester block, so that option does **not** turn routing off; it only drops the ranked-memory block (see its description) |
| **no plugin** (control) | `NONE` |

So the in-process route reaches the model as prompt context, and without the mod the block is absent. The scratch project has no classic
hook configured, so the mod owned `route` (status below shows `owns: route, post-edit`).

## 2. Deny: `tool.check` dangerous-command list (proven)

The probe asks for `echo format c: > ran.txt`, a `DANGEROUS_COMMANDS` entry that is inert on Linux, so a permitted run is harmless
and `ran.txt` shows whether the command executed.

| Probe | Tool result the model saw | `ran.txt` |
|---|---|---|
| plugin, dangerous | `ERROR Permission to use Bash denied by plugin ruflo-mods: ruflo: dangerous command blocked (format c:)`; model replied `DENIED: ruflo: dangerous command blocked (format c:)` | absent |
| plugin, benign `echo hello > ran.txt` | `(Bash completed with no output)`; model replied `RAN` | `hello` |
| **no plugin** (control), dangerous | `(Bash completed with no output)`; model replied `RAN` | `format c:` |

The deny is the mod's: same command, same project shape, only the plugin differs; the benign command is not caught.

## 3. Status file: the session heartbeat (proven; the path is `session.json`)

There is no `status.json`. The mod's file is `.claude-flow/mods/session.json` (`hooks/session.ts:14`, display only, read by `ruflo mods doctor`).

- Project with `.claude-flow/`: before the session `absent`; after: `{ "startedAt": "2026-10-05T05:56:00.886Z", "owned": [ "route", "post-edit" ], "statusLine": true }`.
- Project without `.claude-flow/`: `owns: nothing (classic hooks keep every event)` and `.claude-flow` **not created** (the opt-in boundary holds).

## 4. `/ruflo-mods` command (proven, answered by the mod with no model call, cost $0)

One session, in order: `/ruflo-mods`, a routed prompt, a refused Bash call, `/ruflo-mods`.

First report: `routed: 0 prompt(s); last none yet`, `policy: none; 0 call(s) tightened, 0 observed`.
Second report: `routed: 2 prompt(s); last coder (30%, no match)`, `policy: none; 1 call(s) tightened, 0 observed`.
Two prompts were routed (the route prompt and the Bash prompt, which matches no keyword), and one call was tightened: the counters
agree with what the session did. The full report also lists `owns`, `edits`, `budget`, `tool hints`, `agent trim`, `delivery`, `segments`, `guidance` (all `off`/`none` by default).

## What could not be provoked, or is not proven

- **Route rationale quoting**: the model sometimes copies the block's first line as `[INFO] Routing task:` followed by part of the prompt, and
  sometimes drops the prompt text; the box lines (agent, confidence, reason) were stable across runs. Proof rests on those lines plus the `NONE` control.
- **Routing off switch**: no option disables routing alone, so there is no "mod loaded, routing off" control; the control is "no plugin".
- **`rm -rf /` and the other list entries**: not run live. `rm -rf /` is destructive if the mod failed to load, so only the inert `format c:` entry was used; the other entries are covered by the parity unit tests.
- **Policy projection deny/ask** (`.claude-flow/policy/claude-code.json`): not exercised; `policy: none` throughout.
- **Edit learning, cost ladder, guidance observation, trust gate** rows of the matrix: out of scope for this item.
- Single run per probe at `haiku`; a different model may phrase its quote differently. The deny and status results are deterministic (hook output and file state), the route quote is model-mediated.

Reproduce: `scripts/live-ruflo-mods-paths.sh all` (or one of `route deny status command`).
