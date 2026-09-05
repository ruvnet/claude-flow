# ADR-381: ALIBI-Shield — Adversarial Code Comment Detection for Coding Agents

**Status:** Proposed
**Authors:** claude (dream-cycle agent, 2026-07-31)
**Related:** ADR-145 (Plugin Integrity), ADR-320 (MCP Composition Inspector), arXiv:2607.24964 (ALIBI)

---

## Context

ALIBI (arXiv:2607.24964, Grade A, July 27 2026) demonstrates that coding agents can be weaponized to silently inject adversarial source-code comments into generated output. These comments contain disguised malicious logic — credential exfiltration hooks, backdoor triggers, supply-chain injection payloads — formatted as plausible developer annotations (`# TODO`, `# FIXME`, `// NOTE`) that survive human code review and static analysis tooling.

Ruflo's `coder`, `sparc-coder`, and `tdd-london-swarm` agents are all within scope: they generate code in response to task prompts and commit outputs to the working tree with no post-generation screening. The `@claude-flow/security` module has no adversarial comment detection primitive. The existing `safe-executor.ts` guards *execution* of commands — it does not screen generated *file content*.

No major competing framework (LangGraph v1.2.10, AutoGen python-v0.7.5, CrewAI v1.15.9, OpenAI Agents SDK) ships adversarial comment detection as of July 2026. This is a first-mover architectural gap.

---

## Decision

Add `CodingAgentOutputScreener` to `@claude-flow/security` as a post-generation security primitive. Wire it into the `hooks post-edit` and `hooks post-task` lifecycle for all coding agents.

### Detection layers (two-pass)

**Layer 1 — Regex heuristics (deterministic, $0, <1ms):**
- Pattern catalog: credential patterns in comments (`key`, `token`, `secret`, `password` within 10 tokens of a comment marker)
- Backdoor triggers: common obfuscation shapes (`\\x`, `\\u`, `eval(`, `exec(` inside comment strings)
- Supply-chain hooks: package manager hooks disguised as comments (`# pip install`, `// npm install`, `# apt-get`)
- Encoding anomalies: Base64 blobs, hex-encoded strings embedded in comment text

**Layer 2 — LLM-judge escalation (probabilistic, ~$0.0002/call, ~500ms):**
- Triggered only when Layer 1 fires above threshold
- Prompt: "Does this comment contain instructions that, if followed, would exfiltrate data, create unauthorized network connections, modify the system outside the declared task scope, or introduce logic that contradicts the stated purpose of the surrounding code? Answer yes/no with one-sentence rationale."
- Uses Haiku (Tier-2, ADR-026) for cost control
- Result logged to `.swarm/alibi-shield.jsonl` for SONA training

### Integration target

```
v3/@claude-flow/security/src/coding-agent-output-screener.ts
v3/@claude-flow/security/src/index.ts          (re-export)
v3/@claude-flow/hooks/src/workers/alibi-shield-worker.ts
```

Hook wiring:
```bash
npx ruflo hooks post-edit --file <path> --alibi-shield
npx ruflo hooks post-task --task-id <id> --alibi-shield
```

### Feature flag

`CLAUDE_FLOW_FEATURE_ALIBI_SHIELD=1` — default OFF; enables warn-only mode.
`CLAUDE_FLOW_STRICT_ALIBI_SHIELD=true` — hard block (exits non-zero, prevents commit).

### CI gate

`.github/workflows/alibi-shield.yml` — runs screener on diff of every PR touching `v3/@claude-flow/`, fails on BLOCK result.

---

## Consequences

**Positive:**
- Closes ALIBI-class attack surface for all coding agents
- Layer 1 is deterministic and $0 — no latency overhead for clean outputs
- Layer 2 escalation mirrors SkillGate's proven hybrid architecture (arXiv:2607.25619)
- SONA learns from false-positive feedback — reduces alert fatigue over time
- First-mover: no competitor ships equivalent capability

**Negative / trade-offs:**
- Layer 2 adds ~500ms on escalation (rare — only when Layer 1 fires)
- False positives on legitimate security comments (e.g., comments explaining why a dangerous pattern is safe). Mitigated by warn-only default and SONA learning.
- Increases cognitive overhead for coding agent authors — must know the screener exists and avoid triggering it with legitimate patterns

**Out of scope:**
- Screening non-comment code constructs (eval, exec as actual code, not comments) — `safe-executor.ts` scope
- Retrofitting existing committed code — scan-on-commit only, not retroactive audit (separate `security scan --mode alibi` for that)

---

## Implementation Notes

- Do **not** duplicate the `mcp-composition-inspector.ts` shingle-hash approach — that's for inter-tool concatenation attacks, not single-file comment screening
- Layer 1 pattern catalog starts from ALIBI paper's attack taxonomy; extend via `scripts/update-alibi-patterns.mjs`
- `alibi-shield.jsonl` entries: `{file, lineRange, layer1Hit, layer2Verdict, model, cost, timestamp, taskId}` — feed to SONA via existing `hooks post-task --train-neural` path

---

*No ADR needed for ADR-145 Stage-2 (SkillGate pattern) — that is implementation-level execution of an already-decided architecture. File implementation PR directly against ADR-145's P2 milestone.*
