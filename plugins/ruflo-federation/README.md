# ruflo-federation

The comms layer for multi-agent AI. Cross-installation agent federation with zero-trust security, PII-gated data flow, and compliance-grade audit trails.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-federation@ruflo
```

## What's Included

- **Zero-Trust Federation**: Agents discover peers and prove identity via mTLS + ed25519 before any data moves
- **PII Pipeline**: 14-type detection with per-trust-level policies (BLOCK/REDACT/HASH/PASS) and adaptive confidence calibration
- **5-Tier Trust Model**: UNTRUSTED → VERIFIED → ATTESTED → TRUSTED → PRIVILEGED with behavioral scoring
- **Compliance Modes**: HIPAA, SOC2, GDPR audit trails as first-class primitives
- **Secure Messaging**: HMAC-signed envelopes with dual AI Defence gates (outbound + inbound)
- **Byzantine Consensus**: BFT for state mutations across untrusted federation peers
- **Budget Circuit Breaker (ADR-097)**: per-call `maxHops` (default 8), optional `maxTokens` / `maxUsd` caps, and constant-string `HOP_LIMIT_EXCEEDED` / `BUDGET_EXCEEDED` errors that defang recursive delegation loops and runaway cost cascades

## Budget & Circuit Breaker

`/federation send` accepts optional cumulative-spend caps so a single delegation cannot spawn an unbounded fan-out:

```bash
/federation send <node-id> task-assignment '{"task":"…"}' \
  --max-hops 4 \
  --max-tokens 50000 \
  --max-usd 0.25
```

| Field | Default when omitted | Notes |
|---|---|---|
| `maxHops` | `8` | `0` disallows remote delegation entirely. Hard ceiling 64. |
| `maxTokens` | unbounded | Σ tokens across the whole hop chain. Hard ceiling 1B. |
| `maxUsd` | unbounded | Σ USD across hops. Hard ceiling $1M. |
| `hopCount` | `0` | Pass-through for messages being re-forwarded. |
| `spent.{tokens,usd}` | `0` | Caller-reported usage from previous legs. Negatives clamped to 0. |

Validation rejects `NaN`, ±`Infinity`, negative numbers, and non-integer hop counts up front. Errors surface as constant strings with no remaining-budget echo, so a malicious caller cannot use response codes as an oracle to probe configured thresholds.

Phase 1 enforces at the **send** side. Phase 2 (peer state machine: ACTIVE / SUSPENDED / EVICTED) and Phase 3 (`ruflo-cost-tracker` integration for unified spend reporting) ship in follow-up releases.

## Commands

| Command | Description |
|---------|-------------|
| `/federation <subcommand>` | Dispatcher for `init`, `join`, `leave`, `peers`, `send`, `status`, `audit`, `trust`, `config` (see [`commands/federation.md`](commands/federation.md)) |

## Skills (auto-invoked by description)

| Skill | When it triggers |
|-------|------------------|
| `federation-init` | Initialize this node — generate keypair and configure peers |
| `federation-status` | "is federation healthy?", "show peers", "federation status" |
| `federation-audit` | Query audit logs with compliance / severity / date filters |

## Agents

| Agent | Description |
|-------|-------------|
| `federation-coordinator` | Orchestrates discovery, handshake, trust evaluation, and secure message routing |

## Requires

- `ruflo-core` plugin (provides MCP server)
- `@claude-flow/security` (cryptographic primitives)

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Federation runtime:** `@claude-flow/plugin-agent-federation` (resolved via `npx -y -p`).
- **Verification:** `bash plugins/ruflo-federation/scripts/smoke.sh` is the contract.

## Alignment with the canonical 3-gate pattern

Federation's "PII Pipeline" feature is a richer specialization of the canonical 3-gate pattern owned by [ruflo-aidefence ADR-0001](../ruflo-aidefence/docs/adrs/0001-aidefence-contract.md). The mapping:

| Canonical gate | Federation specialization |
|----------------|--------------------------|
| Pre-storage PII (`aidefence_has_pii`) | 14-type PII detection with per-trust-level policies (`BLOCK` / `REDACT` / `HASH` / `PASS`) |
| Sanitization (`aidefence_scan`) | Outbound HMAC-signed envelope + dual AI Defence gates |
| Prompt-injection (`aidefence_is_safe`) | Inbound message verification before delivery to local agents |

Federation extends the canonical gates with adaptive confidence calibration and trust-level-aware policies, but the gate ordering and intent are identical. New federated content paths should reference the canonical 3-gate pattern by name.

With the [`aidefence@2.3.0` upgrade (ADR-118)](../../v3/docs/adr/ADR-118-aidefence-2.3.0-upgrade.md), the inbound `aidefence_is_safe` gate (Gate 3) now catches a wider injection surface — `ignore all previous instructions` family (0..4 modifier-word window), role-hijack (`you are now …` / `act as …` / `pretend to be …`), and jailbreak markers (`DAN mode` / `developer mode` / `god mode` / `root mode`). Federation's adaptive confidence calibration runs over the broader detection set automatically; no plugin code change required.

## Namespace coordination

This plugin owns the `federation` AgentDB namespace. This is the documented exception to the kebab-case `<plugin-stem>-<intent>` rule: when a plugin's name *is* the intent, the namespace can match the plugin stem. See [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`federation` is accessed via `memory_*` tools (namespace-routed). Used for: peer registry, trust score history, audit log indices, message envelope receipts.

## Verification

```bash
bash plugins/ruflo-federation/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-federation plugin contract (3-gate alignment, ADR-097 budget integration, namespace coordination, smoke as contract)](./docs/adrs/0001-federation-contract.md)
