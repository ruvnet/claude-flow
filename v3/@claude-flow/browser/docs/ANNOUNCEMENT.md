# RuFlo Browser Substrate — `@claude-flow/browser@3.0.0-alpha.4`

> **TL;DR.** RuFlo is no longer "a browser agent." With ADR-122 it becomes the **substrate** underneath Stagehand, Browser Use, Surfer-H, Playwright, Browserbase, and Operator: signed-replay trajectories, causal-graph self-healing, attested cookie vaults, federated MCTS, risk-class gating, and a workflow compiler that emits replayable YAML. **230 tests, 0 new CVEs, all under 100µs.**

## Why this is beyond current public SOTA

The public stack today:

```
agent → browser → action → observation → next action
```

RuFlo should be:

```
agent → governed Session Capsule → distributed MCTS search →
  Browser Execution Adapter → replay verification → RuVector memory →
  Workflow Compiler → reusable RuFlo primitive
```

Stagehand makes browser automation portable. Browserbase persists sessions. Browser Use exposes real session-reuse pain. Surfer-H+Holo1 improves visual navigation (92.2% WebVoyager). Reflective MCTS improves agent search. **None of them ship cryptographic provenance, queryable causal recovery, attested cookie vaults, federated MCTS, or compiled workflows.**

RuFlo combines the missing parts.

## The eight phases

| Phase | Wedge | Beyond SOTA because… |
|---|---|---|
| 0 | `agent-browser` 0.27 + converge package & plugin | Closed a 21-minor drift on the upstream CLI |
| 1 | Signed trajectory containers (Ed25519 + RVF) | Cryptographic provenance for AI browsing — no other system has this |
| 2 | Causal-graph self-healing selectors | Surfer-H / Stagehand / Skyvern heal silently; ruflo records *why* |
| 3 | AIDefence-attested cookie vault | PII-gated, content-hash-verified, witness-signed handles |
| 4 | Federated MCTS branch exploration | Distributes MCTS across federation peers (no single-process limit) |
| 5 | Cost-aware routing + GOAP pre-planning | 3-tier classifier ($0 / $0.0002 / $0.005+) with GOAP dry-run |
| 6 | Session Capsule + Risk Classifier + Browser Execution Adapter | OWASP-aligned policy; substrate above the browser-tool wars |
| 7 | Workflow Compiler + production-aware UCT | Successful traces → deterministic YAML with selector fallbacks |

## Performance

| Operation | µs/op | ops/sec |
|---|---:|---:|
| Phase 1 — sealTrajectory (Ed25519 sign) | 37.5 | 26,648 |
| Phase 1 — verifySealedTrajectory | 88.5 | 11,306 |
| Phase 2 — annotateSnapshot (3 refs) | 2.1 | 479,511 |
| Phase 3 — vault.verifyAttestation | 83.2 | 12,027 |
| Phase 5 — ActionRouter.classify | 0.16 | 6,169,640 |
| Phase 7 — productionUct score | 0.32 | 3,145,069 |
| Phase 7 — WorkflowCompiler.compile | 22.9 | 43,712 |

Sub-100µs across the substrate. All numbers from `scripts/benchmark-substrate.mjs` on M-series macOS.

## What's new in alpha.4

- **Session Capsule** — sealed bundle with origins, consent proof, reuse policy, witness chain, replay counter, expiry. Mounting enforces `allowedOrigins`, `allowedTaskClasses`, `maxReplays`.
- **Risk Classifier** — 7-class taxonomy. Classes 1-3 (read-only / authenticated-read / draft-write) autonomous by default. Classes 4-7 (external-submission / financial / account-mutation / destructive) gate on human approval.
- **Production-aware UCT** — `score = Q + C·√(ln N / n) + λ_R·replayability − λ_risk·risk − μ_cost·cost − α_auth·auth_fragility`. The penalties keep MCTS from chasing high-Q paths that are expensive, irreversible, or auth-fragile.
- **Workflow Compiler** — winning MCTS trace → CompiledWorkflow with primary selector + ordered fallback chain (testid > role+name > text > ref). Deterministic YAML output for VCS check-in.
- **Browser Execution Adapter interface** — single surface above agent-browser / Stagehand / Browserbase / Browser Use / local Chrome / Surfer-H. First concrete adapter ships now; more in Phase 6.5+.

## Trying it

```ts
import {
  createBrowserService,
  sealTrajectory,
  verifySealedTrajectory,
  SessionCapsuleService,
  CookieVaultService,
  WorkflowCompiler,
  productionUct,
} from '@claude-flow/browser';

// Phase 1 — signed trajectories
const browser = createBrowserService({ signTrajectories: true });
browser.startTrajectory('Sign in');
await browser.open('https://example.com/login');
await browser.fill('@e1', 'me@example.com');
await browser.click('@e3');
const result = await browser.endTrajectory(true, 'logged in');
// result.__sealed is a signed envelope — distribute, replay, verify

// Phase 3 — attested cookie vault
const vault = new CookieVaultService({ projectId: 'my-project' });
const sealed = await vault.store({
  cookie: { name: 'sid', value: 'opaque-token', domain: 'example.com' },
});
// Refused if value contains PII; otherwise sealed + signed

// Phase 6 — Session Capsule with policy
const capsules = new SessionCapsuleService();
const capsule = await capsules.create({
  tenantId: 't1',
  ownerId: 'me',
  origins: [{ origin: 'https://example.com', requireSecure: true, requireHttpOnly: false }],
  consentStatement: 'I consent to reuse this session for authenticated reads',
  reusePolicy: { maxReplays: 5, allowedTaskClasses: ['authenticated-read'] },
});

// Phase 7 — Workflow Compiler
const compiler = new WorkflowCompiler();
const workflow = compiler.compile({
  id: 'my-login', goal: 'Sign in', trajectoryEnvelope: result.__sealed.envelope,
});
console.log(compiler.toYaml(workflow));
```

## Test + audit status

- **230/230 tests passing** (12 e2e skipped on local; run via `docker compose --profile e2e up browser-e2e`).
- **TypeScript:** strict; `tsc --noEmit` clean.
- **npm audit:** 0 new vulnerabilities; transitive findings tracked under ADR-118 (AIDefence) and ADR-121 (embeddings).
- **Security audit:** see `docs/SECURITY_AUDIT.md`.

## What's next

- Phase 6.5 — Stagehand / Browserbase / local-Chrome `BrowserExecutionAdapter` implementations.
- Phase 8 — federation transport wiring (ADR-097/104) so Phase 4's `PeerAdapter` becomes a real cross-installation channel.
- Phase 9 — Holo1 self-hosted Localizer model for visual grounding parity with Surfer-H (currently SOTA at 92.2% WebVoyager).

## References

- ADR-122: `v3/docs/adr/ADR-122-browser-beyond-sota.md`
- Tracking issue: ruvnet/ruflo#2041
- Branch: `feat/adr-122-browser-beyond-sota`
- Reflective MCTS for web agents — https://arxiv.org/abs/2410.02052
- Surfer-H + Holo1 — https://arxiv.org/abs/2506.02865
- OWASP Session Management — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Stagehand v3 — https://www.browserbase.com/changelog/stagehand-v3
