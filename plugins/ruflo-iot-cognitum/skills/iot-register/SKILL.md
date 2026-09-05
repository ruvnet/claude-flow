---
name: iot-register
description: Register a Cognitum Seed device by endpoint and establish agent bridge
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store Read
argument-hint: "[endpoint] [--token PAIRING_TOKEN]"
---
Register a Cognitum Seed device. Creates a SeedClient connection, fetches identity, and assigns initial trust level.

Default endpoint: `http://169.254.42.1/` — the Cognitum Seed link-local USB Ethernet address. Use this when no endpoint is supplied.

Steps:
1. Resolve ENDPOINT: use the user-supplied value, or default to `http://169.254.42.1/`.
2. `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot register ENDPOINT`
3. If pairing token provided: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot pair DEVICE_ID`
4. Show device status: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot status DEVICE_ID`

Store registration event:
`mcp__plugin_ruflo-core_ruflo__memory_store({ key: "iot-register-DEVICEID", value: "Registered at ENDPOINT", namespace: "iot-devices" })`
