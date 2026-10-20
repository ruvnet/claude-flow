# ruflo-protector: Project Anatole

**Project Anatole** is an optional, learning watchdog for unattended agents (`/loop` ticks, headless `claude -p` workers, overnight swarms). It is a mod ([ADR-404](../../v3/docs/adr/ADR-404-ruflo-as-a-mod.md) pattern) that watches what the agent does, applies a small set of deterministic, OWASP-mapped rules, remembers what is normal for the project, and leaves a record you can read when you come back. Design and threat model: [ADR-453](../../v3/docs/adr/ADR-453-project-anatole.md). Version 0.1.1, **default off** (not in any install bundle).

> The technical id stays `ruflo-protector` (command `/protector`, files `.claude-flow/protector-mod/`, rule ids `PR-001..013`). "Project Anatole" is what a person sees.

## What it does

1. **Rules** (the only thing that can ever block): 13 narrow rules, each a pure function of a categorical event, each with OWASP LLM / Agentic-threat references. `PR-001` secret to a network sink, `PR-002` remote code piped into a shell, `PR-003` persistence (Claude settings, hooks, rc files, cron, authorized_keys, git hooks), `PR-006` destructive operations ship as `block`; the rest (`PR-004` credential read then egress, `PR-005` risky action after outside content, `PR-007` rate burst, `PR-008` new host with a body, `PR-009` write outside the project, `PR-010` peer message with override phrasing, `PR-011` spawn escalation, `PR-012` dependency from a URL, `PR-013` system prompt to a network sink) ship as `notify`. `/protector list` shows each one.
2. **A baseline** (notify only): per project, categorical and bounded (tool names, command heads, host classes, path areas, spawn types, call rate; at most 2,000 entries). A learned anomaly alerts only when it is corroborated by a risky action and the baseline is mature (200 events, 3 sessions, 24 hours). A novel read never alerts.
3. **A record**: `status.json`, `alerts.jsonl`, `baseline.json`, `rules.json`, `allow.json` under `.claude-flow/protector-mod/` (schemaVersion 1, bounded), a toast, and `/ruflo-mods` shows one `protector:` row.

No argument value, file content or prompt text is ever stored: events become tokens (`Bash`, `git commit`, `github.com`, `src/auth`). A secret-shaped token is replaced by `redacted`.

## Modes

| Mode | Effect |
|---|---|
| `off` | does nothing |
| `learn` (default once installed) | records the baseline, says nothing; a rule hit is only counted |
| `notify` | alerts (file, toast), never blocks |
| `enforce` | a rule marked `block` denies (never asks: nobody is there at 3 a.m.); everything else still only notifies |

`learn` graduates to `notify` when the baseline is mature (option `autoGraduate`, default on). **It never enables `enforce` by itself.** A fail-open design: an error inside the protector never blocks a tool call; it sets `degraded` in the status file.

## Keeping false positives out

| Control | What it does |
|---|---|
| Learning period | no anomaly alert before 200 events, 3 sessions and 24 hours |
| Corroboration | novelty alone never alerts; only a risky action (egress with a body, write outside the project, unknown spawn) |
| Narrow rules | blocking rules are literal shapes; heuristic ones are `notify` only; `PR-003` exempts the ruflo setup commands by exact argv |
| Clean-event learning | the baseline learns only events with no rule hit, no denial, and no tainted turn; a new host, outside-project area, command or spawn type counts only after two sessions |
| Dedup and rate limit | one alert per fingerprint per session (repeats raise a count); at most 20 alerts an hour; the rest are counted |
| Feedback | `/protector ack <id>` marks a false positive (fingerprint allowed, baseline taught); a block rule with more than 30% acked among 10+ alerts is demoted to `notify` and shown as auto-demoted |
| Shadow replay | `/protector replay` re-scores the recorded ring (last 500 events) against the current rules and baseline, so you can check precision before `enforce` |
| Corpus gate | `tests/corpus.test.ts`: 24 benign development traces must give zero alerts after a mature baseline; an attack trace per rule must be caught |

## Reading alerts

