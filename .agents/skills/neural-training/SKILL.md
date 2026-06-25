---
name: neural-training
description: >
  Neural pattern training with SONA (Self-Optimizing Neural Architecture), MoE (Mixture of Experts), and EWC++ for knowledge consolidation.
  Use when: pattern learning, model optimization, knowledge transfer, adaptive routing.
  Skip when: simple tasks, no learning required, one-off operations.
---

# Neural Training Skill

## Purpose
Train and optimize neural patterns using SONA, MoE, and EWC++ systems.

## When to Trigger
- Training new patterns
- Optimizing agent routing
- Knowledge consolidation
- Pattern recognition tasks

## Intelligence Pipeline

1. **RETRIEVE** — Fetch relevant patterns via HNSW (150x-12,500x faster)
2. **JUDGE** — Evaluate with verdicts (success/failure)
3. **DISTILL** — Extract key learnings via LoRA
4. **CONSOLIDATE** — Prevent catastrophic forgetting via EWC++

## Components

| Component | Purpose | Performance |
|-----------|---------|-------------|
| SONA | Self-optimizing adaptation | <0.05ms |
| MoE | Expert routing | 8 experts |
| HNSW | Pattern search | 150x-12,500x |
| EWC++ | Prevent forgetting | Continuous |
| Flash Attention | Speed | 2.49x-7.47x |

## Commands

### Train Patterns
```bash
npx claude-flow neural train --model-type moe --epochs 10
```

### Check Status
```bash
npx claude-flow neural status
```

### View Patterns
```bash
npx claude-flow neural patterns --type all
```

### Predict
```bash
npx claude-flow neural predict --input "task description"
```

### Optimize
```bash
npx claude-flow neural optimize --target latency
```

## Best Practices
1. Use pretrain hook for batch learning
2. Store successful patterns after completion
3. Consolidate regularly to prevent forgetting
4. Route based on task complexity
