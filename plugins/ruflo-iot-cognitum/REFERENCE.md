# ruflo-iot-cognitum — Operations Reference

Companion reference for the agents in this plugin. The agent prompts deliberately stay lean (≤ 60 lines) per [ADR-098 Part 2](../../v3/docs/adr/ADR-098-plugin-capability-sync-and-optimization.md); this file collects the tables and catalogs an agent reads on-demand instead of paying for them in every spawn's context window.

## Trust tiers (5 levels)

| Level | Name | Score range | Capabilities |
|---|---|---|---|
| 0 | `UNKNOWN` | 0.0–0.19 | Discovery only |
| 1 | `REGISTERED` | 0.2–0.39 | Status, identity queries |
| 2 | `PROVISIONED` | 0.4–0.59 | Telemetry ingest, vector store |
| 3 | `CERTIFIED` | 0.6–0.79 | Mesh participation, firmware deploy |
| 4 | `FLEET_TRUSTED` | 0.8–1.0 | Full fleet operations, witness signing |

Promotion requires the device to meet the lower bound of the next tier across all 6 trust components — a single-component cliff (e.g. firmware fall-behind) demotes by one tier until the deficiency is repaired.

## Device coordinator tool catalog

The default endpoint when none is supplied is `http://169.254.42.1/` — the Cognitum Seed link-local USB Ethernet address.

```bash
# Lifecycle
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot register [endpoint]
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot pair <device-id>
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot unpair <device-id>
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot remove <device-id>

# Inspection
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot status <device-id>
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot list
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot mesh <device-id>

# Witness audit
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot witness <device-id>
npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot witness verify <device-id>
```

## Background workers

| Worker | Interval | Event emitted | Description |
|---|---|---|---|
| `HealthProbeWorker` | 30s | `iot:device-offline` | Probes device status, detects offline |
| `TelemetryIngestWorker` | 60s | — | Ingests telemetry vectors |
| `AnomalyScanWorker` | 120s | `iot:anomaly-detected` | Runs Z-score anomaly detection |
| `MeshSyncWorker` | 120s | `iot:mesh-partition` | Detects mesh topology partitions |
| `FirmwareWatchWorker` | 300s | `iot:firmware-mismatch` | Detects firmware version changes |
| `WitnessAuditWorker` | 600s | `iot:witness-gap` | Audits witness chain epoch continuity |

Workers are dispatched by the host daemon when `ruflo-iot-cognitum` is loaded. Verify via `ruflo hooks worker list` and `ruflo hooks worker status`.

## Trust-score formula breakdown

```
trustScore =
    0.30 · pairingIntegrity     # mTLS chain valid, expected fingerprint
  + 0.15 · firmwareCurrency     # current firmware vs latest available
  + 0.20 · uptimeStability      # rolling 24h uptime ratio
  + 0.15 · witnessIntegrity     # Ed25519 chain has no gaps
  + 0.10 · anomalyHistory       # 1.0 minus normalized anomaly count
  + 0.10 · meshParticipation    # active edges in the mesh topology
```

A device that fails its `witness verify` drops `witnessIntegrity` to 0 immediately — that single failure caps the device at trust 0.85 (max), forcing demotion from `FLEET_TRUSTED`.