`/protector alerts [n]` or `alerts.jsonl`: `{id, at, rule, owasp, severity, action: blocked|notified, tool, summary, fp, state, session}`. `summary` is a shape ("remote code piped into an interpreter (Bash · head curl · host x.example)"), never a value; `fp` is a 12-hex fingerprint of (rule, command head, host or area). A block reason names the rule and the way out: `/protector allow <fp>`.

## `/protector`

Answered locally, no model turn.

| Verb | Does |
|---|---|
| `status` | one-screen summary |
| `list` | every rule: id, OWASP refs, severity, mode, hits, acked share |
| `rule <id> <off\|notify\|block>` | change one rule's mode (writes `rules.json`) |
| `mode <off\|learn\|notify\|enforce>` | change the mode |
| `run` | scan the project's `.claude/settings*.json` for exposure (secrets, pipe-to-shell hooks, `bypassPermissions`, wildcard allows) |
| `replay` | shadow-score the event ring; what would fire in notify and in enforce |
| `alerts [n]` | the last n alerts |
| `ack <id>` / `unack <id>` | mark an alert a false positive (and teach the baseline) / undo |
| `allow <fp>` | allow a fingerprint without an alert |
| `reset-baseline` | forget the baseline and start learning again |

## Toasts (ADR-477)

Project Anatole draws its toasts through the shared toast policy (one copy of `hooks/toast-policy.ts`, kept identical across the ruflo mods by `scripts/sync-toast-policy.mjs`): a level prefix (`›` info, `✓` ok, `⚠` warn, `✗` error), one clean line of at most 120 characters with secrets masked, an identical toast not repeated for a minute, and at most four a minute per source (errors are held and counted, never dropped). A blocked call is an `error`, an alert that only notified is a `warn`, and the baseline graduating to `notify` is an `info` marked always-show.

The person's choice is the console's **Settings → Interface and updates → Toasts**: `all`, `important` (warnings and errors) or `off`, and a mute chip per source. Every toast, drawn or not, is kept as a digest the console shows on its Events page, flagged with what became of it; without the console nothing is written and the defaults apply.

## Options

| Option | Default | Effect |
|---|---|---|
| `mode` | `learn` | the starting mode (`off`, `learn`, `notify`, `enforce`); a mode set with `/protector mode` is saved in `rules.json` and wins |
| `autoGraduate` | `on` | move `learn` to `notify` when the baseline is mature; never to `enforce` |

## Try it safely

1. Install it (it is not in any default bundle) and leave the mode at `learn`. Work as usual for a few days: it only learns.
2. When it graduates to `notify`, read `/protector alerts` after each unattended run and `ack` the false positives.
3. `/protector replay` shows what `enforce` would have blocked on your recent work. Only then consider `/protector mode enforce`.
4. `ruflo-mods` with `modTrust = "refuse-risky"` refuses a mod that hooks `tool.check`: add `ruflo-protector@ruflo` to `modTrustAllow`.

## Events and what is not covered

Hooks: `tool.check` (every tool use; Bash, Write/Edit, WebFetch, MCP calls, SendMessage), `agent.spawn`, `session.receive` (peer messages, `PR-010`), `turn.start` / `turn.complete`, `session.start` / `session.end`, `command.run`. Not hooked, said plainly: the engine's `http.fetch` is a *plugin's* own request, not the model's, so model egress is seen through `tool.check` on WebFetch, WebSearch, network commands and remote MCP calls; `prompt.submit` is not used (the prompt for taint comparison comes from `turn.start`); a `tool.check` verdict that is `ask` is learned unless denied (the person approved or will decide). `PR-004` follows cred reads through Read/Bash only, `PR-007` counts `tool.check` calls per minute. The `files are a courtesy` rule: decisions use the mod's memory, never a file re-read mid-session, so editing `rules.json` or `allow.json` while a session runs changes nothing until the next session.

## Performance

`npx tsx plugins/ruflo-protector/scripts/bench.mjs`: median added cost per tool call is under 1 ms (budget); measured medians are 5 to 15 microseconds for ordinary calls and about 70 microseconds for a 200 KB write.
