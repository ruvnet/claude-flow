# ADR 435: The command palette laid out like the other pages

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Scope: `plugins/ruflo-console`: `hooks/views/palette.ts`, `hooks/views/pane.ts` (the palette now draws in cards), `tests/palette-view.spec.ts` (new).

Extends: ADR 430 (the menu's design), ADR 431 (the design carried through the pages).

## 1. Decision

The palette was a plain list: a dim group column and a bare button per entry, outside the cards every other page uses, with nothing to say what pressing an entry does or which one Enter runs. It now reads like the rest of the console:

- **Cards.** The palette draws through the same card kit as the pages (a section per `rule`): *Palette* (the filter field and the keywords that take text), *Matches*, *How it runs*.
- **Keywords as buttons.** The text commands (`route`, `store`, `search`, `task`, `mission`, `ask`, …) are chips that start the command (they put `route ` in the field), so they can be found without knowing them.
- **Rows.** One dotted-leader row per match, all one width, ending in a tag for what pressing it does: **go** (opens a page), **$0** (a read that runs at once), **ask** (a change: asks y/n first), **text** (takes the words typed after its keyword), **cmd**, **drill**, **n/a** (cannot run now). The first match, which Enter runs, is marked **▶** and primary.
- **Grouped, then ranked.** With nothing typed the entries sit under dim `── group ──` rules, as the menu groups its entries; once a query ranks them the list is flat (a group in the middle of a ranking would interleave) and the group moves to the end of each row.
- **Footer.** What the tags mean, that every entry is also `/ruflo run <id>`, and Close.

## 2. Not proven

Seen through a fake kit, not on a terminal. The twelve-row cap is unchanged ("+N more: keep typing").

## 3. Tests

`tests/palette-view.spec.ts` (6): grouped versus ranked; ▶ and primary on the first match only; every row one width; the tag for each kind; the keyword buttons and Close; no match and the selection context. Removing the ▶ and removing the leader padding each fail a spec.
