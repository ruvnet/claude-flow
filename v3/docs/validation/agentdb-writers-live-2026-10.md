# Live validation of the four newly guarded agentdb writers, 2026-10-05

PR #3745 added `agentdb_feedback`, `agentdb_session-end`, `hive-mind_memory` and `session_save` to the ruflo-agentdb secret guard (`plugins/ruflo-agentdb/hooks/tools.ts` `WRITERS`). Until now that was proven only by unit tests (`tests/guard-scan.test.ts`). This run drives a **real headless Claude** with the plugin loaded and the **real ruflo MCP server**.

Reproduce: `scripts/live-agentdb-writers.sh` (about $0.16 of haiku for the session). It builds a private `mktemp -d` project (`git init`, `memory init`), starts one `claude -p --input-format stream-json --plugin-dir plugins/ruflo-agentdb --strict-mcp-config` process (settings: `recall=off`, `guard=on`) with the `ruflo` and `ruvector` MCP servers, and sends one prompt per call. It reads the tool result Claude received, not the model's reply. The fake token is assembled at runtime from fragments (`ghp_` plus 36 mixed characters); the repo never holds it whole.

Environment: Claude Code 2.1.287, `@claude-flow/cli@latest` as the `ruflo` MCP server, `ruvector@latest`, model `haiku`.

## Result: 11 of 11 rows as expected

| Call | Fake secret in | Tool result Claude received |
|---|---|---|
| `agentdb_feedback` secret | `agent: "deploy used api_key=<token>"` | refused |
| `agentdb_feedback` benign | | `{"success": true, "controller": "intelligence+bridge-store", "updated": 2}` |
| `agentdb_session-end` secret | `summary: "deploy used password=<token>"` | refused |
| `agentdb_session-end` benign | | `{"success": true, "controller": "bridge-store", "persisted": true}` |
| `hive-mind_memory` secret | `value: {"token": "<token>"}` (action `set`) | refused |
| `hive-mind_memory` benign | | `{"action": "set", "key": "region", "success": true, ...}` |
| `session_save` secret | `description: "secret: <token>"` | refused |
| `session_save` benign | | `{"sessionId": "session-...", "name": "live-w4b", "savedAt": ..., "stats": ...}` |
| `memory_import` (unguarded) | token inside the JSON file at `inputPath` | **not refused**: `"imported": {"entries": 1, "vectors": 1, "patterns": 0}` |
| `rvf_create` (setup) | none | `{"success": true, "path": ..., "totalVectors": 0, ...}` |
| `rvf_ingest` (unguarded) | token in `entries[0].metadata.note` | **not refused**, but failed for a tool reason: `Another writer holds the lock: RVF error 0x0300: LockHeld` |

Every refusal was, byte for byte:

```
<tool_use_error>ruflo-agentdb: this memory write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.</tool_use_error>
```

The script asserts that neither the whole token nor a 16-character slice of it appears in any refusal text (`echoed` was `false` in all four). The refusal is the plugin's, returned to Claude as an error on the tool call, so the write did not go through (the benign calls to the same tools in the same session did).

## What was proven

- With `ruflo-agentdb` loaded through `--plugin-dir`, a secret-shaped value in each of the four newly listed writers is refused before the tool runs, with the plugin's message, in the field each tool really takes (a free-text agent field, a summary, a nested `value` object, a description).
- The refusal never echoes the secret.
- A benign call to each of the same four tools passes in the same session, so the guard is not blanket-denying the tool.

## The gap, documented

`memory_import` and `rvf_ingest` are not in `WRITERS` on purpose (`tests/guard-scan.test.ts` asserts that). Live, `memory_import` imported a secret-bearing entry because the guard sees only the **path** argument, never the file's contents. `rvf_ingest` was not refused either; the call failed on the RVF store lock (`rvf_create` in the same MCP process still held it), so this run shows the guard did not interfere, **not** that an ingest would have stored the value.

## What could not be provoked

- A successful `rvf_ingest`: the create-then-ingest sequence through one MCP process hits `LockHeld`. The plugin's behaviour (no refusal) is established; the store-side result is not.
- The first attempt of the script saw no tools at all because the `npx`-started MCP servers had not connected when the first prompt arrived (10 empty rows, $0.07). The script now sends an uncounted warm-up prompt (`agentdb_health`, up to three tries) first.
- Only a GitHub-token shape was exercised live. Other shapes (private key, JWT, key assignments) are covered by `tests/guard-scan.test.ts` and, for three other writers, by `agentdb-recall-live-2026-10.md`.
- The prompt told haiku the values are fake fixtures; a model that refused first would hide the guard, but all calls were made, so nothing was left unproven for that reason.
