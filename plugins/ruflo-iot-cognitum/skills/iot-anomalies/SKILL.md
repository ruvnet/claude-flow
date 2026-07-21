---
name: iot-anomalies
description: Detect and classify telemetry anomalies on Cognitum Seed devices. Use when investigating a device that's reporting odd metrics, before approving a firmware canary advancement, or when triaging fleet-wide health alerts.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store Read
argument-hint: "<device-id>"
---
Run Z-score anomaly detection on a device's recent telemetry.

Steps:
1. `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot anomalies DEVICE_ID`
2. Review detected anomaly types (spike, flatline, drift, oscillation, pattern-break, cluster-outlier)
3. If score > 0.9, recommend quarantine
4. Store anomaly pattern for learning:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "iot-anomaly-DEVICEID", value: "TYPE at SCORE", namespace: "iot-anomalies" })`
