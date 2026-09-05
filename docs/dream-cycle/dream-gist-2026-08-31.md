# Security SOTA Report — 2026-08-31

TL;DR: In 2026, every major agent framework (LangGraph, OpenAI Agents SDK, Google ADK) and the MCP spec itself (2026-07-28) converged on the same shape — a synchronous pre-execution interception point that checks a declarative tool-call policy before dispatch, plus a separate audit-emission step. Ruflo already authored exactly this policy schema (`.harness/mcp-policy.json`, ADR-150) months ago, but tonight's code audit confirmed the running `claude-flow` MCP server (`mcp-server.ts`) never read it — any connected client could call any tool with zero audit trail and zero call budget. Tonight's candidate wires the two policy fields that are in this server's actual jurisdiction (`auditLog`, `maxToolCallsPerTurn`) into the real `tools/call` dispatch path, fully opt-in, evaluated with a real deterministic $0 test suite (16/16 passing) plus a broader 43-test MCP regression sweep (39/43 passing, 4 failures traced to pre-existing unbuilt sibling packages, not this candidate).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MCP spec requires servers to rate-limit tool calls and log usage; no wire-level allow/deny primitive — left to implementers | modelcontextprotocol.io/specification/2026-07-28/server/tools | A |
| OWASP Agentic Skills Top 10 (2026) recommends default-deny allowlists + structured audit logging as baseline platform guidance; no spend-cap guidance anywhere | owasp.org/www-project-agentic-skills-top-10 | A |
| "Before the Tool Call" (OAP spec): synchronous pre-action interception vs. declarative policy cuts empirical attack success from 74.6% (permissive) to 0% (restrictive), 879 attempts | Uchibeke, arXiv:2603.20953 (2026-03-21) | B |
| Google ADK `before_tool_callback` intercepts every dispatch pre-execution, can block/substitute; org policy via Runner Plugins, per-agent via local callbacks (two-tier split) | google/adk-docs (official) | A |
| LangGraph `interrupt_on`: declarative per-tool-name → interrupt-config map, requires a checkpointer | docs.langchain.com (official) | A |
| CrewAI OSS core has **no** standardized pre-tool-call authorization provider contract — open, unresolved GitHub issue, not shipped | github.com/crewAIInc/crewAI issue #4877 | A |
| OpenAI Agents SDK ships tool-call guardrails (block/replace/tripwire) but no native spend/budget concept, confirmed by two independent write-ups | dev.to/pat9000; runcycles.io | B |
| mcp-firewall (OSS MCP gateway): default-deny RBAC + Ed25519-signed hash-chained audit trail + fail-closed approval — the closest complete prior-art implementation of what Ruflo's policy file already declares | github.com/ressl/mcp-firewall (fetched directly) | A |

## Ruflo Current Capability

