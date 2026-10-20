# ADR 436: The Help page: ruHelp and a guide for every capability

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Scope: `plugins/ruflo-console`: `hooks/help-docs.ts`, `hooks/help-topics*.ts`, `hooks/help-actions.ts` (new), `hooks/views/help.ts` (new), `hooks/views/pane.ts`, `hooks/bindings.ts`, `hooks/state.ts` (`help`), `hooks/commands.ts` (a stale key fixed), `tests/help-docs.spec.ts` (new).

Source: `docs/ruflo-explained.md` (the rUv Cohen explainer), for the concepts, the connection paths, the first task, verification, cost and federation guides.

## 1. Decision

The Help page was one block of key text. It is now ruHelp and the documentation:

- **ruHelp, the help bot.** A field at the top. A question is answered at once, from the built-in guides, for nothing: the best guide, its first three steps (each with its button), the other guides that matched. Matching is by words with a small table of same-meaning words ("spend", "budget", "expensive" are one idea), so people can ask in their own words.
- **Ask Claude with these docs.** The only thing that starts a model turn. It asks first with the exact words, screens a typed question with AIDefence, and sends the best guides as quoted data (each line behind `│`, so none can start a command); mid-turn it only fills the prompt box. Same rules as Ask Claude on every page.
- **Thirty-two guides**, brief, in seven groups (Start, Work, Learn, Safety, Network, Tools, Console): what it is for, then numbered steps, tips, and the guides to read next. Each step that has a target has the button that does it: open the page, run the palette entry, or start it (each asks first as it always does).
- **Opens where you are.** `h` opens the guide for the page you were on (the index from the main menu). A newcomer path (the tour, setting up, a first mission) leads the index. Every page has a guide (spec).
- **The explainer's ideas, in the console's words.** How the pieces fit (model, skill, MCP, plugins), connecting Claude Code, Codex, Desktop, ChatGPT and Grok, a safe first task, checking that it really works ("a connection is not proof"), cost per accepted result, and the federation (join, claims, Seraphina).

## 2. Kept honest

- A spec checks that every step's page, start and palette entry exists, that every "next" guide exists, that every page has a guide, and that guides stay brief (a summary of at most 90 characters, at most seven steps). Pointing a step at a palette entry that is gone fails it.
- Specs pin how people ask: fourteen natural questions each land on the right guide first. Writing them found a real bug (a one-letter token matched any long word by prefix).
- Claims in the guides were checked against the code (the mission controls, the Settings rows, the update choices), not written from memory; three were corrected before this shipped.
- The old `/ruflo help` text said `m` was Missions; `m` is the Plugin Catalog and Missions is `1`. Fixed.

## 3. Not proven

Seen through a fake kit, not on a terminal. The connection commands are the explainer's and were not run here. ruHelp is a keyword search, not a model: a question the guides do not cover gets "no guide matches" and the offer to ask Claude.
