# Index: the mod-system ADRs (404 to 453)

Checked 2026-10-05 against `main` at 6c7b6e889. "PR" is the merged pull request that added the ADR file (found with `gh api repos/ruvnet/ruflo/commits/<sha>/pulls`); "Shipped in" is the version the ADR's own status line names, confirmed against the `version` in the plugin's `plugin.json` at the commit that added the ADR or its code. "Tests" are test files the ADR names or that the commit implementing it added (console tests are in `plugins/ruflo-console/tests/`, `.spec.ts` unless noted). `—` means the ADR does not say. `node scripts/check-adr-links.mjs` checks the links, the relation lines and the numbering of the 4xx files.

Two files carry the number 430 (the menu's accents, and the menu-design amendments); `scripts/check-adr-links.mjs` allows exactly that pair.

## The mod platform and the plugin fleet

| ADR | Title | Status | Date | Builds on / extends | Superseded by | PR | Shipped in | Tests |
|---|---|---|---|---|---|---|---|---|
| 404 | Ruflo as a Claude Code mod (function hooks) | Accepted | 10-01 | related 150, 174, 324, 405 | — | #3608 | ruflo-mods (0.3.4 now) | `bench-mods-latency.ts`, mods suites |
| 405 | ruOS desktops as swarm execution hosts | Proposed | 10-01 | related 150, 324, 325 | — | #3605 | ruflo-ruos 0.1.0 (status not updated) | `smoke.sh` |
| 445 | AgentDB as a mod: safe recall, a write guard, `/agentdb-mod` | Accepted | 10-04 | 404, 444 | — | #3697 | ruflo-agentdb 0.4.0, console 0.31.0 | `agentdb-mod.spec.ts`, plugin tests, `bench.mjs` |
| 446 | The plugin fleet as mods (39 plugins) | Accepted | 10-04 | 404, 445 | — | #3700 | 39 plugins; 44 plugins have a mod today | per-plugin `claude plugin test`, `smoke-all-plugins` |
| 447 | Native mod guidance and observation loop | Accepted | 10-04 | 404, 445, 322A | — | #3702 | ruflo-mods 0.2.0 + CLI `guidance` adapter | `guidance.test.ts`, `mods-guidance-e2e.test.ts`, workflow `mod-guidance.yml` |
| 449 | Guidance learning loop on the mod system | Proposed | 10-04 | 404, 447, 322A/C, 446 | — | #3722 (doc only) | not built: its "New" rows are unimplemented | — |
| 450 | Threat model of the mod system | Proposed (T1 part, T6, T8, T12 done; T19 recorded; T9 and default confirm await a human) | 10-05 (see note) | 404, 444, 445, 446, 447, 448; related 449, 451, 452 | — | merged: #3717 (console 0.33.3: T1 truthful classes incl. dt-term-exec, T3 plain()); T8+T12 in #3720 (0.33.4), T8 install class in #3730 (0.33.5); T6 guards #3727, #3734, #3745, #3764; T19 (`http.fetch` read path, recorded without a fix) in #3740 | ruflo-console `threat-model.spec.ts`, `control-guards.spec.ts` | `threat-model.spec.ts`, `threat.test.ts` |
| 451 | Mod capability roadmap | Proposed (items 1–3, 5–7 shipped, all default off; 4, 8, 9, 10 not built) | 10-04 | 404, 445, 446, 447; related 449, 450, 452 | — | #3716 (ADR + `toolHints`, 0.3.0); `agentTrim` item 2 (0.3.1, `33a60c715`); `deliveryScreen` item 3 (0.3.3, `cd01a4aea`); `capabilityProbe` item 5 #3763 (0.3.7); `sessionRollup` item 6 #3766 (0.3.8); `compactCarry` item 7 #3768 (0.3.9); agentTrim live fixes #3733 and measurement #3760; fixes 0.3.2, 0.3.4 | ruflo-mods 0.3.9 | `describe`, `agents`, `delivery`, `probe`, `rollup`, `compact` tests |
| 452 | Mod-system overnight hardening: findings, changes, open items | Accepted (record) | 10-05 | 404, 444, 445, 446, 450, 451 | — | #3735; records #3706, #3711, #3713, #3714, #3715, #3717, #3719, #3727, #3732, #3733, #3734 (all merged) | no code of its own | `probe-mod-guards`, `sync-mod-screen --check` |
| 453 | Project Anatole: an optional, learning watchdog for unattended agents | Proposed | 10-05 | 404, 444, 445, 446, 450, 451, 452; related 449 | — | this PR (ADR only) | not built | — |
| 491 | ruflo-mods across Claude Code and Codex: a host-neutral core and a thin Codex adapter | Proposed | 10-11 | 404, 406, 444, 447, 451, 488, 490; related 489 | — | this PR (ADR only) | not built; evidence table measured by ADR-490's loop | `scripts/e2e/leg-codex.mjs` policy probes |
| 494 | ruRE in the ruflo console: a TOOLS page for static reverse engineering | Accepted | 10-23 | 442, 480; related 489 | — | this PR | ruflo-console 0.45.0 (the `rure_*` tools are in `main` after 3.59.17) | `tests/rure-page.spec.ts`, `tests/rure-e2e.spec.ts` (real CLI) |

## Console: mission control and Claude control

| ADR | Title | Status | Date | Builds on / extends | Superseded by | PR | Shipped in | Tests |
|---|---|---|---|---|---|---|---|---|
| 406 | Mission control through compatible mods | Proposed | 10-01 | extends 404; complements 405 | — | #3617 | partly (console missions, see note) | — |
| 407 | The ruflo-console cockpit | Accepted | 10-02 | extends 404, 406 | — | #3634 | console 0.6.2 | `conformance`, `smoke.sh`, `sweep.test.ts` |
| 408 | Mission Control in the cockpit | Accepted | 10-02 | extends 406, 407 | — | #3640 | console 0.11.0 | `ask-claude`, `goap`, `e2e-smoke.sh` |
| 409 | The planner and the one lifecycle | Accepted | 10-03 | extends 406, 407; detail of 408 | — | #3647 | console 0.14.x | `mission-control`, `mission-review` |
| 410 | Claude's guidance and the AIDefence screen | Accepted | 10-03 | extends 409 | — | #3647 | console 0.14.x | `mission-guidance`, `mission-review` |
| 411 | The Claude UI bridge: Ask, Launch, plugin map | Accepted | 10-03 | extends 407 | — | #3647 | console 0.14.x | `ask-claude`, `plugin-coverage` |
| 412 | Answers open where they were asked | Accepted | 10-03 | extends 407 | — | #3647 | console 0.14.x | `attention.test.ts`, `labs.test.ts` |
| 413 | The regression system | Accepted | 10-03 | extends 407 | — | #3647 | console 0.14.x | `smoke.sh`, `e2e-smoke.sh` |
| 414 | The Loop Manager | Accepted | 10-03 | extends 411 | — | #3647 | console 0.15.0 | `loops` |
| 415 | The Learning page and the Optimizer | Accepted | 10-03 | extends 412 | — | #3647 | console 0.16.0, 0.17.0 | `learning`, `optimizer` |
| 416 | Timeline and Events | Accepted | 10-03 | extends 407 | — | #3648 | console 0.18.0 | `watch` |
| 417 | The AgentBBS section | Accepted | 10-03 | extends 407 | — | #3651 | console 0.19.0 | `agentbbs`, `xruv.test.ts` |
| 418 | Tool rows name their mission task | Accepted | 10-03 | extends 407, 409 | — | #3652 | console 0.20.0 | `tool-owner` |
| 419 | AgentDB reads in the Memory Lab, coverage audit | Accepted | 10-03 | extends 407, 411 | — | #3653 | console 0.21.0 | `memory-lab` |
| 420 | Tool-coverage audit and a live smoke | Accepted | 10-03 | extends 407, 411, 413, 419 | — | #3655 | console 0.21.0 | `e2e-smoke.sh` |
| 421 | The boot screen brings every area online | Accepted | 10-03 | extends 407 | — | #3658 | console 0.22.0 | `diagrams` |
| 422 | Cards, a grouped nav, page-scoped asks | Accepted | 10-03 | extends 407, 412 | 424 (the nav card, in part) | #3659 | console 0.23.0 | `card`, `missions.test.ts` |
| 423 | "Start here" steps | Accepted | 10-03 | extends 407, 422 | — | #3660 | console 0.24.0 | `steps` |
| 424 | A compact nav with search | Accepted | 10-03 | extends 422 | 442 (Plugins group, in part) | #3663 | console 0.25.0 | `nav-state`, `nav.test.ts` |
| 425 | The Missions list | Accepted | 10-03 | extends 409, 407, 424 | — | #3665 | console 0.26.0 | `mission-list` |
| 426 | Self-check, boot report, visible runs | Accepted | 10-03 | extends 421, 411, 413, 420 | — | #3665 | console 0.26.0 | `self-check` |
| 427 | Security sentries | Accepted | 10-03 | extends 414, 411, 426 | — | #3665 | console 0.26.0 | `sentries` |
| 428 | Update check and auto-update | Accepted | 10-03 | extends 407, 426 | — | #3665 | console 0.26.0 | `updates` |
| 429 | The band: panel, standing row, links | Accepted | 10-03 | extends 407, 409, 428 | — | #3665 | console 0.26.0 | `band` |
| 430 | Main menu: accents, chips, badges | Accepted | 10-03 | extends 407, 429 | — | #3665 | console 0.26.0 | `design`, `menu-style`, `footer-layout` |
| 430 | Main menu design (amendments file) | Accepted | 10-03 | extends 407 | 442 (Plugins group, in part) | #3665 | console 0.26.0 | — |
| 431 | Live run check, render smoke, menu design throughout | Accepted | 10-03 | extends 426, 430, 420 | — | #3665 | console 0.26.0 | `live-read`, `render-smoke` |
| 432 | Cyberpunk boot uplink and Refresh | Accepted | 10-03 | extends 426, 430 | — | #3665 | console 0.26.0 | `boot-cyber` |
| 433 | Menu entry and page-title strike-in | Accepted | 10-03 | extends 430, 432 | — | #3665 | console 0.26.0 | `menu-entry` |
| 434 | Plugins page detects the marketplace | Accepted | 10-03 | — | — | #3665 | console 0.26.0 | `plugin-ops` |
| 435 | The palette page design | Accepted | 10-03 | extends 430, 431 | — | #3665 | console 0.26.0 | `palette-view` |
| 436 | Help: ruHelp and guides | Accepted | 10-03 | — | — | #3665 | console 0.26.0 | `help-docs` |
| 437 | Cost across providers | Accepted | 10-03 | — | — | #3667 | console 0.27.0, ruflo-cost-tracker 0.27.0 | `cost-ledger`, `_pricebook.mjs` |
| 438 | Research integration contract | Accepted | 10-04 | — | — | #3667 | console 0.28.0 | — |
| 439 | Console research start and confirm | Accepted | 10-04 | — | — | #3667 | console 0.28.0 | `mission-research` |
| 440 | Research web-fetch guard | Accepted | 10-04 | — | — | #3667 | ruflo-mods, console 0.28.0 | `research.test.ts` |
| 441 | Loop-centric missions | Accepted | 10-04 | — | — | #3667 | console 0.28.0 | `goap`, `mission-guidance` |
| 442 | Sandbox page; Plugins moves to TOOLS | Accepted | 10-04 | supersedes part of 424, 430 | — | #3667 | console 0.28.0 | `sandbox`, `nav.spec.ts` |
| 443 | Missions Claude knows about; verified evidence; spend | Accepted | 10-04 | 406, 437, 441 | — | #3695 | console 0.29.0, cost-tracker 0.27.1 | `mission-context`, `mission-cost`, `mission-loop` |
| 444 | Claude controls the console | Accepted | 10-04 | 406, 443 | — | #3696 | console 0.30.0 (autopilot default 0.32.0) | `model-tools`, `e2e-control.sh` |
| 448 | The Room: a shared live feed | Accepted | 10-04 | 407, 416, 444 | — | #3704 (doc), #3705 (page) | console 0.33.0 (expiry event 0.32.2) | `room`, `nav`, `runner`, `watch` |
| 477 | Mods: one toast system, with levels, de-duplication, a record and a setting | Accepted | 10-07 | 404, 453, 474, 466 | — | #3889 | console 0.37.0, swarm 0.3.4, protector 0.1.1, mods 0.3.16 | `toast-policy.spec`, `toasts.spec`, `toasts.test`, `toast.test` |
| 478 | Console What's new page, plugin changelogs | Accepted | 10-07 | 428, 477 | — | — | [ADR-478](ADR-478-console-whats-new.md) | — |
| 480 | Console ADRs page: your project's ADRs, and missions, loops and swarms that follow them | Accepted | 10-07 | 407, 443, 444, 450, 474, 477, 478 | — | this PR | console 0.39.0, swarm 0.3.5, workflows 0.6.4 | `adr.spec`, `adr-write.spec`, `adr-integration.spec`, `adr-page.spec`, `adr-mutation.spec`, `adr-digest.spec` |
| 483 | Console advisor checkpoints for mission loops (plan, repeated failure, before done) | Accepted | 10-08 | 441, 443, 444, 477, 480, 481 | — | this PR | console 0.40.0 | `mission-advisor.spec`, `mission-advisor-mutation.spec` |
| 484 | External plugins in the ruflo marketplace (first: Agentic QE) | Accepted | 10-09 | 446, 434, 411 | — | this PR | next console release | `plugin-catalog.spec`, `plugin-coverage.spec`, `smoke-all-plugins` external step |
| 486 | Session workspace: attention queue, session browser and preview on the Room (Claude, Codex and Ruflo sessions) | Accepted | 10-09 | 406, 444, 448, 473, 477, 481 | — | this PR | console 0.41.0, mods 0.4.0 | `sessions.spec`, `sessions-safety.spec`, `sessions-real-fs.spec`, `attention.test` |

Other ADRs outside 404-451 that the mod ADRs lean on: 150 (removable integrations), 174 (failures as a learning signal), 322 and 322A/B/C (flywheel, evaluation and promotion, receipts), 324 and 325 (policy engine, claims plane), 103 (witness). The console's Mods section (`hooks/data/mods.ts`, console 0.33.1, PR #3707) reads the status files ADR 446 defines.

## MCP server

| ADR | Title | Status | Date | Builds on / extends | Superseded by | PR | Shipped in | Tests |
|---|---|---|---|---|---|---|---|---|
| 479 | MCP HTTP transport: bearer token, and refusal to serve a network without one | Accepted | 10-07 | related 012, 476 | — | #3599 (#3598) | cli 3.55.0, mcp 3.1.0 | `mcp-http-nonloopback-auth-gate.test.ts`, `http-transport-auth.test.ts` |
| 490 | A three-host e2e integration loop (Claude Code, Codex, OpenRouter) | Accepted | 10-11 | 404, 406, 444, 448, 451; related 489, 491 | — | this PR | `scripts/e2e/`; fixes in cli (MCP resources capability), codex (marketplace clone budget) | `host-matrix.mjs`, `mcp-resources-capability-honesty.test.ts`, `mcp-bin-resources-capability.test.ts`, `plugin-install-timeout.test.ts` |

## Notes

- **Dates.** ADRs 444, 445 and 446 were dated 2026 10 05 but were committed on 2026-10-04 (14:36 -0400, merged 19:24 UTC); corrected. ADR 450 is still dated 2026 10 05 in its own header although its file was added on 2026-10-04 (7725b867f); the owner should fix the file.
- **ADR 405 and 406** still read "Proposed" although parts shipped (ruflo-ruos 0.1.0 for 405; mission records and the console for 406, which accepted ADRs 408, 409 and 443 build on). Their owners should decide whether to mark them Accepted with the unbuilt parts split out; this index does not change them.
- **Forward links.** 449, 450 and 451 are on `main`. 447 names all three as followers. They do not yet cite each other: 449 cites 404, 446, 447 but not 450 or 451; 450 cites 444 to 448 but not 449 or 451; 451 cites 445 to 447 but not 449 or 450; 452 cites 450 and 451. As of this update 450 and 451 name 449 and 452 and each other in a `Related`/`Builds on` line; 449 still does not name 450 or 451 (not edited here).
- **ADR files whose own Status line differs from this index:** none for 450 and 451, whose Status lines now carry the same implementation summary (section 9 of 450, section 8 of 451 hold the tables). 405, 406 and 449 are "Proposed" in both.
- **ADRs with no stated parent:** 434, 436, 437, 438, 439, 440, 441 carry no `Builds on` or `Extends` line.
- **2026-10-07 additions.** Rows for 477, 478 and 479 were added. 478's link is to a file added by the change that builds that page. 479 is not a mod ADR; it is listed because 476 (hive-mind gating) and the toasts sit on the same MCP and console surfaces. ADRs 454 to 476 are not in these tables.
- **2026-10-11 additions.** Rows for 490 and 491 were added. 490 is listed under the MCP section because its loop found and fixed an MCP capability defect; it also records the Codex install defect. 491 is Proposed: its evidence table is measured, nothing in it is built.
| 487 | Optional ruvnet-brain grounding (detect-only) in the console and mods | Accepted | 10-09 | 404, 443, 444, 481 | — | this PR | console 0.42.0, mods 0.5.0 | `grounding.spec`, `grounding.test.ts` |
| 489 | `ruflo tui`: the console in a terminal of its own, over the same `Host` boundary (standalone adapter, read-only Overview and Cost) | Accepted (phase 1 in PR #4059) | 10-11 | 407, 446, 448, 481, 486; related 150 | — | PR #4059 | not shipped | `tui-boundary.spec`, `tui-host.spec`, `tui-render.spec`, `tui-session.spec`, `tui-command.test.ts` |
