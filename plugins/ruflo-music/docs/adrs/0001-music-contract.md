---
id: ADR-0001
title: ruflo-music plugin contract — PAT auth, audio_url delivery, namespace claims, known reliability posture
status: Proposed
date: 2026-08-27
authors:
  - reviewer (Claude Code)
tags: [plugin, music, cogmusic, cognitum, mcp, namespace, smoke-test]
---

## Context

`ruflo-music` (v0.1.0) wraps the `cogmusic` MCP server — a hand-rolled JSON-RPC
server at `music.cognitum.one/mcp` (source: `cognitum-one/minimax-music`,
`services/gateway`), reached locally via the `cogmusic` npm package (a thin
stdio↔HTTP bridge, `packages/cogmusic` in that repo). This is architecturally
different from most sibling plugins (e.g. `ruflo-neural-trader`), which wrap a
locally-executed `npx <tool>` CLI: there is no local compute here. Every real
generation runs on a remote GPU the user does not own or control, authenticated
by a personal access token (`cogmcp_...`) the user mints themselves at
`music.cognitum.one/mcp`. This plugin has no way to mint, rotate, or store that
token on the user's behalf — it can only tell them how, and register it locally
via `claude mcp add`.

### Six MCP tools, one real gap

`list_productions`, `get_production`, `create_production`, `separate_stems`,
`extract_midi`, `master`. By deliberate design (upstream ADR-0020), no tool
returns audio bytes inline over MCP — `list_productions`/`get_production`/
`create_production` carry an `audio_url` (upstream ADR-0022, added specifically
so an MCP *agent*, not just a human at a browser, can retrieve what it
generated) that requires a separate authenticated GET with the same PAT as
`Authorization: Bearer`. `separate_stems`/`extract_midi`/`master` have **no**
equivalent `audio_url` yet — their outputs are dashboard-only today. This is a
real, current gap in the upstream tool surface, not something this plugin can
work around; `music-stems`/`music-midi` say so explicitly rather than implying
a capability that doesn't exist.

### Known reliability history — disclosed, not glossed over

The GPU inference service behind `create_production`/`separate_stems`/
`extract_midi`/`master` has a real, documented history of intermittent
cold-start failures (upstream ADR-0022/0023: a sharded model component
silently failing to load, root-caused and fixed across three iterations,
including one fix attempt that itself introduced a worse failure mode before
the actual working fix landed). As of this ADR the fix is deployed and verified
against a real generation. Every skill that calls a generation-class tool
documents "retry once before concluding something's wrong" as the expected,
honest behavior — not silent infinite retry, and not treating a single
transient failure as a hard error.

## Decision

1. **Namespace claims** (kebab-case `music-<intent>`, per
   [ruflo-agentdb ADR-0001 §"Namespace convention"](../../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)):
   - `music-productions` — cached production metadata (id, title, audio_url,
     prompt, lyrics, duration, processing-step flags) for recall without a
     round-trip to `list_productions`/`get_production`.
   - `music-briefs` — the creative brief that produced each production,
     keyed by production id, so "make another one like that" can retrieve the
     exact prompt/lyrics shape that worked.
   All access via `memory_*` (namespace-routed) — no `agentdb_pattern-*` or
   `agentdb_hierarchical-*` calls with a `namespace` argument anywhere in this
   plugin.
2. **Two agents**, not four (`ruflo-neural-trader`'s per-stage-agent pattern
   doesn't fit — this pipeline has two real stages, not four): `music-composer`
   (lyrics + style-prompt writing, no MCP tools) and `music-producer` (the
   actual MCP-tool-driving pipeline entry point, delegates composition to
   `music-composer`).
3. **Seven skills** map directly onto the six MCP tools plus one setup skill
   (`music-connect`) that no other sibling plugin needs an equivalent of,
   because no other plugin's backing service requires a user-minted,
   browser-only PAT.
4. **`allowed-tools` deliberately reference a non-`ruflo-core` MCP server.**
   Every sibling plugin's skills reference only `mcp__plugin_ruflo-core_ruflo__*`
   tools (driving external work via `Bash` instead). This plugin's
   `music-generate`/`music-list`/`music-get`/`music-stems`/`music-midi`/
   `music-master` skills reference `mcp__cogmusic__*` directly — the tools of
   whatever separately-registered MCP server the user named `cogmusic` via
   `claude mcp add cogmusic ...` (see `music-connect`). This is a real, first
   instance of the pattern in this marketplace, not an oversight: cogmusic
   genuinely is a standalone MCP server the user registers themselves, not a
   CLI this plugin shells out to. Live-verified working end to end in the
   session that produced this ADR (`create_production`/`list_productions`/
   `get_production` all called successfully against a real account).
5. **Compatibility pin**: `@claude-flow/cli` v3.6 major+minor (same convention
   as every sibling plugin), plus `cogmusic@0.1.1` or later specifically —
   `0.1.0` has no fetch timeout override and fails any `create_production`
   call that runs past Node's ~5-minute undici default, which real generations
   routinely do.
6. **`scripts/smoke.sh`** — 10 structural checks: version + keywords; all 7
   skills present with valid frontmatter; both agents present; command
   present; README pins v3.6; README pins `cogmusic@0.1.1+`; namespace
   coordination block present with both namespace claims; known-gap
   disclosure (no audio bytes over MCP, stems/MIDI have no `audio_url`,
   reliability history) present in README, not silently omitted; ADR exists
   with status `Proposed`; no wildcard tool grants in any skill.

## Consequences

**Positive:** the plugin is honest about what it can and cannot do —
no-audio-bytes-over-MCP, no-stem/MIDI-audio_url, and the real reliability
history are all documented rather than discovered the hard way by a future
caller. The composer/producer split lets lyric quality improve independently
of the MCP-plumbing logic.

**Negative:** two real, currently-unclosed gaps in the *upstream* tool surface
(no `audio_url` for stems/MIDI outputs) that this plugin cannot close on its
own — a future upstream ADR would need to extend the same PAT-authorized-URL
pattern ADR-0022 already established for the primary track to those two
derived-asset endpoints.

## Verification

```bash
bash plugins/ruflo-music/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `cognitum-one/minimax-music` `docs/adr/0020-mcp-server-and-connector-ui.md` — why MCP tools are metadata-only by design, PAT auth scheme
- `cognitum-one/minimax-music` `docs/adr/0022-mcp-audio-url-via-pat.md` — the `audio_url` pattern this plugin depends on
- `cognitum-one/minimax-music` `docs/adr/0023-transformer-sharded-load-vs-gcsfuse.md` — the inference-service reliability history disclosed above
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention this ADR follows
- `plugins/ruflo-neural-trader/docs/adrs/0001-neural-trader-contract.md` — closest sibling precedent (external-tool-wrapping plugin contract), diverged from where the shape doesn't fit (local CLI vs. remote PAT-authed MCP server)
