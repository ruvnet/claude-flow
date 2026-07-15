# OWASP GenAI Security Top 10 (2025) — Ruflo Component Mapping

> **Purpose**: Map OWASP GenAI 2025 Top-10 risks to Ruflo's architectural components, ADRs, and control layers. Demonstrates how Ruflo's multi-layer security model addresses each category.
>
> **Status**: Ruflo v3.7+
>
> **First-mover note**: As of July 2026, no peer competitor (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK) publishes a detailed mapping of OWASP GenAI risks to their own components. This document establishes Ruflo's explicit commitment to defense-in-depth against the industry's published risk model.

## TL;DR

Ruflo addresses all 10 OWASP categories through a **five-layer defense** architecture:

1. **Install-time integrity** (ADR-145 Part A) — signature + semantic scanning
2. **Publish-time code scanning** (ADR-320 Part A) — AST + dependency-graph analysis
3. **Runtime permissions** (ADR-320 Part B) — capability manifest enforcement
4. **Memory governance** (ADR-145 Part B + ADR-178 + ADR-321) — write ACL, provenance, tamper-evident sealing
5. **Cross-agent authorization** (ADR-144) — delegation chain verification

| OWASP Category | Risk | Ruflo Layer(s) | ADR(s) | Mitigation |
|---|---|---|---|---|
| **LLM01** Prompt Injection | User input→ agent context | Content guardrail | ADR-131 | Detects / blocks injected commands per agent boundary |
| **LLM02** Insecure Output Handling | Agent→ user / external system | Cross-agent auth | ADR-144 | Verifies caller authorization before executing output-routed actions |
| **LLM03** Training Data Poisoning | Malicious skill / memory | Supply chain + memory integrity | ADR-145, ADR-320, ADR-321 | Pre-publish scanner, install verification, memory sealing |
| **LLM04** Model DoS | Adversarial token flood | Rate limiting | CLAUDE.md config | Token budget + MCP response timeout |
| **LLM05** Supply-Chain | Compromised plugins | 2-stage publish + install scan, runtime permission | ADR-145 Part A + ADR-320 + ADR-321 | Code AST scan, dependency graph, permission enforcement, propagation detection |
| **LLM06** Sensitive Data Disclosure | Secret in logs / memory | Guardrail + memory namespace ACL | ADR-131, ADR-145 Part B | Detects secrets in prompts; namespace grants restrict agent memory access |
| **LLM07** Insecure Plugin Design | Malicious / over-privileged plugin | Runtime permission + publish scanner | ADR-320 Part B + ADR-145 | Manifest enforces per-capability limits; pre-publish scan for RCE/exfil patterns |
| **LLM08** Excessive Agency | Agent exceeds delegated authority | Cross-agent authorization + permission manifest | ADR-144, ADR-320 Part B | Tool-call verification; plugin capability limits enforce least privilege |
| **LLM09** Overreliance on LLM Output | Agent acts without verification | Human-in-the-loop routing | ADR-178 RepE, IPI mode | Suspicious writes trigger human review before propagation |
| **LLM10** Model and Inversion Attacks | Membership / prompt / model-weight inference | Prompt caching + bounded conversation | ADR-146 (caching), CLAUDE.md | Cached prompts reduce inference surface; conversation windows limit history exposure |

---

## Detailed Mapping by OWASP Category

### LLM01 — Prompt Injection

**Risk**: Attacker injects commands into prompts that trick an agent into executing unintended actions.

**Ruflo Layers**:
- **ADR-131 Content Boundary Guardrail** — blocks prompt-injection patterns (command markers, role-switching, instruction-override) at the agent→LLM boundary, before the model sees them
- **ADR-144 Cross-Agent Authorization** — even if injection tricks the model into a tool call, the call's authorization (agent→agent or agent→plugin boundary) is re-verified independent of the prompt content
- **Agent Message Validation** — CLI config `CLAUDE_FLOW_GUARDRAIL_LEVEL` sets detection strictness (lenient/balanced/strict); strict mode requires human-in-the-loop review

**Status**: ✅ Implemented (ADR-131 since v2.4)

**User Action**: No configuration required. Enable strict mode for high-security deployments:
```bash
export CLAUDE_FLOW_GUARDRAIL_LEVEL=strict
npx ruflo swarm init --topology hierarchical
```

---

### LLM02 — Insecure Output Handling

**Risk**: Agent's LLM output is passed to external systems (files, APIs, logs) without validation, allowing the model to inject commands into those systems.

