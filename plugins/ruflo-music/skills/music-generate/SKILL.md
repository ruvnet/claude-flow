---
name: music-generate
description: Generate a new song from a creative brief (genre, mood, language, BPM, theme) via the cogmusic MCP create_production tool
allowed-tools: mcp__cogmusic__create_production mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search
argument-hint: "<brief describing genre/mood/language/theme>"
---

# Music Generate

Turns a creative brief into a real, playable track through the user's own Cognitum Music account.

## When to use

The user asks to create/generate/produce a song, remix, or track. If `mcp__cogmusic__create_production` isn't loaded, run `music-connect` first.

## Steps

1. **Compose the two required inputs** from the brief (delegate the actual writing to the `music-composer` agent for anything beyond a trivial brief — lyrics quality matters more than most callers expect):
   - `lyrics` — structured with `[intro]`/`[verse]`/`[chorus]`/`[bridge]`/`[outro]` tags, one section per line group. Match the language the user asked for; don't default to English if they named another language.
   - `prompt` — genre, BPM, instrumentation, and mood in one dense sentence. Be specific (e.g. "Afrobeat, 116 BPM, talking drum, shekere, horn section" beats "upbeat African music").

2. **Pick `audio_duration`** (seconds, default 30 if unspecified). 90–150s covers a real verse/chorus/bridge structure; don't go far past 150s without the user asking — generation time and cost both scale with duration, and the model's documented ceiling is 300s.

3. **Call the tool** — it blocks for real minutes, not seconds:
   ```
   mcp__cogmusic__create_production({
     title: "...",
     lyrics: "...",
     prompt: "...",
     audio_duration: 120,
   })
   ```
   Do not poll or retry mid-call — the underlying bridge (`cogmusic@0.1.1+`) already carries a long internal timeout. If it returns `{"content":[{"text":"generation failed", ...}],"isError":true}`, this is very likely a transient GPU-inference-service issue (see [ADR-0001](../../docs/adrs/0001-music-contract.md)'s Known reliability notes), not a bad prompt — retry once before concluding something is actually wrong with the request itself.

4. **On success**, the result includes `id`, `title`, `audio_duration`, `created_at_unix`, and an `audio_url`. Fetch the audio itself (or hand the URL to the user) with:
   ```bash
   curl -H "authorization: Bearer $COGMUSIC_TOKEN" "$AUDIO_URL" -o track.wav
   ```
   Audio is never returned inline over MCP by design (see ADR-0001) — always a separate authenticated GET.

5. **Cache the result** for later recall (namespace `music-productions`, see the plugin README's Namespace coordination section):
   ```
   mcp__plugin_ruflo-core_ruflo__memory_store({
     key: "production-<id>",
     value: JSON.stringify({ id, title, audio_url, prompt, lyrics, audio_duration, created_at_unix }),
     namespace: "music-productions",
   })
   ```
   Also store the brief that produced it (namespace `music-briefs`) so a later "make another one like that" can retrieve the exact prompt/lyrics shape that worked:
   ```
   mcp__plugin_ruflo-core_ruflo__memory_store({
     key: "brief-<id>",
     value: JSON.stringify({ id, brief: "<the user's original request>", prompt, lyrics }),
     namespace: "music-briefs",
   })
   ```

6. **Report back**: title, duration, the `audio_url`, and a one-line summary of the style. Don't claim the audio "sounds like X" — you cannot hear it; describe what was requested, not the result.

## Known reliability notes

The GPU inference service behind Cognitum Music has a real, documented history of intermittent generation failures (cold-start weight-loading races — see the upstream repo's ADR-0022/0023). A single retry resolves most transient failures. If two consecutive attempts with the *same* prompt/lyrics both fail, say so plainly rather than silently retrying a third time — that's a signal something's actually wrong on the service side, not bad luck.
