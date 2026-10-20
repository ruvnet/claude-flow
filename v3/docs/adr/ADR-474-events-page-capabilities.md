# ADR 474: Console: Events and Timeline pages: capabilities

Status: Accepted

Date: 2026-10-07

Builds on: ADR-461 (saved views and the console's own state file), ADR-466 (the autopilot journal), ADR-469 (the layout harness), ADR-473 (the bench pass)

## 1. Context

The Events page showed the last 300 events of this session, kept in memory only: a kind chip row, a text find, a pause, a 15-minute
sparkline, a paged list and one expandable row. A restart emptied it. It only knew the diff of two ruflo reads and the console's own tool
calls, it had no sense of what mattered, the find was a substring, and nothing could be followed, exported or alerted on.

The Timeline page drew a gantt of ruflo agents' busy and idle status and Claude Code tool-call ticks over 5, 15 or 60 minutes, observed only
since the console loaded, 12 lanes at most, with no history, no zoom, no events on it, and no way to ask "who was running at once".

Both pages are about what happened and when, so they share one store, one write path and one idea of "the session" versus "what is kept".

## 2. Decision

**One bounded store** (`hooks/data/activity-store.ts`, pure schema; `hooks/activity-io.ts`, the only write path; `hooks/activity-live.ts`,
the live pass). Three files under the project's `.claude-flow/console/`:

| file | holds | cap |
|---|---|---|
| `events.jsonl` | one line per event | 2 MiB, then cut to the newest half |
| `lanes.jsonl` | busy/idle spans per lane, tool calls per lane per minute | 1 MiB, same rule |
| `events-prefs.json` | up to 20 saved searches, 50 pins, 10 alert rules | 64 kB |

**Event schema** (`v: 1`): `{"v":1,"t":<ms>,"kind":"swarm|claims|federation|learning|tools|mods|missions|workflows|autopilot|anatole|notices|other",
"level":"ok|info|warn|bad","text":"<masked, at most 240 chars>","agent"?:"","ref"?:"agent:<id>|claim:<id>|run:<id>|task:<id>|mission:<id>|step:<id>|rule:<id>","src"?:"","s"?:"<console id>"}`.
Lane lines: `{"v":1,"t":"span","l":<lane>,"g":<group>,"n":<label>,"a":<from>,"b":<to>,"y":1|0}` and `{"v":1,"t":"tick","l","g","n","m":<minute>,"c":<calls>,"tools":{"Bash":2}}`.
Groups: `ruflo`, `claude`, `workflow`, `mission`, `autopilot`. A line that is not JSON, is cut off, has a wrong type, or says a newer `v` is
counted and skipped (the page says how many), never thrown on. An unknown kind from an old or newer log is read as `other` with its name kept in
the text. A prefs file from a newer console is never written over.

**One write path.** Lines are queued and written in batches (at most one write per file in flight, at most 32 kB per batch, every 4 s, 1.5 s
tick), never one write per event. The append is one fixed argv shared with the autopilot journal (`data/append-argv.ts`: `dd of=<path> oflag=append conv=notrunc bs=1M iflag=fullblock status=none`, no shell, the path
is one argv element). `bs=1M iflag=fullblock` makes a batch one O_APPEND write, which the kernel keeps whole when two consoles share the file; with dd's default 512-byte blocks
1094 of 4800 lines were torn by two writers. The journal (ADR-466) had the old argv and now uses the same helper; a real-dd test with eight writers covers each. The folder is made once with `mkdir -p`; the path
is checked for a link on the way down before every write and a link is refused. Rotation: past the cap the newest half is written to
`<file>.tmp` (after `rm -f`, with `conv=excl`) and renamed over the file. A failed write keeps the lines queued, waits 30 s and retries; the queue
is bounded (2000 lines) so a dead disk costs memory only up to that. Two consoles on one project may both log what both observed; the reader drops
a line with the same second, kind and text (read-time de-duplication) and each line carries a short console id. A rotation raced by another console
can lose the few lines that arrived in between: this is a history, not a ledger.

**History on open.** The tail of each file (the last 1 MB, from a line start; the page prints the bytes read, the cap and the bad-line count)
is parsed into a retained log of at most 10 000 events and a lane store of at most 20 000 spans. A window control: session (this console only),
15 min, 1 h, 24 h, all kept.

**Sources** (each observed, none invented; the first read of a source is a baseline and yields nothing): the diff of ruflo reads and the
tool calls (as before); workflow runs from the Workflows read the console already holds (started, finished, failed, stuck, empty; seen only while
the Workflows page has been read, said on the page); the autopilot's loop (start, resume, pause, stop, a step handed over, done, failed, parked,
the kill flag); Anatole alerts (blocked or notified, with the rule id); band notices raised; permission denies; plugin and mod load changes.

