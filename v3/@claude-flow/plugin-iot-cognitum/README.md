# @claude-flow/plugin-iot-cognitum

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-iot-cognitum.svg)](https://www.npmjs.com/package/@claude-flow/plugin-iot-cognitum)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-iot-cognitum.svg)](https://www.npmjs.com/package/@claude-flow/plugin-iot-cognitum)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

IoT Cognitum Seed device-agent bridge — treat every Seed as a Ruflo agent with hardware capabilities.

## Hardware

This plugin requires a **Cognitum Seed** device. Get one at **https://cognitum.one**.

The Seed is an edge appliance with on-device vector store, Ed25519 cryptographic identity, OTA firmware updates, mesh networking, and a witness chain for provenance.

**Default endpoints:**
- `http://169.254.42.1` — link-local USB-C (no auth, read-only + pair window)
- `https://169.254.42.1:8443` — LAN/HTTPS with bearer token (full access including writes)

## Install + run

```bash
npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot --help
```

## Authentication via `.env`

Create a `.env` file in your project root (or any parent directory):

```bash
COGNITUM_SEED_TOKEN=your-bearer-token-here
# Optional overrides:
COGNITUM_SEED_ENDPOINT=https://169.254.42.1:8443    # default when token is set
IOT_FLEET_ID=my-fleet
IOT_ZONE_ID=zone-1
IOT_TLS_INSECURE=true                                # accept self-signed cert (default: true)
```

The bin walks up from CWD looking for `.env`, loads it without overwriting existing process.env vars, then:

- When `COGNITUM_SEED_TOKEN` is present → default endpoint switches to `https://169.254.42.1:8443` (LAN/HTTPS) and the token is passed as the bearer/pairing token on `register`.
- When no token → default endpoint stays at `http://169.254.42.1` (USB-C link-local, read-only).

Token scope on Seed varies — read endpoints work with most tokens; `store/ingest` and some admin operations require a write-scoped token. See https://cognitum.one for token tier documentation.

## Commands

| Command | Description |
|---|---|
| `cognitum-iot init` | Show plugin configuration |
| `cognitum-iot register [endpoint]` | Register a Seed device (defaults to `http://169.254.42.1`) |
| `cognitum-iot list` | List registered devices |
| `cognitum-iot status <device-id>` | Show device trust score, vectors, epoch |
| `cognitum-iot mesh <device-id>` | Show mesh network topology |
| `cognitum-iot witness <device-id>` | Show witness chain |
| `cognitum-iot witness verify <device-id>` | Verify witness chain integrity |
| `cognitum-iot query --device-id <id> --vector "[..]"` | k-NN search the on-device vector store |
| `cognitum-iot ingest --device-id <id> --vector "[..]"` | Ingest a vector (requires bearer auth) |
| `cognitum-iot pair --device-id <id>` | Pair (requires open pair window on device) |
| `cognitum-iot unpair --device-id <id>` | Unpair (requires bearer auth) |
| `cognitum-iot fleet create --fleet-id <id> --name <name>` | Create a fleet |
| `cognitum-iot fleet list` | List fleets |
| `cognitum-iot fleet add --fleet-id <fid> --device-id <did>` | Add device to fleet |
| `cognitum-iot fleet remove --fleet-id <fid> --device-id <did>` | Remove device from fleet |
| `cognitum-iot fleet delete --fleet-id <id>` | Delete a fleet |
| `cognitum-iot firmware list` | List firmware rollouts |
| `cognitum-iot firmware status <rollout-id>` | Rollout status |
| `cognitum-iot firmware deploy <fleet-id> --version <ver>` | Start an OTA rollout |
| `cognitum-iot firmware advance <rollout-id>` | Advance rollout stage |
| `cognitum-iot firmware rollback <rollout-id>` | Force rollback |

## Programmatic use

```typescript
import { IoTCognitumPlugin } from '@claude-flow/plugin-iot-cognitum';

const plugin = new IoTCognitumPlugin();
await plugin.initialize({ /* PluginContext */ });
const coordinator = plugin['coordinator'];
const device = await coordinator.registerDevice('http://169.254.42.1');
console.log(`Trust: ${device.trustLevel}, vectors: ${device.vectorStoreStats.totalVectors}`);
```

## Tests

239 unit + integration tests, plus a chained-command live-device smoke harness at `__tests__/integration/full-plugin-smoke.mjs`. Run:

```bash
npm test                                      # unit + SDK integration
SEED_ENDPOINT=http://169.254.42.1 \
  node __tests__/integration/full-plugin-smoke.mjs   # live device smoke
```

## License

MIT — Claude Flow Team.

Cognitum Seed hardware: see https://cognitum.one for licensing and acquisition.
