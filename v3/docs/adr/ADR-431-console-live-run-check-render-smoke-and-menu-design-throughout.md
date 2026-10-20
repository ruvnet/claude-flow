# ADR 431: A live check that every read-only run works, a render smoke for every page, and the menu's design carried through the pages

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `tests/live-read.spec.ts` (new), `tests/render-smoke.spec.ts` (new), `tests/design.spec.ts` (new), `hooks/views/common.ts` (`tagChip`), `hooks/views/nav.ts`, `hooks/menu-colors.ts` (`COST_CHIP`), `hooks/views/{secure,devtools,mh-lab,memory-lab,vector,xruv,automate}.ts` (the cost tag), `hooks/views/secure.ts` (a missing import).

Extends: ADR 426 (the self-check), ADR 430 (the menu's design), ADR 420 (the live smoke).

## 1. Context

Two asks: use the main menu's design through the whole UI, and make sure every run-related capability works as expected.

ADR 426's self-check proves that each command is *built* correctly: its argv is well-formed, a text verb refuses an empty field, every runnable row has an input that runs. It cannot prove that the command *runs*: that the CLI still has the verb, that the entry's reader copes with what it prints. And none of the pure specs draws a page, so a page that fails to draw is invisible to them. Looking for what the second gap hides found a bug this branch had shipped.

## 2. Decision

### 2.1 A live check of every read-only run
`tests/live-read.spec.ts` takes every runnable id the palette lists (the catalog a button press resolves through), keeps the ones that are read-only (`$0`, local, run at once without a confirm), runs each exactly as a press does (the console's default `npx --offline -y @claude-flow/cli@latest`, in a scratch directory, eight at a time), and reads what it printed with the runner's own rules: the runner's test of whether a run went well, and its order for what the result panel shows (`spec.read`, else `spec.lines`, else the lab's reading).

- **Pass:** it went well and there are lines to show.
- **Warning:** it did not go well but says so in words the panel shows. A project with no audits, no database, or no suite answers that way; it is not a broken button.
- **Failure:** the CLI does not know the command or an option (the registry has drifted), a reader throws, a hang, or the panel would be empty.

It is off by default (it starts a process per command): `RUFLO_LIVE=1 npx vitest run plugins/ruflo-console/tests/live-read.spec.ts`. An always-on part checks that the palette still lists a sensible set of read-only runs.

**What it found, on CLI 3.51.1 from the npx cache:** 133 read-only runs in 17 seconds: **120 pass, 13 warn, 0 fail**, and 9 entries skipped because they are not ruflo CLI calls (a fixed command, or code that does its own thing). The warnings:

- *No data in an empty project:* `mh-drift` (no audit records yet), `mh-bench-verify` (no bench suite), `mem-stats` and `mem-retrieve` (no database, no such key), `mem-synth`, `mem-sroute`, `auto-ses-current` (nothing to read).
- *A sample that is not the input the verb wants:* `dt-app-inspect` and `dt-app-verify` (the sample `deploy` is not a file), and `dt-daemon`, which printed the daemon's status and exited 1 in that run (a hand run of the same command exited 0, so the exit code is not stable and the check does not rely on it).
- ***A real defect, in the CLI, not the console:*** `dt-wasm-gallery`, `dt-wasm-categories` and `dt-wasm-search` print `Failed to initialize @ruvector/rvagent-wasm: ERR_MODULE_NOT_FOUND` and exit 0. The CLI's source imports `@ruvector/rvagent-wasm` in four files (`mcp-tools/wasm-agent-tools.ts`, `commands/agent-wasm.ts`, `ruvector/agent-wasm.ts`, `types/optional-modules.d.ts`) but its `package.json` does not declare it, so those buttons fail on any install that does not already have it. The console shows the error honestly; the fix is in the CLI's dependencies. Not done here.

An early version of this check misread `mh-bench-verify` as a failure, because it did not apply the runner's rules for what the panel shows (the CLI's message is on stderr, which the lab's reader falls back to). A check that disagrees with the runner is worse than none, so it now mirrors the runner exactly.

### 2.2 A render smoke for every page
`tests/render-smoke.spec.ts` draws every page through `viewText`, the console's own text renderer, in both looks, at 60, 100 and 160 columns, with an empty project and a busy one (spend, findings, an update on offer, a terminal run), and fails on a throw, an empty page, or a printed `undefined`, `NaN` or `[object Object]`. It needs no host. **It found a bug this branch had shipped:** `views/secure.ts` called `sentryRows` (ADR 427) without importing it, so the Security page threw a `ReferenceError` the moment it drew. No pure spec renders that view, and the kit tests that would have caught it need the host package, so only CI would have. Removing the import again fails all six cases, which is the check that the smoke can fail.

### 2.3 The menu's design through the pages
- **A cost tag is a solid chip** in the BBS look (`$0`, `wr`, `cpu`, `net`, `$$`, `del`), the way the menu draws a key: dark ink on a ground by how much the run asks (a read green, local work or a write cyan, the network amber, spending or deleting red). One helper, `tagChip`, replaces seven copies of the same text at the call sites in Security, Performance, Dev Tools, the MetaHarness lab, the Memory Lab, the Vector Lab, x.ruv.io and Automation. The plain look keeps coloured text.
- **The nav card:** the open page and the open group are solid chips in the page's accent (the colour of the menu group that lists it), and the page buttons carry the menu's badges (spend on Cost, an update on Settings, approvals, findings). Together with ADR 430's accented section rules and card borders, a page now reads in the menu's colours from the nav down.
- **A badge never costs a row its fit.** Its length is in the width the nav uses to choose a form, and the spec tests every width from 50 to 200 columns, not a handful (a first version tested five and could not fail: the overrun only happens in the narrow window where the choice is on the edge).

## 3. What this does not prove

- **Only the read-only runs are run live.** A write, a spend, a network call or a delete is never run by a test: those ask first, and a test is not a person who can say no. Their commands are checked only by the self-check (built right), not by running.
- **One CLI, one project.** The runs are against the CLI the npx cache holds (3.51.1) in an empty scratch project, so what a verb does with real data is not covered, and a verb that needs a sample (a path, a key) is only as good as the sample.
- **How it looks.** The chips, the accents and the nav are checked by what they are made of (their colours, contrast, widths), through a fake kit, not by seeing them. The kit tests that draw them need the `claude-code/testing` host package and run in CI.

## 4. Tests

`tests/live-read.spec.ts` (2; one off unless `RUFLO_LIVE=1`); `tests/render-smoke.spec.ts` (6: two looks by three widths); `tests/design.spec.ts` (6: a cost tag is a chip in the BBS look and text in the plain one; the open page and group are accent chips and plain text; the menu's badges are on the page buttons and absent where there is nothing to say; no row of pages exceeds its width at any of 151 widths, checked by removing the badge from the width and watching it fail at 52 columns). The console suite passes 463 tests; the 22 files that cannot load the host package fail only on that import.
