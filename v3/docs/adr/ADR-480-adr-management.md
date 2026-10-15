# ADR 480: Console: managing your project's ADRs, and handing them to missions, loops and swarms

Status: Accepted (ships in ruflo-console 0.39.0, ruflo-swarm 0.3.5, ruflo-workflows 0.6.4)

Date: 2026-10-07

Scope: `plugins/ruflo-console` (`hooks/adr.ts`, `hooks/adr-mission.ts`, `hooks/adr-actions.ts`, `hooks/adr-palette.ts`, `hooks/data/adr*.ts`, `hooks/views/adr.ts`, the mission, settings and nav files they plug into), `plugins/ruflo-swarm` (`hooks/adr-digest.ts`), `plugins/ruflo-workflows` (the workflow-create skill)

Builds on: ADR-478 (the What's new page, the sibling pattern), ADR-477 (toasts), ADR-474 (the bounded, washed text the console keeps), ADR-444 and ADR-450 (Claude's control of the console, and its levels), ADR-443 (mission context, gates and the loop), ADR-407 (the cockpit)

## 1. Context

### 1.1 Who this is for

A person who runs Claude Code in their own project and keeps (or should keep) Architecture Decision Records there. The console runs in that project, so the ADRs it manages are **that project's**, in whatever convention that project uses. ruflo's own `v3/docs/adr` is a test corpus here and the place this record lives; no runtime code names it, and nothing depends on `scripts/check-adr-links.mjs` (the lint is the plugin's own).

### 1.2 What exists: the ruflo-adr plugin

`plugins/ruflo-adr` (a separate marketplace plugin, 0.5.4) is a lifecycle tool for agents: skills `adr-create`, `adr-index`, `adr-reindex`, `adr-review`, `adr-verify`, an `adr` command and an `adr-architect` agent, and a mod with a write guard. It writes `docs/adr/ADR-NNN-slug.md` with bold-field lines (`- **Status**: proposed`, lowercase) and registers each record in AgentDB (`adr-patterns`, `adr-edges`) with causal edges (`supersedes`, `amends`, `depends-on`, `related`). Its parser accepts front matter and `**Status**:`-style lines, but not the plain `Status:` / `Date:` lines that most of ruflo's own ADRs use, so those parse as `Unknown`.

It does nothing in the console: no page, no confirm, no mission link. It is also AgentDB-centred; a user without ruflo memory has no use for it. This ADR does not change it, and its record format is a subset of what the console reads. The two share status words (proposed, accepted, superseded, deprecated, rejected) and the supersede direction (the newer record names the older).

### 1.3 What exists: the console

Read from the code, not assumed:

- **A page** is a `ViewId` in `state.ts` (`VIEWS`: hotkey, label, blurb, rows), a group in `nav-state.ts`, a body in `views/pane.ts` (`BODIES`), an opener in `view-open.ts`, and entries in the help topics, the ask table, the boot list and `self-check.ts`. What's new (ADR-478) touched 28 files; this ADR follows the same list.
- **Confirm pattern**: an `ActionSpec` handed to `runner.ask`. The card shows `runs: <shows>` wrapped in full, and `Effect: <note>`. `run` is custom code that runs on Yes (30 s window). A spec that `isReadOnly` runs at once.
- **Claude's control** (`model-tools.ts`): `console_state | console_open | console_set | console_run`. `console_run` runs a palette entry by id. A non-read-only entry becomes `state.pending`; its class (`classOf`: words in label, command, note, shows, plus the entry's `declared` class) must be allowed by the person's level (read, write, manage, full), and in `ask` mode waits for the person's Yes. A read-only entry that declares a class goes through the same gate. So the established way to expose an action to Claude is a palette entry.
- **Events and toasts**: `record(state.events, …)` for Events; `host.toast(text, ms, level)` goes through the shared toast kit (source `console`), which also records a digest the Events page takes in.
- **Missions**: a ledger of `MissionRecord`s in the plugin store (`saveLedger`), a **context section** (`mission-claude.ts: contextSection`, ≤1200 characters, keyed so Claude's prompt cache holds), the **task instruction** (`instructionOf`), the **gates** (the person's own commands, `verify`, which records each exit code as evidence), a loop manager that prepares `/loop` text in the prompt box, and the GOAP planner whose plan has a `create (ADRs, SOP)` step.
- **Workflows**: the Workflows page *reads* Claude Code's run folders (`wf-live.ts`, `data/workflows-read.ts`). The console has no workflow engine and no step types. Steps live in ruflo's `workflow_create` (MCP) and in native `.claude/workflows/*.js` scripts.
- **Swarms**: the console's Swarm page shows ruflo's swarm; spawning is `ruflo agent spawn`. The place a spawned subagent's prompt is built is ruflo-swarm's `agent.spawn` hook (`injectSpawnContext` appends a swarm note). There is no task prompt in the console itself.

