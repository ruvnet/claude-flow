# ruflo-iot-cognitum

IoT device lifecycle, telemetry anomaly detection, fleet management, and witness chain verification for Cognitum Seed hardware.

## Hardware

This plugin requires a **Cognitum Seed** device. Get one at **https://cognitum.one** — the Seed is an edge appliance with on-device vector store, Ed25519 identity, OTA firmware, mesh networking, and a witness chain. Default address when attached via USB-C is `http://169.254.42.1` (link-local, no auth) or `https://169.254.42.1:8443` (LAN, bearer auth required for state-mutating operations).

## Overview

Treats every Cognitum Seed device as a Ruflo agent with hardware capabilities. Devices progress through a 5-tier trust model, emit telemetry vectors for anomaly detection, participate in mesh networks, and maintain Ed25519 witness chains for provenance.

Backed by `@claude-flow/plugin-iot-cognitum` (239 tests, 39 source files).

## Installation

```bash
claude --plugin-dir plugins/ruflo-iot-cognitum
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `device-coordinator` | sonnet | Device lifecycle, 5-tier trust scoring, mesh coordination |
| `telemetry-analyzer` | sonnet | Z-score anomaly detection, SONA learning, AgentDB persistence |
| `fleet-manager` | sonnet | Fleet CRUD, firmware rollout state machine, fleet policies |
| `witness-auditor` | haiku | Witness chain epoch verification, gap detection |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `iot-register` | `/iot-register <endpoint>` | Register a Seed device |
| `iot-fleet` | `/iot-fleet <create\|list\|add\|remove\|delete>` | Fleet management |
| `iot-anomalies` | `/iot-anomalies <device-id>` | Detect telemetry anomalies |
| `iot-firmware` | `/iot-firmware <deploy\|advance\|rollback\|status\|list>` | Firmware rollouts |
| `iot-witness-verify` | `/iot-witness-verify <device-id>` | Verify witness chain integrity |

## Commands (25 subcommands)

```bash
# Device lifecycle
# `endpoint` defaults to http://169.254.42.1/ (the Seed link-local USB Ethernet address)
iot register [endpoint] [--token TOKEN]
iot list
iot status <device-id>
iot pair <device-id>
iot unpair <device-id>
iot remove <device-id>

# Telemetry
iot ingest <device-id>
iot baseline <device-id> [--compute]
iot anomalies <device-id>
iot query <device-id> --vector "[1,2,3]" --k 10

# Fleet management
iot fleet create --name "my-fleet"
iot fleet list
iot fleet add <fleet-id> <device-id>
iot fleet remove <fleet-id> <device-id>
iot fleet delete <fleet-id>

# Firmware rollouts
iot firmware deploy <fleet-id> --version "2.0.0"
iot firmware advance <rollout-id>
iot firmware rollback <rollout-id>
iot firmware status <rollout-id>
iot firmware list

# Mesh & witness
iot mesh <device-id>
iot witness <device-id>
iot witness verify <device-id>
iot health <device-id>
iot trust <device-id>
```

## Trust Model (5 Tiers)

| Level | Name | Score Range | Capabilities |
|-------|------|-------------|-------------|
| 0 | UNKNOWN | 0.0–0.19 | Discovery only |
| 1 | REGISTERED | 0.2–0.39 | Status, identity queries |
| 2 | PROVISIONED | 0.4–0.59 | Telemetry ingest, vector store |
| 3 | CERTIFIED | 0.6–0.79 | Mesh participation, firmware deploy |
| 4 | FLEET_TRUSTED | 0.8–1.0 | Full fleet operations, witness signing |

**Trust Score Formula:**
```
0.3×pairingIntegrity + 0.15×firmwareCurrency + 0.2×uptimeStability
+ 0.15×witnessIntegrity + 0.1×anomalyHistory + 0.1×meshParticipation
```

## Anomaly Detection

Z-score composite scoring: `min(1, meanZ/3)`

| Type | Detection Rule | Typical Cause |
|------|---------------|---------------|
| spike | maxZ > 5 | Sudden sensor failure |
| flatline | all zero + low Z | Sensor disconnected |
| drift | 1-2 dimensions high Z | Gradual calibration loss |
| oscillation | alternating high/low | Feedback loop |
| pattern-break | moderate Z, multiple dims | Environmental change |
| cluster-outlier | >50% dimensions high Z | Multi-sensor failure |

## Firmware Rollout State Machine

```
pending → canary → rolling → complete
                ↘ rolled-back ↙
```

- **canary**: Deploy to `ceil(deviceCount × canaryPercentage/100)` devices
- **rolling**: If canary anomaly score < rollback threshold, deploy to remaining
- **rolled-back**: Force rollback triggered by anomaly threshold breach

## Background Workers

| Worker | Interval | Event |
|--------|----------|-------|
| HealthProbeWorker | 30s | `iot:device-offline` |
| TelemetryIngestWorker | 60s | — |
| AnomalyScanWorker | 120s | `iot:anomaly-detected` |
| MeshSyncWorker | 120s | `iot:mesh-partition` |
| FirmwareWatchWorker | 300s | `iot:firmware-mismatch` |
| WitnessAuditWorker | 600s | `iot:witness-gap` |

## Integrations

- **AgentDB HNSW**: Telemetry vectors stored in `iot-telemetry` namespace with HNSW indexing (M=16, efConstruction=200)
- **SONA Neural**: Anomaly patterns fed to SONA for cross-device correlation and predictive maintenance
- **Cognitum SDK**: `@cognitum-one/sdk/seed` SeedClient with 12 typed endpoints

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Hardware:** requires Cognitum Seed device. SDK: `@cognitum-one/sdk/seed`.
- **Verification:** `bash plugins/ruflo-iot-cognitum/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns five AgentDB namespaces, all compliant with the [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) (`<plugin-stem>-<intent>` kebab-case):

| Namespace | Purpose |
|-----------|---------|
| `iot-devices` | Device trust history per Cognitum Seed |
| `iot-telemetry` | Telemetry vectors (HNSW: M=16, efConstruction=200) |
| `iot-telemetry-anomalies` | Detected anomalies tagged by type + remedial action |
| `iot-anomalies` | Skill-level anomaly index (alias of above) |
| `iot-audit` | Witness-chain gap records |

Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

## Trust model parallel with federation

This plugin's 5-tier device trust model (UNKNOWN → REGISTERED → PROVISIONED → CERTIFIED → FLEET_TRUSTED) follows the same shape as the [ruflo-federation 5-tier trust model](../ruflo-federation/docs/adrs/0001-federation-contract.md) (UNTRUSTED → VERIFIED → ATTESTED → TRUSTED → PRIVILEGED). Different surface (IoT devices vs federation peers) and distinct naming, but the score-driven progression and capability-gating principle are the same.

## Verification

```bash
bash plugins/ruflo-iot-cognitum/scripts/smoke.sh
# Expected: "12 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-iot-cognitum plugin contract (compliant namespaces, 5-tier trust parallel, 6 background workers, smoke as contract)](./docs/adrs/0001-iot-cognitum-contract.md)

## Related Plugins

- `ruflo-agentdb` — HNSW-indexed telemetry storage backend; namespace convention owner
- `ruflo-federation` — 5-tier trust model parallel (different surface, distinct naming, same shape)
- `ruflo-intelligence` — SONA neural pattern learning
- `ruflo-observability` — Telemetry correlation and tracing

## License

MIT
