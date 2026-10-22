# ADR 478: Console: the What's new page and plugin changelogs

Status: Accepted

Date: 2026-10-07

Builds on: ADR-428 (the update check), ADR-477 (toasts), ADR-474 (the bounded, washed text the console keeps), ADR-407 (the cockpit)

## 1. Context

A person who updates a ruflo plugin learns nothing from the console about what changed. The update check (ADR-428) says a newer
`ruflo-console` exists and installs it; the other 47 plugins update silently with the marketplace. The only record of what changed is
`git log` in a repository most users do not have, and the release notes on GitHub, which cover the npm train and not each plugin.

Two constraints shaped the page. It must not add network traffic: the console's one network call of its own is the daily read of the published
`plugin.json`, and a changelog page is a poor reason to add another. And every line it shows is text a plugin author wrote, so it is untrusted
the way an Events line or a tool result is.

## 2. Decision

**A page under TOOLS, fed by each plugin's own `CHANGELOG.md`.** The files ship inside the plugin, so what the page shows is what is installed,
read from disk, offline.

### 2.1 The page

`What's new` (id `whatsnew`, icon 🆕), in the TOOLS group beside Plugins and Settings (`hooks/nav-state.ts`), in the main menu's TOOLS card, in
the nav search (it matches "changelog" and "what changed"), by `/ruflo whatsnew`, and in the boot log and self-check as an area. It has no
hotkey of its own, like Workflows, Room and Sandbox (`NAMED_ONLY` in `hooks/self-check.ts`): no free letter is safe: `y` and `n` answer the confirm row (and `n` pages the Timeline), `j` and `k` move the selection, and the footer owns `p`, `x`, `r` and `h`.

From the top (`hooks/views/whatsnew.ts`):

