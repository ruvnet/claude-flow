# ADR 489: `ruflo tui`: the console in a terminal of its own, over the same views

Status: Proposed (phase 1, a read-only Overview and Cost, is implemented in the draft PR that adds this file; phases 2 to 4 are a roadmap)

Date: 2026-10-11

Builds on: ADR-407 (the cockpit), ADR-446 (plugin mods), ADR-448 (the Room), ADR-481 (one sanitiser for drawn text), ADR-486 (session workspace), ADR-150 (plugin skills dispatched by the CLI, with graceful degradation), ADR-437 (multi-provider cost ledger). Security inputs: #3983 (every confirm route bound to the card the person saw), #3981 (no transcript text or path in a model-facing answer).

Numbering: 488 is the highest on `main` and no open pull request names 489 (checked 2026-10-11 before committing). ADR-487 exists twice, so check again at merge.

## 1. Context

rUv's goal: a TUI for ruflo, part of `npx ruflo`, that reuses the ruflo-console components and works both on its own and as the mod inside Claude Code
(ruflo-mods). A standalone host should eventually drive Codex and OpenRouter. The agreed starting point was a **thin shell first**: a `ruflo tui` entry
that embeds the existing views, Codex and OpenRouter through their own CLI or API, Claude Code staying a supported host, and not a new agent harness.

This ADR records what the code showed, the decision, and the first slice. Every number below was measured on `main` at 72255a2f4 unless it says otherwise.

## 2. Findings (evidence)

### 2.1 The host boundary already exists

`plugins/ruflo-console/hooks/host.ts` defines `Host`, "the engine as `session.start` bound it": 31 required members and 3 optional ones (`fs`, `run`, `spawn`,
`every`, `after`, `storeGet/Set`, `openPane`, `blit`, `toolCall`, `rufloSnapshot`, `httpSend` …). Its contract says any member may be refused and a refusal is
a missing fact, never a crash. `register.ts` `hostOf($, …)` is the one place that spells `$.noun.method(...)`: the Claude Code adapter. The controller
(`createController(state, host)`), every view (`(ctx) => RenderElement`, built only from `ctx.kit.Box|Text|Button`, optional `Raster|Input`) and the page
(`paneView`) are plain functions over that interface.

Static check over all 343 `.ts` files under `hooks/` (comments stripped; the rules are asserted by `tests/tui-boundary.spec.ts`):

| class | meaning | files | where |
|---|---|---|---|
| host-neutral | no engine call, no Node module, no package; reads files through `Host.fs`, runs the ruflo CLI through `Host.run` | **315** | top level 97, `data/` 103, `views/` 98, `gfx/` 17 |
| host-engine-dependent | calls a `Host` member only the Claude Code host can answer (panes, `blit`, prompt box, `toolCall`, `rufloSnapshot`, dialogs, toasts) | **26** | top level 23, `views/` 3 (`wf-control`, `wf-guide`, `wf-templates`) |
| Claude-Code-only | touches `$` or `on(...)` directly | **2** | `register.ts`, `model-tools.ts` (the model-facing `console_*` tools) |

95 files import `claude-code`, all as types; no file imports a Node module or a package. The "about 113 files" in the question is the
top level of `hooks/` (122 `.ts` files: 97 host-neutral, 23 engine-dependent, 2 engine-only); the whole folder has 343. "Host-neutral" is a statement about imports, not about usefulness: many neutral views
draw `n/a` on a host that cannot measure what they read (see 2.4).

### 2.2 What it renders to: no terminal library, no escapes

The console uses no TUI library and writes no terminal escape sequence. Views build an element tree; the Claude Code engine lays it out and draws it. `Raster`
(`gfx/raster.ts`, `[codePoint, fg, bg]` triplets as base64) is Claude Code's own element, a picture the engine paints. A search for Kitty found nothing in the
console. The premise "renders to Kitty / 256-colour" is therefore not in the code; the 256-colour note in the project memory is about Claude Code inside tmux.
A standalone host needs its own renderer for `Box|Text|Button`; `Raster` can take its existing words fallback (`picture()` in `views/common.ts`) until a later phase.

### 2.3 How `npx ruflo` dispatches, and where `tui` fits

