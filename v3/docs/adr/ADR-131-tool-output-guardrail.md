# ADR-131: ToolOutputGuardrail — semantic screening at the content boundary

**Status**: Accepted
**Date**: 2026-05-26
**Issue**: [ruvnet/ruflo#2149](https://github.com/ruvnet/ruflo/issues/2149)
**Related**: OWASP Top 10 for Agentic Applications 2026 ASI01 (Goal Hijacking)

## Context

Ruflo's `@claude-flow/security` package has strong transport- and boundary-level controls:

| Control | Component |
|---|---|
| Input validation at HTTP/CLI ingress | `InputValidator` (Zod) |
| Path traversal prevention | `PathValidator` |
| Command injection prevention | `SafeExecutor` |
| Password hashing | `PasswordHasher` (bcrypt) |
| Token generation | `TokenGenerator` |
| Inter-agent trust | Claims (ADR-101), federation TLS (ADR-107) |

**Gap**: zero semantic screening of content returned by MCP tool calls, memory reads, or external API responses *before* that content enters agent reasoning. An attacker who influences any retrieved content (web page, document, memory entry) can embed instructions that the LLM will execute, since it cannot reliably distinguish data from instructions.

OWASP ASI01 — Agent Goal Hijacking — ranks this as the **#1 risk** in the 2026 agentic-applications top-10. A Jan 2026 systematic review of 78 studies (arXiv:2601.17548) reports adaptive attacks achieve **>85% bypass rates** against current SOTA defences. System-level per-boundary guardrails are the only defence category with sub-millisecond latency and no model dependency — and the only one practical to apply at every tool boundary.

OpenAI Agents SDK (March 2025) is the current best-in-class reference: parallel-execution guardrails at every tool invocation with no critical-path latency penalty.

## Decision

Introduce `ToolOutputGuardrail` in `@claude-flow/security` — a pure, synchronous, pattern-based screener for content crossing the agent's content boundary. It does **not** alter the agent's running prompt; it returns a finding result the caller uses to decide policy (`allow` / `flag` / `redact` / `reject`).

### Shape

```ts
new ToolOutputGuardrail({
  policy: {            // optional — defaults shown
    low: 'allow',
    medium: 'flag',
    high: 'redact',
    critical: 'reject',
  },
  customPatterns: [...], // optional domain-specific
  maxScanBytes: 1 << 20, // 1 MiB cap; truncation reported at medium
}).scanAndEnforce(content);
// → { content: string; result: GuardrailResult; action: GuardrailAction }
```

### Detection categories (built-in)

| Category | Severity | Examples |
|---|---|---|
| `instruction-override` | critical/high | "ignore previous instructions", "new directives:" |
| `embedded-system` | critical/high | ChatML frames (`<|im_start|>`), Llama `[INST]`, `<system>` tags |
| `exfiltration` | critical | "send the api key to …", "leak credentials to …" |
| `role-hijack` | high/medium | "you are now a …", "act as …" |
| `jailbreak` | high | DAN mode, developer mode, "do anything now" |
| `hidden-unicode` | high/low | bidi overrides, zero-width chars |
| `tool-spoofing` | medium | `tool_call:` / `function_call:` shaped payloads |
| `truncation` | medium | content > `maxScanBytes` (the tail isn't scanned) |

Pattern set is intentionally conservative — it targets the explicit shapes that show up in published indirect-injection corpora rather than general "suspicious-looking" text. False-positive rate is bounded by pattern specificity; tune via `customPatterns` and `policy`.

### Integration plan (phased — Phase 1 is this PR)

| Phase | Scope | Where |
|---|---|---|
| **P1** (this PR) | Class + tests + exports; OWASP mapping doc | `@claude-flow/security/src/tool-output-guardrail.ts` |
| P2 | MCP tool result boundary | `@claude-flow/cli/src/mcp-tools/*` dispatch layer |
| P3 | Memory read path | `@claude-flow/cli/src/memory/*` retrieve functions |
| P4 | Raft consensus payload validator (swarm-layer ASI01) | hive-mind proposal pipeline |
| P5 | Per-tool policy overrides + structured telemetry | hooks system |

P2–P5 are tracked separately so the class can ship + be exercised by callers (third-party plugins, integration tests) before deeper wiring.

## Alternatives considered

**Model-based classifier at each boundary.** Higher recall at the cost of: per-call latency in the 50-500 ms range, model dependency, and a moving false-positive rate. Rejected for the hot path; remains an option as an out-of-band reviewer in a future ADR.

**LLM "instruction tag" wrapper.** Wrap tool output in `<tool-output>…</tool-output>` and instruct the model to ignore instructions inside. Empirically defeated by ≥85% of adaptive attacks (arXiv:2601.17548). Not a replacement for the boundary screener.

**HITL checkpoint per tool call** (LangGraph's posture). Adds round-trip latency and shifts the burden to humans. Useful as a fallback for `critical` findings; not viable as the primary defence.

## Consequences

**Positive**:
- Closes the ASI01 gap at the content boundary with zero model dependency
- Pure-function shape — safe to invoke in every MCP tool result and memory read
- Pattern set is publicly documented and tunable per-deployment
- Decoupled from the agent's running prompt — no prompt-engineering risk

**Negative / risks**:
- Pattern-based detection has known bypasses (encoding, obfuscation, novel phrasings). Not a substitute for least-privilege tool design.
- Defaults assume English-language attacks; non-English patterns need `customPatterns`.
- A `reject` finding drops tool output entirely — callers must surface the rejection to the agent rather than silently substituting empty content.

**Telemetry / observability**:
- Each `flag`/`redact`/`reject` event SHOULD be logged with `pattern`, `severity`, `category`, and source (tool name or memory namespace).
- Findings count by category is a useful adoption + drift metric for the security dashboard.

## Validation

Implementation in this PR:
- `v3/@claude-flow/security/src/tool-output-guardrail.ts` (~300 LOC)
- `v3/@claude-flow/security/__tests__/tool-output-guardrail.test.ts` — 24 tests, 9 ms total
- Public exports added to `@claude-flow/security/index.ts`
- OWASP mapping: `v3/docs/security/owasp-agents-2026-mapping.md`

Out of scope (tracked in follow-on issues):
- Integration into MCP tool dispatch (P2)
- Integration into memory read path (P3)
- Swarm consensus payload validator (P4)
- Structured telemetry + dashboard panel (P5)