1. A header: the running console version, and whether a newer one is known (section 2.5). Two buttons: **check for an update now**, which is the
   existing `act.checkUpdates` (the update flow's forced check, which still asks before installing), and **toast when something new lands**, a
   switch (section 2.4).
2. **Breaking changes**, pinned: every `breaking:` entry that arrived since the last look, with a dismiss button each and one for all. A pin
   outlives the page being opened and the session; only dismissing removes it, and a dismissed entry is never pinned again.
3. **Since you last looked**: the entries newer than the version last seen, per plugin, newest first (by date, then version).
4. A divider, `you last looked here`.
5. **Earlier**: the two next-newest entries of each plugin (24 shown at most).
6. **Full notes** (folded): each plugin's file path and its GitHub address, as plain text. Nothing opens by itself.
7. **Without notes** (folded): installed plugins whose file is missing, too large, a link, or not in the format, each with its reason. If no plugin
   has a readable file, one line says so instead of an empty list.

Each entry is a heading (`plugin version · date`) and up to six changes marked `‼ BREAKING`, `+ new`, `✓ fix` or `· chore`; the rest are counted.
It draws in both looks and at every width through the same `text`, `row` and `section` helpers as its siblings.

### 2.2 The changelog format

`plugins/<name>/CHANGELOG.md`, newest first:

    ## <major>.<minor>.<patch> — <yyyy-mm-dd>
    - feat: a new capability
    - fix: something that was broken
    - breaking: something that changes what you do
    - chore: housekeeping

Only these lines are read. The heading takes an em dash, an en dash or a hyphen between version and date; the version is plain semver
(no `v`, no pre-release: a plugin whose manifest is a pre-release is not listed on the page, because its row is not a plain version, but its
file is still written for people); the date must be a possible one. A bullet is `-` or `*`, a kind, a colon, text. Anything else, a title, an
introduction, prose, is skipped without error. A repeated version is dropped. Entries are ordered by version, whatever order the author wrote.

`hooks/data/changelog.ts` parses it, with these bounds (`LIMITS`):

| bound | value | what happens past it |
|---|---|---|
| file size read from disk | 256 KiB (`readBounded`, regular files only) | not read: "too large" |
| bytes parsed | 64 KiB | the rest is ignored; `truncated` |
| lines | 2,000 | the rest is ignored; `truncated` |
| entries kept | 40 | the rest is ignored; `truncated` |
| changes per entry | 12 | counted in `more`, not kept |
| width of a change | 160 characters | cut with an ellipsis |
| header / bullet looked at | 64 / 600 characters | the rest of the line is not matched |
| plugins read | 60, in batches of 8 | the rest are not listed |

Matching uses two anchored patterns with no nested quantifier on a clipped line, so a hostile file cannot make the parser backtrack; the spec
runs a megabyte of one line, a megabyte of blanks and half a million repeated `1.` segments and requires them to finish in under 1.5 seconds. A file
with no entry is `garbled`, an empty one `empty`; neither throws.

Every kept line goes through `maskLine` (`hooks/data/event-mask.ts`, ADR-474): escape sequences (CSI, OSC including the link and clipboard forms),
control, zero-width, bidirectional and tag characters are removed, credential-shaped text, e-mail addresses and home-directory paths are masked,
white space is collapsed. The page draws that text through `Text` elements, which interpret neither Markdown nor ANSI, so `[x](http://..)`,
`<script>` and `**bold**` stay characters. The file's path is washed again with `tidy` before it is shown.

### 2.3 What is remembered

One JSON string in the plugin's store, key `whatsnew` (`hooks/whatsnew.ts`):

    { "v": 1, "seen": { "<plugin>": "<version>" }, "toasted": { "<plugin>": "<version>" },
      "pinned": ["<plugin>@<version>"], "dismissed": ["<plugin>@<version>"], "toast": true }

Parsed defensively (names `[A-Za-z0-9._-]{1,80}`, plain-semver versions, at most 200 of each, 64 KiB); anything unreadable is "no record".
`seen` is the divider: on opening the page every installed ruflo plugin's version is written to it, so the marker clears, but the page keeps the
previous `seen` in memory until it is left (`before`), so the divider stays where the last look was while the person reads. A plugin never seen
before shows only its newest entry as new.

**First sight is a baseline.** With no record, the installed versions are recorded as seen and toasted: nothing is new, nothing is toasted. The
first What's new a person ever sees is the next version that lands. (A person who updates to the console version that introduces this page does
not see that version as new; its notes are on the page's Earlier list.)

### 2.4 The marker and the toast

The marker needs no parsing. `hasUnseen` compares each installed plugin's version (the snapshot's `installed_plugins.json` read, which the
console already makes every few seconds; the console's own row is its running version or the installed one if newer) with `seen`. While any is
newer, `badgesOf` (`hooks/menu-style.ts`) gives the page an attention badge `new`, which the nav, the main menu and the band already draw, and the
TOOLS chip of the nav carries a `•` while its pages are not showing. Opening the page clears both.

The toast (`syncWhatsNew`, called after each disk read in `hooks/controller.ts`): when a plugin's version is newer than the one last toasted,
**one** line goes through the console's own toaster: level `info`, source `console`, so ADR-477's rules apply to it unchanged (the `important`
mode and a muted `console` source filter it, and it is still kept as a `notices` event with the reason). Several plugins moving at once make one
toast, naming two and counting the rest. It says nothing again for the same version, in this session or a later one (`toasted`); it is not
raised while the page is open (the versions are looked at at once), when the switch is off, or in a session nobody can see (`-p`). The switch is
saved in the same record. Nothing here reads a changelog: the toast says that something landed, and the page says what.

### 2.5 What is not fetched

The update check reads `plugin.json` and keeps only the version; it never sees notes, so nothing is "already fetched" for a newer version. The
page therefore shows that version (`state.updateAvailable`, the update flow's own result), says its notes are not fetched here, and names where
to read them as text (`https://github.com/ruvnet/ruflo/releases`). The page itself issues no request: `hooks/whatsnew.ts`, the view and the
parser contain no `fetchText`, `httpSend`, `run` or `spawn` (smoke step 18 greps for them), and the specs hand the page a host whose fetch and run
count calls and assert zero. The band's `⬆ version available` link still goes to Settings, where the install lives.

### 2.6 Every plugin has a changelog; the check is scoped

All 48 plugins gained a `CHANGELOG.md` in this format, built from `git log` of the plugin's path and the history of its `plugin.json` version:
one entry per version bump (the eight newest), its bullets the non-merge commit subjects since the previous bump (conventional prefixes mapped
to the four kinds, `!` or "BREAKING" to `breaking`; the first release is the commits that created it; commits after the last bump are listed
under the current version, which is where they ship). Subjects are cut at 140 characters; more than eight become one "and N more changes" line.
No history was written by hand, and none is claimed beyond what git shows: a plugin with fewer than eight bumps says "this is the whole history".

The smoke contract (`scripts/smoke-all-plugins.mjs`, the one shared script every plugin's CI row runs through) gained a `changelog contract` row:
`CHANGELOG.md` must hold a `## <version> — <date>` entry for the version in `.claude-plugin/plugin.json`. It is **enforced for ruflo-console,
ruflo-mods, ruflo-swarm and ruflo-protector** only, the four that bump on their own cadence. The other plugins ship the file but are not gated:
the npm release train bumps their manifests on another branch, and a gate that fails whenever a release lands before its changelog would block
that train. `ruflo-console`'s own smoke (step 18) and `tests/whatsnew.spec.ts` check the same for the console, and the spec also requires that
every plugin's file parses (a pre-release manifest excepted) and that the four gated plugins' newest entry is their manifest version. Widening the
gate is a one-line change to `CHANGELOG_CONTRACT` once the release flow writes the entry.

## 3. Consequences

- A person sees, offline, what changed in each plugin they run, with breaking changes held in front of them until they say they have read them.
- A plugin that ships no changelog, or a broken one, costs one line under "Without notes" and nothing else.
- The page shows the installed copy's notes, not the next version's; a version that is installed but not yet loaded (the update waits for a restart)
  shows as new, with its notes, before it runs.
- The `•` and `new` markers appear for every ruflo plugin the marketplace updates, so a person with many plugins sees them often; the toast
  setting and the `console` mute in Settings are the way to quiet them, and the first-sight baseline means a new install is silent.

## 4. Not closed

- A changelog is the plugin author's claim. A plugin can omit a breaking change, or label an ordinary change `breaking:`; nothing here compares the
  file with the code. It is as trustworthy as the plugin's own code, which the person has already chosen to run.
- The page lists plugins from the marketplace named `ruflo` only; a ruflo plugin installed from another marketplace is not shown.
- The remote version's notes are not shown (section 2.5); a future change could fetch them behind the existing daily gate, which is a
  decision to add traffic, not a fix.
- Pinned breaking changes are matched by `plugin@version`; a plugin that re-publishes the same version with a new breaking entry is not pinned
  again.
- The per-plugin changelog for the 44 plugins outside the gate can drift from their manifests until the release flow writes entries; the page then
  shows an older "newest" entry for them.
- The plain look is exercised in the pure spec (`viewText` in both looks at three widths, and `render-smoke.spec.ts` at four); the kit test runs the default BBS look only.

## 5. Evidence

- `tests/whatsnew.spec.ts` (31 tests, no host): the format and every bound, hostile text (escapes, OSC, bidi, tags, credentials, a credential split
  by a control character, Markdown and HTML left as plain characters), the record's round trip and hostile input, baseline, marker, toast once and
  not after a restart, the switch, only ruflo-marketplace plugins with plain versions and safe names listed, the page opened with files that are missing, garbled, oversize and a link,
  pins and dismissal across sessions, the page in both looks at three widths with a 5,000-entry hostile file, no fetch or run made, and every plugin's real
  `CHANGELOG.md`. The parser was mutation-checked: 22 mutants of `hooks/data/changelog.ts` (a bound removed or widened, the sort dropped or
  reversed, a date or duplicate check removed, a dash or the CRLF handling changed, a kind added, a flag dropped); 19 are killed, and the three that
  live are performance guards with no behavioural difference (the `split` limit, and the two `slice`s ahead of anchored patterns).
- `tests/whatsnew.test.ts` (9 kit tests): `/ruflo whatsnew`, the nav group and search, the marker appearing and clearing, one toast and not a
  second, the switch saved, a breaking change pinned and dismissed, a non-format file, a hostile file, and no network from the page or its buttons.
- `scripts/smoke-all-plugins.mjs` row `changelog contract`; `plugins/ruflo-console/scripts/smoke.sh` step 18.
