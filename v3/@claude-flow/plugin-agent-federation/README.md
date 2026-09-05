# @claude-flow/plugin-agent-federation

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-agent-federation.svg)](https://www.npmjs.com/package/@claude-flow/plugin-agent-federation)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-agent-federation.svg)](https://www.npmjs.com/package/@claude-flow/plugin-agent-federation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cross-installation agent federation with zero-trust security, PII-gated data flow, and compliance-grade audit trails.

## Install + run

```bash
npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation --help
```

## Subcommands

| Command | Description |
|---|---|
| `ruflo-federation init` | Initialize federation on this node (generates keypair) |
| `ruflo-federation join <peer-url>` | Join a federation by connecting to a peer |
| `ruflo-federation leave` | Leave the current federation |
| `ruflo-federation peers` | List known peers and their trust levels |
| `ruflo-federation peers add <node-id>` | Add a peer to the federation |
| `ruflo-federation peers remove <node-id>` | Remove a peer |
| `ruflo-federation status` | Show federation health, sessions, trust levels |
| `ruflo-federation audit` | Query compliance-grade audit logs |
| `ruflo-federation trust` | Manage trust scores and tiers |
| `ruflo-federation config` | Show/update federation config |

## Configuration via `.env`

```bash
FEDERATION_NODE_NAME=my-node           # default: hostname
FEDERATION_BIND_HOST=0.0.0.0           # default: 0.0.0.0
FEDERATION_BIND_PORT=8443              # default: 8443
FEDERATION_TRUST_LEVEL=untrusted       # default: untrusted
```

## Tests

325 unit tests covering audit, routing, discovery, plugin lifecycle.

```bash
npm test
```

## License

MIT — Claude Flow Team.
