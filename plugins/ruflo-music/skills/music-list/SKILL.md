---
name: music-list
description: List the account's saved music productions with metadata and audio_url
allowed-tools: mcp__cogmusic__list_productions mcp__plugin_ruflo-core_ruflo__memory_store
argument-hint: ""
---

# Music List

Surfaces every production in the connected Cognitum Music account.

## When to use

The user asks what tracks exist, wants to find a track by title, or you need a production `id` for `music-get`/`music-stems`/`music-midi`/`music-master` and don't already have it.

## Steps

1. Call `mcp__cogmusic__list_productions({})` — no arguments.
2. Present results sorted by `created_at_unix` descending (the API already returns them this way): title, duration, `id`, and which processing steps have run (`has_stems`/`has_midi`/`has_mastered`).
3. If the user is looking for a specific track, match on `title` (case-insensitive substring) rather than asking them to know the `id` up front.
4. Optionally refresh the `music-productions` memory cache for any entries not already stored there (see `music-generate`'s caching step) — useful after a production was created outside this session (e.g. from the web dashboard).

## Notes

This never returns audio bytes — only metadata plus each production's `audio_url` for a follow-up authenticated GET. See [ADR-0001](../../docs/adrs/0001-music-contract.md).
