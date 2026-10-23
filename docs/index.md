---
layout: default
title: RuFlo Marketplace
description: Claude Code native agents, swarms, workers, and MCP tools for continuous software engineering
---

# RuFlo Marketplace

**Installable agentic workflows for Claude Code -- not just commands.**

RuFlo provides native Claude Code plugins for multi-agent orchestration, /loop workers, security auditing, memory-powered RAG, and test generation.

## Quick Install

```bash
# Add the marketplace
/plugin marketplace add ruvnet/ruflo

# Install plugins
/plugin install ruflo-core@ruflo
/plugin install ruflo-swarm@ruflo
/plugin install ruflo-loop-workers@ruflo
```

## Plugins

| Plugin | Description | Install |
|--------|-------------|---------|
| **ruflo-core** | MCP server, base commands, project config | `/plugin install ruflo-core@ruflo` |
| **ruflo-swarm** | Teams, agents, Monitor streams, worktree isolation | `/plugin install ruflo-swarm@ruflo` |
| **ruflo-loop-workers** | /loop workers, CronCreate, cache-aware scheduling | `/plugin install ruflo-loop-workers@ruflo` |
| **ruflo-security-audit** | Security review, dependency checks, policy gates | `/plugin install ruflo-security-audit@ruflo` |
| **ruflo-rag-memory** | RuVector memory, HNSW search, AgentDB | `/plugin install ruflo-rag-memory@ruflo` |
| **ruflo-testgen** | Test gap detection, coverage analysis, TDD workflow | `/plugin install ruflo-testgen@ruflo` |
| **ruflo-docs** | Doc generation, drift detection, API docs | `/plugin install ruflo-docs@ruflo` |
| **ruflo-autopilot** | Autonomous /loop completion, learning, prediction | `/plugin install ruflo-autopilot@ruflo` |
| **ruflo-intelligence** | Self-learning SONA patterns, trajectory learning, routing | `/plugin install ruflo-intelligence@ruflo` |
| **ruflo-agentdb** | AgentDB controllers, HNSW vector search, RuVector | `/plugin install ruflo-agentdb@ruflo` |
| **ruflo-aidefence** | AI safety scanning, PII detection, prompt defense | `/plugin install ruflo-aidefence@ruflo` |
| **ruflo-browser** | Playwright browser automation, testing, scraping | `/plugin install ruflo-browser@ruflo` |
| **ruflo-jujutsu** | Git diff analysis, risk scoring, reviewer recs | `/plugin install ruflo-jujutsu@ruflo` |
| **ruflo-agent** | Sandboxed WASM agents and gallery sharing | `/plugin install ruflo-agent@ruflo` |
| **ruflo-workflows** | Workflow templates, orchestration, lifecycle | `/plugin install ruflo-workflows@ruflo` |
| **ruflo-daa** | Dynamic Agentic Architecture, cognitive patterns | `/plugin install ruflo-daa@ruflo` |
| **ruflo-ruvllm** | Local LLM inference, MicroLoRA, chat formatting | `/plugin install ruflo-ruvllm@ruflo` |
| **ruflo-rvf** | RVF portable memory, session persistence | `/plugin install ruflo-rvf@ruflo` |
| **ruflo-plugin-creator** | Scaffold, validate, publish new plugins | `/plugin install ruflo-plugin-creator@ruflo` |

## How It Works

RuFlo plugins extend Claude Code with:
- **Skills** -- Teach Claude Code new workflows (swarm init, /loop workers, security scans)
- **Commands** -- Slash commands for common operations (/status, /audit, /memory)
- **Agents** -- Specialized agent definitions (coder, reviewer, architect, security-auditor)
- **MCP Server** -- 314 tools for coordination, memory, neural learning, and more

## Claude Code Native Integration

RuFlo plugins use Claude Code's native capabilities when available:

| Feature | Plugin | Claude Code Native |
|---------|--------|--------------------|
| Periodic workers | ruflo-loop-workers | `/loop` + `ScheduleWakeup` |
| Live monitoring | ruflo-swarm | `Monitor` tool |
| Background jobs | ruflo-loop-workers | `CronCreate` |
| Agent isolation | ruflo-swarm | `isolation: "worktree"` |
| Multi-agent comms | ruflo-swarm | `TeamCreate` + `SendMessage` |
| Cross-session | ruflo-core | `PushNotification` + `RemoteTrigger` |
| Autonomous loops | ruflo-autopilot | `/loop` + `ScheduleWakeup` + autopilot MCP |

## Trust & Security

- All plugins are open source -- review before installing
- MCP servers run locally, no data leaves your machine
- Plugins declare required permissions in their manifest
- Pin versions for production use: `/plugin install ruflo-core@0.1.0@ruflo`
- Security scanning available via ruflo-security-audit
- Cryptographically-signed [witness manifest](../verification/README.md) attests every documented fix; see [Validation System](validation/) for the three-layer regression-protection stack

## Links

- [GitHub Repository](https://github.com/ruvnet/ruflo)
- [npm Packages](https://www.npmjs.com/package/@claude-flow/cli)
- [ADR-091: Native Integration](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-091-loop-monitor-native-integration.md)
- [Issues & Support](https://github.com/ruvnet/ruflo/issues)
