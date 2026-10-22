# ADR 434: The Plugins page detects the marketplace, and can act on plugins

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Scope: `plugins/ruflo-console`: `hooks/plugin-ops.ts` (new), `hooks/views/plugins.ts`, `hooks/views/steps.ts`, `hooks/bindings.ts` (`plugin`), `hooks/views/common.ts` (`Actions.plugin`), `tests/plugin-ops.spec.ts` (new).

## 1. The bug

The page's "Start here: get the ruflo plugins" card showed "1. Add the ruflo marketplace" as the next step even when the marketplace was added. The page body read `known_marketplaces.json` correctly; the card's step simply had no `done` check, so it could never see it. Step 1 now checks the marketplace list; step 2 is "Install a ruflo plugin" and is done once a plugin from the ruflo marketplace is installed, so the card goes away when both are true. A spec calls `stepsRows` directly (a first version asserted on the page text, which does not include the card, and passed with the fix removed; it now fails without it).

## 2. One place for each job, and links between them

An earlier version of this ADR gave the Plugins page its own install, update, enable and disable buttons. They duplicated the Plugin Catalog's (which also had uninstall and `--scope user`), so they are gone: **the Plugins page is for the health of the setup, the Plugin Catalog is for the plugins.**

- **Plugins page:** the marketplace clone (age, auto-update, stale), the installed/enabled/listed/loaded matrix, mods, and one action: **update the marketplace** (`claude plugin marketplace update ruflo`, primary when the clone is stale; asks first, network). Its folded **Installed plugins** and **Available to install** lists show each plugin with its state and open it in the catalog; an installed plugin also links to the console section that launches its commands (→ Swarm, → Security, …).
- **Plugin Catalog:** unchanged in what it does (browse, filter, contents, view/use, install/update/enable/disable/uninstall). New: a health line (how fresh the clone is) with **◂ Plugins: health** and **↻ update marketplace**; a selected plugin's detail has a **related** row: → the section that launches it, → Plugins: setup health.
- **Launch sections** (the foot of every page): laid out like the menu's cards: a dim `── plugin ──` rule per plugin with **▸ in the catalog**, then one dotted-leader row per command, all one width, ending in a primary **▶ run**. Before, the plugin name was a ragged green line and each command was a variable-width button followed by a loose ▸ run.
- `views/links.ts` holds the two links every page uses (`openInCatalog`, `homeLink`).

## 3. Not proven

Seen through a fake kit, not on a terminal. The marketplace update was checked against `claude plugin --help`, not run.
