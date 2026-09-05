---
name: music-stems
description: Run 4-stem separation (vocals/drums/bass/other) on an existing production
allowed-tools: mcp__cogmusic__separate_stems mcp__cogmusic__get_production
argument-hint: "<production-id>"
---

# Music Stems

Splits an already-generated production into vocals/drums/bass/other stems.

## When to use

The user wants isolated stems from a track they've already generated (remixing, karaoke tracks, sampling). Needs an existing production `id` — run `music-list` first if you don't have one.

## Steps

1. Call `mcp__cogmusic__separate_stems({ id: "<production-id>" })`. This is a real GPU job — it takes real time, similar order of magnitude to generation itself, and shares the same underlying inference service as `create_production` (see the reliability notes in `music-generate`'s SKILL.md — a transient failure is worth one retry before concluding something's wrong).
2. **This does not return audio.** The result only confirms which stems were produced. Check `has_stems` via `mcp__cogmusic__get_production` afterward, then point the user at the dashboard (`music.cognitum.one`) to actually listen — per [ADR-0001](../../docs/adrs/0001-music-contract.md), the current cogmusic MCP tool surface doesn't expose a stem-level `audio_url` the way the primary production audio has one (only the main track's URL is PAT-authorized today).
3. If the user specifically needs the stem *bytes* delivered back through this session rather than via the dashboard, say so plainly — that's a real gap in the current MCP surface, not something this skill can work around.