**Ruflo Layers**:
- **ADR-144 Cross-Agent Authorization** — every agent→agent tool call (e.g., agent A calling a tool that modifies shared state) must re-verify that agent A is authorized for that action, independent of what the prompt claims A should do
- **Write-Time ACL Check** — memory writes verify authorization at invocation time, not just at prompt time
- **Output Sanitization** — ADR-131 guardrail extends to output-routed fields (returns from tool calls) when they re-enter the agent context

**Status**: ✅ Implemented (ADR-144 since v3.0)

**User Action**: No configuration required. Authorization is verified per-call.

---

### LLM03 — Training Data Poisoning

**Risk**: Malicious training data (or memory written by a compromised agent) causes the model to produce unintended behavior on subsequent queries.

**Ruflo Layers**:
- **ADR-145 Part A: Install-time signature verification** — every plugin's package signature is verified before install, blocking tampered versions
- **ADR-145 Part B: Memory namespace write ACL** — only agents with explicit `writeNamespaces` grants can write to shared memory; other agents cannot poison the namespace they read from
- **ADR-178 Verifiable Memory Governance** — every write records `provenance` (who wrote it), `version`, `write_hash` (content hash), and `parent_hash` (previous version), creating an immutable audit trail
- **ADR-321 HMAC-Sealed Memory** — writes to the shared `collaboration` namespace are sealed with an HMAC key held only by the server; readers can cryptographically verify content has not been altered or spoofed
- **ADR-320 Part A: Pre-publish code scanner** — before a plugin reaches the registry, AST-level scanning detects code patterns that inject hostile content into shared memory

**Status**: ✅ ADR-145 Parts A+B, ADR-178, ADR-320 (Proposed); ADR-321 (Proposed)

**User Action**: Enable strict sealing to require HMAC verification (default in v4.0):
```bash
export CLAUDE_FLOW_STRICT_SEALING=true
```

---

### LLM04 — Model DoS

**Risk**: Attacker floods a model with tokens or oversized requests, causing service degradation.

**Ruflo Layers**:
- **Token budget** — configured in `v3/CLAUDE.md` Performance Targets; agents respect `CLAUDE_FLOW_TOKEN_BUDGET` env var
- **MCP response timeout** — `<100ms` target enforced at the MCP server level (see `v3/@claude-flow/hooks/src/mcp-server.ts`)
- **Rate limiting** — each agent's LLM calls are rate-limited by the Anthropic API (per-minute token quota); Ruflo does not override or bypass those limits
- **Input validation** — all user prompts are truncated to a configurable max length before being passed to agents

**Status**: ✅ Implemented (v3.0+)

**User Action**: Configure token budget and timeout:
```bash
export CLAUDE_FLOW_TOKEN_BUDGET=100000
export CLAUDE_FLOW_MCP_TIMEOUT_MS=100
```

---

### LLM05 — Supply-Chain

**Risk**: A compromised dependency, malicious plugin, or tampered package reaches the registry, and agents install and execute it unknowingly.

**Ruflo Layers**:
- **ADR-145 Part A: Install-time signature verification** — plugin signatures are verified before install; packages with invalid or missing signatures are rejected
- **ADR-145 Part A: Semantic intent scanning** — plugin description/README is scanned for language indicating hidden functionality (e.g., "exfiltrate," "backdoor"). Confidence scores flag suspicious descriptions
- **ADR-320 Part A: Pre-publish static/behavioral scanner** — runs on `npx ruflo plugins publish`:
  - **AST-level symbolic rule pass** detects credential extraction, exfiltration calls, undeclared hook injection, RCE patterns in the plugin's code
  - **Dependency-graph traversal** flags unpinned versions, known-vulnerable packages (OSV cross-reference), and over-privileged transitive dependencies
  - Scans every published version; scan results are stored in the registry index and displayed on `npx ruflo plugins install`
- **ADR-320 Part B: Runtime permission manifest** — each plugin declares what capabilities (filesystem, network, hooks, memory namespaces, subprocess) it needs; runtime enforcement blocks attempts to exceed those capabilities
- **ADR-321 HMAC-sealed collaboration memory** — any plugin that tries to write falsified or replayed content to shared memory is detected at read time via cryptographic verification

**Status**: ✅ ADR-145 Part A (since v2.4); ADR-320 Parts A+B (Proposed); ADR-321 (Proposed)

**User Action**: Enable strict publishing to block plugins with high-severity findings:
```bash
export CLAUDE_FLOW_STRICT_PUBLISH=true
npx ruflo plugins publish ./my-plugin
```

