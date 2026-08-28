# ruflo-music

AI music generation via [Cognitum Music](https://music.cognitum.one) — compose lyrics/prompts, generate tracks, separate stems, extract MIDI, and master, all through the `cogmusic` MCP server against your own Cognitum account.

## Overview

Wraps the `cogmusic` MCP bridge as a Ruflo plugin with 2 agents, 7 skills, and one dispatcher command. Unlike most sibling plugins, there's no locally-executed CLI runtime here — every real generation runs on a remote GPU inference service (MiniMax-Music3), reached over a hand-rolled MCP server your own account authenticates against with a personal access token you mint yourself.

## Prerequisites

- A Cognitum Music account at [music.cognitum.one](https://music.cognitum.one).
- A `cogmcp_...` personal access token, minted at `music.cognitum.one/mcp` (sign in → "Generate connection token"). Shown exactly once — copy it immediately. This plugin cannot mint or rotate this token for you.
- `cogmusic@0.1.1` or later registered as an MCP server:
  ```bash
  claude mcp add cogmusic --env COGMUSIC_TOKEN=cogmcp_... -- npx -y cogmusic@latest
  ```
  `0.1.0` has no fetch timeout override and fails any `create_production` call that runs past Node's ~5-minute default — real generations routinely take longer. See the `music-connect` skill for the full setup flow.

## Installation

```bash
claude --plugin-dir plugins/ruflo-music
```

## MCP Integration (6 Tools)

`cogmusic` exposes 6 tools once registered:

```bash
claude mcp add cogmusic --env COGMUSIC_TOKEN=cogmcp_... -- npx -y cogmusic@latest
claude mcp get cogmusic   # expect: ✔ Connected
```

| Tool | Purpose |
|------|---------|
| `list_productions` | List saved productions (metadata + `audio_url` each) |
| `get_production` | Fetch one production's current metadata + `audio_url` |
| `create_production` | Generate a new track from lyrics + a style prompt (blocks for minutes) |
| `separate_stems` | 4-stem separation (vocals/drums/bass/other) |
| `extract_midi` | Pitch-tracked MIDI/score extraction |
| `master` | LUFS loudness normalization + peak limiting |

## Agents

| Agent | Role |
|-------|------|
| `music-composer` | Writes structured lyrics + a genre/style prompt from a creative brief. Calls no MCP tools. |
| `music-producer` | Pipeline entry point — delegates composition to `music-composer`, calls `create_production`, caches the result, optionally post-processes, reports the `audio_url`. |

## Skills

| Skill | Purpose |
|-------|---------|
| `music-connect` | One-time setup — register the `cogmusic` MCP server |
| `music-generate` | Generate a track from a fully-specified brief |
| `music-list` | List all productions in the account |
| `music-get` | Fetch one production's metadata + `audio_url` |
| `music-stems` | Run 4-stem separation on an existing production |
| `music-midi` | Extract MIDI from an existing production |
| `music-master` | Run a mastering (LUFS) pass on an existing production |

## Commands

```bash
/music connect [--token cogmcp_...]
/music generate <brief>
/music list
/music get <production-id>
/music stems <production-id>
/music midi <production-id>
/music master <production-id>
```

## Known gaps (disclosed, not silently omitted)

- **No audio bytes over MCP, by design.** Every tool that returns a production carries an `audio_url`, not the audio itself — always a separate authenticated `GET` with the same `cogmcp_` token as `Authorization: Bearer`.
- **Stems and MIDI have no `audio_url` yet.** `separate_stems`/`extract_midi` confirm what was produced (`has_stems`/`has_midi` via `get_production`), but the derived audio/MIDI files are dashboard-only today — the PAT-authorized-URL pattern that already covers the primary track (see Architecture Decisions) hasn't been extended to these two endpoints upstream.
- **The GPU inference service has a real reliability history.** Intermittent cold-start failures were root-caused and fixed upstream across three iterations (see ADR-0001's Related section) — a single retry resolves most transient failures; every generation-class skill documents this rather than treating a first failure as final.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Runtime:** `cogmusic@0.1.1+` npm package (stdio↔HTTP MCP bridge) registered via `claude mcp add`; no local compute — generation runs on a remote GPU service you don't control.
- **Verification:** `bash plugins/ruflo-music/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns two AgentDB namespaces (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)):

| Namespace | Purpose |
|-----------|---------|
| `music-productions` | Cached production metadata — id, title, `audio_url`, prompt, lyrics, duration, processing-step flags — for recall without a round-trip to `list_productions`/`get_production` |
| `music-briefs` | The creative brief that produced each production, keyed by production id, so a later "make another one like that" can retrieve the exact prompt/lyrics shape that worked |

All access via `memory_*` (namespace-routed). No `agentdb_pattern-*` or `agentdb_hierarchical-*` calls with a `namespace` argument anywhere in this plugin. Reserved namespaces (`pattern`, `claude-memories`, `default`) are never shadowed.

## Verification

```bash
bash plugins/ruflo-music/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [ADR-0001](docs/adrs/0001-music-contract.md) — plugin contract: PAT auth model, `audio_url` delivery pattern, namespace claims, disclosed reliability posture.

## Related Plugins

- [ruflo-agentdb](../ruflo-agentdb) — namespace convention this plugin follows
- [ruflo-neural-trader](../ruflo-neural-trader) — closest sibling precedent for an external-service-wrapping plugin contract (diverged where local-CLI vs. remote-PAT-authed-MCP-server shape doesn't fit)

## License

MIT
