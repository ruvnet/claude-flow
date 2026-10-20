# Live validation of ruflo-mods 0.3.1, 2026-10-05

Method as in `agentdb-recall-live-2026-10.md`: a private `mktemp -d` project, one real headless `claude -p --input-format stream-json --plugin-dir plugins/ruflo-mods` process per scenario, model `haiku`, options set through `--settings pluginConfigs`, the session's own `/ruflo-mods` command read back in the same process. Claude Code 2.1.287, `@claude-flow/cli` (the `ruflo` MCP server that owns the hinted tools). Reproduce: `scripts/live-ruflo-mods.sh [status hints trim ledger spawn | all]`; total spend for this report about $0.4 (`/ruflo-mods` itself is answered by the mod, no model call).

## Summary

| # | Claim | Result |
|---|---|---|
| 1 | `toolHints` off by default does nothing; on adds hints | **Confirmed.** Off: 0 hints, `tool hints: off`. On: the hint appears under exactly the 2 hinted tools asked about, none under `memory_list` (not in the table), status `6 tool(s) described`. |
| 2a | `agentTrim` off hides nothing | **Confirmed.** All 9 types listed (5 defined + 4 built-in), `agent trim: off`. |
| 2b | on hides unused types, keeps core roles | **Confirmed.** `coder`, `reviewer` + built-ins kept; `zebra-specialist`, `quokka-analyst`, `yak-planner` hidden (`3 type(s) hidden`). |
| 2c | `agentTrimKeep`, 30-day ledger | **Confirmed.** Keep list keeps `zebra-specialist` (2 hidden). Ledger with a 1-day-old `quokka-analyst` keeps it, a 40-day-old `yak-planner` is hidden (2 hidden). |
| 2d | fails open | **Partly.** A corrupt, wrong-shape or hostile-valued ledger never crashed or hid a core role; but the result is an empty ledger, so trimming still applies (3 hidden). The `.catch` fail-open (a hook that throws) could not be provoked from outside; unit tests cover it. |
| 2e | "named in the prompt" keeps a type; trim covers "dispatch" | **Not as documented (fixed in 0.3.2, text only).** See below. |
| 3 | `/ruflo-mods` status | **Confirmed**, the counters track the features live. |

## 1. toolHints

Prompt (both runs): `Use ToolSearch with query "select:mcp__ruflo__memory_search,mcp__ruflo__swarm_init,mcp__ruflo__memory_list" ... print each tool name and its full description verbatim`.

- **Off (default, no settings):** descriptions are the server's own. No `ruflo:` line in any of the three. `/ruflo-mods` -> `tool hints:  off (set the toolHints option)`.
- **On:** observed, verbatim:
  - `mcp__ruflo__memory_search` description ends `...Diversity can change result order.` then `ruflo: Searches AgentDB only; memory_search_unified also covers Claude memories and patterns.`
  - `mcp__ruflo__swarm_init` ends `...spawn each separately.` then `ruflo: For coding work use topology hierarchical, maxAgents 6-8, strategy specialized.`
  - `mcp__ruflo__memory_list`: unchanged, no hint.
  - `/ruflo-mods` -> `tool hints:  6 tool(s) described` (the table's 6 tools are described when the deferred list is built, not only the 2 asked for).
- Cost: $0.051 (off), $0.027 (on).

## 2. agentTrim

Five agent types defined with `--agents` (`coder`, `reviewer`, `zebra-specialist`, `quokka-analyst`, `yak-planner`); the question is `List every subagent_type value your Agent tool accepts`.

| Run | Model's answer | `/ruflo-mods` |
|---|---|---|
| off (default) | claude, coder, Explore, general-purpose, Plan, quokka-analyst, reviewer, yak-planner, zebra-specialist | `agent trim:  off (set the agentTrim option)` |
| on | claude, coder, Explore, general-purpose, Plan, reviewer (+ `fork` in one of the on-runs; a model-side listing variation, not seen in the others) | `3 type(s) hidden` |
| on, `agentTrimKeep=zebra-specialist` | ... reviewer, zebra-specialist | `2 type(s) hidden` |
| on, ledger `{quokka-analyst: now-1d, yak-planner: now-40d}` | ... quokka-analyst, reviewer | `2 type(s) hidden` |
| on, ledger `{ this is not json` | claude, coder, Explore, general-purpose, Plan, reviewer | `3 type(s) hidden` |
| on, ledger `{agentUse: ["quokka-analyst"]}` | same as above | `3 type(s) hidden` |
| on, ledger `{quokka-analyst: "now", zebra-specialist: -1}` | same as above | `3 type(s) hidden` |

The ledger is `$.store`: `~/.claude/plugins/store/ruflo-mods_inline-<hash>.json`, user-global, so the harness snapshots and restores it around each phase.

### Two claims the live runs contradict (text corrected in 0.3.2; no behaviour changed)

1. **A hidden type can still be dispatched (CORRECTION 2026-10-05: only when the prompt names it; see `ruflo-mods-trim-measure-2026-10.md`, where an unnamed hidden type was refused).** With `agentTrim` on and `quokka-analyst` hidden, `Call the Agent tool ... subagent_type "quokka-analyst"` replied `ACCEPTED`, ran, and the ledger afterwards held `{"agentUse": {"quokka-analyst": 1791174198156}}`, so it is kept from then on. The option text said "listing and dispatch"; it is the listing only.
2. **"Named in the prompt" does not keep a type in a headless session.** `Is quokka-analyst available? ... list` answered `No` and the type stayed hidden (3 hidden); a second experiment (`Say hi`, list, then a prompt naming it plus the list) hid it in both lists. The listing is built before the first prompt and not rebuilt, so `agent.offer` runs before `prompt.submit` can record the prompt. Not tested: an interactive session (it may rebuild the listing). Use `agentTrimKeep` to be sure.

## 3. /ruflo-mods

Default session: `owns: nothing (classic hooks keep every event)`, `routed: 0 prompt(s)`, `budget: off`, `tool hints: off`, `agent trim: off`, `guidance: off`. With both options on and no activity: `tool hints:  0 tool(s) described`, `agent trim:  0 type(s) hidden`. After the activity above the counts read 6 and 3 (see the tables), so the report reflects live behaviour. `owns: nothing` is expected here: the classic hook-handler is not installed in the scratch project.

## 4. Not done

- Interactive (TUI) sessions; only headless `-p` was run.
- The throwing-hook `.catch` fail-open path (needs a fault-injection point in the engine).
- Only haiku, one run per cell for `hints` and `status`; trim answers were repeated with one model-side variation (`fork`).
- The console UI was not driven: nothing the console shows changed.

## 5. Change shipped: ruflo-mods 0.3.2 (text only)

`plugin.json` `agentTrim` description, the `agents/index.ts` doc comment and the smoke version string. Plugin tests 39 pass / 0 fail, `claude plugin validate` passes, smoke 11/11.
