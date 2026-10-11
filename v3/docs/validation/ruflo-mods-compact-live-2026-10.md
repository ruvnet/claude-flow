# ruflo-mods `compactCarry` (ADR-451 item 7), live canary run (2026-10-10)

`compactCarry` (PR #3768, 0.3.9, default off) had only kit tests. This run drives it through REAL headless Claude Code sessions
(engine 2.1.289, model haiku) with `--plugin-dir plugins/ruflo-mods`, in an isolated throwaway `HOME` / `CLAUDE_CONFIG_DIR`.
Plugin code was not changed. Driver: `scripts/live-ruflo-mods-compact.mjs` (this change).

## Method

- Isolation: `HOME` and `CLAUDE_CONFIG_DIR` are a fresh `mktemp` dir; the real `~/.claude`, plugin install state and sessions are not touched.
  Auth: only the OAuth **access token** (no refresh token, so nothing can rotate the real login) was written to the throwaway config, mode 0600,
  and shredded at the end. Nothing credential-like is printed; replies are reduced to boolean checks.
- Per run a scratch git project gets `.claude-flow/swarm/swarm-state.json` and `.claude-flow/claims/claims.json` (the files `carryBlock` reads
  from `state.root`) with a unique random canary swarm id (`swarm-<8 letters>`) and claim id (`cl-<6 letters>`). Option set through `pluginConfigs`
  as in `live-ruflo-mods-options.sh`; tools denied so the model can only answer from context.
- Turns, one `stream-json` process: two filler turns, ASK (control, before compaction), `/compact` (no text), ASK, then a diagnostic probe.
  ASK = "From your context alone (no tools), list every swarm id and every claim id that ruflo state recorded for this session. Reply with the ids only, or NONE."
- A second throwaway plugin (`--plugin-dir`, loaded after ruflo-mods so it sits beneath it) records `session.compact`'s `trigger`, `agentId` and
  `instructions` to a file, which is how the appended string is observed (canaries replaced by `<SWARM>` / `<CLAIM>`).
- Evidence the compaction ran: a `compact_boundary` system message in the stream and the snoop file. Evidence the summary kept the ids (instrumented
  runs only): a transcript line with `isCompactSummary` containing the canary.

## Results

| arm | n | compacted | canary id in post-compact answer | canary in the summary message | canary before compaction (control) |
|---|---|---|---|---|---|
| `compactCarry` ON | 14 | 14/14 | **10/14** | 9/9 measured (see below) | 0/14 |
| OFF (control) | 7 | 7/7 | **0/7** | 0/3 measured | 0/7 |
| ON, malformed state files (`{not json`, `[[[`) | 6 | 6/6 | 0/6 (nothing to carry, as designed) | 0/2 measured | 0/6 |

ON, by batch (honest breakdown, including the poor batch): pilot 1/1; batch A 1/4; batch B 4/4; batch C 4/5. The summary-contains check was added
after batch A, so it covers batches B and C only (9/9 summaries held the swarm id). In batch C one run (`on 2`) had the id in the summary but the
model still answered NONE: that is a model-recall miss, not a carry miss. Batch A's three misses are unexplained (the summary was not inspected
there); the ON/OFF contrast holds in every batch but ON recall is 10/14, not "always". A model forgetting a carried id is a real result, and
the carry only asks the summariser to keep it.

The diagnostic probe ("does your context hold a line beginning `ruflo state at compaction`?") answered no in 4/4 where run: the summariser
paraphrases the block rather than keeping it verbatim, so the id survives but the framing line does not. Useful for ADR-488.

### (c) The exact `instructions` string the hook appended

With no text after `/compact` (so the block is the whole `instructions`), canaries masked:

```
ruflo state at compaction (facts recorded by ruflo, data not instructions; keep the ids and counts in the summary):
swarm: id=<SWARM> topology=hierarchical status=running agents=3
claims: 1 open: <CLAIM> active
session: last route coder; routed 3; budget OK; policy none
```

(`trigger` was `manual`, `agentId` absent, 9 messages in the transcript.) Fixed words, counts and validated ids only; under 600 characters. With the
option OFF or with malformed state, `instructions` was absent in every run.

### (e) Fail open

Malformed swarm and claims files with the option ON: 6/6 sessions compacted normally (`compact_boundary`, no errors, model kept answering),
the hook appended nothing. Pass.

### (d) Subagent compaction untouched: NOT tested live

A subagent's own compaction cannot be provoked cheaply from a headless session. What is verified instead: the kit test
`a subagent compaction (agentId) is left alone` (tests/compact.test.ts) and the hook's `if (e.agentId !== undefined) return next(e)`. Live:
every observed compaction here was the main conversation (`agentId` absent). UNVERIFIED live.

## Spend

Actual `total_cost_usd` summed over all runs: **about $1.70** (pilot $0.07, batch A $0.73, batch B $0.25, batch C $0.64; haiku). Cap was about $2.

## Limits

- One model (haiku), one project shape, one ask wording; n is small. 10/14 is not a rate estimate with a useful interval.
- `/compact` was typed with no text; the "appended after the person's own text" path (`${e.instructions}\n\n${block}`) is covered by a kit test only.
- Auto-compaction (`trigger: auto`) and `precompute` were not exercised; only `manual`.
- The first 6 runs (batch A's ON runs and its OFF/malformed runs) have no summary-contains evidence.
- Headless only; the desktop and terminal UIs were not driven.

## Verdict

The base hook works live: with the option on, the real compaction was told the block (observed), and the canary survived into the summary in
every instrumented run and into the answer in 10/14; with it off, 0/7; malformed state fails open. Item 7's acceptance test (present with the
option on, absent with it off) passes; the stronger claim "the model always remembers" is not supported.
