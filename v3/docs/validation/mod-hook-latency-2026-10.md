# Mod hook latency — measured 2026-10-04 (W8)

**Result: nothing to optimize.** One unrelated `tool.call` pays about **18–21 µs** in total across all 40 plugins that register a `tool.call` hook (median, two runs), against a no-op async hook floor of 0.2–0.3 µs per hook. The 38 plain guards cost 0.4–1.0 µs each. The only two outliers are the two observers whose job is to look at every call: `ruflo-console` (3.0 µs) and `ruflo-swarm` (1.9 µs). No mod's unwatched path scans, stringifies or allocates in proportion to the input. No plugin source was changed, so plugin tests are identical before and after by construction.

## Method

`scripts/bench-mod-hooks.mjs` (`npx tsx scripts/bench-mod-hooks.mjs [--iters 5000] [--json] [--only a,b]`).
For each of the 44 `plugins/*/hooks/register.ts`: load the module, call `register(on, {})`, and dispatch an event through the registered handlers the way the engine does (outermost first, a core that returns the event). `$` is a fake whose ops resolve at once (empty fs, `session.root` = `/work`, timers return a handle), so the numbers are the mod's own cost. They exclude Claude Code's dispatch and worker hop, and exclude real I/O.

- 5000 timed iterations after 300 warmup, per plugin per event; times are µs.
- **unrelated**: `Read` and `Bash` with typical input; the slower of the two is reported.
- **unrelated 200KB**: `Write` with a 200 KB `content`. A hook that scans or stringifies the input of a tool it does not watch would show up here.
- **watched**: the slowest of up to 12 tool names harvested from the plugin's hooks (`memory_store`, `agentdb_hierarchical-store`, and quoted tool identifiers), with a small `key`/`value` payload. It is a heuristic for "a tool the mod acts on", not a per-plugin hand-written case.
- `session.start`, `prompt.submit` (3 plugins register it), and `command.run` (the plugin's own registered slash command, args `status`).
- Host: 32 cores, load average about 26 during the runs (other workers were running), so p99 is noisy; medians were stable across two runs.

## Fleet cost of one unrelated tool.call

| | run 1 | run 2 |
|---|---|---|
| sum of medians, 40 stacked hook sets (µs) | 20.9 | 17.9 |
| same with a 200 KB payload (µs) | 15.8 | 16.7 |
| sum of p99s (µs) | 93.4 | 61.6 |
| async no-op hook floor, median / p99 (µs) | 0.30 / 2.2 | 0.22 / 2.8 |

The 200 KB payload costs no more than the small one, so the unwatched path is O(1) in input size. Anything that scaled with the input would have grown by orders of magnitude here.

Five slowest on an unrelated call (median µs): ruflo-console 3.00, ruflo-swarm 1.89, ruflo-ruvector 0.76, ruflo-intelligence 0.62, ruflo-adr 0.61.

A watched call is also cheap. The secret screen in `ruflo-ddd` on a 200 KB watched write measures 53 µs (separate one-off, 200 iterations), and it only runs for the mod's own tools.

## Per plugin (median / p99 µs)

Hooks column = number of `tool.call` / `session.start` / `prompt.submit` / `command.run` registrations. Columns: unrelated, unrelated 200 KB, watched, session.start, prompt.submit, command.run. `-` = the plugin registers no hook for that event.

| plugin | hooks | unrelated | unrelated 200KB | watched | session.start | prompt.submit | command.run |
|---|---|---|---|---|---|---|---|
| ruflo-adr | 1/1/0/1 | 0.61 / 1.7 | 0.51 / 2.8 | 0.63 / 2.0 | 3.12 / 28.1 | - | 1.27 / 3.8 |
| ruflo-agent | 1/1/0/1 | 0.47 / 5.9 | 0.22 / 0.5 | 1.85 / 15.9 | 4.61 / 24.8 | - | 0.93 / 3.5 |
| ruflo-agentdb | 1/1/0/1 | 0.53 / 2.1 | 0.38 / 1.7 | 2.04 / 6.3 | 3.39 / 19.9 | - | 1.28 / 3.9 |
| ruflo-agntcy | 0/1/0/1 | - | - | - | 4.49 / 13.9 | - | 0.75 / 1.4 |
| ruflo-ai-team | 1/1/0/1 | 0.46 / 1.4 | 0.23 / 0.6 | 0.40 / 0.9 | 3.90 / 9.6 | - | 0.57 / 1.4 |
| ruflo-aidefence | 1/1/0/1 | 0.27 / 0.9 | 0.23 / 0.5 | 1.71 / 10.2 | 3.94 / 12.2 | - | 0.81 / 4.4 |
| ruflo-arena | 0/1/0/1 | - | - | - | 3.46 / 9.2 | - | 0.97 / 8.8 |
| ruflo-autopilot | 1/1/0/1 | 0.41 / 1.1 | 0.33 / 0.7 | 2.60 / 9.1 | 3.92 / 8.9 | - | 0.81 / 1.9 |
| ruflo-bbs-federation | 1/1/0/1 | 0.46 / 1.7 | 0.47 / 1.3 | 0.41 / 1.3 | 3.41 / 8.0 | - | 0.94 / 2.5 |
| ruflo-browser | 1/1/0/1 | 0.41 / 1.0 | 0.37 / 1.0 | 0.41 / 1.8 | 3.23 / 19.8 | - | 1.06 / 6.2 |
| ruflo-business-pods | 1/1/0/1 | 0.40 / 2.2 | 0.28 / 0.5 | 0.34 / 1.0 | 3.58 / 8.1 | - | 0.69 / 1.4 |
| ruflo-chatgpt-federation | 1/1/0/1 | 0.44 / 1.4 | 0.34 / 1.0 | 0.34 / 2.2 | 3.49 / 25.8 | - | 1.10 / 3.4 |
| ruflo-console | 5/1/1/2 | 3.00 / 7.0 | 3.12 / 13.5 | 3.32 / 6.7 | 150.65 / 868.1 | 0.30 / 1.0 | 72.31 / 337.1 |
| ruflo-daa | 1/1/0/1 | 0.39 / 0.8 | 0.30 / 1.0 | 0.32 / 2.8 | 3.17 / 39.9 | - | 1.35 / 11.3 |
| ruflo-ddd | 1/1/0/1 | 0.47 / 3.7 | 0.22 / 0.8 | 1.89 / 17.2 | 2.57 / 14.0 | - | 1.09 / 2.8 |
| ruflo-deepseek-harness | 1/1/0/1 | 0.27 / 0.8 | 0.19 / 0.6 | 0.21 / 0.8 | 2.77 / 9.1 | - | 1.10 / 4.3 |
| ruflo-docs | 1/1/0/1 | 0.39 / 1.3 | 0.37 / 0.8 | 0.77 / 2.5 | 3.07 / 10.5 | - | 1.04 / 2.2 |
| ruflo-federation | 1/1/0/1 | 0.51 / 1.3 | 0.37 / 0.9 | 0.29 / 0.5 | 3.13 / 39.4 | - | 1.08 / 9.9 |
| ruflo-goals | 1/1/0/1 | 0.40 / 1.2 | 0.22 / 0.8 | 1.55 / 12.8 | 3.23 / 15.7 | - | 2.81 / 8.9 |
| ruflo-graph-intelligence | 1/1/0/1 | 0.33 / 5.8 | 0.23 / 0.6 | 0.25 / 0.6 | 3.28 / 27.3 | - | 3.11 / 25.7 |
| ruflo-intelligence | 1/1/0/1 | 0.62 / 2.2 | 0.25 / 0.7 | 2.17 / 8.1 | 3.54 / 17.1 | - | 3.01 / 7.2 |
| ruflo-iot-cognitum | 1/1/0/1 | 0.45 / 1.2 | 0.23 / 0.8 | 0.34 / 0.9 | 3.55 / 22.5 | - | 3.56 / 7.7 |
| ruflo-jujutsu | 1/1/0/1 | 0.42 / 1.3 | 0.23 / 0.8 | 2.92 / 8.7 | 3.43 / 13.4 | - | 1.48 / 5.3 |
| ruflo-knowledge-graph | 1/1/0/1 | 0.44 / 1.3 | 0.30 / 0.9 | 5.72 / 16.9 | 4.01 / 10.3 | - | 1.97 / 7.5 |
| ruflo-loop-workers | 1/1/0/1 | 0.47 / 1.0 | 0.27 / 0.8 | 4.56 / 16.2 | 4.25 / 9.6 | - | 1.35 / 10.6 |
| ruflo-market-data | 1/1/0/1 | 0.42 / 1.1 | 0.49 / 1.6 | 5.40 / 19.2 | 3.22 / 40.2 | - | 1.46 / 11.8 |
| ruflo-metaharness | 1/1/0/1 | 0.43 / 4.1 | 0.43 / 1.4 | 5.43 / 14.4 | 3.51 / 8.6 | - | 1.13 / 6.8 |
| ruflo-migrations | 1/1/0/1 | 0.31 / 1.5 | 0.24 / 0.8 | 4.72 / 13.6 | 2.70 / 28.2 | - | 1.04 / 2.8 |
| ruflo-mods | 1/1/1/3 | 0.47 / 1.8 | 0.23 / 1.0 | 0.39 / 1.0 | 6.30 / 13.8 | 0.29 / 0.9 | 1.60 / 14.6 |
| ruflo-music | 1/1/0/1 | 0.52 / 1.8 | 0.41 / 2.0 | 5.19 / 20.1 | 2.63 / 30.8 | - | 1.01 / 3.5 |
| ruflo-neural-trader | 1/1/0/1 | 0.33 / 1.1 | 0.48 / 1.2 | 4.11 / 9.6 | 2.77 / 8.5 | - | 0.76 / 2.2 |
| ruflo-observability | 1/1/0/1 | 0.30 / 1.6 | 0.25 / 0.5 | 4.27 / 13.8 | 2.70 / 6.1 | - | 1.19 / 3.2 |
| ruflo-plugin-creator | 0/1/0/1 | - | - | - | 2.41 / 23.4 | - | 2.95 / 21.5 |
| ruflo-rag-memory | 1/1/0/1 | 0.33 / 1.0 | 0.23 / 0.9 | 2.18 / 16.8 | 3.13 / 18.2 | - | 1.22 / 19.2 |
| ruflo-ruos | 0/1/1/0 | - | - | - | 4.71 / 13.2 | 5.60 / 10.3 | - |
| ruflo-ruvector | 1/1/0/1 | 0.76 / 18.1 | 0.36 / 13.7 | 3.99 / 25.4 | 2.97 / 8.5 | - | 1.05 / 2.9 |
| ruflo-ruvllm | 1/1/0/1 | 0.56 / 2.1 | 0.23 / 0.5 | 3.04 / 10.7 | 3.13 / 8.2 | - | 1.45 / 3.4 |
| ruflo-rvf | 1/1/0/1 | 0.39 / 1.1 | 0.34 / 1.0 | 2.66 / 8.4 | 2.80 / 8.6 | - | 1.09 / 3.2 |
| ruflo-security-audit | 1/1/0/1 | 0.25 / 0.8 | 0.33 / 0.8 | 0.47 / 2.2 | 2.72 / 5.6 | - | 1.08 / 3.5 |
| ruflo-sparc | 1/1/0/1 | 0.36 / 1.1 | 0.22 / 0.8 | 0.47 / 2.0 | 2.81 / 5.9 | - | 1.32 / 26.6 |
| ruflo-swarm | 1/1/0/8 | 1.89 / 5.0 | 1.06 / 2.4 | 1.14 / 14.1 | 64.21 / 255.8 | - | 0.99 / 2.5 |
| ruflo-testgen | 1/1/0/1 | 0.27 / 1.0 | 0.23 / 1.2 | 2.03 / 6.6 | 2.84 / 7.9 | - | 1.40 / 11.7 |
| ruflo-workflows | 1/1/0/1 | 0.46 / 0.9 | 0.34 / 1.7 | 5.67 / 21.5 | 3.60 / 10.4 | - | 1.59 / 4.2 |
| ruflo-x-gateway | 1/1/0/1 | 0.26 / 1.1 | 0.23 / 0.7 | 4.69 / 10.0 | 3.62 / 7.2 | - | 1.34 / 9.4 |


## Why no optimization

- The 38 plain guards already return `next(e)` after one `Set`/tail check. Their cost is the async function call plus the engine-style `next` hop (about 0.2 µs floor plus the check).
- `ruflo-console` and `ruflo-swarm` (`screen.ts` is owned by another worker, and neither register file was touched) read the event on every call to light the activity pane. That work is their feature, and it totals about 5 µs.
- `session.start` is 2–6 µs for 42 plugins and 84–200 µs for `ruflo-swarm` / `ruflo-console`, which build their panes once per session. `command.run` is only paid when the user types that command.
- For scale: the fleet adds about 20 µs to a tool call; Claude Code's own per-hook dispatch is documented in ADR-404 at milliseconds. The mods are not the latency source. Further per-mod tuning would be inside the noise.

## What was not measured

Claude Code's dispatch, worker hop and real fs / network ops in `$` (all stubbed); `$.fs.write` status flushes that happen when a guard denies (these only happen on a refusal); real model-turn costs. Re-run the script after adding a mod: a new `tool.call` hook costing more than about 2 µs on the unrelated or 200 KB columns deserves a look.
