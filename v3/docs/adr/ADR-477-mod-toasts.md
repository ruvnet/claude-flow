# ADR 477: Mods: one toast system, with levels, de-duplication, a record and a setting

Status: Accepted

Date: 2026-10-07

Builds on: ADR-404 (ruflo as a mod), ADR-453 (Project Anatole), ADR-474 (the Events store), ADR-466 (the autopilot's notices)

Numbering: ADR-475 (policy ledger anchor) and ADR-476 (hive-mind gating) were taken by other changes while this was written.

## 1. Context

A mod's toast is `$.ui.toast(text, { timeoutMs })`: transient, one line, no click, fire and forget, and the host may refuse it. Four ruflo
plugins used it, each with its own wrapper: `ruflo-console` (`quietly(...)` in `register.ts`, `update-flow.ts`, the autopilot's `say`),
`ruflo-swarm` (`host.toast`, the `Next:` fallback), `ruflo-protector` (a local `toast()` that swallows errors) and `ruflo-mods` (the budget
ladder, the delivery screen and `agentTrim`, each with its own `try`). Only the autopilot also queued a notice.

What that left:

- no shared helper: four wrappers that trim, swallow and fail differently;
- no levels: a budget CRITICAL and an informational "update available" looked the same;
- nothing kept: a toast the person looked away from was gone, and so was its text;
- no de-duplication or rate limit: one loop could stack twenty identical lines;
- no control: a person who wanted quiet could not have it, and one who wanted only the important ones could not say so;
- silence where it mattered: a mission finishing or failing, a subagent dying and a loop going round in circles said nothing.

## 2. Decision

**One policy, carried by every plugin; one setting, owned by the console; one digest per toast, read by the console.**

### 2.1 The policy (one canonical file, byte-identical copies)

`plugins/ruflo-mods/hooks/toast/policy.ts` is the canonical source. It has no import and never touches `$`. A plugin ships alone through
the marketplace and cannot import a sibling's file at run time, so each other plugin carries a copy at `hooks/toast-policy.ts`.
`scripts/sync-toast-policy.mjs` writes the copies; `--check` fails naming any that differ. The same check is a step of each plugin's
`scripts/smoke.sh` (which CI runs through `smoke-all`) and of `tests/toast-policy.spec.ts`. Edit the canonical file, run the script, never
a copy.

### 2.2 Contract

| rule | value |
|---|---|
| levels | `info` `ok` `warn` `error`, drawn with the prefix `›` `✓` `⚠` `✗` |
| one line | escape sequences and control, zero-width, bidi and tag characters removed; white space collapsed; credentials, e-mail addresses and home paths masked; the whole line, prefix included, is at most 120 characters, cut with `…` |
| de-duplication | an identical (source, text) is not drawn again for 60 s (the level is not part of the identity) |
| rate limit | at most 4 drawn toasts per source per 60 s |
| errors | an error past the limit is never dropped: it is held and said once when the window has room, as `✗ <first> … and N more`; muting or switching toasts off drops what is held (it is already recorded) |
| setting | `all`: every level; `important`: `warn`, `error`, and anything marked `always`; `off`: none |
| mute | a source in the muted list draws nothing, whatever its level, errors included |
| away only | `awayOnly` holds a toast back only when the host says the person is present; with no such signal it draws as usual |
| failure | a host that throws is a `refused` toast; a failing clock, setting or recorder falls back to the wall clock, the defaults, or nothing. Nothing in the policy throws to its caller |

Every toast, whatever became of it (`shown`, `deduped`, `rate-limited`, `coalesced`, `muted`, `off`, `filtered`, `away`, `refused`), is
recorded as a **digest**: time, source, level, the washed text, the outcome. Empty text records nothing.

### 2.3 The setting

Owned by the console (Settings → Interface and updates → Toasts): `all | important | off`, and one mute chip per source (`console`, `swarm`,
`protector`, `mods`). Kept in the console's plugin store like `updates` and the nav style (no confirm: it only narrows what is shown), and
mirrored to `.claude-flow/console/toast-prefs.json` (`{"v":1,"mode":...,"muted":[...]}`), which the other plugins read through
`$.fs.read` at most every 4 s. No file, or one that does not parse, is `all` with nothing muted. A plugin with no console runs on the
defaults.

### 2.4 The record

- The console records its own digests in memory; the Events pass turns them into events.
- The other plugins keep a ring of their last 60 digests in **their own file**, `.claude-flow/console/toasts/<source>.jsonl`, rewritten
  whole with `$.fs.write` (a plugin has no append, and the Events file is appended by `dd` from the console, so a plugin never writes it).
  Identical neighbours are counted (`n`), not repeated. A plugin writes only when `.claude-flow/console/` exists: that folder is the
  console's, and its own `.gitignore` covers it. Without the console nothing is written.
- The console reads those files on its 1.5 s pass (when a file's modification time moved), decodes and washes every line again (a file is
  not trusted), ignores a line that claims another source, and takes in only digests newer than its own start. They become `notices` events
  with `src: toast`, written to `events.jsonl` under the existing masking, caps and the `eventsPersist` option.
- Only masked, length-capped digests are written or read. No network.

### 2.5 Call sites

| plugin | toast | level |
|---|---|---|
| mods | budget INFO / WARNING / CRITICAL / HARD_STOP | info / warn / error / error |
| mods | delivery screen dropped or held back a message | error |
| mods | `agentTrim` hid agent types (once) | info |
| protector | blocked a call | error |
| protector | noticed (an alert, not a block) | warn |
| protector | baseline mature, mode moved to notify | info, `always` |
| swarm | `Next: …` when the prompt box could not be filled | info, `awayOnly` |
| console | update available, updating | info |
| console | update installed / failed | ok / warn |
| console | autopilot notices (`say`) | their own level (`bad` is `error`) |

New sources, each behind the same setting:

| source | when | level |
|---|---|---|
| console | a mission finished (every task done) | ok |
| console | a mission lost a task (the task store shows `failed`) | error |
| swarm | a subagent's turn ended with a reason other than `answer` or `aborted` | error |
| swarm | a loop failed the same call (same tool, same subject) three times running | warn |

**Not built: a watched-PR CI result.** No watcher exists in the console or any mod; one would be a new network call, which this change
does not add. **`Next:` is not away-only in practice:** the engine exposes no terminal-focus signal to a mod (`isFocused` in the engine's
types is a pane's focus, not the terminal's), so `awayOnly` draws as usual until it does; the policy honours the flag the day a host
answers it.

## 3. Threat and robustness

- A toast is attacker-influenced text (a rule name, a peer's origin, an agent's label). It is washed to one line and masked before it is
  drawn or written; the digest is washed again when read; a ring file is not trusted to name its own source.
- A toast changes no verdict, answer or hook result: every call is in a `try`, a refusal is swallowed, and the mods' verdicts wait at most for
  the clock and one setting read (cached for 4 s), never for a digest write (the recorder is fire and forget). A fire-and-forget toast
  after the hook returned was tried and lost digests in the engine kit, so the mods await the toast, not the write.
- Muting is the person's alone and only narrows: no plugin can unmute another, and the default with no file is "all", so a deleted or
  corrupt setting never silences an error for good.
- The engine's static validation follows `$` only into a function declared in the same file: the mods bind the engine's calls from the `$`
  built beneath (`engine.create`, as `ui.status` already is) and, if that did not run first (a test harness), from `session.start`'s own `$`;
  protector passes `$` to a top-level function, and swarm and the console build
  the toaster inside the function that holds `$`.
- Each plugin adds no hook event and no network or process call; `ruflo-mods`' smoke still lists exactly the events it did.
- A write by two sessions of one plugin is last-writer-wins on a 60-line courtesy ring; nothing depends on it.

## 4. Consequences

- One behaviour, in one file, tested once. A new plugin adopts it by copying the file (the script) and calling `createToastKit`.
- A person can have quiet (`off`), only what matters (`important`), or mute one noisy source, and loses nothing: the Events page keeps
  every toast with its outcome.
- Four plugin versions move: console 0.37.0, swarm 0.3.4, protector 0.1.1, mods 0.3.16. No lockfile or npm package changes.
- Cost: a plugin that never meets the console still carries the policy file (about 440 lines) and runs a few clock and file calls per
  toast; a plugin with no console folder writes nothing.
- Known limits: the digests of a plugin that was not running during a console session reach Events only as long as the file's newest 60
  lines hold them; the policy keeps one clock per plugin, so two plugins' rates are independent by design (per source).

## 5. Test plan

- `tests/toast-policy.spec.ts` (console, vitest): prefixes, washing and masking (including a NUL inside a key), the 120-character limit,
  de-duplication at the window's edge, the rate limit and its reopening, held errors and their count, `all`/`important`/`off`, mute,
  held errors dropped on off, `awayOnly`, a throwing host, a throwing recorder, clock and setting, an async clock and setting, the
  setting's file round trip and its hostile forms, the ring (count, cap, round trip, distrust), the kit (setting read and cached, digests
  beside it, no console means no file, a second session keeps the first's lines, an unreadable disk), and the copies' identity.
- Mutation check of that spec: each of DEDUPE_MS, RATE_MAX, LINE_MAX, the error prefix, the error hold, the `important` filter, the mute,
  `off`, `awayOnly` and the secret mask is flipped in turn and the spec must fail.
- `ruflo-mods/tests/toast.test.ts`, `ruflo-protector/tests/mod.test.ts`, `ruflo-swarm/tests/toast.test.ts` (engine kit): a budget crossing
  toasts once with its prefix and persists; a duplicate is suppressed and recorded; past four errors are held, counted and all recorded;
  off and mute draw nothing and still persist; the setting is re-read; a refusing host never changes the answer; without the console no
  file is written; swarm's stuck loop and failed subagent.
- `ruflo-console/tests/toasts.spec.ts` and `tests/toasts.test.ts`: the setting's store and mirror, a failing store or disk, digests as
  events, the ring files' trust rules, the pass, the bound on the log, the mission notices; end to end through Settings (the Toasts row
  and chips, the toast drawn, repeated, off, muted, and on the Events page flagged).
- Each plugin's `scripts/smoke.sh` compares its copy with the canonical file.

## Update 2026-10-07

Checked against `plugins/ruflo-mods/hooks/toast/policy.ts` (the canonical policy, 461 lines; the copies at
`plugins/ruflo-console/hooks/toast-policy.ts`, `plugins/ruflo-swarm/hooks/toast-policy.ts` and
`plugins/ruflo-protector/hooks/toast-policy.ts` are the same length), `plugins/ruflo-console/hooks/toasts.ts`,
`plugins/ruflo-console/hooks/register.ts` and the call sites in `plugins/ruflo-swarm/hooks/register.ts`,
`plugins/ruflo-protector/hooks/register.ts`, `plugins/ruflo-mods/hooks/{session,noun}.ts`. Nothing in section 2.2 is contradicted by the
code. What was missing is the order in which the rules run, which decides the outcome when two apply. It is below.

**Editorial repair.** The first bullet of section 3 about the engine's static validation had been overwritten by a replacement-string
accident (the whole document was pasted into the middle of it, three times). It is restored to one bullet above; no decision text changed.

### The behaviour matrix, as shipped

A toast is decided by `run()` in `policy.ts`, which tests these rules **in this order and stops at the first that applies**:

| # | rule | outcome (the digest's `why`) |
|---|---|---|
| 0 | the washed text is empty | `empty`: nothing drawn, nothing recorded |
| 1 | mode is `off` | `off` |
| 2 | the source is in the muted list | `muted` |
| 3 | mode is `important`, the level is `info` or `ok`, and the toast is not `always` | `filtered` |
| 4 | the toast is `awayOnly` and the host answers `false` for "away" | `away` |
| 5 | the same washed text was drawn or held in the last 60 s | `deduped` |
| 6 | fewer than 4 toasts drawn in the last 60 s | draw it: `shown`, or `refused` if the host throws (a refused toast is not remembered, so it may be tried again) |
| 7 | no room, and the level is `error` | `coalesced`: held (first text kept, a count of more) |
| 8 | no room, any other level | `rate-limited`: dropped (recorded) |

Mode and level, for a source that is not muted and a toast with no `always` flag (rules 1 to 3, then rule 6 when there is room):

| mode | `info` | `ok` | `warn` | `error` |
|---|---|---|---|---|
| `all` | shown | shown | shown | shown |
| `important` | filtered | filtered | shown | shown |
| `off` | off | off | off | off |

- A toast marked `always` passes the `important` filter at any level (the only such call is protector's "baseline mature" `info`). It does
  not pass `off` or a mute.
- Order matters in two places. `off` is reported as `off` even for a muted source, and a muted source in `important` mode reports `muted`,
  not `filtered`, because the mute is tested first.
- A muted source draws nothing at any level, `error` included. No plugin can unmute another: the setting is the person's file.
- Rules 4 to 8 apply only to a toast that got past 1 to 3, so a `filtered`, `muted` or `off` toast never touches the de-duplication
  table or the rate window.
- Rule 5 keys on the washed text alone, not the level, and only a toast that was `shown` or `coalesced` is remembered. A `rate-limited`,
  `refused`, `filtered` or `away` toast is not, so the same line can still be drawn later. De-duplication is tested **before** the rate
  limit, so a repeated error line is `deduped`, never counted into a held batch: the K in "and K more" is the number of further distinct held error lines.
- Held errors: one slot, released when the 60 s window has room, by the next toast of that source or by a timer. All four plugins pass
  an `after` timer (`$.clock.after`), so a held error is said without waiting for another toast. The released line is
  `✗ <first> … and K more` (just `✗ <first>` when only one was held). The release itself is not a new digest: each held error was already recorded as
  `coalesced`. At release time a source that is now `off` or muted drops what it holds.
- `away`: `awayOnly` is honoured only when the host supplies the `away` function. No plugin supplies it today (checked in the four
  registrations above), so `away` is never the outcome in the shipped code. This is the same limit section 2.5 states for swarm's `Next:`.
- Every outcome except `empty` is recorded as a digest, drawn or not. The console keeps its own in `state.toastLog`
  (200 at most, `plugins/ruflo-console/hooks/toasts.ts`); the other plugins write their ring file when `.claude-flow/console/` exists.
- The console's toaster reads its setting from memory (`state.toastPrefs`) with no file read; the other three read
  `.claude-flow/console/toast-prefs.json` through a 4 s cache (`PREFS_TTL_MS`). So a change in Settings reaches the console at once and the
  others within about 4 s.

### Call sites, re-checked

The tables in section 2.5 match the code: swarm's failed subagent (`error`, any end reason except `answer` and `aborted`) and stuck loop
(`warn`) are in `plugins/ruflo-swarm/hooks/register.ts`; protector's `blocked` (`error`), `noticed` (`warn`) and mature baseline
(`info`, `always`) are in `plugins/ruflo-protector/hooks/register.ts`; the console's mission finished or failed toasts are the
`mission-done` and `mission-failed` notices (`TOASTED_KEYS` in `plugins/ruflo-console/hooks/notices.ts`, sent from `controller.ts`);
the update toasts are in `plugins/ruflo-console/hooks/update-flow.ts` (see ADR-428). The autopilot's `say` maps level `bad` to `error`
(`ap-live.ts`).

### What's new

The What's new page (ADR-478) raises one console-source info toast per new version.

## Addendum 2026-10-11: what the engine does with a toast's text (measured)

Colour and animation in a toast were asked for. A spike on Claude Code 2.1.289 (interactive, in tmux; a throwaway mod calling `$.ui.toast` once per case, five seconds apart, `capture-pane -e`) shows what the engine draws:

| text in the toast | what the engine drew |
|---|---|
| plain text | drawn, in a one-slot box in the header |
| `✓ ⚠ ✗ › ⏳ 🔥 ▶` | drawn as written |
| SGR colour (`ESC[38;5;208m`, bold, red) | the ESC byte becomes U+FFFD and the rest (`[38;5;208m`) is drawn as literal text: **no colour** |
| OSC 8 link | swallowed with the link text; no hyperlink |
| OSC 0 (window title) | not run; ESC and BEL become U+FFFD, the rest is drawn |
| bidi override (U+202E) | becomes U+FFFD |
| carriage return, `ESC[2K`, `ESC[1G` | become U+FFFD; nothing is cleared or overwritten |

Four calls made in the same instant leave one visible toast: the slot shows the newest, so a toast is not a stack. Decisions:

- **Icons only.** The level prefixes (`› ✓ ⚠ ✗`) of section 2.2 are the supported styling. Colour cannot be carried by the text, and the washing in section 2.2 (escapes removed first) is therefore not a loss.
- **No animation through toasts.** A static line in a one-slot box. Animation and colour belong to a surface the console draws itself (a band or a pane), not to `$.ui.toast`. That is not built here.
- The engine's own neutralising (U+FFFD for controls) is a second layer under ours, not a reason to relax ours: a plugin's text is washed before it reaches the engine.

Not measured: Windows terminals, other terminals than tmux, the desktop and VS Code surfaces.
