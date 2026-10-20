---
name: iot
description: Manage Cognitum Seed IoT devices, fleets, firmware, and telemetry
---
$ARGUMENTS
Manage IoT Cognitum Seed devices. Parse subcommand from $ARGUMENTS.

Usage: /iot <subcommand> [options]

Subcommands:
- `register [endpoint]` — Register a Seed device by HTTP endpoint (defaults to `http://169.254.42.1/` — the Cognitum Seed link-local address)
- `status <device-id>` — Refresh device state and trust score
- `list` — List all registered devices
- `pair <device-id>` — Pair device, promote trust level
- `unpair <device-id>` — Unpair device, demote trust level
- `remove <device-id>` — Deregister and close device connection
- `query <device-id> --vector "[...]" --k N` — k-NN vector store search
- `ingest <device-id>` — Ingest telemetry vectors
- `mesh <device-id>` — View mesh network topology
- `witness <device-id>` — View witness chain
- `witness verify <device-id>` — Verify witness chain integrity
- `fleet create --name NAME` — Create a device fleet
- `fleet list` — List all fleets
- `fleet add <fleet-id> <device-id>` — Add device to fleet
- `fleet remove <fleet-id> <device-id>` — Remove device from fleet
- `fleet delete <fleet-id>` — Delete fleet
- `firmware deploy <fleet-id> --version VER` — Start firmware rollout
- `firmware advance <rollout-id>` — Advance rollout stage
- `firmware rollback <rollout-id>` — Force rollback
- `firmware status <rollout-id>` — Rollout status
- `firmware list` — List all rollouts
- `anomalies <device-id>` — Detect telemetry anomalies
- `baseline <device-id> [--compute]` — View or recompute telemetry baseline

Steps by subcommand:

**register**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot register ENDPOINT` (default ENDPOINT=`http://169.254.42.1/` if not supplied — the Cognitum Seed link-local USB Ethernet address)
**status**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot status DEVICE_ID`
**list**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot list`
**pair**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot pair DEVICE_ID`
**unpair**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot unpair DEVICE_ID`
**remove**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot remove DEVICE_ID`
**query**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot query DEVICE_ID --vector "VECTOR" --k K`
**ingest**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot ingest DEVICE_ID`
**mesh**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot mesh DEVICE_ID`
**witness**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot witness DEVICE_ID`
**witness verify**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot witness verify DEVICE_ID`
**fleet create**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot fleet create --name NAME`
**fleet list**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot fleet list`
**fleet add**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot fleet add FLEET_ID DEVICE_ID`
**fleet remove**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot fleet remove FLEET_ID DEVICE_ID`
**fleet delete**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot fleet delete FLEET_ID`
**firmware deploy**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot firmware deploy FLEET_ID --version VERSION`
**firmware advance**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot firmware advance ROLLOUT_ID`
**firmware rollback**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot firmware rollback ROLLOUT_ID`
**firmware status**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot firmware status ROLLOUT_ID`
**firmware list**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot firmware list`
**anomalies**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot anomalies DEVICE_ID`
**baseline**: `npx -y -p @claude-flow/plugin-iot-cognitum@1.0.0 cognitum-iot baseline DEVICE_ID --compute`
