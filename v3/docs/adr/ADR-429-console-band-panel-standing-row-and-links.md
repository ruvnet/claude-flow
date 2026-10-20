# ADR 429: The band above the prompt: a bordered panel, a standing row that stays, and links

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/views/bar.ts` (`BarPart.row`, `compact`, `PANEL`, `BAND_LINKS`, `barView`), `hooks/state.ts` (`updateAvailable`), `hooks/update-flow.ts`, `tests/band.spec.ts`.

Extends: ADR 407 (the cockpit and its band), ADR 409 (the mission part of the band), ADR 428 (an available update).

## 1. Context

The band above the prompt is one row. Its parts were laid out in order of urgency, each given the room that was left, and when the room ran out the rest were dropped. The owner saw it change from
`ruflo · claude: Bash · 12s ago · 27 claims · $19.81 this session` to
`◆ ruflo · 🎯 0/15 · t1 Research prior art, existin… (1) · 27 claims`.

Reading the code, three things can produce that, and I cannot tell from here which one the screenshot showed:

- **A long part crowds the rest out.** The mission part (`🎯 done/total · task title (1)`) comes before the standing facts, and its title can take 28 characters of a row that has none to spare. This is a real flaw, and the one a layout can fix.
- **The last tool call vanished after a minute.** The event part showed only while the newest event was under 60 seconds old, so `claude: Bash · 12s ago` was there, and a minute later so was nothing, and with it the answer to "what did Claude last do?".
- **Spend needs a cent.** `$ this session` is left out under $0.01 ("a part with nothing to say is left out rather than shown as zero"), and a session that has only just started has spent less than that. I have not checked what `$.session.usage()` returns right after a start or an account change. A fresh `--plugin-dir` session has no tool event yet and little or no spend.

The last is the data, not a defect. The first two are what this ADR changes.

## 2. Decision

### 2.1 Two rows, in a bordered panel with a background
The band is a rounded box with a dark ground and a border, in two rows.

- **Status row:** the mark and `ruflo`, then what needs a person, the mission, who is working, the AI terminal's runs and a fresh event, each part given the room that is left, as before. This is where a long title is cut.
- **Standing row:** `↳`, then the last tool call or event with how long ago (it no longer vanishes after a minute), claims, spend, what the last scan found (`🔒 235 high or critical`, loud only when one is critical), and a published update not yet taken (`⬆ 0.27.0 available`), then links. A long mission title in the first row cannot push these out, because they are not in it.

Parts that are links open the console on their view, as they did.

### 2.2 Shorten by choice, never cut a word
Each standing part can have a compact form (`$19.81`, `2 claims`, `🔒 235`). If the row would not fit its parts in full, it uses the compact forms; it never cuts a part mid-word. If the links do not fit, the ones that do not are dropped, not cut.

### 2.3 Links
At the end of the standing row: **Missions, Swarm, Security, Memory, Cost, Menu**, each opening the console on that view. The set is the pages a person goes to from the band; the rest are a click on Menu away.

### 2.4 Colours
The panel's ground, border and every piece of text have explicit hex colours from the 256-colour cube and grey ramp, not theme names: the text must read on the ground whatever the theme, and a name the host does not know could make it refuse the tree and draw its own band instead (the mod guide's `ui.render ... refused` case). A **Button cannot be coloured**, so a link's label takes the theme's own; on a dark theme that reads, on a light one it is dim on the dark ground. That is a known limit, not tested here.

## 3. Alternatives considered

- **Keep one row and shorten the mission part.** Rejected: any fixed width is wrong for some terminal, and the next long part would do the same.
- **A theme background token.** Rejected: no token is documented for a background, and an unknown one is the risk above.
- **Always show spend, as `$0.00`.** Rejected: the band's rule is that a part with nothing to say is left out; it is still left out under a cent.
- **External links (the docs, the repository, x.ruv.io).** Not added: whether a Text can carry a hyperlink in the host has not been checked, and a link that does not open is worse than none. The links are to the console's own pages.

## 4. Consequences

The band is four rows tall (the border adds two) where it was one, above the prompt, in a slot the host caps at half the terminal. The second row is where a person looks for "what did it last do, what has it cost, what needs attention".

## 5. Tests

`tests/band.spec.ts` (15, 8 new): a stale event is kept as a standing part with its age ("claude: Bash · 5m ago") while a fresh one stays on the status row, and the idle text no longer repeats it; a long working task cannot push the claims, the spend or the last tool call out (the long task is cut on the first row; the second has no ellipsis), at 70 columns in compact forms and at 140 in full words; the panel is a bordered, grounded box of two rows; every piece of text has its own colour; each link is there and opens its view; a link that does not fit is dropped, not cut; open-console shows only while the pane is closed; findings are named from the last scan and loud only when critical, and absent for none; an available update is a link to Settings. The kit is faked, so the layout is checked without the host; how it looks is not.
