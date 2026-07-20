---
name: wasm-gallery
description: Browse, publish, and install WASM agents from the community gallery
argument-hint: "[search-query]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__wasm_gallery_list mcp__plugin_ruflo-core_ruflo__wasm_gallery_search mcp__plugin_ruflo-core_ruflo__wasm_gallery_create mcp__plugin_ruflo-core_ruflo__wasm_agent_create mcp__plugin_ruflo-core_ruflo__wasm_agent_export Bash
---

# WASM Gallery

Browse and share WASM agents through the community gallery.

## When to use

When looking for pre-built WASM agents or sharing your own agents with the community.

## Steps

1. **Browse gallery** — call `mcp__plugin_ruflo-core_ruflo__wasm_gallery_list` to see available agents
2. **Search** — call `mcp__plugin_ruflo-core_ruflo__wasm_gallery_search` with keywords to find specific agents
3. **Install** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_create` with a gallery agent's configuration
4. **Publish** — call `mcp__plugin_ruflo-core_ruflo__wasm_gallery_create` to share your agent
5. **Export first** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_export` to package before publishing
