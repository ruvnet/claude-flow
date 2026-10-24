# Security SOTA Report — 2026-08-11

**TL;DR:** Adversarial cross-skill composition (ColluSkill, Grade A, arXiv:2608.09732, Aug 2026) achieves 96.0% attack-success rate against per-component MCP scanners — including Ruflo's current `McpCompositionInspector`. ChainGuard chain-level defense published in the same paper drops ASR to 22.5%, a concrete, implementable fix. No competitor has shipped a cross-tool composition defense.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| ColluSkill: adversarial cross-skill composition bypasses per-tool scanners at 96.0% ASR | arXiv:2608.09732, Aug 9, 2026 | A |
| ChainGuard: chain-level cross-skill correlation drops ASR 96.0% → 22.5% | arXiv:2608.09732 | A |
| SkillsMetric: static analysis AUC 0.93 on 138K skills but 0% detection of host-destruction attacks | arXiv:2608.08468, Aug 8, 2026 | A |
| Persistent Semantic Entities: preference injection compounds 1.9× across a 4-stage pipeline; 100% contamination at t=10 | arXiv:2608.07952, Aug 7, 2026 | A |
| StepJack: multi-step indirect prompt injection ASR rises 31.3% (1-hop) → 36.9% (3-hop) | arXiv:2608.06477 | A |
| AutoGen v0.7.5: Docker executor now default; `approval_func` adds human-in-the-loop before code runs | github.com/microsoft/autogen | B |

---

## Ruflo Current Capability

| Component | What it does | Gap vs 2026 SOTA |
|-----------|-------------|------------------|
| `mcp-composition-inspector.ts` | Per-tool Shamir-split fragment correlation + phrase catalog match | No cross-tool sequential correlation — ColluSkill exploits inter-tool boundaries |
| `channel-guard.ts` | Runtime message scanning at routing boundary (zero-width unicode, role-shift, base64 encoded payloads) | Stateless per-hop — no accumulated risk across multi-hop swarm chains (StepJack gap) |
| `injection-catalog.ts` | 16 injection phrases + adjacent keyword scoring | Phrase catalog bypassed at 96.0% ASR by adversarial composition; 0% for host-destruction |
| `tool-output-guardrail.ts` | Pattern-based content boundary scanner for MCP tool responses | Misses composition-layer evasion by design |
| `@claude-flow/security` plugin | CVE remediation, input validation, path security, safe executor | No ChainGuard equivalent; no sequential tool-call risk scoring |

---

## Competitor Comparison

| Competitor | Per-tool scanner | Cross-tool composition defense | Code execution safety | 2026 status |
|-----------|-----------------|-------------------------------|----------------------|-------------|
| LangGraph | None | None | None | No security hardening in 2026 changelog |
| AutoGen / AG2 | None | None | Docker executor (default v0.7.5) + `approval_func` | Most security-active competitor in 2026 |
| CrewAI | None | None | None | No security features in 2026 releases |
| OpenAI Agents SDK | ToolGuardrail (per-call only) | None | Sandboxed tool execution | No cross-tool composition defense |
| **Ruflo** | `McpCompositionInspector` ✓ | ❌ Missing | `SafeExecutor` ✓ | Leads on per-tool scanning; gap at composition layer |

No competitor has shipped a cross-tool composition security layer. First-mover advantage available.

---

## Benchmarks

| Benchmark | Metric | Source | Grade |
|-----------|--------|--------|-------|
| ColluSkill: per-component scanner ASR | **96.0% (bypassed)** | arXiv:2608.09732 | A |
| ChainGuard: chain-level defense ASR | **22.5% (defended)** | arXiv:2608.09732 | A |
| SkillsMetric: host-destruction detection rate | **0%** (complete blind spot) | arXiv:2608.08468 | A |
| SkillsMetric: prompt injection detection rate | **42%** | arXiv:2608.08468 | A |
| Persistent injection compounding ratio | **1.9× per 4-stage pipeline** | arXiv:2608.07952 | A |
| AutoGen Docker containment bypass rate | Not published | microsoft/autogen | B |

---

## Scan — intelligence

**Finding (Grade A):** arXiv:2608.09643 "Activation Probes Surface Code-Security Signals" — probing internal model activations achieves **61–67% accuracy** detecting vulnerable vs. fixed code, without any output-level signal. Ruflo's SONA neural system records trajectory rewards but does not tap internal activation signals for security classification. Adding a lightweight activation probe at the reasoning boundary could surface security-critical patterns SONA currently misses entirely.

**Competitive signal:** No competitor (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK) has published an activation-level security probe in 2026.

---

## Scan — swarm

**Finding (Grade A):** arXiv:2608.06477 "StepJack" — multi-step indirect prompt injection ASR rises monotonically: 31.3% at hop 1, 36.9% at hop 3. Ruflo's swarm passes tool-output context across ChannelGuard boundaries, but ChannelGuard is stateless — it does not accumulate injection risk across a message chain. Content cleared at hop 1 can arrive at a successor agent as part of a multi-hop injection sequence with no accumulated-risk signal, directly matching the StepJack threat model.

**Competitive signal:** No competitor tracks cumulative per-session injection risk across multi-agent hops.

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `f35c545fbe927aeb4ab8433bab8d827f69436572` |
| Report SHA-256 | `a49ec6f669ffda52ab20f84b6ee9bf0054d7746154cb51d03bb8d2f653acaaf9` |
| Witness stamp | `c76a4e325430373793d470aab112b7e0a723c3ebd3b9564dfb03871b21ad32f8` |

Verifier: `sha256sum dream-gist-2026-08-11.md` → concat session commit `f35c545fbe927aeb4ab8433bab8d827f69436572` → `sha256sum` → must equal `c76a4e325430373793d470aab112b7e0a723c3ebd3b9564dfb03871b21ad32f8`.

---

## Recommended Next Steps

1. **[ADR-382] Extend `McpCompositionInspector` with ChainGuard-style cross-tool sequential correlation** — maintain a rolling sum of injection scores across the full tool-call sequence per session; flag when the cross-tool aggregate exceeds a configurable threshold even if individual per-tool scores are sub-threshold. Entry: `v3/@claude-flow/cli/src/security/mcp-composition-inspector.ts`, new `ChainRiskAccumulator` state class.

2. **[Implementation] Make `ChannelGuard` stateful across multi-agent hops** — add `channelSessionId` propagation through `SendMessage`; maintain a `SessionRiskLedger` keyed by session ID; auto-quarantine messages when session total exceeds threshold. Closes the StepJack multi-hop gap. Entry: `v3/@claude-flow/cli/src/security/channel-guard.ts`.

3. **[Audit] Add host-destruction detection to `injection-catalog.ts`** — SkillsMetric shows 0% detection for host-destruction attacks in static analysis. Add semantic-similarity fallback (cosine sim over SONA embeddings) for novel injection variants not in the phrase catalog, with host-destruction patterns as priority. Entry: `v3/@claude-flow/cli/src/security/injection-catalog.ts`, new `HOST_DESTRUCTION_PATTERNS` export.
