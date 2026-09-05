# ruflo-aidefence

AI safety scanning, PII detection, prompt injection defense, and adaptive threat learning.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-aidefence@ruflo
```

## Features

- **Safety scanning**: Detect prompt injection, jailbreak attempts, and adversarial content
- **PII detection**: Flag emails, SSNs, API keys, and other sensitive data
- **Adaptive learning**: Train defenses on confirmed threats to improve detection
- **Threat classification**: Categorize threats with confidence scores

## Defense-in-depth pairing (ruflo 3.6.25+)

This plugin pairs with three runtime hardening features that ship in the host (ADR-095 / ADR-096 / audit_1776853149979):

- **Loader-hijack denylist** — `validateEnv()` rejects `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `DYLD_FALLBACK_LIBRARY_PATH`, `DYLD_FORCE_FLAT_NAMESPACE`, `NODE_OPTIONS`, `NODE_PATH` at the `terminal_create` MCP boundary. Adding any of these to a child process is functionally RCE; threat scoring should treat a denylist-enforcing host as substantially less exposed.
- **File mode 0600 / dir mode 0700** on session, terminal, and memory stores via `fs-secure.writeFileRestricted` — cross-user-on-host reads blocked at the OS layer.
- **Encryption at rest** (opt-in via `CLAUDE_FLOW_ENCRYPT_AT_REST=1`) — AES-256-GCM with magic-byte (`RFE1`) backward-compat sniff. Reports involving memory.db / sessions / terminal-history exfiltration should account for the gate state (`ruflo doctor -c encryption`).

## Commands

- `/aidefence` -- Detection stats and threat analysis dashboard

## Skills

- `safety-scan` -- Scan inputs for prompt injection and unsafe content
- `pii-detect` -- Detect PII in text, code, and configurations

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **MCP surface:** 6 `aidefence_*` tools (`scan`, `analyze`, `stats`, `learn`, `is_safe`, `has_pii`) plus `transfer_detect-pii` for categorized findings.
- **Verification:** `bash plugins/ruflo-aidefence/scripts/smoke.sh` is the contract.

## The 3-gate pattern (canonical)

Every consumer plugin handling untrusted content should apply these three gates **in order**:

| # | Gate | Tool | When |
|---|------|------|------|
| 1 | Pre-storage PII | `aidefence_has_pii` | Before any AgentDB / `memory_store` write — redact or quarantine before persistence. |
| 2 | Sanitization | `aidefence_scan` | For cookies, tokens, high-entropy blobs — vault behind an opaque handle rather than embed raw values. |
| 3 | Prompt-injection | `aidefence_is_safe` | Before any extracted text re-enters an LLM prompt — quarantine to `findings.md` if flagged. |

This is the pattern `ruflo-browser` ADR-0001 §4 codified and `ruflo-aidefence` ADR-0001 canonicalizes. Reference these gates by name in any new plugin that handles user-supplied content.

### What the gates catch (after [ADR-118](../../v3/docs/adr/ADR-118-aidefence-2.3.0-upgrade.md))

The upstream `aidefence@2.3.0` / `aimds-*@0.1.1` release (shipped 2026-05-14) widens the detection net without changing the MCP-tool surface. Gate 3 (`aidefence_is_safe`) now flags:

| Category | Sample input |
|----------|--------------|
| **Prompt injection** (0..4 modifier-word window) | `ignore all previous instructions`, `forget every rule above`, `disregard the system prompt` |
| **Role hijack** | `you are now …`, `act as …`, `pretend to be …` |
| **Jailbreak markers** | `DAN mode`, `developer mode`, `god mode`, `root mode` |

`aidefence_stats` now also reports accurate `total_mitigations` and `successful_mitigations` (previously hardcoded `0` — an unclosed TODO that's now backed by `AtomicU64` counters).

## Namespace coordination

This plugin owns the `security-patterns` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

## Verification

```bash
bash plugins/ruflo-aidefence/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-aidefence plugin contract (pinning, namespace coordination, 3-gate pattern, smoke as contract)](./docs/adrs/0001-aidefence-contract.md)
