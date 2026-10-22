# ADR 441: Loop-centric missions: settings, guidance and plan phases

Status: Accepted (shipped in ruflo-console 0.28.0 and its companion plugins, PR #3667)

Date: 2026 10 04

Scope: `plugins/ruflo-console` (mission guidance, the GOAP plan text, Settings, Help)

Source: ADR 438 §1 (loop-centric missions). The approach is the one used to build the research-integration mission itself.

## 1. Decision

A mission is driven as a bounded loop, and the console's settings and guidance prompts say so and default to it.

- **The loop.** `/loop <interval> <objective>`, default `5m`. Each tick (1) checks progress against the plan, (2) fixes what failed, (3) runs the named gates, (4) repeats until every phase is complete and green.
- **Gates** come from the plan: always the full test suite, then the build and smoke checks, the review, the security review and the benchmark when the plan's goal asks for them. A gate counts only when its real output was read; a fix is mutation-checked (break it once, see the test fail, restore).
- **Finish condition**, stated up front: every phase's acceptance checks pass and every gate is green on the same clean commit. Then the loop stops and reports.
- **Defaults are stated, not asked**, so there are no mid-loop questions. The loop stops to ask only when a gate fails the same way three ticks running, an acceptance check cannot be met within the scope, or an action would leave the branch without its setting.
- **Concurrent writers** work in isolated git worktrees on disjoint files; readers (research, review, audit, validate) only read. Plan waves show how many writers run at once (capped) and who owns what. Each plan step carries its acceptance check.
- **Nothing leaves the branch without a setting.** Commits go to the mission branch only; push and publish are off by default, and the guidance says "do not push" / "do not publish, release or deploy" unless the setting is on.

Surfaces: `loopLines` and `planText` (mission-text.ts) render the loop; `guidancePrompt` (mission-guidance.ts) carries it to Claude and asks for a "Loop" section; `goap.ts` holds the types, defaults, gates and writer roles; `settings.ts` stores the preferences with the AI preferences; Help has the guide `mission-loop`.

## 2. Settings (stored with the AI preferences, key `ai-prefs`)

| Row | Default | Choices |
|---|---|---|
| Mission loop interval | 5m | 2m 5m 10m 15m 30m |
| Worktree per writer | on | on, off |
| Loop may commit (mission branch) | on | on, off |
| Loop may push | off | on, off |
| Loop may publish | off | on, off |
| Max concurrent writers | 6 | 1 2 4 6 8 |

A bad or missing stored value is the default. Push and publish turn on only from an explicit stored `true`. `LOOP_ROWS` in `settings.ts` is the row list; the Settings page maps over it.

## 3. Constraints

- No new storage, no plugin.json `userConfig` key, no new network call. The console only prepares text; it never commits, pushes or publishes.
- Defaults are the user's to change; the setting, not the prompt, decides what may leave the branch.

## 4. Not decided here

- Whether a loop line should be offered as a one-press start from the Missions page: left to the Missions owner.
- Per-profile intervals (a bug fix may want a shorter tick than a security review) are deferred.