Declare plugin permissions in `plugin.json`:
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "permissions": {
    "filesystem": { "read": ["./config/**"], "write": [] },
    "network": { "allowedHosts": ["api.example.com"] },
    "hooks": ["pre-task"],
    "memoryNamespaces": ["plugin-state"],
    "subprocess": false
  }
}
```

---

### LLM06 — Sensitive Data Disclosure

**Risk**: Secrets (API keys, credentials, PII) are leaked via agent logs, memory, or outputs.

**Ruflo Layers**:
- **ADR-131 Content Boundary Guardrail** — detects known secret patterns (AWS keys, private keys, OAuth tokens) in agent messages and blocks them from reaching the LLM; logs a `SecretDetected` event for review
- **ADR-145 Part B Memory Namespace ACL** — agents cannot read from namespaces they don't have explicit `readNamespaces` grants for; shared secrets can be isolated to a namespace that only authorized agents access
- **ADR-178 Verifiable Memory Governance** — every memory write is logged with provenance; audit trail allows tracing which agent wrote which secret, if any
- **Environment variable isolation** — agents do not have automatic access to `process.env`; plugins must declare `needsEnvVars: ["SPECIFIC_VAR"]` in their manifest to receive them

**Status**: ✅ ADR-131 (v2.4+); ADR-145 Part B (v3.0+); ADR-178 (v3.6+)

**User Action**: Enable guardrail secret detection:
```bash
export CLAUDE_FLOW_GUARDRAIL_LEVEL=strict
```

Declare plugin env-var needs in `plugin.json`:
```json
{
  "name": "my-plugin",
  "needsEnvVars": ["PLUGIN_API_KEY"],
  "permissions": { "filesystem": {}, "network": {}, "hooks": [], "memoryNamespaces": [] }
}
```

---

### LLM07 — Insecure Plugin Design

**Risk**: A plugin has design flaws that allow it to be exploited (e.g., unvalidated input to a tool, no bounds on resource use, or overly broad permissions).

**Ruflo Layers**:
- **ADR-320 Part A: Pre-publish code scanner** — detects common anti-patterns:
  - **RCE patterns** (`eval`, dynamic `require` with unsanitized input, shell-out without escaping)
  - **Input validation gaps** (tools that accept arbitrary paths or commands without sanitization)
  - **Resource-exhaustion patterns** (unbounded loops, recursive calls without depth limits)
- **ADR-320 Part B: Runtime permission manifest** — plugin declares exactly what it is allowed to do; runtime enforcement blocks:
  - Filesystem access outside declared globs
  - Network calls to hosts not in the allowlist
  - Hook registration for hooks not declared
  - Subprocess execution if `subprocess: false`
- **ADR-145 Part A: Install-time scanning** — semantic scan catches descriptions claiming the plugin has capabilities it doesn't declare (e.g., "network integration" but no network grant)

**Status**: ✅ ADR-145 Part A (v2.4+); ADR-320 Parts A+B (Proposed)

**User Action**: Review scan results before installing plugins:
```bash
npx ruflo plugins install @claude-flow/plugin-example
# Shows scan verdict (pass/warn/block) and permission manifest
```

For plugin authors, run the scanner before publishing:
```bash
npx ruflo plugins publish ./my-plugin --strict
# Blocks if high-confidence RCE/exfil patterns detected
```

---

### LLM08 — Excessive Agency

**Risk**: An agent is granted too much authority and executes actions it shouldn't (e.g., modifying files outside its scope, or calling tools it wasn't meant to use).

**Ruflo Layers**:
- **ADR-144 Cross-Agent Authorization** — every tool call is verified against the calling agent's authorization grant, independent of what the agent's prompt claims it should be able to do
- **ADR-320 Part B Plugin Permission Manifest** — plugins are strictly limited to declared capabilities; a plugin cannot exceed its manifest (e.g., cannot write to filesystem if the manifest says `write: []`)
- **ADR-145 Part B Memory Namespace ACL** — agents have explicit allow-lists for which namespaces they can read/write; no ambient authority
- **Audit logging** — every tool call, permission check, and authorization decision is logged; see `CLAUDE_FLOW_AUDIT_LOG` environment variable

**Status**: ✅ ADR-144 (v3.0+); ADR-145 Part B (v3.0+); ADR-320 Part B (Proposed)

**User Action**: Configure agent grants conservatively:
```bash
export CLAUDE_FLOW_AGENT_MAX_TOOLS=20        # Agent can call at most 20 distinct tools
export CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS=3  # Plugin can request at most 3 permission categories
```

Review authorization failures in audit logs:
```bash
npx ruflo logs --filter "authorization_denied"
```

---

### LLM09 — Overreliance on LLM Output

**Risk**: An agent trusts the model's output without verification and acts on it, even when the output is incorrect or adversarial.

**Ruflo Layers**:
- **ADR-178 Verifiable Memory Governance (RepE mode)** — when an agent writes to shared memory, ADR-178's *Recursive Episodic Evaluation* can flag suspicious writes. If a write's content contradicts recent history or has low confidence, it enters `CLAUDE_FLOW_IPI_MODE` (human-in-the-loop review)
- **ADR-321 Propagation-chain detection** — if the same content is re-sealed under a different writer within a time window, it is flagged as a potential propagation attack (worm-like behavior)
- **Agent → Human escalation** — any suspicious action can trigger a human-in-the-loop checkpoint, interrupting the agent's execution until a human reviews and approves

**Status**: 🟡 ADR-178 (v3.6+, RepE mode is Proposed); ADR-321 (Proposed)

**User Action**: Enable human-in-the-loop review for suspicious memory writes:
```bash
export CLAUDE_FLOW_IPI_MODE=human_review      # or: log_only / escalate / block
export CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS=300000  # 5 minutes
```

---

### LLM10 — Model and Inversion Attacks

**Risk**: An attacker reconstructs the model's weights, training data, or prompts via membership inference, prompt injection, or model extraction.

**Ruflo Layers**:
- **ADR-146 Prompt Caching** — prompts are cached at the API level (Anthropic's native caching); cached prompts are not re-transmitted to the model on every call, reducing the inference surface for model-extraction attacks
- **Conversation windowing** — agents' message histories are bounded to a configurable window size (default: last 20 messages); older messages are archived, reducing the amount of prompt material exposed during any single inference
- **No model fine-tuning from agent output** — Ruflo agents do not train models on their own outputs by default; the only feedback to the learning system is from human-in-the-loop reviews and metrics
- **API security delegation** — Ruflo uses Anthropic's Claude API, which enforces rate limiting and abuse detection at the API boundary; Ruflo does not implement a local model replica

**Status**: 🟡 ADR-146 (Proposed); conversation windowing (v3.0+)

**User Action**: Enable prompt caching for high-volume agent runs:
```bash
export CLAUDE_FLOW_ENABLE_CACHING=true
npx ruflo swarm init --topology hierarchical --cache-mode aggressive
```

Configure conversation window size:
```bash
export CLAUDE_FLOW_CONVERSATION_WINDOW=20
```

---

## Defense-in-Depth Summary

Ruflo's five-layer model ensures that a compromise at any single layer is insufficient to breach security:

1. **Install layer** blocks signatures and semantic attacks *before* code reaches the agent
2. **Publish layer** scans code *before* it reaches users, at registry time
3. **Load layer** enforces permission manifests *before* execution starts
4. **Runtime layer** checks authorization *per invocation*, not just once
5. **Memory layer** seals shared memory cryptographically, so even a compromised agent cannot forge writes

This composition matches the OWASP principle of **defense in depth**: assume each layer has a false-negative rate, and stack them to reduce compound risk.

---

## Configuration Reference

| Env Var | Default | Purpose | ADR |
|---------|---------|---------|-----|
| `CLAUDE_FLOW_GUARDRAIL_LEVEL` | `balanced` | Prompt-injection & secret-detection sensitivity (`lenient`/`balanced`/`strict`) | ADR-131 |
| `CLAUDE_FLOW_STRICT_PUBLISH` | `false` | Fail `plugins publish` on high-confidence code-level findings | ADR-320 |
| `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` | `unlimited` | Cap the number of permission categories a plugin can request | ADR-320 |
| `CLAUDE_FLOW_STRICT_SEALING` | `false` | Require valid HMAC seals on collaboration-namespace reads (reject tampered content) | ADR-321 |
| `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS` | `300000` | Time window for propagation-chain detection (5 minutes default) | ADR-321 |
| `CLAUDE_FLOW_IPI_MODE` | `log_only` | Suspicious write handling (`log_only`/`escalate`/`human_review`/`block`) | ADR-178 |
| `CLAUDE_FLOW_AUDIT_LOG` | unset | Write audit trail to this file (authorization, secret detection, permission checks) | — |
| `CLAUDE_FLOW_TOKEN_BUDGET` | `1000000` | Max tokens per agent per session | — |
| `CLAUDE_FLOW_CONVERSATION_WINDOW` | `20` | Max recent messages in agent context (older archived) | — |

---

## Further Reading

- **OWASP GenAI Security Project**: [Top 10 for LLM Applications (2025)](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- **Ruflo ADR Roadmap**: [`v3/docs/adr/`](../adr/)
- **User Guide — Plugin Security**: [`docs/security/plugin-security-guide.md`](./plugin-security-guide.md) (user-facing configuration and best practices)
- **Security Baseline — Socket.dev Audit**: [`docs/security/socket-baseline.md`](./socket-baseline.md) (supply-chain audit results)