`ruflo/bin/ruflo.js` is a thin wrapper that loads `@claude-flow/cli`. The CLI maps a command name to a lazy `import('./<name>.js')` in
`src/commands/index.ts`, and lists names in `src/mcp-tools/capability-brain.ts` (pinned by `guidance-brain.test.ts`: 52 became 53). `commands/metaharness.ts`
is the precedent for a command that runs plugin code: it finds `plugins/ruflo-metaharness` in the CLI's **own** install (`plugins/own-install.ts`
`ownPluginDirs`, which stops at `node_modules` so a repository cannot supply code that ruflo then runs), degrades gracefully when it is absent, and
`scripts/prepare-publish.mjs` copies the plugin into the tarball. `tui` follows exactly that shape.

### 2.4 What a standalone host can and cannot know

| Source | Claude Code host | Standalone host |
|---|---|---|
| ruflo files (`.claude-flow/*`, `.swarm/*`, helpers manifest) | `$.fs` | Node `fs`, confined (see 4) |
| ruflo CLI JSON probes | `$.process.run` | `execFile` of **this** CLI, no shell |
| session cost, context % (`usage()`) | engine | **n/a** (no Claude session) |
| `ruflo-mods` budget and routing (`rufloSnapshot`) | `$.ruflo` | **n/a** (mods not seated) |
| panes, focus, blit, prompt box, slash commands, tool calls | engine | refused |

So in phase 1 the Cost page shows `n/a` for Claude Code spend, context and the budget ladder, and shows what is on disk: the provider ledger when
`ruflo-cost-tracker` data exists, and the router's counts. That is true, not a defect; but it means Cost is thin until phase 2 reads Codex and OpenRouter spend.
The shared chrome also still draws Claude-only affordances (Ask Claude, the Claude-control card, "ruflo-mods · asks first" rows). They are drawn inert and dimmed
in this phase; hiding them needs a host capability flag (phase 2, see 6).

### 2.5 Node floor and what ships

Node `>=20` (root, `ruflo`, `@claude-flow/cli` all declare it). The console is TypeScript with extensionless, bundler-style imports and constructor
parameter properties (`gfx/raster.ts`), so it cannot be compiled by the CLI's `tsc` (NodeNext) and Node's native type stripping (22.18+) refuses it: the
standalone host needs a **bundle**. `esbuild` bundles `tui/main.ts` and everything it reaches into one ESM file: **1247 KiB minified, 437 KiB gzipped**
(1.9 MB unminified), no dependency left to install. `esbuild` is present in the repo's `node_modules` only through another tool; it is not a declared devDependency (decision A below).

## 3. Decision

### 3.1 The `Host` interface is the adapter boundary. Do not invent a second one.

Name the existing `hooks/host.ts` contract as the boundary and enforce it with a test (`tests/tui-boundary.spec.ts`): `hooks/` has no value import of the
engine declarations, no Node module and no package; only `register.ts` and `model-tools.ts` reach `$`; `tui/` imports neither. There are then two adapters:

| | Claude Code mods adapter (exists) | Standalone terminal adapter (this PR) |
|---|---|---|
| Host | `hostOf($, …)` in `register.ts` | `tui/node-host.ts` `createNodeHost` |
| Kit (draws `Box|Text|Button`) | the engine's element table, `$.ui.resolve` | `tui/ansi.ts` `terminalKit` + `render` |
| Loop | engine render, input and timers | `tui/run.ts` (alternate screen, raw keys, a timer) |
| Page | `paneView(ctx)` | **the same `paneView(ctx)`** (`tui/session.ts`) |

The rule for adding a view: it renders against `Ctx` and uses only `ctx.kit`; if it needs a member only one host has, it reads it through an optional `Host`
member and shows `n/a` where it is absent. No view forks per host.

### 3.2 Placement: one source of truth, a sibling folder, a build-time bundle

- Source stays in `plugins/ruflo-console/`. The standalone adapter lives beside it in `plugins/ruflo-console/tui/` (not in `hooks/`, which must stay Node-free).
  Nothing is copied or forked; `tui/` imports `../hooks/*` by relative path.
- `plugins/ruflo-console/scripts/build-tui.mjs` bundles `tui/main.ts` to `plugins/ruflo-console/dist/tui.mjs` (gitignored).
- `@claude-flow/cli` gains `src/commands/tui.ts`: it finds `plugins/ruflo-console/dist/tui.mjs` in its own install (`ownPluginDirs`, never the working directory),
  imports it, and calls `runTui`. No bundle is a message and exit 1; no terminal is one plain frame and exit 0. Ruflo works without it.
- Publishing: `scripts/prepare-publish.mjs` must run the build and copy `plugins/ruflo-console/dist` into `plugins/ruflo-console/` of the CLI tarball, as it
  does for `ruflo-metaharness`. **This PR does not change the publish path** (it cannot be exercised without a release); until it does, `npx ruflo tui` reports the
  bundle as missing on a registry install and works from a checkout after `node plugins/ruflo-console/scripts/build-tui.mjs`. See decision B.
