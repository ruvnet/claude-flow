<div align="center">

<a href="https://cognitum.one/agentic-engineering"><img src="ruflo/assets/ruflo-neon-flicker.gif" alt="Ruflo animated neon sign" width="100%"></a>

**An agent meta-harness for Claude Code and Codex.**

<!-- Try Ruflo — the 3 badges first-time visitors actually act on -->
[![npm version (ruflo)](https://img.shields.io/npm/v/ruflo?label=npx%20ruflo&style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/ruflo)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-flow)

<p align="center">
<a href="data/npm-downloads.latest.json"><img src="docs/assets/readme/badges/downloads.svg?v=mobile-readable-3" width="300" alt="Ecosystem npm downloads: 12.52M over 12 months through October 4, 2026"></a>
<br>
<a href="https://github.com/ruvnet/claude-flow"><img src="docs/assets/readme/badges/claude.svg?v=mobile-readable-3" width="300" alt="Claude Code"></a>
<a href="https://www.npmjs.com/package/@claude-flow/codex"><img src="docs/assets/readme/badges/codex.svg?v=mobile-readable-3" width="300" alt="Codex Plugin"></a>
</p>

</div>

<a id="start-here"></a>

## <img src="docs/assets/readme/icons/terminal.svg" width="32" height="32" alt=""> Get started with Ruflo

<img src="docs/assets/readme/icons/plugins.svg" width="28" height="28" alt=""> **Start in Claude Code** with core tools, the visual console and runtime mods. Requires Claude Code **2.1.287 or later**. Run inside Claude Code:

```text
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-core@ruflo
/plugin install ruflo-console@ruflo
/plugin install ruflo-mods@ruflo
/reload-plugins
/ruflo
```

**Core** provides foundation tools. **Console** opens the agent cockpit. **Mods** add routing and policy enforcement inside Claude Code. Mods run with your account's permissions; review their code before installing.

<img src="docs/assets/readme/icons/terminal.svg" width="28" height="28" alt=""> **Using Codex or another MCP enabled tool?** Use NPX for Ruflo project setup and connect your client to the Ruflo MCP server. Run the setup wizard in your project terminal:

```bash
npx ruflo@latest init wizard
```

For clients that support local stdio MCP servers, configure **command** `npx` and **arguments** `["-y", "ruflo@latest", "mcp", "start"]`. The equivalent server command is:

```bash
npx -y ruflo@latest mcp start
```

MCP exposes Ruflo tools to your client. The console and mods above are Claude Code integrations; hook support depends on the client.

[Compare install paths](#quick-start) · [Open the console](#console-walkthrough) · [User guide](docs/USERGUIDE.md)

<div align="center">


### Optional: ruOS Desktop

<a href="https://ruos.cognitum.one"><img src="ruflo/assets/ruos-animated.svg" alt="ruOS — A desktop that runs itself" width="100%"></a>

**Connect ruOS to ChatGPT or Claude via MCP:**

```text
https://ruos.cognitum.one/mcp
```



<!-- RuVector promo -->
<a href="https://github.com/ruvnet/ruvector"><img src="docs/assets/readme/ruvector-promo-depth.svg" width="100%" alt="RuVector: Give your agents memory. Local vector search, persistent context, graph relationships and feedback learning. Explore RuVector."></a>

```bash
npx ruvector
```




# Ruflo

[English](README.md) · [简体中文](README.zh-CN.md)


[![RuFlo Explained — build an AI team that plans, remembers, tests, and improves](docs/assets/ruflo-explained/ch14.jpg)](docs/ruflo-explained.md)

**[📖 RuFlo Explained — Build an AI Team That Plans, Remembers, Tests, and Improves](docs/ruflo-explained.md)**
A 14-chapter guide: from the basic idea to a first useful task, then memory, agent teams, plugins, cost and verification.

</div>

> **Agent = Model + Harness.** The model writes; the harness gives it tools, memory, loops, sandboxes, and controls so it can actually work. **Ruflo is the harness** — the execution layer around Claude Code and Codex that adds 100+ specialized agents, coordinated swarms, self-learning memory, federated comms across machines, and enterprise security guardrails. So agents don't just run, they collaborate.

One `npx ruflo init` gives Claude Code a nervous system: agents self-organize into swarms, learn from every task, remember across sessions, and — with federation — securely talk to agents on other machines without leaking data. You keep writing code. Ruflo handles the coordination.

<p align="center"><img src="docs/assets/readme/learning-cinematic-compact.svg" width="100%" alt="Ruflo trajectory learning: branching memory paths, outcome feedback, contrastive AI and local learning. No LLM required for local vector retrieval and contrastive updates; agent execution may still use an LLM."></p>

<sub>Conceptual learning loop. Local vector retrieval and contrastive updates can run without an LLM; embeddings and configured learning modules are still required. See the <a href="v3/@claude-flow/cli/src/services/ruvector-training.ts">RuVector training integration</a> and <a href="v3/@claude-flow/neural/src/modes/balanced.ts">trajectory contrastive learning</a>.</sub>

<details>
<summary>Architecture in text</summary>

User → Ruflo (CLI/MCP) → Router → Swarm → Agents → Memory → LLM providers. Memory feeds useful experience back into routing. This is a conceptual flow, not a live execution trace.

</details>

> **New to Ruflo?** You don't need to learn 314 MCP tools or 26 CLI commands. After `init`, just use Claude Code normally — the hooks system automatically routes tasks, learns from successful patterns, and coordinates agents in the background.

<details>
<summary><strong>📖 Background — where the name comes from</strong></summary>

> Claude Flow is now Ruflo — named by [`rUv`](https://ruv.io), who loves Rust, flow states, and building things that feel inevitable. The "Ru" is the rUv. The "flo" is working until 3am. Underneath, powered by [`Cognitum.One`](https://cognitum.one/?RuFlo) agentic architecture, running a supercharged Rust-based AI engine, embeddings, memory, and plugin system.

</details>

---

<p align="center"><img src="docs/assets/readme/console.svg" alt="Mission control: inspect agent work" width="100%"></p>

<p align="center"><img src="docs/assets/ruflo-console-workflows.svg" width="952" height="964" alt="An animated recording of the ruflo console inside Claude Code: the boot (the neon sign and every area checked), then the Workflows page on a sample run: phases and agents with model, tokens and time; drilling from a run into one agent's activity, log and result; search; failure triage; cost; replay and compare; the control tab with a confirm card; and the mission autopilot panel"></p>

<img src="docs/assets/readme/console-icon-workflows.svg" width="28" height="28" alt=""> **Your agent cockpit.** Track workflows, agents, models, tokens and cost beside Claude Code. The animation shows startup checks and a **sample workflow**, not a live session.

<img src="docs/assets/readme/console-icon-inspect.svg" width="28" height="28" alt=""> **Inspect any run.** Open agent logs and results, search, triage failures, replay and compare. Start with `npx ruflo init`, restart Claude Code, then `/ruflo`. [Full console tour](docs/assets/ruflo-console-walkthrough-wide.gif).

<img src="docs/assets/readme/console-icon-control.svg" width="28" height="28" alt=""> **Let Claude drive. You set the limits.** Enable **Settings → Claude control** to navigate and run console actions. Choose `read`, `write`, `manage` or `full`, with `ask` or `auto` approval. The current default is **read + ask**; raising the level is your choice. Actions above your permission level are refused, and network, spending and destructive actions require confirmation even in `auto`. Review the live action log or press **Take back control** to stop Claude control. [Details](v3/docs/adr/ADR-444-claude-controls-the-console.md).

<a id="console-walkthrough"></a>

### One task: create a mission with Claude

<img src="docs/assets/readme/console-icon-workflows.svg" width="28" height="28" alt=""> **Watch the recorded console session below.** Claude creates a mission, opens the Learning and Security pages, and reports its actions in Overview.

1. **Set the boundary.** Install the console using the commands below, open `/ruflo`, then choose **Settings → Claude control → write + ask**.
2. **Give a concrete request.** Try: “Create a mission to add a dark mode toggle. Show me the mission and its status.”
3. **Approve creation.** Claude opens Missions and sets the goal. Confirm the pending create action in the console.
4. **Verify the result.** Check that Missions contains the goal and Overview records the action. Creating a mission does not mean the feature has been implemented.
5. **Keep control.** **Take back control** pauses Claude's console tools. A later call should be refused until you restore control.

**What the recording demonstrates:** a real Claude Haiku session with `write + auto`, mission creation, page navigation, a refused swarm stop, and control being taken back. The steps above use `ask` so you approve creation yourself. The separate workflow animation uses sample data; neither is evidence of completed swarm work or memory recall.

[Implementation and recorded test findings](v3/docs/adr/ADR-444-claude-controls-the-console.md) · [Reproduction script](plugins/ruflo-console/scripts/e2e-control.sh)

<p align="center"><img src="docs/assets/ruflo-console-claude-control.gif" alt="Claude Code with the ruflo console beside it: Claude sets a mission goal, creates the mission and opens the Learning, Security and Overview pages through the console tools; the Claude control dashboard logs each action; swarm-stop is refused because it needs the full level; the person clicks Take back control and the next request is refused"></p>


**Install the mods from the ruflo marketplace** (Claude Code 2.1.287 or later; mods run with your account's permissions and are not sandboxed, so read the code first):

```text
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-console@ruflo
/plugin install ruflo-mods@ruflo
/reload-plugins
```

`ruflo-console` is the cockpit above, `ruflo-mods` routes prompts and enforces policy in-process, `ruflo-swarm` shows the swarm in a pane, and `ruflo-ruos` adds the ruOS status segment. Open `/plugin` to confirm they appear in the active mods line. Inside the console, `/ruflo market` is the Plugin Catalog: every ruflo plugin, mod and skill with what it ships, and buttons to install, enable, disable and update (each asks first).

## Quick Start

<p align="center"><img src="docs/assets/readme/quick-start.svg" alt="Start building with Ruflo" width="100%"></p>

There are **two different install paths** with very different surface areas. Pick based on what you need (#1744):

| | **Claude Code Plugin** | **CLI install (`npx ruflo init`)** |
|---|---|---|
| What it gives you | Slash commands + a few skills + agent definitions per-plugin | Full Ruflo loop — 98 agents, 60+ commands, 30 skills, MCP server, hooks, daemon |
| Files in your workspace | **Zero** | `.claude/`, `.claude-flow/`, `CLAUDE.md`, helpers, settings |
| MCP server registered | Only if `ruflo-core` is installed (it ships its own `.mcp.json`) — most other plugins don't | Yes |
| Hooks installed | No | Yes |
| Best for | Try a single plugin's commands without committing to the full install | Production use — everything works as documented |

### Path A — Claude Code Plugins (lite, slash commands only)

```bash
# Add the marketplace
/plugin marketplace add ruvnet/ruflo

# Install core + any plugins you need
/plugin install ruflo-core@ruflo
/plugin install ruflo-swarm@ruflo
/plugin install ruflo-rag-memory@ruflo
/plugin install ruflo-neural-trader@ruflo
```

This adds slash commands and agent definitions. `ruflo-core` (installed above) does register its own MCP server on install — its tools are callable as `mcp__plugin_ruflo-core_ruflo__*` (e.g. `mcp__plugin_ruflo-core_ruflo__memory_store`), not the bare `memory_store`/`swarm_init`/`agent_spawn` names the CLI-track scaffold uses. Other plugins generally don't ship their own MCP server. For the full loop with the CLI-track tool names, use Path B below.

<details>
<summary><strong>🔌 All 35 plugins</strong></summary>

#### Core & Orchestration

| Plugin | What it does |
|--------|-------------|
| [**ruflo-core**](plugins/ruflo-core/README.md) | Foundation — server, health checks, plugin discovery |
| [**ruflo-swarm**](plugins/ruflo-swarm/README.md) | Coordinate multiple agents as a team |
| [**ruflo-autopilot**](plugins/ruflo-autopilot/README.md) | Let agents run autonomously in a loop |
| [**ruflo-loop-workers**](plugins/ruflo-loop-workers/README.md) | Schedule background tasks on a timer |
| [**ruflo-workflows**](plugins/ruflo-workflows/README.md) | Reusable multi-step task templates |
| [**ruflo-federation**](plugins/ruflo-federation/README.md) | Agents on different machines collaborate securely |

#### Memory & Knowledge

| Plugin | What it does |
|--------|-------------|
| [**ruflo-agentdb**](plugins/ruflo-agentdb/README.md) | Fast vector database for agent memory |
| [**ruflo-rag-memory**](plugins/ruflo-rag-memory/README.md) | Smart retrieval — hybrid search, graph hops, diversity ranking |
| [**ruflo-rvf**](plugins/ruflo-rvf/README.md) | Save and restore agent memory across sessions |
| [**ruflo-ruvector**](plugins/ruflo-ruvector/README.md) | [`ruvector`](https://npmjs.com/package/ruvector) — GPU-accelerated search, Graph RAG, 103 tools |
| [**ruflo-knowledge-graph**](plugins/ruflo-knowledge-graph/README.md) | Build and traverse entity relationship maps |

#### Intelligence & Learning

| Plugin | What it does |
|--------|-------------|
| [**ruflo-intelligence**](plugins/ruflo-intelligence/README.md) | Agents learn from past successes and get smarter |
| [**ruflo-graph-intelligence**](plugins/ruflo-graph-intelligence/) | Sublinear graph reasoning — PageRank, delta updates, complexity-aware execution (ADR-123) |
| [**ruflo-daa**](plugins/ruflo-daa/README.md) | Dynamic agent behavior and cognitive patterns |
| [**ruflo-ruvllm**](plugins/ruflo-ruvllm/README.md) | Run local LLMs (Ollama, etc.) with smart routing |
| [**ruflo-goals**](plugins/ruflo-goals/README.md) | Break big goals into plans and track progress |

#### Code Quality & Testing

| Plugin | What it does |
|--------|-------------|
| [**ruflo-testgen**](plugins/ruflo-testgen/README.md) | Find missing tests and generate them automatically |
| [**ruflo-browser**](plugins/ruflo-browser/README.md) | Automate browser testing with Playwright |
| [**ruflo-jujutsu**](plugins/ruflo-jujutsu/README.md) | Analyze git diffs, score risk, suggest reviewers |
| [**ruflo-docs**](plugins/ruflo-docs/README.md) | Generate and maintain documentation automatically |

#### Security & Compliance

| Plugin | What it does |
|--------|-------------|
| [**ruflo-security-audit**](plugins/ruflo-security-audit/README.md) | Scan for vulnerabilities and CVEs |
| [**ruflo-aidefence**](plugins/ruflo-aidefence/README.md) | Block prompt injection, detect PII, safety scanning |

#### Architecture & Methodology

| Plugin | What it does |
|--------|-------------|
| [**ruflo-adr**](plugins/ruflo-adr/README.md) | Track architecture decisions with a living record |
| [**ruflo-ddd**](plugins/ruflo-ddd/README.md) | Scaffold domain-driven design — contexts, aggregates, events |
| [**ruflo-sparc**](plugins/ruflo-sparc/README.md) | Guided 5-phase development methodology with quality gates |
| [**ruflo-metaharness**](plugins/ruflo-metaharness/README.md) | Grade your agent setup, scan tool configs for security risks, and track changes over time ([guide](docs/metaharness-user-guide.md)) |
| [**ruflo-arena**](plugins/ruflo-arena/README.md) | Competitive ruliology — pit agent strategies against each other in tournaments, hill-climb and co-evolve the winners (ADR-147/148) |

#### DevOps & Observability

| Plugin | What it does |
|--------|-------------|
| [**ruflo-migrations**](plugins/ruflo-migrations/README.md) | Manage database schema changes safely |
| [**ruflo-observability**](plugins/ruflo-observability/README.md) | Structured logs, traces, and metrics in one place |
| [**ruflo-cost-tracker**](plugins/ruflo-cost-tracker/README.md) | Track token usage, set budgets, get cost alerts |

#### Extensibility

| Plugin | What it does |
|--------|-------------|
| [**ruflo-agent**](plugins/ruflo-agent/README.md) | Run agents — local WASM sandbox (rvagent) + Anthropic Claude Managed Agents (cloud) |
| [**ruflo-plugin-creator**](plugins/ruflo-plugin-creator/README.md) | Scaffold, validate, and publish your own plugins |

#### Domain-Specific

| Plugin | What it does |
|--------|-------------|
| [**ruflo-iot-cognitum**](plugins/ruflo-iot-cognitum/README.md) | IoT device management — trust scoring, anomaly detection, fleets |
| [**ruflo-neural-trader**](plugins/ruflo-neural-trader/README.md) | [`neural-trader`](https://npmjs.com/package/neural-trader) — AI trading with 4 agents, backtesting, 112+ tools |
| [**ruflo-market-data**](plugins/ruflo-market-data/README.md) | Ingest market data, vectorize OHLCV, detect patterns |

</details>

### <img src="docs/assets/readme/icons/terminal.svg" width="28" height="28" alt=""> CLI Install

**macOS / Linux / WSL / Git-Bash:**

```bash
# One-line install (POSIX shells only — see Windows note below)
curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/ruflo@main/scripts/install.sh | bash
```

**All platforms (including native Windows PowerShell / cmd):**

```bash
# Interactive setup wizard — runs identically on every platform
npx ruflo@latest init wizard

# Quick non-interactive init
# npx ruflo@latest init

# Or install globally
npm install -g ruflo@latest
```

> 💡 **Windows users:** the `curl ... | bash` form needs a POSIX shell (Git-Bash, WSL, MSYS). The `npx ruflo@latest init wizard` line works natively in PowerShell and cmd. If you hit an `'bash' is not recognized` error, use the `npx` line instead — both end up running the same init flow.

### <img src="docs/assets/readme/icons/network.svg" width="28" height="28" alt=""> MCP Server

```bash
# Add Ruflo as an MCP server in Claude Code
claude mcp add claude-flow -- npx ruflo@latest mcp start
```

---

## What You Get

<p align="center"><img src="docs/assets/readme/capabilities.svg" alt="Your agent toolkit" width="100%"></p>

<table>
<tr><td width="50%"><a href="plugins/ruflo-swarm/README.md"><img src="docs/assets/readme/card-swarm.svg" width="100%" alt="Agent teams"></a></td><td width="50%"><a href="plugins/ruflo-rag-memory/README.md"><img src="docs/assets/readme/card-memory.svg" width="100%" alt="Persistent memory"></a></td></tr>
<tr><td width="50%"><a href="plugins/ruflo-intelligence/README.md"><img src="docs/assets/readme/card-learning.svg" width="100%" alt="Learning loops"></a></td><td width="50%"><a href="plugins/ruflo-security-audit/README.md"><img src="docs/assets/readme/card-security.svg" width="100%" alt="Security controls"></a></td></tr>
<tr><td width="50%"><a href="https://ruvnet.github.io/ruflo"><img src="docs/assets/readme/card-plugins.svg" width="100%" alt="Plugin marketplace"></a></td><td width="50%"><a href="plugins/ruflo-ruvllm/README.md"><img src="docs/assets/readme/card-routing.svg" width="100%" alt="Models and routing"></a></td></tr>
</table>

| Capability | Description |
|------------|-------------|
| <img src="docs/assets/readme/icons/agents.svg" width="28" height="28" alt=""> **100+ Agents** | Specialized agents for coding, testing, security, docs, architecture |
| <img src="docs/assets/readme/icons/network.svg" width="28" height="28" alt=""> **Comms Layer** | Zero-trust federation — agents across machines/orgs discover, authenticate, and exchange work securely |
| <img src="docs/assets/readme/icons/swarm.svg" width="28" height="28" alt=""> **Swarm Coordination** | Hierarchical, mesh, and adaptive topologies with consensus |
| <img src="docs/assets/readme/icons/learning.svg" width="28" height="28" alt=""> **Self-Learning** | SONA neural patterns, ReasoningBank, trajectory learning |
| <img src="docs/assets/readme/icons/memory.svg" width="28" height="28" alt=""> **Vector Memory** | HNSW-indexed AgentDB — measured ~1.9x faster at N=20k, ~3.2x–4.7x at N=5k vs brute force (recall@10 ~0.99); ANN wins above the crossover, ties/loses at small N. See [audit](docs/reviews/intelligence-system-audit-2026-05-29.md) + [`scripts/benchmark-intelligence.mjs`](scripts/benchmark-intelligence.mjs) |
| <img src="docs/assets/readme/icons/workers.svg" width="28" height="28" alt=""> **Background Workers** | 12 auto-triggered workers (audit, optimize, testgaps, etc.) |
| <img src="docs/assets/readme/icons/plugins.svg" width="28" height="28" alt=""> **Plugin Marketplace** | 33 native Claude Code plugins + 21 npm plugins |
| <img src="docs/assets/readme/icons/routing.svg" width="28" height="28" alt=""> **Multi-Provider** | Claude, GPT, Gemini, Cohere, Ollama with smart routing |
| <img src="docs/assets/readme/icons/security.svg" width="28" height="28" alt=""> **Security** | AIDefence, input validation, CVE remediation, path traversal prevention |
| <img src="docs/assets/readme/icons/federation.svg" width="28" height="28" alt=""> **Agent Federation** | Cross-installation agent collaboration with zero-trust security |
| <img src="docs/assets/readme/icons/audit.svg" width="28" height="28" alt=""> **[MetaHarness](docs/metaharness-user-guide.md)** | Audit your AI agent setup before you ship. Grade readiness (1-100), scan tool configs for security issues, snapshot the whole project to catch regressions over time, and find templates that match your repo. `ruflo eject` turns a ruflo project into a standalone agent toolkit with its own name. [Full guide](docs/metaharness-user-guide.md). |

### <img src="docs/assets/readme/icons/learning.svg" width="28" height="28" alt=""> Learning from experience

<p align="center"><img src="docs/assets/readme/learning-flow.svg" width="100%" alt="Recall, execute, evaluate, store, adapt and reuse: an illustrative agent learning cycle."></p>

Useful trajectories and task feedback can inform future work. Results depend on the configured memory, learning components and quality of feedback. [Learning plugin](plugins/ruflo-intelligence/README.md).

### Agent Federation — Slack for Agents

<p align="center"><img src="docs/assets/readme/federation.svg" alt="Connected intelligence across machines" width="100%"></p>

<p align="center"><img src="docs/assets/readme/federation-flow.svg" width="100%" alt="Outbound agent, data filtering, signing and encryption, identity verification, input checks and receiving agent."></p>

Slack gave teams channels. Federation gives agents the same thing — **shared workspaces across trust boundaries**, where agents on different machines, orgs, or cloud regions can discover each other, prove who they are, and collaborate on tasks.

The difference: some channels are trusted, some aren't. [`@claude-flow/plugin-agent-federation`](https://github.com/ruvnet/ruflo/issues/1669) handles that automatically. Your agents join a federation, get verified via mTLS + ed25519, and start exchanging work — with PII stripped before anything leaves your node and every message auditable. Untrusted agents can still participate at lower privilege: they see discovery info, not your memory. As they prove reliable, trust upgrades. If they misbehave, they get downgraded instantly — no human in the loop required.

You don't configure handshakes or manage certificates. You `federation init`, `federation join`, and your agents start talking. The protocol handles identity, the PII pipeline handles data safety, and the audit trail handles compliance.

> **📘 Full user guide:** [`docs/federation/`](./docs/federation/) — setup, MCP tools, trust levels, circuit breaker, and the (opt-in) WireGuard mesh layer that ties packet-layer reachability to federation trust. ADR-111 deep-dive at [`docs/federation/phase7-mesh-bringup.md`](./docs/federation/phase7-mesh-bringup.md).

<details>
<summary><strong>Federation capabilities</strong></summary>

| | Capability | How it works |
|---|---|---|
| 🔒 | **Zero-trust federation** | Remote agents start untrusted. Identity proven via mTLS + ed25519 challenge-response. No API keys, no shared secrets. |
| 🛡️ | **PII-gated data flow** | 14-type detection pipeline scans every outbound message. Per-trust-level policies: BLOCK, REDACT, HASH, or PASS. Adaptive calibration reduces false positives. |
| 📊 | **Behavioral trust scoring** | Formula (`0.4×success + 0.2×uptime + 0.2×threat + 0.2×integrity`) continuously evaluates peers. Upgrades require history; downgrades are instant. |
| 📋 | **Compliance built-in** | HIPAA, SOC2, GDPR audit trails as compliance modes. Every federation event produces a structured record searchable via HNSW. |
| 🤝 | **9 MCP tools + 10 CLI commands** | Full lifecycle: `federation_init`, `federation_send`, `federation_trust`, `federation_audit`, and more. |

</details>

<details>
<summary><strong>Example: two teams sharing fraud signals without sharing customer data</strong></summary>

```bash
# Team A: initialize federation and generate keypair
npx claude-flow@latest federation init

# Team A: join Team B's federation endpoint
npx claude-flow@latest federation join wss://team-b.example.com:8443

# Team A: send a task — PII is stripped automatically before it leaves
npx claude-flow@latest federation send --to team-b --type task-request \
  --message "Analyze transaction patterns for account anomalies"

# Team A: check peer trust levels and session health
npx claude-flow@latest federation status
```

</details>

See [issue #1669](https://github.com/ruvnet/ruflo/issues/1669) for the complete architecture, trust model, and implementation roadmap.

```bash
# Claude Code plugin
/plugin install ruflo-federation@ruflo

# Or via CLI
npx claude-flow@latest plugins install @claude-flow/plugin-agent-federation
```

<details>
<summary><strong>Claude Code: With vs Without Ruflo</strong></summary>

| Capability | Claude Code Alone | + Ruflo |
|------------|-------------------|---------|
| Agent Collaboration | Isolated, no shared context | Swarms with shared memory and consensus |
| Coordination | Manual orchestration | Queen-led hierarchy (Raft, Byzantine, Gossip) |
| Memory | Session-only | HNSW vector memory with sub-ms retrieval |
| Learning | Static behavior | SONA self-learning with pattern matching |
| Task Routing | You decide | Intelligent routing (89% accuracy) |
| Background Workers | None | 12 auto-triggered workers |
| LLM Providers | Anthropic only | 5 providers with failover |
| Security | Standard | CVE-hardened with AIDefence |

</details>

<details>
<summary><strong>Architecture overview</strong></summary>

```
User --> Claude Code / CLI
          |
          v
    Orchestration Layer
    (MCP Server, Router, 27 Hooks)
          |
          v
    Swarm Coordination
    (Queen, Topology, Consensus)
          |
          v
    100+ Specialized Agents
    (coder, tester, reviewer, architect, security...)
          |
          v
    Memory & Learning
    (AgentDB, HNSW, SONA, ReasoningBank)
          |
          v
    LLM Providers
    (Claude, GPT, Gemini, Cohere, Ollama)
```

</details>

---

## Documentation

<p align="center"><img src="docs/assets/readme/documentation.svg" alt="Guides, architecture and verification" width="100%"></p>

Four docs for four audiences:

| Doc | When to read it |
|-----|-----------------|
| **[Status](docs/STATUS.md)** | See what currently works — capability counts, test baselines, recent fixes, what's next. The *is-it-ready* doc. |
| **[User Guide](docs/USERGUIDE.md)** | Daily reference — every command, every config flag, every plugin. The *how-do-I* doc. |
| **[MetaHarness Guide](docs/metaharness-user-guide.md)** | How to grade your agent setup, scan tool configs for security, detect changes between runs, and eject a project into a standalone agent toolkit. The *audit-my-setup* doc. |
| **[Benchmarks](https://gist.github.com/ruvnet/298f8c668c8859b369f91734a0e9cbbe)** | v3.8.0 SOTA matrix vs LangGraph / AutoGen / CrewAI on darwin-arm64 + linux-x64. ruflo wins cold start, single turn, RSS by 1.3×–1953×. The *is-it-fast* doc. |
| **[Verification](verification.md)** | Cryptographically prove your installed bytes match the signed witness — `ruflo verify`. The *trust-but-verify* doc. |
| **[Team Gateway Checklist](docs/TEAM-GATEWAY-CHECKLIST.md)** | Before-merge gates, dual-mode handoff, memory namespace sharing, and witness manifest entry per merge. The *safer-team-workflows* doc. |

Benchmark internals (for reproduction): [`sota-workload-spec.md`](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-workload-spec.md) · [`SOTA-PROGRESS.md`](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/SOTA-PROGRESS.md) · [raw matrix JSON: darwin](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-matrix.json) · [linux](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-matrix-linux.json)

User Guide section index:

| Section | Topics |
|---------|--------|
| [Quick Start](docs/USERGUIDE.md#quick-start) | Installation, prerequisites, install profiles |
| [Core Features](docs/USERGUIDE.md#-core-features) | MCP tools, agents, memory, neural learning |
| [Intelligence & Learning](docs/USERGUIDE.md#-intelligence--learning) | Hooks, workers, SONA, model routing |
| [Swarm & Coordination](docs/USERGUIDE.md#-swarm--coordination) | Topologies, consensus, hive mind |
| [Security](docs/USERGUIDE.md#%EF%B8%8F-security) | AIDefence, CVE remediation, validation |
| [Ecosystem](docs/USERGUIDE.md#-ecosystem--integrations) | RuVector, agentic-flow, Flow Nexus |
| [Configuration](docs/USERGUIDE.md#%EF%B8%8F-configuration--reference) | Environment variables, config schema |
| [Plugin Marketplace](https://ruvnet.github.io/ruflo) | Browse and install plugins |

---

## Support

<p align="center"><img src="docs/assets/readme/support.svg" alt="Build with the Ruflo community" width="100%"></p>

| Resource | Link |
|----------|------|
| Documentation | [User Guide](docs/USERGUIDE.md) |
| Issues & Bugs | [GitHub Issues](https://github.com/ruvnet/claude-flow/issues) |
| Enterprise | [ruv.io](https://ruv.io) |
| Community | [Agentics Foundation Discord](https://discord.com/invite/dfxmpwkG2D) |
| Powered by | [Cognitum.one](https://cognitum.one) |

<p align="center"><img src="docs/assets/readme/signal-divider.svg" alt="Ruflo" width="100%"></p>

## License

MIT - [RuvNet](https://github.com/ruvnet)

<a href="https://cognitum.one"><img src="docs/assets/readme/cognitum-banner-v2.svg" width="100%" alt="Cognitum One: Ambient Intelligence at the edge of the Physical World. Explore cognitum.one."></a>
