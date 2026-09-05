# Security SOTA Report — 2026-08-26

TL;DR: `authorizeMcpTool()` — Ruflo's live, already-wired MCP tool-authorization chokepoint — has always trusted a plain, unsigned `CLAUDE_FLOW_PRINCIPAL_ID` env var as caller identity, with zero cryptographic proof. Tonight's candidate binds the already-built, already-tested-but-dead-code Ed25519 `verifyInvocationToken` (ADR-377 Phase 3, shipped 2026-07-30, never wired) into that real chokepoint, scoped to `DualModeOrchestrator`-spawned worker subprocesses — closing a live spoofing gap OWASP's 2026 Agentic Top 10 names as ASI07. Off by default. evaluated: **accepted, with disclosed caveats**.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OWASP Top 10 for Agentic Applications formalizes ASI07 "Insecure Inter-Agent Communication" (Dec 2025) | genai.owasp.org | A |
| MCP's 2026-07-28 spec revision still excludes stdio transport from its OAuth 2.1 authorization machinery entirely, deferring identity to "the environment" — the exact unsigned-env-var mechanism this candidate hardens | modelcontextprotocol.io | A |
| 40.55% of 7,973 scanned live remote MCP servers expose tools with zero authentication | arXiv:2605.22333 | A |
| LangChain (#35393) and CrewAI (#5561) both received well-specified Ed25519/DID caller-identity RFCs in Feb–Apr 2026 and closed both "not planned" | GitHub, direct fetch | A |
| CP-WBFT: confidence-probe-weighted BFT tallying, AAAI 2026 | arXiv:2511.10400 | A |
| AIP (Agent Identity Protocol): scanned ~2,000 live MCP servers, found all lacking auth; proposes Invocation-Bound Capability Tokens | arXiv:2603.24775 | B |

## Ruflo Current Capability

`v3/@claude-flow/security/src/mcp-caller-identity.ts` (ADR-377 Phase 3, PR #2874, merged 2026-07-30) implements Ed25519 `issueInvocationToken`/`verifyInvocationToken`, fully tested — but grep across all of `v3/` confirmed **zero production call sites**. Last night (2026-08-25) flagged wiring it into `AgentAuthorizationPropagator.checkToolCall` — but tonight's deep research corrected that: `checkToolCall` also has zero production callers. The **actual live enforcement chokepoint**, used by both stdio and HTTP transports, is `authorizeMcpTool()` in `v3/@claude-flow/cli/src/services/policy-runtime.ts`, whose `identity.id` (line 350, pre-patch) was `process.env.CLAUDE_FLOW_PRINCIPAL_ID ?? 'legacy-cli'` — a bare string, verified nowhere downstream in `AgenticPolicyEngine.evaluate()`. `DualModeOrchestrator` (`v3/@claude-flow/codex/src/dual-mode/orchestrator.ts:600`) sets this value for every spawned worker subprocess — a process running arbitrary LLM-driven tool calls, exactly the kind of process a prompt injection could compromise.

## Competitor Comparison

| System | Verifies caller/agent identity for tool calls? | Mechanism | Grade |
|---|---|---|---|
| LangGraph | No (RFC #35393 closed not-planned) | Platform user-auth only, not agent-identity | A |
| AutoGen/AG2 | No (community RFC open, unmerged) | None; `AgentId` is routing-only | A |
| CrewAI | No (RFC #5561 closed not-planned) | Client→MCP-server auth only | A |
| OpenAI Agents SDK | No | Tool allowlists (least-privilege scoping ≠ identity) | B |
| MCP spec itself (2026-07-28) | No, by design for stdio | Defers to "environment" for stdio; OAuth 2.1 only for HTTP | A |

Why universal "No": not a solved-but-unpublished problem — the MCP spec inherits OAuth 2.1's human-delegation model and explicitly carves stdio out of its scope, so every framework built on top inherited that same non-goal. Two independent teams (LangChain, CrewAI) got matching RFCs and declined them without published rationale — a genuine, still-open field gap.

## Hypothesis

> Given `authorizeMcpTool`'s unsigned-env-var identity, when `isMcpCallerAuthEnabled()` is true and `DualModeOrchestrator` mints a per-worker Ed25519 `InvocationToken` (worker-lifetime TTL = `config.timeout`, wildcard `toolName: '*'` — a disclosed scope reduction from the primitive's original per-call design) that `authorizeMcpTool` verifies before trusting identity, then a process without a validly-signed token should be rejected (fail-closed) while a legitimate token's `callerId` is used even when it disagrees with the raw env var — subject to: (1) disabled behavior is byte-identical; (2) existing suites stay green; (3) $0 cost.

## Evaluation

Real evaluator: Vitest, zero LLM calls. 6 new deterministic scenarios (baseline-disabled-spoofing-succeeds; enabled+no-token→reject; enabled+forged-signature→reject; enabled+expired→reject; enabled+legitimate-token→accept using verified `callerId`; orchestrator env-var gating + token round-trip) — all pass post-fix, all correctly fail/error pre-fix (`git stash` isolation). `@claude-flow/security` 583/583, `@claude-flow/codex` 241/241, `policy-runtime.test.ts` 18/18 (13 pre-existing + 5 new). CLI full suite: 19 pre-existing WASM/Docker-dependent failures proven **identical** with and without the diff via stash-and-diff comparison of failing-test-name lists (empty diff). `tsc --noEmit` clean for touched packages.

An independent adversarial critic (fresh session) re-ran every suite itself, independently verified the Ed25519 SPKI DER prefix against real `node:crypto` output, probed cross-worker token confusion (rejected), NUL-byte field-injection into `callerId` (rejected — signing never parses a flat delimited string), and traced every fail-closed branch line-by-line. **Verdict: CONFIRMED-SAFE-WITH-CAVEATS** — disclosed, not hidden: (1) the worker-lifetime/wildcard-tool token is a capability credential, not a per-call proof — a leaked token remains valid for that worker's lifetime; (2) two other call sites (`harness-flywheel-runtime.ts:101`, `metaharness.ts:146,173`) still trust the bare env var, real residual scope for a future phase; (3) a pre-existing, unrelated quirk — 4 literal NUL bytes used as field separators in `signingPayload()`, present at HEAD — was probed for exploitability (none found, since verification always uses structured JSON fields, never a split flat string) and correctly left unfixed (out of frozen scope).

## Darwin Results

Skipped — scope mismatch, confirmed via `npx ruvector harness darwin --help`: real interface evolves continuous/categorical genome parameters (routing weights, topology, prompt/memory/tool/tier/context/coordination) against an LLM-scored bench corpus via `darwin <config> --execute`. A binary crypto-verification gate has no such tunable parameter space. Same class of skip as 5 of the last 6 dream-cycle nights.

## SOTA Proof & Witness

Control-plane discovery (`npx ruvector harness status --json`) confirms 14/15 pinned MetaHarness primitives available (witness-chain, flywheel, darwin, router, redblue, weight-eft all loaded; only `@ruvector/router` semantic-router unavailable, has a defensive JS fallback). No signed `@metaharness/flywheel` bundle produced — deterministic Vitest evidence, not an LLM-task corpus the replay/verify tooling targets, same as every accepted night since 08-18. See Witness table below for cryptographic provenance of this report.

## Recommended Next Steps

1. **Merge this candidate** (human review required) — closes a real, OWASP-ASI07-named, field-wide-unsolved gap in a live enforcement path, with independent adversarial confirmation.
2. **Follow-up**: wire `resolveMcpCallerIdentity`'s pattern into the two other still-trusting call sites (`harness-flywheel-runtime.ts:101`, `metaharness.ts:146,173`) — same primitive, mechanical extension.
3. **Follow-up**: `TopologyManager.rebalanceHybrid()`'s one-directional adjacency bug (topology-manager.ts:536-539) — confirmed still open tonight by the swarm scan, ~4-6 line fix, cheapest still-open swarm lead.
4. **Follow-up**: wire `ConsensusVote.confidence` into `byzantine.ts`'s tally — CP-WBFT (AAAI 2026, Grade A) is now a peer-reviewed reference pattern for exactly this, found by tonight's swarm scan.
5. Separately worth a maintainer's attention (not a candidate): the pre-existing NUL-byte quirk in `signingPayload()` and two stale ADR status/CVE-registry doc entries (ADR-377 README still says "Proposed" despite merged code; `CVE-REMEDIATION.ts`'s `ADR165-OPEN-01` entry is stale-fixed) — cosmetic, flagged for cleanup.

## Witness

| Field | Value |
|---|---|
| Session commit | `e21aa352fdc80fd2d3cc4e83404a76a18d118b96` |
| Report SHA-256 (pre-witness content) | `a590238de9502914cdcca27a2ceb9426b2cda590c0c4fd4be84cc03f5deefb52` |
| Witness stamp | `fd944eaaea6d669f9c62355bd95c339f97313faa4b999510b454002e85714ee2` |

Verifier: fetch `docs/dream-cycle/dream-gist-2026-08-26.md` at the commit that introduced it, strip the witness table's filled values back to placeholders (`a590238de9502914cdcca27a2ceb9426b2cda590c0c4fd4be84cc03f5deefb52`, `fd944eaaea6d669f9c62355bd95c339f97313faa4b999510b454002e85714ee2`), `sha256sum`, concatenate with the session commit, `sha256sum` again → must equal the witness stamp.