### 1.4 What ADRs look like in practice

ruflo's `v3/docs/adr` (264 files; numbers 074 to 479; sampled and then parsed whole):

| form | files | |
|---|---|---|
| `Status: Accepted` (plain line, ADR-4xx) | 79 | plus `Date: 2026 10 03` (space-separated) in 48 |
| `**Status**: Accepted` / `**Status:**` | 94 + 28 | `**Date**: 2026-05-03` in 90+ |
| `- **Status**: …` / `- Status: **…**` (list item) | 39 | ADR-104 style |
| table row `\| Status \| Proposed \|` | 3 | ADR-376 |
| `## Status` section | 0 as the primary form | |
| YAML front matter | 0 in `v3/docs/adr`; both of `plugins/ruflo-adr/docs/adrs` | |
| no status line | 11 | before the table-form fix |

Names are `ADR-NNN-slug.md` (3 digits), with `ADR-322A/B/C` and `ADR-164.1` siblings and 8 numbers used twice. Relations are lines `Supersedes:`, `Builds on:`, `Extends:`, `Related:` (plain or bold, with parentheses and links), and `Supersedes: nothing` in 19 files. No file says `Superseded by`; the direction is on the newer record. Issues and PRs appear as `#N` in titles, status suffixes and `Tracking:` lines. Status words: accepted 131, proposed 108, implemented 10, draft 3; none superseded, deprecated or rejected. Free text follows the word (`Accepted (ships in ruflo-console 0.26.0)`).

The console's parser reads all of that (`hooks/data/adr.ts`), and also the conventions of other projects, which are covered by fixture projects in `tests/fixtures/adr-projects/`:

| project | folder | convention | what is read |
|---|---|---|---|
| `madr` | `docs/decisions` | MADR 3: front matter `status:`, `date:`, `supersedes:`; `status: "superseded by ADR-0003"` | status, date, links, Decision Outcome |
| `nygard` | `doc/adr` | adr-tools: `# 3. Title`, `Date:`, `## Status` section, `Superseded by [3. …](0003-….md)`, `Supersedes [2. …](…)` | same |
| `ruflo-style` | `docs/adrs` | `ADR-001-slug.md`, bold and plain Status/Date/Scope/Builds on lines | same, plus scope paths |
| `log4brains` | `docs/adr` | date-prefixed names, `- Status: accepted` | status, date; the name is not a number |
| `plain` | `adr` | markdown with no status | listed, flagged |
| `mixed` | `docs/architecture/decisions` | three formats, a duplicate number, a missing supersede target, an index | the lint |
| `empty` | none | a project with no ADRs | the initialise flow |

Parsing ruflo's own 264 files gives: 160 accepted, 104 proposed, 261 dated, 248 with named scope paths, 249 with a Decision paragraph, 200 with a link to another ADR. The lint finds 12 duplicate numbers, 22 "supersedes, but the older one is still accepted", 5 supersedes with no file, 14 broken same-folder links and 60 files missing from `INDEX-mod-system.md`. Those are real facts about that corpus, not test noise.

## 2. Decision

### 2.1 The registry (pure, bounded, offline)

`data/adr.ts` (parse), `data/adr-lint.ts` (lint, link graph, filter), `data/adr-write.ts` (style, numbering, templates, edits, diff), `data/adr-scope.ts` (digest, suggestion, scope check). No I/O, no throw.

- A record becomes `{file, number, variant, title, status, statusRaw, date, format, scope[], supersedes[], supersededBy[], relates[], refs[], context, decision, consequences, notes[]}`. Status is normalised to proposed, accepted, superseded, deprecated, rejected or unknown by the first matching word; the raw text is kept.
- Formats tried in order: front matter, a `## Status` section, a `Status:` / `**Status**:` / list / table line. A file with none is `bare`, listed, and flagged `no status`.
- Bounds: a file is read to 200,000 characters (`notes` says so), at most 500 files, at most 24 scope entries, 20 issue references, 24 links; every regular expression that walks user text has a bounded quantifier (a quadratic one was found by a hostile test and fixed). Escapes and control characters are removed before anything is parsed, so none reaches the screen, a prompt or a file.
- Siblings `322A`/`.1` share a number and are not duplicates. A date-prefixed name (`20200101-…`) is not a sequence number.
- The lint: duplicate number (error), supersede cycle (error), dangling supersedes or superseded-by, supersedes whose target is not marked superseded, superseded by nothing, no status, unknown status, status without a date, no number, a same-folder link that does not resolve, a record missing from the folder's index file. At most 60 findings of a kind are listed, with a note of the rest.

### 2.2 Finding the folder, and the style