- This is not a new npm package and not one of the four bundled leaves: no `@claude-flow/*` version, pin or standalone publish changes. The CLI's "bundled
  versus standalone leaves" rule is untouched; the cost is the +437 KiB gzip tarball weight in phase 1b.

Rejected: a new `@claude-flow/tui` package (a fifth artifact to version, publish and pin, for code that has one consumer); moving views into `cli/src` (a fork of
343 files and a circular dependency, since the plugin would then import the CLI); compiling the console with the CLI's `tsc` (its imports are not NodeNext);
requiring `tsx` or Node 22 at runtime (a dependency or a floor bump).

### 3.3 Renderer

A 200-line renderer (`tui/ansi.ts`): `Box` row and column, rounded and single borders, `paddingX`, `gap`, `Text` colour (theme names, `#rrggbb` as truecolor or the nearest
256-cube), bold, dim, italic, inverse, word wrap and `truncate-end`, `Button` as an inert `[label]`. No `Raster`, no `Input` (the views already have fallbacks for both).
**No dependency.** Ink, blessed or similar would bring a React or a native layer into a CLI that has neither; if a later phase needs real input fields it may
add one as an **optional, lazily imported** dependency, per the published-train rule, and say so here first.

### 3.4 Security constraints on the new host (each is enforced and tested)

