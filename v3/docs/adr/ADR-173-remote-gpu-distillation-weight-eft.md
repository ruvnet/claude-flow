# ADR-173: Remote GPU Distillation via weight-eft over SSH (Dry-Run-Default, Spend-Gated)

**ID**: ADR-173
**Status**: Proposed — implemented on `feat/agenticow-integration` (ships in 3.21.0)
**Date**: 2026-07-04
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-171 (Provenance-tiered oracle — supplies the gold labels this pipeline trains on)
- ADR-172 (Fable harness — the Tier-2 judge that may label data fed here)
- ADR-143 / ADR-026 (Model routing cost tiers — a distilled cheap-tier adapter is what reduces escalation)
- ADR-166 (MCP bridge RCE remediation — the "no implicit remote execution / secure-by-default" discipline reused here)

---

## 1. Context

`@metaharness/weight-eft@0.1.1` turns an agent's run archive into portable LoRA training data (SFT + DPO JSONL) with contamination / reward-hacking / long-context guards — all $0, offline. Its *value proposition* is closing the cost flywheel: fine-tune a cheap **open-weights** model (GLM/Qwen/DeepSeek) on successful runs so the cascade escalates to frontier models less often.

But the flywheel did not close, for reasons verified end-to-end:
- weight-eft's own `train` emits the `ruvllm microlora` command string and **deliberately never spawns it** (no GPU job, no paid call — by design).
- ruflo's native LoRA (ADR: 3.19.0 flywheel) is a *different* LoRA — 384-dim router-embedding pattern-alignment, not the 7-14B causal-LM attention-projection LoRA weight-eft targets. They do not plug into each other.
- It only makes sense with an open-weights cheap tier (you cannot LoRA Anthropic Haiku) — which ruflo's OpenRouter path provides.

The unlock: a real GPU host — `ruvultra` on tailscale (Linux, SSH open, no HTTP inference port). The tune can run there over SSH.

## 2. Decision

Ship `ruflo neural distill export | plan | eval | train`, where `train --remote <host>` constructs an SSH-based tune on a user-supplied GPU host — **but every spending / executing path is off by default and explicitly gated.**

### 2.1 The $0 spine (always available)
- `export` — captured run records → DarwinTrajectory[] → weight-eft SFT/DPO JSONL + guard report. $0, offline.
- `plan` — print the `ruvllm microlora` GPU training plan. $0 dry-run.
- `eval` — cost-Pareto delta between two cascade outcome sets. $0.

### 2.2 Remote train (opt-in, dry-run default)
`train --remote <host> [--base <model>]`:
1. rsync the JSONL to the host, run `ruvllm microlora sft && dpo` over SSH, fetch the adapter back.
2. **DRY-RUN by default**: print the exact ssh/rsync/ruvllm commands + a preflight probe (ssh reachable? `ruvllm --version` / nvidia-smi on remote, wrapped so failure is reported not fatal). No data leaves the machine, no compute runs.
3. Real execution requires **both** `--execute` **and** `--yes` (or an interactive confirm). Even then the command preview is shown first.
4. Host is **parameterized** (`--remote` / `RUFLO_DISTILL_REMOTE`) — never hard-coded. `ruvultra` / its IP appear in *no* source file; it is the user's infra, passed at runtime.

### 2.3 Honesty rule (hard)
No command, help text, or doc claims ruflo "trains a model" or "reduces escalation" as a $0/local capability. It is: export audited training data + measure the cost-Pareto + print the plan, and — as an explicit, user-triggered, remote-GPU, spend-gated step — run the tune. The residual gaps are stated plainly: (a) resolved-gold is Tier-graded (ADR-171), so SFT quality is only as good as its provenance; (b) a real adapter must clear a hand-verified holdout before it is trusted in routing.

## 3. Consequences

- The flywheel is *buildable and user-triggerable*, not falsely "done." The $0 spine ships as a real capability; the tune is one `--execute --yes` away once the user confirms the box has the GPU toolchain and accepts the spend.
- Attack surface (SSH, remote exec) is added **last** in the merge order and reviewed adversarially: no implicit remote execution, command preview mandatory, no env-secret logging (ADR-166 discipline).
- Distilled adapters target the OpenRouter open-weights cheap tier — the escalation-reduction path is real *if* a tune runs and eval confirms it on held-out data.

## 4. Alternatives rejected

- **Spawn weight-eft's train directly / claim the flywheel is done**: it never spawns; that would be a false capability claim. Rejected.
- **Reuse ruflo's 384-dim native LoRA**: wrong LoRA (router-embedding, not causal-LM). Rejected.
- **Auto-run the tune when a host is reachable**: silent spend + remote execution on user infra. Rejected — dry-run default, double-flag gate.
- **Hard-code ruvultra**: it is user infra; parameterized only. Rejected.
