---
name: daa-agent
description: Create and adapt Dynamic Agentic Architecture agents that learn and evolve
argument-hint: "<create|adapt|status> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__daa_agent_create mcp__plugin_ruflo-core_ruflo__daa_agent_adapt mcp__plugin_ruflo-core_ruflo__daa_learning_status mcp__plugin_ruflo-core_ruflo__daa_performance_metrics mcp__plugin_ruflo-core_ruflo__daa_knowledge_share Bash
---

# DAA Agent

Create agents with Dynamic Agentic Architecture that adapt and learn over time.

## When to use

When you need agents that go beyond static configurations — agents that adapt their behavior based on performance metrics, learn from interactions, and share knowledge with other agents.

## Steps

1. **Create agent** — call `mcp__plugin_ruflo-core_ruflo__daa_agent_create` with initial configuration and learning parameters
2. **Monitor learning** — call `mcp__plugin_ruflo-core_ruflo__daa_learning_status` to see adaptation progress
3. **Check performance** — call `mcp__plugin_ruflo-core_ruflo__daa_performance_metrics` for efficiency and accuracy metrics
4. **Adapt** — call `mcp__plugin_ruflo-core_ruflo__daa_agent_adapt` to trigger manual adaptation based on feedback
5. **Share knowledge** — call `mcp__plugin_ruflo-core_ruflo__daa_knowledge_share` to propagate learnings to other agents

## DAA vs static agents

| Aspect | Static Agent | DAA Agent |
|--------|-------------|-----------|
| Behavior | Fixed configuration | Adapts over time |
| Learning | None | Continuous from interactions |
| Knowledge | Isolated | Shared across agents |
| Performance | Constant | Improves with use |
