---
name: cost-local
description: Cost per million tokens on hardware you own (Ollama, llama.cpp, vLLM, LM Studio) from watts, electricity price, hardware price and measured tokens/second, and the utilisation at which local beats a hosted model. Use for local-vs-API break-even questions.
argument-hint: "--tok-per-s <n> [--busy 0.25] [--compare <model>] [--format json|markdown]"
allowed-tools: Bash
---

# Cost Local

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/local-cost.mjs --tok-per-s 80 --busy 0.25 --compare claude-haiku-4-5
```

Inputs (all the user's): `--watts-idle`, `--watts-active`, `--kwh`, `--hw-price`, `--life-years`, `--resale`. `--tok-per-s` is required and must be a **measured** generation speed.

## Rules

- Cost = **fixed** (amortisation + idle power, paid busy or not) + **marginal** (extra watts while generating). Utilisation decides the answer: always show the table at 5/25/50/100% busy.
- It is an estimate from the inputs; say so. Nothing is measured.
- Compare against a same-capability hosted model, not a frontier one; price alone is a poor reason to buy a GPU for sporadic use.
- Read real counts from the server (Ollama `eval_count`/`prompt_eval_count` on the native API, llama.cpp `timings`, vLLM `/metrics`), not the lossy OpenAI-compatible `usage`, and count model reloads (`load_duration`) as overhead.
