# ADR 426: A self-check that the boot log reports, run buttons that say what they need, and results that go back to Claude

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/self-check.ts` (new, pure), `hooks/boot-checks.ts` (new, a leaf), `hooks/gfx/boot.ts`, `hooks/views/frames.ts`, `hooks/register.ts`, `hooks/views/secure.ts` (`entryRow`, `sendResultRow`), `hooks/views/devtools.ts`, `hooks/views/mh-lab.ts`, `tests/self-check.spec.ts` (new), `tests/diagrams.spec.ts`.

Extends: ADR 421 (the boot screen), ADR 411 (the Claude UI bridge), ADR 413 (the regression system), ADR 420 (the tool-coverage audit).

## 1. Context

Three things were wrong, found by use rather than by a test.

- **The boot log claimed what it had not checked.** Each area printed `[ OK ]` on a timer, one every 120 ms, whether or not anything in it worked. The sign and the modem are decoration; a status line is not, and a green that is not earned teaches people to ignore green.
- **A run button could only fail.** The Security rows that take the field's text (`aid-check`, `aid-plan`, and the rest) refused with `nothing to do: type "aid-check <text>"; text may not start with -` when pressed on an empty field, and nothing on the row said it was waiting for text. The page's folds (this branch) had also hidden the field, which made it worse, but the row itself never told the person what it needed.
- **A run led nowhere.** A result sat in the pane. The only way to act on it was to read it, work out the next command, and type it. ADR 411's bridge already sends a page to the main Claude session as quoted data, but it was only in the footer, not at the result.

## 2. Decision

### 2.1 A self-check, pure and spawn-free
`hooks/self-check.ts` checks every area the boot log names. For each: its page exists, has a key, and has an Ask row (ADR 411). For the four areas that own a command registry (Security, Performance, Dev Tools, MetaHarness) it also checks every command, reading the same registries the buttons read:

- a command's argv is non-empty, with no empty or control-character part, and something reads its output;
- a text-taking verb **refuses an empty field**, **refuses text starting with `-`** (it could be read as a flag), and **builds its command from at least one sample** (free text, or an action type for `policy-eval`), with the text reaching the command, so its button can run;
- a Dev Tools row is runnable or has a reason it is n/a; one that names no input field runs on an empty page; one with a field has an input that runs;
- a lab verb that cannot run now says why;
- no two entries share an id (the id is a palette keyword).

It runs no process. That each command is built right is proved here; that the CLI answers is the Doctor's job and stays a button that asks first (the console runs nothing on open, ADR 407).

### 2.2 The boot log reports it
`bootPicture` takes the results. An area shows `[ OK ]` only if its check passed, and `[FAIL]` with its first problem if not; READY says `N of M areas verified` and `[FAIL] READY` when any failed. `register.ts` runs the check once at load and puts the results in `hooks/boot-checks.ts`, a leaf that `frames.ts` reads. The leaf exists because the self-check reaches the pages (through the Ask table) and the pages reach the drawing code, so frames importing the check would be a cycle. If the check itself throws, the log draws as before and the console starts. With no results (a caller that passes none) the log draws as it always did, which is the only way the older boot tests still hold.

### 2.3 A run button says what it needs
A row that takes the field's text dims its button and says `← type text above first` while the field would be refused. A runnable row's button is a primary `▶ run`. Where a field lives in a section, the section is open by default, so the field is in reach.

### 2.4 A result goes back to Claude
Under each result block (Security, Performance, Dev Tools, the MetaHarness lab) a `✦ send result to Claude` button calls the ADR 411 bridge: the page's text, the result included, as quoted data with secrets removed, after the confirm that says it starts a billed turn, with a question that asks what to fix, run or change next.

## 3. Alternatives considered

- **Run every command at startup.** Rejected: the four registries hold 149 entries, each a `ruflo` cold start, on every open, and some write or touch the network. The self-check proves the commands are built correctly and takes about a third of a millisecond (measured over 20 runs); a live run is the Doctor's, on a button.
- **Keep the timer and add a separate "checks" screen.** Rejected: the boot log is where the console already says what is online, and two reports could disagree.
- **Have `frames.ts` import the self-check.** Rejected: an import cycle through the pages. The leaf is four lines.
- **Make the refused button say more.** The refusal text is the runner's and also serves the headless `/ruflo run aid-check <text>`, where it is right. The row now says it before the press.

## 4. What the check does not prove

It does not run the CLI, so a command that is well-formed but names a verb the installed ruflo no longer has passes. ADR 420's audit against the CLI's own source and the live smoke (`scripts/e2e-smoke.sh`) cover that. It does not draw the views, so a section that hides a field is not caught here; the kit tests (which need the `claude-code/testing` host package) do. A sample that is too narrow can fail a verb whose rule it does not meet, which is how `policy-eval` first failed against free text: the check now passes a verb that any documented sample builds, and still fails one that none does.

## 5. Tests

- `tests/self-check.spec.ts` (12): the real registries pass; every boot area is checked, in boot order, and every area names a real page, so no `[ OK ]` goes unchecked; the four registry areas have their commands counted; and a broken entry fails each way: a text verb that builds a command from an empty field, one that lets `-` through, one that refuses every input, an empty argv part, a command with no reader, a Dev Tools row no input can run, one with no input field that cannot run empty, an n/a with no reason, a lab verb that cannot run and does not say why, one with nothing to run or type, a duplicate id, and a page that is missing, has no key, or has no Ask row. A check that cannot fail would prove nothing, so these are the point.
- `tests/diagrams.spec.ts`: with results the log shows `[ OK ]` for a passed area and `[FAIL]` with its problem for a failed one, READY counts what was verified and fails when any did, and an area still starting shows `[ .. ]`.
- The console suite passes 365 tests. 22 files cannot load the `claude-code/testing` host package here, each failing only on that import; they run in CI (ADR 413). The row text, the dimmed button and the send button are in those, so they are not yet exercised.

## 6. Amendment: which build is running, and every look

- **The version cannot say which build.** It is the same across every commit of a release, so a session on a stale copy and one on the latest both read `v0.26.0`. The header now adds the git revision, `v0.26.0 · 2dc45ae`, with `-dirty` when the tree has uncommitted edits. `hooks/build.ts` (a leaf) holds it; `register.ts` reads it once at session start with two read-only `git` calls and sets it only when the plugin folder is `plugins/ruflo-console` of the repository git reports, so an installed copy that sits inside some other repository never shows that repository's commit. The text is validated as a short hex revision, since it is drawn on the screen.
- **The plain look has no banner.** Its one-line header (`◆ ruflo · project`) now carries the version and the build too, widened from 40 to 64 columns.
- **The boot screen is not in every look.** The plain look draws none, and a BBS look can turn the boot off, so a failed self-check would have been silent there. A failed area is now also an Overview alert (`self-check: Security failed — …`), drawn before any project is read.
- **A redraw timer must respect `fps: 0`.** The guidance section's ticker (it keeps the spinner turning before the first words arrive) redrew four times a second whatever the setting. It now redraws only when `fps` is above zero and the pane is open; the section still updates as words arrive.

There is no mode called "lite" in the console. What exists is the plain look, `fps: 0`, narrow and compact panes, and surfaces without a text field; the changes above were checked against those, not against a lite mode.
