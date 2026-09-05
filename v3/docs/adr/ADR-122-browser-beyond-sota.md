# ADR-122 — RuFlo Browser Substrate: signed trajectories, causal self-healing, federated MCTS, session capsules

**Status**: Proposed (2026-05-18) — revised 2026-05-18 to reframe as substrate
**Date**: 2026-05-18
**Authors**: claude (drafted with rUv)
**Related**: `@claude-flow/browser@3.0.0-alpha.3`, [`agent-browser@0.27.0`](https://www.npmjs.com/package/agent-browser), `ruflo-browser` plugin (record/replay/auth-flow/cookie-vault), [`@ruvector/rvf@0.2.1`](https://www.npmjs.com/package/@ruvector/rvf), AgentDB causal graph (ADR-076 family), Ed25519 witness manifest (ADR-103), Federation v1 (ADR-097/104/105–110), AIDefence 2.3.0 (ADR-118), [Reflective MCTS for web agents (arXiv 2410.02052)](https://arxiv.org/abs/2410.02052), [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Browserbase Stagehand](https://www.browserbase.com/blog/browser-automation-all-languages-with-stagehand/)
**Supersedes**: nothing (additive)

## Core thesis (revised)

**RuFlo is not a browser agent. RuFlo is the memory, policy, replay, and distributed-planning substrate underneath browser agents.**

Stagehand, Browser Use, Surfer-H, Playwright, Chrome, Browserbase, local browsers, and cloud browser pools become **execution targets**. RuFlo owns: memory, auth state, planning, replay, scoring, policy, learning, and cross-installation coordination.

The public stack today is:

```
agent → browser → action → observation → next action
```

RuFlo should be:

```
agent → governed Session Capsule → distributed MCTS search →
  Browser Execution Adapter → replay verification → RuVector memory →
  Workflow Compiler → reusable RuFlo primitive
```

That is the architectural jump and the defensible SOTA claim.

## Context

There are **two browser systems** in this repo, drifting apart:

1. **`@claude-flow/browser@3.0.0-alpha.3`** (v3 monorepo) — built on AugmentCode's `agent-browser` CLI, ships 59 MCP tools, element-ref snapshots (`@e1`, `@e2` — 93% context reduction), trajectory recording into ReasoningBank, URL/PII scanning, 9 workflow templates, basic multi-session swarm. **Locked to `agent-browser@^0.6.0` while upstream is at `0.27.0`** — a 21-minor-version drift covering the entire 2025–mid-2026 evolution of the CLI.
2. **`ruflo-browser` plugin** (`plugins/ruflo-browser/`) — more modern, 23 MCP tools, already composes RVF cognitive containers + AIDefence gates + cookie vault + replay-with-mutation. This is where the "beyond SOTA" primitives have been quietly accumulating.

Meanwhile the SOTA web-agent field has moved hard. Current WebVoyager numbers (Apr 2026):

| System | WebVoyager | Distinctive technique |
|---|---|---|
| **Surfer-H + Holo1** | **92.2%** | Policy/Localizer/Validator triad — separate VLM for visual UI element localization |
| Browser Use | 89.1% | Hybrid DOM+screenshot, implicit fallback |
| Gemini 2.5 CU | 88.9% | Pure visual grounding, screenshot loop |
| Claude Opus 4.6 (CU) | 88.0% | Pure pixel reasoning, no DOM |
| OpenAI Operator | 87.0% | RL-trained CoT-over-screenshots, user-confirm sensitive actions |
| Skyvern | 85.8% | Validator loop — vision-LLM verifies every action's effect |
| Stagehand v3 | n/a (DX leader) | `observe/act/extract` primitives, CDP-native, managed stealth |

The benchmark frontier is no longer about action accuracy — it's about **inspectability, provenance, and cross-session learning**, none of which any of the named systems ship. Pure-Playwright + LLM systems cannot bolt on signed replay or causal-graph recovery without architectural surgery.

This ADR converges the two ruflo browser systems and commits to three wedges that exploit ambient ruflo infrastructure (HNSW vector memory + AgentDB causal graphs + Ed25519 witness + federation peers + AIDefence) to do what SOTA structurally cannot.

## Gap analysis (what we don't have)

| Capability | Surfer-H | Browser Use | Stagehand v3 | Skyvern | Operator | `@claude-flow/browser` today | `ruflo-browser` today |
|---|---|---|---|---|---|---|---|
| Visual grounding (specialized VLM Localizer) | Y | partial | N | Y | Y | N | N |
| Self-healing selectors (queryable) | Y (silent) | partial | Y (silent) | Y (silent) | N | N | N |
| Parallel MCTS branch exploration | N | N | N | N | N | N | N |
| **Signed / verifiable replay artifact** | **N** | **N** | **N** | **N** | **N** | **N (RVF unused)** | **partial (RVF, no witness)** |
| **Causal-graph selector recovery** | **N** | **N** | **N** | **N** | **N** | **N** | **N** |
| **PII-gated cookie vault with attestation** | **N** | **N** | **N** | **N** | **N** | **N** | **partial (AIDefence yes, no witness)** |
| Cross-session trajectory learning (HNSW) | partial | N | N | partial | N | partial (ReasoningBank) | partial |
| Federated multi-peer session sharing | N | N | N | N | N | N | N |
| Cost-aware per-action model routing | N | N | N | N | N | N | N |
| OCR for screenshot text | Y | N | N | Y | Y | N | N |
| Action-graph / GOAP pre-planning | N | N | N | partial | partial | N | N |

The bolded rows are the wedges: every named SOTA system is "N", ruflo has the primitives in place to be "Y", and nothing else can ship these without rebuilding their core.

## Architecture (substrate)

### Layered system

1. **Browser Execution Adapters** — Playwright, Stagehand, Browser Use, Browserbase, local Chrome profile, remote browser pool, future Surfer-H visual adapter. Single interface; RuFlo stays above the tool wars.
2. **Session Capsule Layer** — sealed browser-state bundles with origin policy, consent proof, expiry, reuse policy, and witness chain. Cookies, localStorage, sessionStorage, IndexedDB metadata, browser fingerprint profile — never raw reusable blobs.
3. **Distributed MCTS Layer** — risk/cost/auth-aware UCT search distributed across federation peers. Reflective MCTS extended to persist across runs and installations.
4. **Cross-Installation Search Fabric** — Explorer / Verifier / Critic / Recorder / Learner / Coordinator node roles. CRDT or append-only event-log merge of search-tree deltas. **Search deltas shared by default; raw secrets never.**
5. **RuVector Memory** — DOM/screenshot/task embeddings, site-flow graphs, selector-reliability vectors, MCTS node summaries. The recall path that gates the cost of a fresh exploration.
6. **Workflow Compiler** — successful MCTS traces become deterministic workflows with selector fallback graphs, test harnesses, policy manifests, and ADR traces.
7. **Policy & Risk Layer** — risk-class taxonomy gates autonomous action. Only read-only / authenticated-read / draft-write run autonomously by default.

### Runtime services

| Service | Responsibility |
|---|---|
| `ruflo-sessiond` | Capture / seal / refresh / rotate / revoke Session Capsules. Mount into browser context. Audit reuse. |
| `ruflo-browexec` | Adapter dispatch. Launch browser via chosen adapter; apply capsule; execute action; emit trace event. |
| `ruflo-mcts` | Distributed tree search engine. Select / expand / simulate / score / backprop / publish delta. |
| `ruflo-replayd` | Replay successful runs; verify; generalize selectors; produce fallback paths; create workflow artifact. |
| `ruflo-critic` | Policy + risk evaluation. Detects irreversible actions; scores auth/site risk; enforces consent; blocks unsafe transitions. |
| `ruflo-memory` | RuVector-backed embeddings + similarity retrieval; failure clustering; reusable-path ranking. |

### Risk classes (autonomous-action gate)

| Class | Description | Autonomous? |
|---|---|---|
| 1 | Read-only | ✅ |
| 2 | Authenticated read | ✅ |
| 3 | Draft write | ✅ |
| 4 | External submission | ❌ human approval |
| 5 | Financial action | ❌ human approval |
| 6 | Account mutation | ❌ human approval |
| 7 | Destructive | ❌ human approval |

### Session Capsule schema

```rust
pub struct SessionCapsule {
    pub capsule_id: CapsuleId,
    pub tenant_id: TenantId,
    pub owner_id: OwnerId,
    pub origins: Vec<OriginPolicy>,
    pub browser_profile: BrowserProfile,
    pub encrypted_state_ref: StateRef,
    pub created_at: Timestamp,
    pub expires_at: Timestamp,
    pub reuse_policy: ReusePolicy,
    pub consent_proof: ConsentProof,
    pub witness_chain_head: Hash256,
}
pub struct ReusePolicy {
    pub allowed_origins: Vec<String>,
    pub allowed_tasks: Vec<TaskClass>,
    pub max_replays: u32,
    pub require_fresh_mfa: bool,
    pub allow_cross_device: bool,
    pub allow_cross_installation: bool,
}
```

The Phase 3 attested cookie vault is the **subset** of this — extended in Phase 6 to full SessionCapsule with multi-store state, browser fingerprint, and ReusePolicy.

### Production-aware UCT scoring

```
score = Q + C·√(ln(parent_visits) / child_visits) + R − λ·risk − μ·cost − α·auth
```

Where `Q` = task value, `R` = replay bonus, `λ·risk` = irreversible-action penalty, `μ·cost` = token + browser-runtime cost, `α·auth` = session-fragility penalty. Phase 4's UCB1 implementation is extended in Phase 6 to use this production-aware formula.

### SOTA scoring rubric

| Dimension | Target |
|---|---|
| Completion rate | > 85% |
| Replay success | > 90% on stable sites |
| Auth reuse success | > 95% within allowed expiry |
| Human intervention rate | < 10% (read-only tasks) |
| Token reduction from memory | > 30% |
| Unsafe action escape rate | 0% |
| Trace completeness | 100% for privileged actions |

## Decision

Land the substrate in **eight phases**, each shippable alone, each opt-in via configuration. Phases 0–2 are convergence; phases 3–5 are the original beyond-SOTA wedges; phases 6–7 are the substrate framing.

### Phase 0 — Upgrade `agent-browser` 0.6 → 0.27 and converge the two systems

The 21-minor drift on `agent-browser` is the highest-yield, lowest-risk fix. Land it first.

- Bump `@claude-flow/browser` dependency to `agent-browser@^0.27.0` in one PR.
- Audit the 59 MCP tools against `agent-browser@0.27` CLI surface; deprecate any that no longer have a CLI counterpart; surface any new CLI verbs (`record`, `replay`, etc.) as new MCP tools.
- Fold the more-mature `ruflo-browser` plugin primitives (record/replay/auth-flow/cookie-vault/screenshot-diff) into `@claude-flow/browser` as first-class application services. Keep the plugin as a thin re-export for backward compatibility, scheduled for removal in 4.0.

**Acceptance:**
- Single source of truth: `@claude-flow/browser` exports `record`, `replay`, `replayWithMutation`, `authFlow`, `cookieVault`, `screenshotDiff` as application-level operations.
- Plugin `plugins/ruflo-browser` re-exports from `@claude-flow/browser` only; no duplicated logic.
- Zero regression on existing 128 tests; new tests cover the merged surface area.
- `ruflo doctor` reports `agent-browser` version and warns when below 0.27.

**Non-goals (Phase 0):** removing the plugin entirely (keep through 4.0); changing the MCP tool names (back-compat).

### Phase 1 — Wedge 1: Signed, replayable trajectory containers (RVF + Ed25519 witness)

Combine the existing RVF cognitive container format (`@ruvector/rvf@0.2.1`) with the Ed25519 witness manifest (ADR-103) to produce a portable, signed `.rvf` browser-session bundle. No other web agent has cryptographic provenance for a recorded session.

- At `endTrajectory(success, verdict)`, write the trajectory steps + final snapshot + screenshot hashes into an RVF container, then sign the container with the project's witness key.
- Provide a verifier: `ruflo browser verify <session.rvf>` — confirms signature, integrity, and chain-of-custody back to the recording project.
- Provide `replayWithMutation(session.rvf, mutations)` — replay against the same or mutated URL, producing a new signed delta artifact suitable for visual-regression CI gates.

**Acceptance:**
- A recorded trajectory round-trips through `record → sign → distribute → verify → replay` with byte-exact step reproduction.
- Forging a step (modifying the trajectory JSON in the container) fails verification.
- CI integration: a session `.rvf` artifact can be checked into a repo and replayed by an unrelated checkout; the replay produces a signed delta against the original.
- Tamper-evidence: changing one element ref in the trajectory breaks `ruflo browser verify`.

**Non-goals (Phase 1):** distributed signing (use single project key); replay across browser-engine versions (require same Playwright major).

### Phase 2 — Wedge 2: Causal-graph-backed self-healing selectors

Every time a selector resolution fails (element-ref no longer present, click target moved, fill target's role changed), record a causal edge in AgentDB: `selector @eN at URL U broke because of DOM mutation M observed between timestamps T1..T2`. Future sessions on the same domain query the causal graph *before* attempting a known-brittle locator family.

- Hook into the existing `agent-browser-adapter` retry path. On retry, snapshot the DOM diff (Playwright `accessibility.snapshot()` before/after) and write a causal edge via `mcp__claude-flow__agentdb_causal-edge`.
- New MCP tool: `browser/explain-recovery` — given a current page + a failing selector, walk the causal graph and return the historical break events that share a structural ancestor.
- Heal proactively: the next session's snapshot is annotated with `_causalRiskScore` per element-ref, sourced from prior break events on this domain. Element-refs with high break-history are flagged in the MCP response.

**Acceptance:**
- After 10 sessions on a domain with N selector breaks, the 11th session's snapshot annotates the N break-prone element-refs with a non-zero `_causalRiskScore`.
- `agentdb_causal-explain` on a failed selector returns at least one prior break event with timestamp and DOM-diff payload.
- Cross-domain isolation: break events on `example.com` do not pollute risk scores on `other.com`.

**Non-goals (Phase 2):** structural deep-learning over the causal graph; just record + query. Learning comes in Phase 5.

### Phase 3 — Wedge 3: AIDefence-attested cookie vault

Every cookie write goes through AIDefence (`aidefence_has_pii` + `aidefence_is_safe`) before it lands in the vault. The vault entry is sealed in an RVF container and witness-signed. The signed attestation confirms: "this cookie handle was scanned by AIDefence version X at timestamp T and contained no PII / no detected threats."

- Replace the current cookie persistence in `ruflo-browser`'s `browser-cookies` MCP tool with the attested flow.
- The cookie handle exposes a `verifyAttestation()` method consumers MUST call before reuse; unverified handles refuse to attach to a new session.
- Federation peers (when ADR-097/111 is online) can request attested cookie handles from each other; the witness signature is the cross-installation trust boundary.

**Acceptance:**
- Cookie containing a value AIDefence flags as PII never persists; an audit event is written.
- A cookie handle whose witness signature is invalid refuses to attach to a session and emits a structured warning.
- A handle attested by Installation A and consumed by Installation B verifies successfully iff B trusts A's witness key.

**Non-goals (Phase 3):** rotating sealed-cookie encryption keys (future ADR); cross-engine cookie portability.

### Phase 4 — Wedge 4: Federated MCTS branch exploration

For exploratory browse-tasks (unfamiliar site, ambiguous goal), distribute parallel branch explorations across federation peers. Each peer explores one subtree, writes its trajectory vector to the shared HNSW index, and the queen node picks the highest-cosine-similarity branch to past successful ReasoningBank trajectories. Plan-MCTS / Agent Alpha style search, but the search is parallelizable across the installation mesh.

- New MCP tool: `browser/explore-mcts` — takes a goal + initial URL, returns the best trajectory by HNSW-similarity to past successes.
- Federation message type `browser_mcts_branch` carries an opaque branch ID, parent-trajectory pointer, and depth budget.
- Each peer runs the branch in an isolated browser session (RVF container per branch), reports the trajectory vector and a self-evaluated value back to the queen.

**Acceptance:**
- On a controlled benchmark task with N=5 federation peers, MCTS exploration produces a higher success rate than single-process exploration at equal wall-clock budget.
- A peer that returns a trajectory whose witness signature fails is excluded from the branch aggregation.
- Cost-tracker reports per-peer spend; the queen can early-terminate branches over budget.

**Non-goals (Phase 4):** running MCTS on every task — gate behind explicit `mcts: true` config; this is for hard tasks only.

### Phase 5 — Cost-aware per-action model routing + GOAP pre-planning

Compose with existing ruflo primitives — no new architecture:

- Wire `hooks_route` per browser action: simple DOM-present actions → Agent Booster (Tier 1, $0); visual grounding on unfamiliar pages → Haiku (Tier 2); plan-level reasoning + recovery → Sonnet/Opus (Tier 3). Cost-tracker already logs per-action spend.
- Wire `ruflo-goals` GOAP planner: before touching the browser, produce an action plan with preconditions/effects against AgentDB causal graphs. Dry-run validation surfaces likely failures (e.g. "this site requires login; you have no cookie attestation") before consuming a real browser session.

**Acceptance:**
- ≥30% of browser actions route through Agent Booster (Tier 1, $0) on a representative workload.
- GOAP dry-run catches at least one class of failure (missing cookie / missing auth state) before the live session starts on the test suite.
- Cost-tracker can produce a per-trajectory cost report broken down by tier.

**Non-goals (Phase 5):** retraining a model for routing; reuse the existing intelligence pipeline.

### Phase 6 — Substrate primitives: Session Capsule + adapter abstraction + risk classes

Extend Phase 3's cookie vault into the full **SessionCapsule** model (origins[], browser-profile, encrypted-state-ref, reuse-policy, consent-proof, witness-chain-head). Expose a single `BrowserExecutionAdapter` interface that wraps the existing AgentBrowserAdapter and adds shim adapters for Playwright/Stagehand/Browserbase/local Chrome. Add a `RiskClassifier` that maps planned actions to the 7-class risk taxonomy and gates autonomous execution.

**Acceptance:**
- Login-once / reuse-many round-trip works across two installations (same project key) with policy enforcement
- `BrowserExecutionAdapter.execute()` dispatches to ≥2 backends (agent-browser + one of Playwright/Stagehand) with byte-identical observation shape
- Risk-class-4-and-above actions block on `approval_required` events
- `ConsentProof` is signed + verifiable; revoke flow invalidates downstream replays

### Phase 7 — Workflow Compiler + production-aware UCT

Compile winning MCTS traces (Phase 4) into deterministic YAML workflows with selector fallback graphs and policy manifests. Extend Phase 4's UCB1 to use the production-aware formula (Q + C·√(ln(N)/n) + R − λ·risk − μ·cost − α·auth). Add the Recorder/Learner node roles for cross-installation workflow exchange.

**Acceptance:**
- A successful MCTS trace compiles to a YAML workflow with ≥1 selector fallback per step
- Replaying the compiled workflow on a fresh installation succeeds end-to-end (without re-exploration)
- Production-aware UCT scores correlate with measured replay-success on a held-out benchmark
- ≥30% token reduction on a second run of a previously-solved task (rubric row 5)

## Phase summary

| Phase | Wedge | Composed primitives | Ships as |
|---|---|---|---|
| 0 | Convergence + upgrade | `agent-browser@0.27`, fold plugin into package | alpha.4 ✅ |
| 1 | Signed trajectories | RVF + witness + replay-with-mutation | alpha.5 ✅ |
| 2 | Causal self-healing | AgentDB causal edges + adapter retry hook | alpha.6 ✅ |
| 3 | Attested cookie vault | AIDefence + RVF + witness | alpha.7 ✅ |
| 4 | Federated MCTS | Federation v1 + HNSW + ReasoningBank | alpha.8 ✅ |
| 5 | Cost-aware routing + GOAP | hooks_route + ruflo-goals + cost-tracker | alpha.9 ✅ |
| 6 | Session Capsule + adapters + risk classes | Capsule schema + BrowserExecutionAdapter + RiskClassifier | alpha.10 🚧 |
| 7 | Workflow Compiler + production-aware UCT | YAML workflows + selector fallback graphs + UCT extension | alpha.11 ⏳ |

## Open questions

- **Holo1 Localizer adoption.** Surfer-H's open-weight 7B Localizer model is the current grounding SOTA. Should we ship a `browser/localize` MCP tool backed by a self-hosted Holo1 via `ruvllm` routing? Defer to a Phase 6 follow-up ADR once Phases 0–2 land — Phase 0 alone closes most of the perceived gap.
- **Anti-bot stealth.** Stagehand outsources this to Browserbase's managed infrastructure. Self-hosting CDP-stealth has its own moral hazard (enables abuse). Defer; if/when a customer asks, scope a separate ADR.
- **Witness key rotation for cross-installation cookie attestation.** ADR-103 covers project-key rotation but not federation-fanout. Likely needs an ADR-122-companion before Phase 3 ships across federations.

## References

- Surfer-H + Holo1 (current WebVoyager SOTA, 92.2%): https://arxiv.org/abs/2506.02865
- Plan-MCTS for web navigation: https://arxiv.org/html/2602.14083
- Grounding Computer Use Agents on Human Demonstrations: https://arxiv.org/pdf/2511.07332
- Stagehand v3 (CDP-native): https://www.browserbase.com/changelog/stagehand-v3
- Browser Use (DOM+vision hybrid): https://github.com/browser-use/browser-use
- Skyvern (Validator loop): https://www.skyvern.com/blog/how-skyvern-reads-and-understands-the-web/
- OpenAI Operator / CUA: https://openai.com/index/computer-using-agent/
- An Illusion of Progress? Assessing Web Agents: https://arxiv.org/html/2504.01382v4
- ADR-103 (witness temporal history): `v3/docs/adr/ADR-103-witness-temporal-history.md`
- ADR-104 (federation wire transport): `v3/docs/adr/ADR-104-federation-wire-transport.md`
- ADR-118 (AIDefence 2.3.0): `v3/docs/adr/ADR-118-aidefence-2.3.0-upgrade.md`
- ADR-121 (embeddings ruvector upgrade): `v3/docs/adr/ADR-121-embeddings-ruvector-upgrade.md`
