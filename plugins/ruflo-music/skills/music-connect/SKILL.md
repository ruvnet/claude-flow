---
name: music-connect
description: One-time setup — mint a Cognitum Music personal access token and register the cogmusic MCP server with Claude Code
allowed-tools: Bash WebFetch
argument-hint: "[--token cogmcp_...]"
---

# Music Connect

Wires this session up to the user's own Cognitum Music account (music.cognitum.one) via the `cogmusic` MCP bridge. This is a one-time, per-machine/per-project setup — run it before any other `music-*` skill if `mcp__cogmusic__*` tools aren't already loaded.

## When to use

- The user asks to generate/produce music and no `mcp__cogmusic__*` tools are visible yet.
- `claude mcp get cogmusic` reports the server missing, disconnected, or unhealthy.
- The user is rotating or replacing an expired/revoked token.

## Steps

1. **Check for an existing, working registration first**:
   ```bash
   claude mcp get cogmusic
   ```
   If it reports `✔ Connected`, you're already set up — stop here.

2. **If no token was provided**, tell the user exactly how to mint one (this step requires their own browser login — you cannot do it for them):
   - Sign in at `https://music.cognitum.one/mcp`
   - Click "Generate connection token" (label it something recognizable, e.g. "Claude Code")
   - Copy the raw token — it starts with `cogmcp_` and is shown **exactly once**

3. **Register the MCP server** once you have the token (never print the full token back to the user in plain chat if avoidable — treat it as a secret; it's fine as a one-time argument to `claude mcp add`, which stores it in local config, not in conversation history):
   ```bash
   claude mcp add cogmusic --env COGMUSIC_TOKEN=cogmcp_... -- npx -y cogmusic@latest
   ```
   Pin to `cogmusic@0.1.1` or later — earlier `0.1.0` has no fetch timeout and fails
   `create_production` calls that run past Node's ~5-minute default (see
   [ADR-0001](../../docs/adrs/0001-music-contract.md)).

4. **Verify**:
   ```bash
   claude mcp get cogmusic
   ```
   Expect `✔ Connected`. If it shows `CONNECTION_CLOSED` or a 404, the `cogmusic` npm package version pinned in the command may be stale or unpublished — check `npm view cogmusic version` and retry with an explicit version.

5. **If registration already exists but is unhealthy**, remove and re-add rather than editing config by hand:
   ```bash
   claude mcp remove cogmusic -s local
   claude mcp add cogmusic --env COGMUSIC_TOKEN=cogmcp_... -- npx -y cogmusic@latest
   ```

6. Once connected, the `mcp__cogmusic__*` tools (`list_productions`, `get_production`, `create_production`, `separate_stems`, `extract_midi`, `master`) become available — proceed to `music-generate` or `music-list`.

## Notes

- The token is a personal access token (PAT) scoped to one Cognitum account, minted and revoked by the user themselves at `music.cognitum.one/mcp` — this plugin has no way to mint or revoke one programmatically, and should never attempt to guess, cache elsewhere, or transmit it anywhere other than the local `claude mcp add` registration.
- A newly-registered MCP server's tools may not appear until the *next* Claude Code session — if `mcp__cogmusic__*` tools still aren't listed after a successful `claude mcp get cogmusic`, tell the user to start a fresh session.
