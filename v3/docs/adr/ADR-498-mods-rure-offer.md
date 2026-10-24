# ADR 498: a mod that offers ruRE when the model reads a binary

Status: Accepted (built and tested against the mod harness; ships in ruflo-mods 0.7.0, option off by default)

Date: 2026-10-23

Builds on: ADR-404 (ruflo as a Claude Code mod), ADR-494 to ADR-497 (the ruRE page and readers). The tools it points at are ruflo-rure ADR-0001 to ADR-0006.

## 1. Context

ruRE reads a program without running it, but nothing tells a person or the model that it is there at the moment a binary comes up. A model asked about `app.exe` tends to run `strings` or `file` through Bash, or guess. The console has a ruRE page; a session without the console, or a model mid-task, has no pointer.

## 2. Decision

An opt-in option, `rureOffer` (default off), registers three hooks:

- **`session.start`** asks `$.tool.list()` once whether an MCP tool named `…__rure_analyze_binary` exists. If not, the mod does nothing for the session.
- **`tool.call`** (observe only, after `next`): for `Read`, `Write`, `Edit` and `MultiEdit`, take `file_path`; if it is a project-relative path of plain characters (`A-Za-z0-9._/-`, at most 160, no `..`, no empty segment, no leading `-`) ending in `.exe .dll .so(.N) .dylib .node .asar .cubin .fatbin .ptx .evm .bytecode`, queue it (at most 8 waiting). An absolute path counts only under the session root. A denied call queues nothing. The call and its result are never changed.
- **`turn.complete`**, main loop only (`agentId` absent), not aborted: stat each queued path through `$.fs`, keep only regular, non-link files of 1 byte to 128 MiB (what ruRE accepts), and append one line to the answer's `text` naming at most three of them. A path is offered once per session; twelve per session in all. An aborted turn drops its queue; a subagent's turn leaves it for the main loop's.

The line is fixed words around already-validated paths: `ruRE can look inside <paths> without running <it|them>: in the ruflo console run /ruflo run dt-re-auto <first>, or ask me to call rure_analyze_binary (rure_analyze_cuda for GPU code). It only parses; nothing is executed.` Nothing the file contains reaches it.

## 3. Why offer-only

A mod that ran ruRE on every read would spend time and tokens on files the model only opened, and would put file-derived text under the answer. An offer costs one line, carries no file content, and leaves the choice to the person or the model. This also keeps the mod tighten-only in spirit: it cannot make any call do more.

## 4. Limits, stated plainly

- The extension list is a heuristic: a binary with another name, or a `.dll` that is plain text, is offered or missed accordingly. `.bin` and `.hex` are left out as too often plain data.
- It sees only what the model's file tools name. A binary reached through Bash is not offered.
- The line is shown beneath the answer by the engine's `turn.complete` text; a front-end that does not show that text shows nothing, and nothing breaks.
- The folder-outside-the-project case is not offered; ruRE's console refuses it too (a separate decision, a person-only setting).

## 5. Verification

`v3/@claude-flow/cli/__tests__/mods/mods-rure-offer.test.ts` (10): the path rule for accepted and refused names (traversal, spaces, shell characters, flags, long names, outside the root), the line's wording, off by default, one offer then none, inert without an MCP ruRE tool, ignoring other tools, files, denied calls, empty and missing files, no line on a subagent's or an aborted turn, the 3-per-turn and 12-per-session caps, and the call's result unchanged. The harness gained `World.tools` and `$.tool.list`.