| Constraint | How it holds on the standalone host |
|---|---|
| Confirm gate bound to the card the person saw (#3983) | Phase 1 has **no write path**: buttons are inert, no key maps to an action, `askChoice` rejects, and `run` only accepts the ruflo CLI. The controller's `confirm(seen)` binding is unchanged and unexercised. A write phase must port the #3983 tests to this host before it lifts any refusal. |
| One sanitiser for drawn text (ADR-481, `modelLine`) | `modelLine` guards what a **model** reads and lives in `model-tools.ts` (engine-only), so it is not imported. The terminal needs the same guarantee for what a **person's terminal** executes: `ansi.ts` `clean` is the chokepoint (OSC/CSI/C1/invisible removed, a line holding a secret or invite withheld whole, using the same `ESCAPES`, `INVISIBLE`, `hasSecret`, `hasInvite`). The mod gets this from the engine; here it is ours. `tui-render.spec.ts` feeds OSC title injection, `\u001b[2J`, `\u001b[?1049h`, a GitHub token and an Anthropic key through every colour depth. |
| Path and transcript leaks (#3981) | Reads are confined to the project, `~/.claude` (or `CLAUDE_CONFIG_DIR`) and `~/.claude-flow`, symlinks resolved before the check (tests: `../`, a link out of the project, `~/.ssh`). The page is drawn for a person (`ctx.text` false), so session previews follow ADR-486; the model-facing path (`viewText`, `console_state`) is untouched. **Not a model channel:** non-TTY output is one plain frame; if someone pipes it to a model that is their choice, and it still passes `clean`. |
| No credentials in output or child processes | `run` starts only `process.execPath <this cli.js> …` (no shell, fixed argv) with an environment allowlist (`PATH`, `HOME`, `LANG`, `TERM`, `CLAUDE_FLOW_*`, `RUFLO_*` …): `OPENROUTER_API_KEY` and friends do not reach the child (test). `fetchText`, `httpSend`, `spawn` are refused. Nothing is written to disk (the store is in memory). |
| A repository cannot supply code that ruflo runs | The bundle is loaded from the CLI's own install only (`ownPluginDirs`); a `plugins/ruflo-console/dist/tui.mjs` inside the opened project is ignored (test). |

### 3.5 Codex and OpenRouter

The console already has an AI terminal (`harness.ts`) that asks `codex`, `claude` or both through `Host.spawn`, and OpenRouter and other OpenAI-compatible
endpoints through `Host.httpSend` with the key named by `keyEnv` (`OPENROUTER_API_KEY`; `convoTargets`, `data/wf-targets.ts`), plus the multi-provider cost ledger (ADR-437). The
standalone host reuses all of it by **implementing `spawn` and `httpSend`**, not by writing a harness: `spawn` for an allowlist of binaries (`codex`, `claude`) in a
read-only sandbox mode by default, `httpSend` for the configured hosts only with the key read from the environment at call time and never stored, logged or drawn.
Both stay refused in phase 1.

### 3.6 Claude Code remains a first-class host

`/ruflo` in Claude Code is unchanged: `register.ts` and the 342 other files were not touched by this PR. `ruflo tui` is an additional front end over the same state,
not a replacement and not a second implementation.

## 4. Phases

1. **Phase 1 (this PR, draft): the vertical slice.** `ruflo tui [--view overview|cost]`; alternate screen, keys `o c Tab r j k PgUp PgDn g G q`, auto-refresh every 3 s; headless prints one plain frame; read-only; the boundary and security tests; ADR.
1b. **Publish wiring.** `prepare-publish.mjs` builds and stages the bundle; a CI job runs `ruflo tui` headless from the packed tarball; decide on `esbuild` as a declared devDependency.
2. **Host capabilities and more pages.** `Host.capabilities` so chrome and rows that need Claude Code are hidden, not drawn inert; Swarm, Room, Events, Missions read-only; Raster to half-block cells; Windows and tmux verification; `NO_COLOR` and width (CJK, emoji) handling.
3. **Drive Codex and OpenRouter** (3.5) behind the confirm gate, with #3983's tests ported; the AI terminal page; per-provider spend read from the CLIs' own reports and the ledger.
4. **Actions.** Pressable buttons and fields (an optional lazily loaded input dependency, or hand-rolled), the confirm card, the palette; each write goes through `Runner` as in the mod.

## 5. Risks

- **Chrome that lies.** Inert Claude-only controls are visible until phase 2. They are dimmed and the footer says read-only; still a rough edge.
- **Drift.** A new view may import something engine-specific. Mitigation: `tui-boundary.spec.ts` (imports) and a headless smoke over the pages the TUI opens.
- **Bundle size.** 437 KiB gzip for a feature many will not use. It loads lazily, only for `tui`. Dropping the unused pages from the bundle (tree-shaking by an explicit page list) is a phase 2 option.
- **A second place to sanitise.** The engine's escape handling is not inherited. `clean` is one function with a test; any new drawing path must go through `render`.
- **Terminal variance.** Raw mode, alternate screen and SGR 256/truecolor are standard xterm behaviour; other terminals, tmux colour depth and Windows are unverified (section 7).
- **Probe cost.** Overview and Cost run the ruflo CLI as a child (version, memory stats, model stats). That is a Node start per probe each cadence; they inherit the controller's cadence and `MAX_PARALLEL_PROBES`.

## 6. Out of scope

An agent tool loop or any new harness; new model providers beyond what `convoTargets` already offers; editing files or settings from the TUI; mouse support;
a web or desktop front end; publishing, version bumps, and the Slack or dashboard connectors. The console's version and changelog are not touched by phase 1.

## 7. Verification

Run on this machine (Linux 6.17, Node 22.23.2, a pty from `script`): 36 new vitest tests in `plugins/ruflo-console/tests/tui-{host,render,session,boundary}.spec.ts` and 6 in `v3/@claude-flow/cli/__tests__/tui-command.test.ts`,
all passing; `tsc -p plugins/ruflo-console` reports no error in `tui/` or the new tests (7 errors exist in other files already on `main`); `node …/cli.js tui` against this repository printed the
real CLI version (`v3.56.5`), the real swarm id, daemon state and helpers manifest; the pty run entered the alternate screen once, switched to Cost on `c`, scrolled on `j`, quit on `q`, left raw mode and the
alternate screen, exit 0.

**Unverified:** Node 20 (the declared floor; the bundle targets it but only 22 was run), macOS Terminal, iTerm2, kitty, Windows Terminal and conhost (raw mode and SGR), tmux/screen colour depth, a terminal narrower than 40 columns, wide
characters, `npx ruflo tui` from a registry install (the bundle is not staged by `prepare-publish.mjs` yet), and every page other than Overview and Cost.

## 8. Decisions for the owner

- **A.** Declare `esbuild` as a root devDependency (build-time only, changes `package-lock.json`)? Today it resolves only because another tool pulls it in.
- **B.** Wire the bundle into `prepare-publish.mjs` now (adds ~437 KiB gzip to the CLI tarball and a build step to the release) or hold until phase 2 makes the page set worth it?
- **C.** Which pages are in the standalone shell after Overview and Cost: Swarm, Room, Events, Missions? Each is read-only first.
- **D.** For Codex and OpenRouter: is read-only sandboxing by default the right default, and may `httpSend` reach only `openrouter.ai` plus hosts named in `convoTargets`?
- **E.** Exit code when `tui` is not in a terminal: it prints one frame and exits 0 so pipes and CI do not fail; say if a non-zero exit is preferred.
