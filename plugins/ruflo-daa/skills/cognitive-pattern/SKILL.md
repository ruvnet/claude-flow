---
name: cognitive-pattern
description: Define and manage cognitive patterns for agent reasoning and decision-making
argument-hint: "<pattern-name>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__daa_cognitive_pattern mcp__plugin_ruflo-core_ruflo__daa_workflow_create mcp__plugin_ruflo-core_ruflo__daa_workflow_execute mcp__plugin_ruflo-core_ruflo__daa_knowledge_share mcp__plugin_ruflo-core_ruflo__daa_learning_status Bash
---

# Cognitive Pattern

Define cognitive patterns that guide agent reasoning and decision-making.

## When to use

When you want to codify reasoning strategies, decision trees, or problem-solving approaches that agents can use and improve over time.

## Steps

1. **Define pattern** — call `mcp__plugin_ruflo-core_ruflo__daa_cognitive_pattern` with the pattern structure and triggers
2. **Create workflow** — call `mcp__plugin_ruflo-core_ruflo__daa_workflow_create` to embed the pattern in an executable workflow
3. **Execute** — call `mcp__plugin_ruflo-core_ruflo__daa_workflow_execute` to run the cognitive workflow
4. **Evaluate** — call `mcp__plugin_ruflo-core_ruflo__daa_learning_status` to see how the pattern performs
5. **Share** — call `mcp__plugin_ruflo-core_ruflo__daa_knowledge_share` to propagate successful patterns

## Pattern types

- **Decision trees** — structured if/then reasoning
- **Chain of thought** — step-by-step problem decomposition
- **Analogy mapping** — solve new problems by referencing similar solved ones
- **Consensus patterns** — multi-perspective evaluation before deciding