**Severity** (`data/event-severity.ts`, one pure function over kind and words): a failure word is `bad`, a warning word `warn`, a completion word
`ok`, the rest `info`; "0 failed" and "no errors" are calm. An Anatole block is `bad`, a notify `warn`. Level chips with counts, a colour and mark on
every row, a warn/bad count in the page rule and a count of unread warn/bad events.

**Query language** (`data/event-query.ts`): free words (AND), `"phrase"`, `-negation`, `kind:`, `level:`, `agent:`, `src:`, `ref:`, `since:90s|15m|1h|2d`,
`a|b` for OR inside a value, `/regex/` or `/regex/i`. A problem is an inline line under the query box and the rest still applies. A regex is refused
over 48 characters, with a back-reference, a lookaround, more than two quantifiers (`?` counts), or a quantified group that holds a quantifier or an alternation;
the text it runs against is cut to 200 characters; so a pattern costs at most O(n^2) of 200. Callers that scan many events also pass a time budget (120 ms):
once it is spent a regex term stops being evaluated and the page says how many events were not searched. (An earlier cap of five quantifiers let `a*a*a*a*b` run for
43 s over 50 kB of text and 280 ms over 200 characters; the test that found it stays.) Matches are highlighted in rows. Saved searches (20) run from chips.

**Grouping and correlation.** A burst (same kind, agent and template within 30 s) is one row with `×k` and an expand. `follow <ref>` keeps one
ref's events and anything within 30 s of them. The detail pane shows the words, level, source, ref, the entity's current state read from the snapshot
(agent, claim, task, run, mission) with a button to its page, and the five events either side.

**Live tail and actions.** j/k move a focus, pause with an unread counter, pins (50), mutes of a kind or a line template for the session (a chip that
undoes it), copy-as-text of the focused line (masked; it is put in the prompt box, the console has no clipboard), alert rules (10): the current query
becomes a rule evaluated over NEW events only, never history, raising a band notice through `addNotice` (one per rule per minute), export of the
filtered events as markdown or JSONL.

**Timeline.** Lanes in five collapsible groups, fed from ruflo agent statuses (sampled), Claude Code main and subagent tool calls (aggregated per
minute), Workflow agents and mission tasks and autopilot steps (intervals already timed in data the console parsed; stored once however many reads
show them), Anatole and other warn/bad events as markers on the owning lane or a top events lane. Windows 5 m, 15 m, 1 h, 6 h, 24 h, session;
zoom, pan (half a window), now, start, jump to the last problem; sort by busy share, calls, name or recency; axis with local time; a parallelism strip with
peak and mean, idle gaps (a lane idle five minutes or more while another was busy) and the busiest minute; a lane detail (spans with durations and
gaps, tool calls by tool, longest busy stretch, its last ten events, buttons to follow it on the Events page over the same window, to its page, and to
ask Claude); an export of lane summaries and the concurrency figures as markdown or CSV (a cell that starts `= + - @` is defused). The cross-link is
one function (`openEventsFor`) used by both pages. The picture and the text are built from the same list of lines (`data/timeline-lines.ts`), so the
text twin carries exactly what the picture does.

**Export guard** (`data/event-export.ts`): a bare name goes under `.claude-flow/console/exports/`, a relative path under the project; `..`,
`~`, a backslash, control characters, a path over 300 characters, a bad extension, a path outside the project, a link on the way and an existing file are
refused before the confirm card is shown; the write is `dd conv=excl` or GNU `install -D` (the same argv as the Workflows export), content on stdin,
masked, at most 400 kB, at most 2000 events.