`discover` tries the folder in **Settings → ADR folder** alone, or else `docs/adr`, `docs/adrs`, `doc/adr`, `doc/adrs`, `adr`, `adrs`, `docs/architecture/decisions`, `docs/architecture/adr`, `docs/decisions`, `architecture/decisions`, `decisions`. Every folder on the path must be a real one (`checkNoLinks`): a link is refused with its reason and never read, and a record that is a link is skipped. Reads are regular files only, size-bounded, through the engine's `fs`.

`detectStyle` samples the project's last 40 numbered records: the commonest format becomes MADR, Nygard or ruflo style; the width is the commonest digit count; an `ADR-` prefix is kept if most records have it. **Settings → ADR style** and **ADR file name pattern** (`{n}` and `{slug}`, ending `.md`) override; an unsafe folder or pattern is refused with a reason and the old value kept. With no ADRs the default is Nygard, four digits, `0001-slug.md`.

### 2.3 The page (TOOLS → ADRs)

A health strip and the lint; a status filter, a text filter and a scope filter; a paged list (`j`/`k`); a detail with the status as written, links **both ways** (supersedes, superseded by, related, cited by other ADRs), the Context, Decision and Consequences paragraphs, issue and PR references, and the missions the record is attached to; and a mission section. Every action is a button with a key and a field where text is needed, so keyboard and mouse reach the same things as on What's new. It draws in both looks and at 44, 80 and 140 columns. TOOLS was chosen over MIND and SAFETY because a project's ADRs are a working tool next to Plugins and What's new; there is no hotkey (every letter is taken), like What's new, so the page is reached from the menu, the nav, the palette or by name.

### 2.4 Writing: always through the confirm, always the exact change

