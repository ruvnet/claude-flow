---
name: music-master
description: Run a mastering pass (LUFS loudness normalization + peak limiting) on an existing production
allowed-tools: mcp__cogmusic__master mcp__cogmusic__get_production mcp__plugin_ruflo-core_ruflo__memory_store
argument-hint: "<production-id>"
---

# Music Master

Applies loudness normalization (default target -14 LUFS, common streaming-platform standard) plus a peak limiter to an already-generated production.

## When to use

The user wants a "radio-ready" or streaming-normalized version of a track they've already generated.

## Steps

1. Call `mcp__cogmusic__master({ id: "<production-id>" })`.
2. The result includes `lufs_before` and `lufs_after` — report both so the user can see the actual loudness change, not just "done."
3. Update the cached entry in `music-productions` (if one exists) with the new `lufs_before`/`lufs_after`/`has_mastered: true` fields so later lookups don't need a round-trip.
4. Mastered audio isn't returned inline over MCP — point the user at the dashboard. See [ADR-0001](../../docs/adrs/0001-music-contract.md).
