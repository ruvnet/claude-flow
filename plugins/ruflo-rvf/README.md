# ruflo-rvf

RVF format for portable agent memory, session persistence, and cross-platform transfer.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-rvf@ruflo
```

## Features

- **RVF format**: Portable vector memory with embeddings, metadata, and causal graphs
- **Session persistence**: Save and restore complete agent sessions across conversations
- **Cross-project transfer**: Export and import knowledge between projects
- **Claude memory bridge**: Import Claude Code auto-memories into AgentDB
- **Format migration**: Upgrade RVF files across versions

## Encryption at rest (ruflo 3.6.25+)

Sessions persisted by this plugin land at `.claude-flow/sessions/*.json`, which are written through `fs-secure.writeFileRestricted({encrypt:true})` per [ADR-096](../../v3/docs/adr/ADR-096-encryption-at-rest.md). Behavior under the gate:

- **Off by default** (`CLAUDE_FLOW_ENCRYPT_AT_REST` unset / falsy) — sessions are plaintext JSON at mode 0600, same as ruflo 3.6.24 and earlier.
- **On** (`CLAUDE_FLOW_ENCRYPT_AT_REST=1` + `CLAUDE_FLOW_ENCRYPTION_KEY` set to 64-char hex or 44-char base64) — each session save is AES-256-GCM with `RFE1` magic-byte prefix. Session restore transparently decrypts via the magic sniff; legacy plaintext sessions still load unchanged during migration.

When **exporting RVF files for cross-machine transfer**, the encryption gate does NOT apply to the exported bytes — the encryption is at-rest on the *originating* host. If the RVF is itself sensitive, transport security (sealed boxes / signed blobs) is the next phase per the ADR roadmap.

Confirm the gate state with `ruflo doctor -c encryption`.

## Commands

- `/rvf` -- Memory stats, saved sessions, storage metrics

## Skills

- `rvf-manage` -- Manage RVF files for portable memory
- `session-persist` -- Persist and restore agent sessions

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-rvf/scripts/smoke.sh` is the contract.

## Cross-plugin RVF ownership

RVF (RuVector Format) cognitive containers appear in three plugins. Each owns a different slice:

| Slice | Owner | What it does |
|-------|-------|-------------|
| **Portable memory + session persistence** | `ruflo-rvf` (this plugin) | High-level skills for save/restore, cross-machine transfer |
| **Browser sessions as RVF** | [ruflo-browser ADR-0001](../ruflo-browser/docs/adrs/0001-browser-skills-architecture.md) | Each browser session is allocated as an RVF container at session-start (manifest, trajectory, screenshots, snapshots, cookies, findings) |
| **RVF tooling (10 subcommands)** | [ruflo-ruvector ADR-0001](../ruflo-ruvector/docs/adrs/0001-pin-ruvector-0.2.25.md) | `ruvector rvf create|ingest|query|status|segments|derive|compact|export|examples|download` |

This plugin sits on top of ruvector's tooling and feeds browser's session-as-RVF model.

## Namespace coordination

This plugin owns the `rvf-sessions` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`rvf-sessions` indexes saved session manifests + their RVF container paths. Accessed via `memory_*` (namespace-routed).

## Verification

```bash
bash plugins/ruflo-rvf/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-rvf plugin contract (cross-plugin RVF ownership table, namespace coordination, smoke as contract)](./docs/adrs/0001-rvf-contract.md)

## Related Plugins

- `ruflo-ruvector` — exposes the `ruvector rvf *` tooling this plugin sits on top of
- `ruflo-browser` — uses RVF containers for session-as-skill artifacts (ADR-0001 there)
- `ruflo-agentdb` — namespace convention owner

## As a mod

Function-hook mod (ADR-445, pattern of `ruflo-agentdb`). It loads from `hooks/hooks.json` → `hooks/register.ts`.

A guard for portable memory: `memory_store`, `session_save`, `hooks_session-end` and `hooks_transfer` refuse secrets, so an RVF export or saved session does not carry them off-machine. Deletes (`memory_delete`, `session_delete`) are not gated: those tools have no confirm flag a mod could rely on.

- **Command**: `/rvf-mod` answers locally with no model call. Verbs: `status`, `scan <text>`, `tools` (which memory and session tools are connected).
- **Status file**: `.claude-flow/rvf-mod/status.json` (`{version, updatedMs, ...counters}`), written at session start and as counters change.
- **Safety**: no network, no process spawning; it only uses tools already connected.
- **Option** `guard` (`on` by default, `off` to disable): a tighten-only `tool.call` guard. A call to one of the tools above whose input holds a key, token, private key or password is denied. The reason never repeats the secret.
- **Test**: `claude plugin validate plugins/ruflo-rvf`, `claude plugin test plugins/ruflo-rvf`, `bash plugins/ruflo-rvf/scripts/smoke.sh`.