**Commands.** `/ruflo events [kind|level|since:15m|"query"|window <w>|clear|forget|export <path>|follow <ref>|pin|rule]` and
`/ruflo timeline [5m|15m|1h|6h|24h|session|zoom <in|out>|follow <ref>|export <path>]`; bare, each opens its page. `forget` asks, then removes
`events.jsonl` and `lanes.jsonl` (saved searches, pins and rules stay). `/ruflo filter <kind>` keeps working.

**Keys** (buttons with hotkeys; the pane's global keys keep theirs): Events j/k move, `t` pause, `l` level, `c` clear filters, `f` kind, `v` copy;
Timeline j/k lane, `b` `n` pan earlier or later, `s` sort, `o` open the lane (zoom, now and last problem are buttons: the engine accepts only a digit or a lowercase letter as a hotkey, and the letters left are tab keys). The brief asked for p (pause), y (copy), g/G, h/l
and Enter; p, y, g and h are already the palette, the confirm, the Timeline tab and help, so the nearest free keys are used and the page says so on its buttons.

## 3. Privacy

What is persisted: masked event text (credentials, `key=value` secrets, bearer strings, JWTs, long key-like runs, home-directory user names, escapes,
control, bidi and tag characters all removed before encoding), the kind, level, a ref, a time. No prompt, no model reply, no tool input, no file content and
no value from a tool call: a tool event is the tool's name and the agent. Lane lines hold lane ids, labels, times and tool names with counts. Everything
lives only in the project's `.claude-flow/console/`, never leaves the machine, is not read by any model turn, and is documented as local state.
Retention: 2 MiB of events and 1 MiB of lanes, the newest half kept at the cap; the retained log in memory is 10 000 events.
**Disable:** the plugin option `eventsPersist` (declared in `plugin.json`, default true; false queues and writes nothing: no event, lane, saved search, pin, rule, folder or ignore file; the pages still work for the session). Reading existing history still happens.
**Clear:** `/ruflo events forget` or the page's "forget history" button, behind the confirm card. Saved searches, pins and rules are
a separate file the person made; they are masked on write and on read.

## 4. Consequences

A restart no longer empties the Events page; a stuck run, a blocked call and a failed step are findable by level; two consoles on one project show
each other's history after a reload. A few kilobytes are written every few seconds in a busy session, in batches. The log is a convenience history: a
rotation raced by a second console can lose a few lines, and the pages say what was read. Workflow run events appear only while the Workflows page
has been the page in front (that is when the console reads runs), and the Timeline says "observed since the console loaded" beside its history.
The console writes its own `.claude-flow/console/.gitignore`, and `ruflo init` now lists `console/` in the `.claude-flow/.gitignore` template (a shipped CLI file: it needs the CLI release), so the history is not committed by accident.

**Known open limits (low severity, not fixed in 0.36.0):** rotating an over-cap file keeps only its newest half and drops the rest; two consoles on one project can each overshoot the cap before either rotates; `forget history` clears the logs but keeps pins and alert rules (the person's own file); persisted mission and step text is cut to 60 characters; a permission deny is logged twice.

## 5. Tests and benchmark

Pure specs in `plugins/ruflo-console/tests/`: `events-severity`, `events-query` (parser, evaluator, adversarial regexes, huge inputs, a 3000-string
property test that no query throws), `events-group`, `events-store` (round-trip property over 500 random events, corrupt and cut lines, schema skew,
rotation, prefs limits), `events-persist` (batching, append argv, missing folder, failing disk, link refusal, bounded queue, rotation, two writers,
history on open, the option off, rules over new events only), `events-export` (traversal, symlink, overwrite refusal, masking, CSV defusing, size cap),
`events-rules` (also the derived sources), `events-view` and `timeline-view` (rows, controls, no duplicate keys, honest empty states, and every row
inside the pane at 56, 60, 72, 80, 100 and 125 columns in both looks with the `wf-layout-rig` meter), `events-commands`, `timeline-model`.
`scripts/bench-events.mjs` (plain node via tsx): load the tail of a 2 MiB log, four query shapes over 10 000 events, one Events page, one Timeline page
over 200 lanes x 24 h, append 100 events, append 100 lane samples; `--check` fails on a missed budget.

## 6. Rollback

Revert the commit. The files under `.claude-flow/console/` are the console's own and are ignored by older consoles (a line of another schema is
skipped, a prefs file of a newer schema is left alone), so a rollback needs no cleanup; `rm .claude-flow/console/events.jsonl lanes.jsonl events-prefs.json`
removes the history.

## Update 2026-10-07: toast digests are events (ADR-477)

Section 2 lists `notices` as an event kind and `src` as the part of the console that saw it. The toast system (ADR-477) is a new source of
such events. Checked against `plugins/ruflo-console/hooks/toasts.ts` (`eventOf`, `pullToasts`), `hooks/activity-live.ts` (`gather`, `tick`,
`TICK_MS`), `hooks/data/event-mask.ts` (`maskLine`), `hooks/data/event-severity.ts` (`levelOf`) and `hooks/data/activity-store.ts`
(`encodeEvent`, `EVENTS_CAP`).

**What an event looks like.** Every toast the plugins decided on, drawn or not, becomes one event with `kind: "notices"` and
`src: "toast"` (the `src` is the literal `toast`; the toast's own plugin is in the text). The text is built by `eventOf` as

    toast <source> <prefix> <washed text>[ [<why>]][ ×<n>]

for example `toast swarm ✗ swarm: lead failed (timeout) [rate-limited] ×2`. `<prefix>` is the level glyph (`›` `✓` `⚠` `✗`), `<why>` is
the outcome and is left out when the toast was `shown`, and `×<n>` appears when identical neighbouring digests were folded.
Outcomes that can appear are `deduped`, `rate-limited`, `coalesced`, `muted`, `off`, `filtered`, `away` and `refused` (ADR-477,
matrix). The event time is the digest's time, not the time the console read it.

**Masking and caps.**

- Masked twice before anything is persisted. The plugin's policy washes the text to one line of at most 120 characters (credentials,
  e-mail addresses, home paths, escapes, control, zero-width, bidi and tag characters). The console then decodes every ring line again
  (`decodeRing` re-washes the text; a file is not trusted) and `eventOf` passes the whole line through `maskLine(…, 200)`, the page's one
  washing function. So a toast event is at most 200 characters, tighter than the 240 of section 2's schema; `encodeEvent` masks it once more
  on write.
- Sources: four plugins write digests (`console` in memory, `swarm`, `protector`, `mods` in files, ADR-477), but the reader accepts any
  file name of the right shape: it reads `.claude-flow/console/toasts/<name>.jsonl`
  for names matching `^[a-z][a-z0-9-]{0,23}$`, at most 12 files per pass, skips its own (`console` has no file; its digests are in memory),
  and drops any line whose own source field differs from the file's name.
- Volume: the console's in-memory digest queue is capped at 200 (`MAX_LOG`) and emptied by each pass; a ring file holds the plugin's last 60
  digests and is read in its last 300 000 characters, lines over 600 characters skipped. A file is re-read only when its modification
  time moved. De-duplication of what was already taken in uses a key of source, time, outcome, count and text, bounded at 600 keys.
- Only digests newer than the console's own start are taken in (`sinceMs`), so history from an earlier session is not replayed as new events.
- Timing: the same 1.5 s pass as the other sources (`TICK_MS`); a toast appears on the page within about that long of its digest being
  written.
- Retention and the off switch are the existing ones: appended to `events.jsonl` under the 2 MiB cap with the newest half kept past it, and
  nothing is written when the `eventsPersist` option is off (the page still shows them for the session).

**One behaviour to know.** The Events page does not carry the toast's own level. The level shown, filtered on and written as `level` is
`levelOf("notices", text)` from the words (a bad word wins over a warn word, which wins over an ok word, else info). A `✗` toast whose
words contain none of those reads as `info`, and the outcome flag can colour the line: `[refused]` is a bad word, so a toast the host
refused reads as `bad`, and a `warn` toast that was only `rate-limited` or `deduped` reads by its words alone. Filter or alert on the word
(`refused`, `failed`, `blocked`) rather than on the glyph.
