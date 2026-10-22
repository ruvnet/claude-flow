# ADR 442: A Sandbox page in the console, and Plugins moves to TOOLS

Status: Accepted (shipped in ruflo-console 0.28.0 and its companion plugins, PR #3667)

Date: 2026 10 04

Scope: `plugins/ruflo-console`: `hooks/sandbox.ts` (new), `hooks/views/sandbox.ts` (new), `hooks/devtools.ts`, `hooks/data/devtools.ts`, `hooks/nav-state.ts`, `hooks/views/menu.ts`, `hooks/state.ts`, `hooks/view-open.ts`, `hooks/help-*.ts`, `hooks/plugin-map.ts`.

Supersedes the grouping lines of ADR-430 (menu design) and ADR-424 (nav) only where they place Plugins in NETWORK.

## 1. Decision

1. **Plugins moves to TOOLS** (nav group and main-menu card). Skills and the Plugin Catalog stay in NETWORK & EXTEND: no test needs them to follow, and the catalog is the install surface for what Skills and Plugins show.
2. **A new `sandbox` page** sits in NETWORK: isolated places to try things. It reuses the Dev Tools machinery (entries with cost tags, fields, the ask-first runner, `devSpec`, the palette ids `dt-*`), so the confirm row, the result panel, `/ruflo run` and the self-check treat its rows like any other.
   - **tmux sandboxes**: real, throwaway tmux sessions. LIST (read, only `ruflo-sb-*`), NEW, SEND (asks, a SHELL COMMAND), CAPTURE (read), KILL (asks, `del`). Every argv is a fixed array, run with no shell. The name field is `^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$`; the console always prefixes `ruflo-sb-` and targets with `=` (exact match), so it can only touch its own sessions (`=ruflo-sb-a:` never reaches `ruflo-sb-ab`). SEND is `send-keys -t <t> -l <text> ; send-keys -t <t> Enter` as one argv: `-l` types the text literally, Enter is its own tmux command. The text follows the terminal `cmd` prose rule (no leading `-`, no control characters, at most 200) and may not end in `;`, because tmux splits an argument ending in a semicolon into two commands. If tmux is missing (a `tmux -V` probe when the page opens) its rows are n/a with the reason.
   - **RVF sandboxes**: the Dev Tools agenticow rows (`cow`: status, diff, lineage, checkpoint, branch, rollback, promote), drawn on both pages from the same entries and fields. Branch, try, then rollback or promote.
   - **RVM**: information only. A search of `v3/@claude-flow/cli/src`, the plugins and the ruflo MCP tool list found no rvm command or tool; ADR-398, ADR-399 and ADR-400 describe RVM as the privileged effect and resource-ceiling boundary, with `authority: none` for advisory code. The rows are n/a with that reason. The console never grants, widens or changes RVM authority.
3. **Sandbox has no hotkey.** Every letter is a page key or reserved (`p x r h j k y n o`), so `key` is `''`: the page is reached from the menu, the nav, the palette or by typing `sandbox` (the Skills page precedent). `tests/nav.spec.ts` and smoke step 16 accept an empty key.
4. `ruflo-rvf` has Sandbox as its home page (its Launch row appears there). `ruflo-ruos` stays with Swarm.

## 2. Honest limits

A tmux session is a separate shell that runs as the user. It is a place to work apart, not a security boundary, and the page and the guide say so. Only RVM, the OS and the host decide what code may do.

## 3. Verification

`tests/sandbox.spec.ts` pins the grouping (every page in exactly one group), the tmux argv (fixed, prefixed, validated, `-l`, no shell, n/a without tmux), the page text and the guide. The tmux argv forms were also run against a real tmux 3.4 (exact targeting, `-f` filter, literal text with `;` inside, Enter as its own command). Not verified: tmux versions other than 3.4, and an installed ruflo CLI's `--help` (not installed in the build environment).
