---
name: music
description: Generate, list, and process music via Cognitum Music (cogmusic MCP)
---
$ARGUMENTS
Manage AI music generation via the `cogmusic` MCP server. Parse subcommand from $ARGUMENTS.

Usage: /music <subcommand> [options]

Subcommands:
- `connect [--token cogmcp_...]` -- One-time setup: register the cogmusic MCP server (see `music-connect` skill)
- `generate <brief>` -- Compose lyrics/prompt from a brief and generate a new track (see `music-composer` agent + `music-generate` skill)
- `list` -- List all productions in the connected account (see `music-list` skill)
- `get <production-id>` -- Fetch one production's metadata + audio_url (see `music-get` skill)
- `stems <production-id>` -- Run 4-stem separation (see `music-stems` skill)
- `midi <production-id>` -- Extract MIDI/score (see `music-midi` skill)
- `master <production-id>` -- Run a mastering (LUFS) pass (see `music-master` skill)

Steps by subcommand:

**connect**: Follow the `music-connect` skill exactly. Do not skip the "check for an existing, working registration first" step.

**generate**: If the brief needs real lyric/prompt composition (anything beyond a one-line genre tag), delegate to the `music-producer` agent, which itself defers lyric writing to the `music-composer` agent before calling `mcp__cogmusic__create_production`. For a fully-specified brief (explicit lyrics + prompt already given), the `music-generate` skill alone is enough — no need to spin up the agent pipeline for that case.

**list**: Run the `music-list` skill directly — no agent needed for a read-only listing.

**get / stems / midi / master**: Run the matching skill directly with the given `production-id`. Look it up via `music-list` first if the user gave a title instead of an id.

If no `mcp__cogmusic__*` tools are loaded when any subcommand runs, run `connect` first and tell the user why.
