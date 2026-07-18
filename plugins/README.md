# Ruflo Plugins

32 Claude Code plugins for agent-powered development workflows. Load with `--plugin-dir`.

## Quick Start

```bash
# Load specific plugins
claude --plugin-dir plugins/ruflo-core --plugin-dir plugins/ruflo-swarm

# Load all plugins
claude $(ls -d plugins/ruflo-*/ | sed 's|^|--plugin-dir |' | tr '\n' ' ')
```

## Plugin Catalog

### Core & Coordination

| Plugin | Description |
|--------|-------------|
| [ruflo-core](ruflo-core/) | MCP server, status, doctor, coder/researcher/reviewer agents |
| [ruflo-swarm](ruflo-swarm/) | Swarm topologies (hierarchical, mesh), Monitor streaming |
| [ruflo-autopilot](ruflo-autopilot/) | Autonomous /loop task completion with prediction |
| [ruflo-loop-workers](ruflo-loop-workers/) | 12 background workers via /loop or CronCreate |
| [ruflo-workflows](ruflo-workflows/) | Workflow templates, parallel execution, branching |

### Memory & Intelligence

| Plugin | Description |
|--------|-------------|
| [ruflo-agentdb](ruflo-agentdb/) | AgentDB with HNSW vector search (150x-12,500x faster) |
| [ruflo-rag-memory](ruflo-rag-memory/) | SOTA RAG — hybrid search, Graph RAG, MMR diversity, memory bridge |
| [ruflo-rvf](ruflo-rvf/) | Portable RVF memory format, session persistence |
| [ruflo-ruvector](ruflo-ruvector/) | [`ruvector`](https://npmjs.com/package/ruvector) — FlashAttention-3, Graph RAG, hybrid search, 103 MCP tools, Brain AGI |
| [ruflo-knowledge-graph](ruflo-knowledge-graph/) | Entity extraction, relation mapping, pathfinder traversal |
| [ruflo-intelligence](ruflo-intelligence/) | SONA neural patterns, trajectory learning, model routing |
| [ruflo-daa](ruflo-daa/) | Dynamic Agentic Architecture, cognitive patterns |

### Architecture & Methodology

| Plugin | Description |
|--------|-------------|
| [ruflo-adr](ruflo-adr/) | ADR lifecycle — create, index, supersede, compliance checking |
| [ruflo-ddd](ruflo-ddd/) | DDD scaffolding — bounded contexts, aggregates, domain events |
| [ruflo-sparc](ruflo-sparc/) | SPARC methodology with 5 phases and quality gates |

### Quality & Security

| Plugin | Description |
|--------|-------------|
| [ruflo-security-audit](ruflo-security-audit/) | CVE scanning, dependency vulnerability checks |
| [ruflo-aidefence](ruflo-aidefence/) | Prompt injection detection, PII scanning |
| [ruflo-testgen](ruflo-testgen/) | Test gap detection, TDD London School workflow |
| [ruflo-browser](ruflo-browser/) | Playwright browser automation and testing |

### Development Tools

| Plugin | Description |
|--------|-------------|
| [ruflo-jujutsu](ruflo-jujutsu/) | Diff analysis, risk scoring, reviewer recommendations |
| [ruflo-docs](ruflo-docs/) | Doc generation, drift detection, API docs |
| [ruflo-ruvllm](ruflo-ruvllm/) | Local LLM inference, MicroLoRA, chat formatting |
| [ruflo-agent](ruflo-agent/) | WASM agent sandboxing and gallery |
| [ruflo-plugin-creator](ruflo-plugin-creator/) | Scaffold and validate new plugins |
| [ruflo-migrations](ruflo-migrations/) | Database schema migration management |
| [ruflo-observability](ruflo-observability/) | Structured logging, tracing, metrics correlation |
| [ruflo-cost-tracker](ruflo-cost-tracker/) | Token usage tracking, budget alerts, cost optimization |

### Payments & Monetization

| Plugin | Description |
|--------|-------------|
| [ruflo-gadgethumans-x402](ruflo-gadgethumans-x402/) | x402 micropayments ($0.001 USDC/call) + 58 MCP tools for agent-to-agent payments. No signup, no API keys |

### Domain-Specific

| Plugin | Description |
|--------|-------------|
| [ruflo-goals](ruflo-goals/) | GOAP planning, deep research, horizon tracking |
| [ruflo-federation](ruflo-federation/) | Zero-trust cross-installation agent federation |
| [ruflo-iot-cognitum](ruflo-iot-cognitum/) | Cognitum Seed IoT — trust scoring, anomaly detection, fleet management |
| [ruflo-neural-trader](ruflo-neural-trader/) | [`neural-trader`](https://npmjs.com/package/neural-trader) — 4 agents, LSTM/Transformer, Rust/NAPI backtesting, 112+ MCP tools |
| [ruflo-market-data](ruflo-market-data/) | Market data ingestion, OHLCV vectorization, pattern matching |

## Recommended Stacks

| Use Case | Plugins |
|----------|---------|
| Feature development | `ruflo-core` + `ruflo-swarm` + `ruflo-testgen` + `ruflo-ddd` |
| Security audit | `ruflo-core` + `ruflo-security-audit` + `ruflo-aidefence` |
| Architecture work | `ruflo-core` + `ruflo-adr` + `ruflo-ddd` + `ruflo-sparc` |
| Deep research | `ruflo-core` + `ruflo-goals` + `ruflo-rag-memory` + `ruflo-intelligence` |
| Vector search | `ruflo-core` + `ruflo-ruvector` + `ruflo-rag-memory` + `ruflo-knowledge-graph` |
| IoT development | `ruflo-core` + `ruflo-iot-cognitum` + `ruflo-agentdb` |
| Trading systems | `ruflo-core` + `ruflo-neural-trader` + `ruflo-market-data` + `ruflo-ruvector` |
| Full stack | All 32 plugins |

## npm Package Integration

Several plugins wrap standalone npm packages for deeper functionality:

| Plugin | npm Package | What It Adds |
|--------|------------|-------------|
| `ruflo-neural-trader` | [`neural-trader`](https://npmjs.com/package/neural-trader) | 112+ MCP tools, Rust/NAPI engine, LSTM/Transformer models |
| `ruflo-ruvector` | [`ruvector`](https://npmjs.com/package/ruvector) | 103 MCP tools, FlashAttention-3, Graph RAG, Brain AGI |

```bash
# Install backing packages
npm install neural-trader ruvector

# Add as MCP servers (optional, for direct tool access)
claude mcp add neural-trader -- npx neural-trader mcp start
claude mcp add ruvector -- npx ruvector mcp start
```

## Plugin Structure

Each plugin follows the Claude Code plugin specification:

```
ruflo-<name>/
  .claude-plugin/plugin.json    # Plugin manifest
  agents/<name>.md              # Agent definitions (frontmatter: name, description, model)
  commands/<name>.md            # CLI command mappings
  skills/<name>/SKILL.md        # Interactive skills (frontmatter: name, description, argument-hint, allowed-tools)
  README.md                     # Plugin documentation
```

## Creating a Plugin

```bash
claude --plugin-dir plugins/ruflo-plugin-creator
# Then: /create-plugin my-new-plugin
```

Or manually: copy any existing plugin directory and modify.

## Validation

```bash
claude plugin validate plugins/ruflo-<name>
```

## Verification & Discoverability

Every MCP tool description across the 32 plugins must answer "use this over native (Bash/Read/Grep/Glob/Task/TodoWrite) when?" per [ADR-112](../v3/docs/adr/ADR-112-mcp-tool-discoverability.md). The rule is enforced by CI:

```bash
# Run the audit (scans all MCPTool definitions across all plugins)
node scripts/audit-tool-descriptions.mjs

# Gates: every description must include "Use when …" guidance,
# be ≥ 80 chars, and be unique. Baseline at verification/mcp-tool-baseline.json
# is monotone-decreasing — CI fails on any regression.
```

Combined with [`verification/`](../verification/) (Ed25519-signed witness manifest, 103+ documented fixes attested), the plugin surface is regression-protected at three layers: install smoke (`npm i`), behavioral smoke (paired-tool round-trips), and presence attestation (every load-bearing line of every documented fix). See [`verification/README.md`](../verification/README.md) for the full stack.

## License

MIT