- **Initialise** (no folder): creates the folder and `0001-record-architecture-decisions.md` (Nygard's own record, accepted). **Propose** (a title): the next number above the highest in the folder, the project's file name and headings, status proposed. Both are new files made with `dd conv=excl` (fails if the file exists) or `install -D`, after `checkNoLinks`; the confirm shows the path and every line of the file, marked `+`. A file that appears between the ask and the Yes is not overwritten, and the result says so.
- **Status changes** (accept, reject, deprecate, supersede): the smallest edit the format allows (the `status:` line, the first line under `## Status`, the value after `Status:` or in a table row; a bare record gets a `Status:` line under its title). Superseding also adds a `Supersedes` line to the newer record, so the confirm shows two diffs. The diff is computed from the old and new text, so what is shown is what is written. On Yes each file is read again and compared with the text the diff was made from; if it moved, nothing is written to it. After the write the file is read back and must equal the new text.
- A title is one safe line (no markdown marks, links or newlines); the file name is `[a-z0-9-]` slug and must match a fixed pattern. Nothing is written outside the project root.

### 2.5 Missions, loops, swarms, workflows

- **Attach** (page or `adr-attach <n>`): up to 8 file names on the mission record (`MissionRecord.adrs`, validated on load). **Suggest**: from the goal, a path in the goal under an ADR's scope counts most, then shared title and scope words; only proposed and accepted records are offered; the person presses to attach. Nothing is attached by itself.
- **Context for Claude**: `missionContextText` appends the digest after the mission's own lines (title, status, the start of the Decision, masked by the Events washer, 260 characters each, 1100 in all, accepted first; a proposed record is marked a draft and a superseded one as history). The text is keyed by a hash of the digest, so Claude's prompt changes only when an attached record's status or decision does. The task instruction (`instructionOf`) carries the same block. Both say the block is data, not instructions.
- **Scope check** (the `adr-scope` entry, the page button, and automatically at the end of **verify**, whose confirm names the extra read-only git commands): `git status --porcelain` plus the commits since the mission began; each changed file is matched against the scope paths of the attached **accepted** records. A hit is a `warning` in the mission record (an `adr.scope` event, so it is evidence) and in the verify result line. It never changes whether the gates passed and never blocks: the existing gate mechanism is the person's own commands with exit codes, which has no notion of a soft finding, so the check follows the loop's other advisory outputs.
- **After a mission**: *draft an ADR from this mission* is a normal propose confirm, pre-filled with the goal and the task titles and results. It is deterministic. The decision itself is left as a sentence saying it is not in the record. There is no claude -p turn for this (the console's guidance turn exists for goals, not for retrospectives), so none was added.
- **Swarm**: the console writes the digest of the active mission's attached ADRs to `.claude-flow/console/adr-digest.json` (small, masked, with a timestamp) whenever attachments change, and the controller's tick (`syncAdrDigest`) rewrites it when the **active mission** or the digest's text changes: switching to a mission with nothing attached writes an empty digest (the swarm treats it as none), and a file left by an earlier session is cleared at the first look. It never creates a file in a project that has not attached an ADR, and it does not judge before the folder has been read. ruflo-swarm's `agent.spawn` hook reads it, ignores one that is missing, over 16 KB, malformed or older than a day, and appends the block after the task prompt; the member row says `[guided by ADR 3, 7]` and keeps the numbers (accepted records only). Option `injectAdrs`, on by default; nothing is added without an attached ADR.
- **Workflows**: no extension point. The console has no engine and no step types, and ruflo's workflow definitions are outside this repository's console. The ruflo-workflows skill documents two ordinary steps instead, *requires ADR* (attach and read the governing records first) and *records ADR* (`adr-propose` last), and the mission lifecycle above carries the rest.

### 2.6 For Claude (console_run) and the control levels

Palette entries: `adr-open` (a page: read), `adr-show <n>` and `adr-scope` (read-only specs that declare nothing: read), `adr-init`, `adr-propose <title>`, `adr-attach <n>`, `adr-detach <n>` (write), and `adr-accept|reject|deprecate <n>`, `adr-supersede <old> <new>` (write, declared). The status entries only *prepare* the change; the diff that follows is the person's confirm, so a write by Claude is level-gated and then still waits on a Yes for the exact lines. A test pins each entry's class (none reaches network, spend or delete: a note that said "in force" was classed `delete` by the word `force` and was reworded).

### 2.7 Events and toasts

An ADR created, accepted, superseded, attached or detached is one Events notice (`adr: …`) and one info toast (`host.toast`, source console), each emitted once; What's new is unaffected.

### 2.8 What is not enforced

Nothing here proves that code complies with an ADR. `scope` is the set of backticked paths the record names (and a `Scope:` line), and the check is a path comparison (exact, under a folder, a glob of one level, or ending with a sub-folder-relative name). The suggestion is a word comparison. A warning is a reason to read the record; silence is not a clearance. The page and the README say this. An ADR whose status the project never wrote is not treated as accepted. Supersession is read from what the records say and is not verified against code.

## 3. Consequences

- A project gets a working ADR practice from the console alone: initialise, propose in its own style, change status with a diff, and see the health of the set. ruflo-adr remains for AgentDB-registered records and is not required.
- Missions can carry the decisions that should constrain them, into Claude's prompt, each task and each spawned swarm agent, at a bounded and masked cost in tokens (about 1,100 characters at most, only when something is attached).
- The settings gain three rows; the nav's TOOLS group is split in two rows (six at most a row); the boot list and the self-check have one more area (31).
- A change of ADR text invalidates Claude's cached mission section (it must, to be correct); status changes of unattached records do not.
- Not done, and why:
  - A workflow step *type* (no engine here).
  - A hard block on a scope hit (the gates have no soft/hard distinction; a hard block on a path heuristic would refuse good changes).
  - ruflo-adr changes (separate plugin; its parser's gap with plain `Status:` lines is recorded in 1.2 and left alone).
  - A notice or toast when a mission finishes offering a draft (the finished mission's ADRs section says so and the button is there; the shared `mission-done` notice text is pinned by other tests and was left alone).
  - Auto-attach from the goal, and auto-writing of drafts (the person decides both).
  - Sequence numbers for date-prefixed names (log4brains): they are listed and flagged `no number`; a new record in such a project gets `0001-`.
  - A claude -p turn to write the draft's decision (no such turn exists for retrospectives).

## 4. Verification

- `tests/adr.spec.ts`: ruflo's own 264 ADRs parse with a number and a title, nearly all with status, date, scope and decision; every fixture convention; hostile files (a 12 MB file, a 2 MB line, nested noise, escapes, bidi marks, binary, unterminated front matter, 300 records in a supersede cycle with duplicate numbers); style detection; numbering; each style's new record parses back; each edit changes one line.
- `tests/adr-write.spec.ts`: folder discovery for six projects and the empty one; a folder that is a link out of the project and a record that is a link (never read, never written through); initialise and propose in four projects in temp copies with real `dd`/`install`; refusal to overwrite on a race; a hostile title; transitions write exactly the diff, a changed file is left alone, supersede edits two files and the lint is then clean.
- `tests/adr-integration.spec.ts`: attach, detach, suggest, caps, hostile ledgers; the digest in the mission context (cached, capped, masked), the task instruction and the swarm file; the scope check against a real git repository (flags under an accepted ADR, not a proposed one, a sibling path, or an unrelated file; sees commits since the mission began; verify adds it without changing the gates' result); the draft.
- `tests/adr-page.spec.ts`: the page in both looks and three widths with hostile titles, every action a button with a key, palette entries and their control class, settings validation.
- `tests/adr-mutation.spec.ts`: 19 one-line mutants of the parser, lint, scope matcher and writer; the battery must see each.
- `plugins/ruflo-swarm/tests/adr-digest.spec.ts` and the host test: the digest is read defensively and reaches a spawned subagent after its task.
