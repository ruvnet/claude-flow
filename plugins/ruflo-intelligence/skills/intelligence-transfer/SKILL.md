---
name: intelligence-transfer
description: Publish or fetch learned patterns across projects via IPFS (Pinata) -- the cross-project pattern transfer that hooks_transfer enables
argument-hint: "<store|load|from-project> [--cid <ipfs-cid>] [--source <project-path>]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__hooks_transfer mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store mcp__plugin_ruflo-core_ruflo__neural_patterns mcp__plugin_ruflo-core_ruflo__neural_status Bash
---

# Intelligence Transfer

Cross-project pattern sharing via IPFS. Lets a different project — or a different machine — fetch and apply patterns this project has already learned.

## Why this exists

Most learning is project-local. `hooks_transfer` is the escape hatch: publish patterns to IPFS, share the CID, and any peer can ingest them. Equivalent to "a deploy artifact for what your agents have learned."

## Prerequisite

```bash
# Required env var (or equivalent endpoint config)
echo $PINATA_API_JWT
```

If unset, `hooks_transfer` returns a structured `success: false` with `error: "PINATA_API_JWT not configured"`. Configure before running this skill.

## Workflows

### Publish current project's patterns

```bash
# Inspect what's stored locally first
mcp tool call neural_patterns --json -- '{"list": true}'

# Publish to IPFS — returns a CID
mcp tool call hooks_transfer --json -- '{"action": "store"}'
```

The response includes the IPFS CID. Save it; share it with peers who need the patterns.

### Fetch + apply a peer's patterns

```bash
# Pull a CID and apply locally
mcp tool call hooks_transfer --json -- '{"action": "load", "cid": "QmXyz..."}'

# Verify they landed
mcp tool call hooks_intelligence_pattern-search --json -- '{"query": "<test>", "limit": 5}'
```

Patterns are merged with local state, not replaced. Conflicts are resolved by recency (newer wins).

### Mirror an entire project's patterns

```bash
# Read patterns from a sibling project on disk and republish under a new CID
mcp tool call hooks_transfer --json -- '{"action": "from-project", "source": "/path/to/peer-project"}'
```

Useful for consolidating learnings across a monorepo or a fleet of related projects.

## When to use this skill

- **Before a fresh project starts** — fetch the relevant patterns from a parent project so the new project's agents start with prior knowledge instead of cold.
- **After a major learning milestone** — publish so other projects benefit.
- **When debugging a regression** — fetch a known-good pattern set to compare against.

## When NOT to use

- Daily — it's a heavyweight operation. `agentdb_consolidate` does the local equivalent.
- For sensitive patterns — IPFS is public by default. Pinata pinning does NOT make patterns private. Strip PII (use `aidefence_has_pii` first) before publishing.

## Caveats

- IPFS CIDs are content-addressed; republishing the same pattern set gives you the same CID.
- Patterns are stored as JSON; they include only the embedding hashes + metadata, not raw text. Decoding requires the same SONA / MicroLoRA adapter version that produced them.
- This skill does NOT publish AgentDB rows — only the intelligence-side patterns. To ship full memory, use `agentdb_*` export tools (out of scope here).

## Related

- `ruflo-agentdb` ADR-0001 §"Namespace convention" — defines `pattern` namespace that this transfer reads from
- `neural-train` skill — produces the patterns that this skill ships