`.harness/mcp-policy.json` (ADR-150 iter 30) declares `defaultDeny: true`, `auditLog: true`, `requireApprovalForDangerous: true`, `maxToolCallsPerTurn: 200`, and a `dangerousPatterns` list — but it existed solely to satisfy `metaharness harness mcp-scan`'s offline linting. Direct grep of `v3/@claude-flow/cli/src/mcp-server.ts` (the code `npx ruflo mcp start` actually runs) confirmed zero references to `policy`/`allow`/`deny`/`approval`/`dangerous`/`auditLog`/`toolTimeout`/`maxToolCalls` anywhere in the file, before tonight. The policy file's own rationale comment scopes `dangerousPatterns`/`allowShell`/`allowNetwork`/`allowFileWrite` to a *different* layer (native Claude Code tools — Bash/Write/Edit/WebFetch — not this MCP server's `memory_*`/`hooks_*`/`agentdb_*` tool surface), so tonight's fix targets only the two fields genuinely in this server's jurisdiction: `auditLog` and `maxToolCallsPerTurn`.

## Competitor Comparison

| Competitor | Runtime tool-call enforcement? | Audit logging? | Approval gate? | Grade |
|---|---|---|---|---|
| LangGraph | Yes — `interrupt()` in the executor itself | No native log | Yes (HITL pause) | B |
| OpenAI Agents SDK | Yes — guardrails run on every call, can raise a tripwire | No native log | Yes, developer-configured | A |
| Google ADK | Yes — `before_tool_callback` real interception point | Not built-in | Developer-built | B |
| CrewAI (OSS core) | No — confirmed absent; RBAC/audit/HITL exist only in paid Enterprise AMP | Enterprise-only | Enterprise-only | B |
| Anthropic MCP reference SDK | No — spec calls for consent, reference SDKs ship permissive defaults by design | No | Elicitation exists as a capability, not enforced | B |
| mcp-firewall (OSS gateway) | Yes, exactly this spec — default-deny, fail-closed | Yes, signed & hash-chained | Yes | A |

Synthesis: **not a first-mover gap.** Ruflo is catching up to a pattern that's split between partial native hooks in the major frameworks and a dedicated "MCP gateway" OSS category (mcp-firewall, Enkrypt AI, MCPGuard, protect-mcp, agentgateway) that already ships the full spec. The honest framing is "adopting a proven pattern," not inventing one — and even the frameworks with native interception (LangGraph/OpenAI SDK/ADK) still lack built-in audit logging, which stays a real differentiator if Ruflo ships it by default once wired.

## Hypothesis

> Given the claude-flow MCP server's `tools/call` dispatch handler, when an opt-in `PolicyEnforcer` (env `RUFLO_MCP_ENFORCE_POLICY=1`) reads `auditLog` and `maxToolCallsPerTurn` from `.harness/mcp-policy.json` and enforces them at the point of dispatch, then every tool call should be audit-logged and per-session call volume should be bounded, relative to today's completely unenforced baseline, subject to: (1) default behavior (flag unset) is byte-for-byte unchanged; (2) existing MCP-related tests remain green; (3) zero LLM/API cost.

Frozen before evaluation began; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: `vitest run`, deterministic, $0, zero LLM calls.

- New suite `__tests__/mcp-policy-enforcer.test.ts`: **16/16 passing** — unit coverage of the policy loader (missing file, malformed JSON → both fail open, never throw), the per-session budget counter (allow-up-to-limit, deny-beyond, independent per session), the audit-log writer (no-op when `auditLog` false, one JSONL line per call, never throws on an unwritable path), and 3 integration tests that instantiate the real `MCPServerManager` and call its actual `handleMCPMessage('tools/call', ...)` (with `mcp-client.js`'s ~300-tool registry mocked out for isolation/speed): default-flag-unset path (5/5 calls succeed, identical to pre-existing behavior), enabled-but-no-policy-file (fails open), enabled-with-budget=1 (1st call allowed, 2nd denied with a policy error).
- Broader regression sweep, all 11 MCP-related test files in the package: **39/43 passing**. The 4 failures (`mcp-tools-deep.test.ts`, `mcp-client.test.ts`, `mcp-client-guardrail.test.ts`, `issue-2612-mcp-rename.test.ts`, plus the 2 e2e HTTP tests) all trace to unbuilt sibling packages in this fresh checkout (`@claude-flow/cli-core/dist`, `@claude-flow/neural/dist`, `@claude-flow/cli/dist` — all confirmed missing via direct `test -d` before touching any code), none of which import `policy-enforcer.ts` or the modified `tools/call` branch. Same class of environmental gap disclosed by multiple prior dream-cycle nights (e.g. 2026-08-17's "unbuilt sibling package @claude-flow/cli-core").
- `@claude-flow/mcp` (a different sibling, imported by an unrelated pre-existing method `startHttpServer()` in the same file) was also unbuilt and broke Vite's static transform of the whole module for every test importing it; built with a plain `tsc` (clean, no errors) before running tests — a legitimate one-time environment fix, not a candidate change.

## Darwin Results

Skipped — scope mismatch, same class as 5 of the last 6 dream-cycle nights. This is a binary/config-wiring correctness fix (either the two policy fields are consulted at dispatch or they aren't), not a continuous/categorical parameter; `@metaharness/darwin`'s real interface (`ruvector harness darwin <config> --execute`) evolves scoped tunable parameters against a benchmark corpus.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `29f048fc3b556f857cf2b126d2a84c19d2daa0d0` |
| Report SHA-256 (pre-witness content) | `329d372953c27d8e6ff4471d11ebeb44fd7434b137a9e70f37c4741310e1bf88` |
| Witness stamp | `670cbbad1a7ecddc562f0c4abb5aebb5d367834ea10d3ce350118eeacc7ab8ea` |
| Evaluation receipt | `__tests__/mcp-policy-enforcer.test.ts`, 16/16 passing (committed on this branch) |
| Flywheel evidence | None — no `.claude-flow/flywheel/` state in this repo; no signed `@metaharness/flywheel` bundle (bespoke deterministic vitest suite, not an LLM-task corpus the replay tooling targets) |
| Darwin lineage | None — skipped, scope mismatch (see Darwin Results) |

Verifier procedure (same as every prior dream-cycle night, e.g. #3034/#3044): the SHA-256 above was computed over this report's content *before* this Witness section held its final values (unavoidably self-referential otherwise — hashing a file that contains its own hash). To reproduce: take this file's content with the Witness table's three value cells blanked back out, SHA-256 it, concatenate with the session commit, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Land tonight's opt-in wiring**, then flip `RUFLO_MCP_ENFORCE_POLICY` on by default in a follow-up night once the audit-log volume/rotation story and the `sessionId`-forgery question (flagged by the adversarial critic — see PR) are separately resolved; shipping audit-by-default is the one dimension where competitors (bar mcp-firewall) are still weak.
2. **A future security night should scope `dangerousPatterns`/`requireApprovalForDangerous` at the correct layer** — Ruflo's native-Claude-Code-tool surface (Bash/Write/Edit/WebFetch), not this MCP server, per the policy file's own rationale; that is a materially different, larger piece of work deliberately left out of tonight's patch.
3. **Do not re-open the "AgentDB memory poisoning" security direction** (ADR-381/ADR-382, researched 2026-07-31/08-01/08-06/08-11, code never implemented) as a 5th consecutive rehash without new evidence — tonight intentionally picked an orthogonal, previously-flagged-but-unactioned direction (MCP governance, surfaced by 2026-08-19's swarm-night scan) instead, per STEP 1.1's duplicate-direction rule.
