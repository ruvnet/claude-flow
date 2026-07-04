# ADR-175 — page-agent In-Page Natural-Language Browser Intent Layer

- **Status:** Proposed
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-150](ADR-150-metaharness-integration-surfaces.md) (optional-dependency + graceful-degradation posture), [ADR-174](ADR-174-memory-distillation-self-optimization.md) (distillation / self-learning loop that browser trajectories feed), `plugins/ruflo-browser/docs/adrs/0001-browser-skills-architecture.md`
- **Upstream:** `github.com/alibaba/page-agent` (npm `page-agent`, MIT)

## Context

The `ruflo-browser` plugin drives a real browser through the `agent-browser` CLI (Playwright under the hood), exposing **23 low-level, selector-based** MCP tools (`browser_click`, `browser_fill`, `browser_type`, `browser_snapshot` with `@e1` refs, `browser_eval`, `browser_screenshot`, session record/replay → RVF containers + ruvector trajectories + AgentDB selector memory + AIDefence gating). Every action requires a CSS selector or element ref; the model must read a snapshot and orchestrate each step imperatively. **There is no natural-language "perform this task" action.**

`page-agent` is the inverse architecture: **injected in-page JavaScript** that serialises the DOM to text (no screenshots, no vision model, no headless process of its own) and lets an LLM execute a multi-step intent in-page — `agent.execute('fill out and submit the checkout form')`. It takes an OpenAI-compatible endpoint (`{ baseURL, apiKey, model }`), ships as an npm package and an injectable IIFE bundle, and is MIT-licensed.

The two are complementary, not competing: the Playwright harness owns navigation, session capture, screenshots, cookies, and gating; page-agent adds the missing intent layer *inside* the page it controls.

## Decision

Add an optional **natural-language intent layer** to the browser plugin: a `browser_act` MCP tool that injects page-agent into the `agent-browser`-controlled page, executes an NL task in-page, routes page-agent's LLM through ruflo's own model layer, captures the resulting action trajectory into memory (feeding ADR-174 distillation), and gates the result through AIDefence.

| Layer | Owner | Responsibility |
|---|---|---|
| Outer harness | `agent-browser` / Playwright (existing) | navigate, session → RVF, screenshots, cookies, AIDefence |
| **In-page intent** | **page-agent (new)** | one NL call reasons over DOM-as-text and performs the multi-step action |

### Design constraints (load-bearing)

1. **Optional dependency (ADR-150 posture).** `page-agent` goes in `optionalDependencies`. `browser_act` returns `{ degraded: true, reason, hint }` — never throws — when it is absent. The CLI is fully functional without it (the 23 selector tools are unaffected). Removability is part of the contract.
2. **Model routing, not hardcoded Qwen.** page-agent's `{ baseURL, apiKey, model }` are resolved from ruflo's existing provider/router configuration (the same OpenAI-compatible surface the rest of the CLI uses), so browser intents are cost-governed. Because page-agent is **text-DOM (no vision)**, it routes naturally to the cheap tier (Haiku/local) — most intents are near-$0.
3. **Key safety.** The API key is resolved node-side and never emitted into page context / injected script strings. If page-agent's in-page mode would require the key in the page, proxy the completion through a local node endpoint so the key never crosses into the DOM.
3b. **Demo-endpoint firewall (fail-closed).** page-agent's only shipped browser bundle (`dist/iife/page-agent.demo.js`) auto-POSTs page content to Alibaba's public sandbox on inject (`https://page-ag-testing-*.<region>.fcapp.run`, `DEMO_MODEL`). We strip that tail, but the strip is best-effort text matching. The load-bearing guarantee is a fail-**closed** content firewall (`findDemoLeak`): if any known demo-endpoint signature survives the strip, `browser_act` **refuses to inject** and degrades — so an upstream bundle change that moves the marker can never silently re-enable the leak. (No fork required: the library core ESM is clean; the leak lives only in the demo bundle. A fork would mean maintaining a parallel 3-package copy forever to delete a few demo lines — the firewall achieves the security goal at near-zero maintenance.)
4. **Trajectory → memory (ADR-174 tie-in).** Each successful `execute()` records the intent + action trajectory as a `browser`-namespace memory entry (best-effort, never fatal), so browser intents feed the distillation/self-learning loop — over time the SONA/MoE model learns which intent→action sequences succeed. This closes the plugin's existing "AgentDB selector memory" into the same learning loop.
5. **AIDefence gating.** Returned page content/results pass through the existing AIDefence PII/injection gate before reaching the caller, matching the selector tools.
6. **Additive, never sole.** Text-DOM has blind spots (canvas, visual-only, heavy shadow-DOM). The screenshot + selector tools remain the fallback; `browser_act` is an added capability, not a replacement.

## Broader use cases (this tool is the foundation)

`browser_act` unlocks several follow-on integrations, sequenced by leverage:

1. **Natural-language acceptance gate** — power the browser-validation gate / `ruflo-testgen` / `production-validator` with `execute('log in, add an item, verify the total')` instead of manual selector orchestration. Cheapest real win.
2. **Learning web-task skill library** — page-agent trajectories → `browser` memory → distilled `reasoning_patterns` → auto-generated `browser-*` skills. The most strategic (compounds with ADR-174).
3. **DOM→text distiller** — reuse page-agent's serialiser as an input adapter to the distillation/embeddings pipeline for arbitrary HTML.
4. **Red/blue web executor** — page-agent as the action executor for `@metaharness/redblue` live-web adversarial tests, scored + human-gated.
5. **GOAP web operators** — expose `execute()` as a planning operator so `ruflo-goals` objectives span code **and** web.
6. **Federated web capability** — page-agent's MCP-server mode exposed across installations via `ruflo-federation`, zero-trust-gated.

## Alternatives considered

- **Reimplement NL intent over Playwright directly** — rebuild page-agent's DOM-text reasoning ourselves. Rejected: page-agent is a proven MIT implementation; reimplementing is cost with no differentiation.
- **Vision/screenshot agent for NL intent** — more expensive (needs a multimodal model), and we already have screenshots for the visual cases. Kept as the fallback lane, not the primary.
- **page-agent's Chrome-extension mode** — requires a real browser profile / user session; breaks headless + CI. Rejected in favour of the injectable IIFE inside the agent-browser-controlled page.

## Rollback

Remove `page-agent` from `optionalDependencies`; `browser_act` degrades to `{ degraded: true }` and every other browser tool is unaffected. No schema, no persisted state, no change to the 23 selector tools. The trajectory-recording side effect is additive to the `browser` memory namespace and never mutates existing data.

## Status of implementation

- `browser_act` MCP tool + optional-dependency wiring + model routing + trajectory capture + AIDefence gating + `browser-intent` skill + degraded-path tests — implemented alongside this ADR.
- Use cases 1–6 above are follow-ons, not part of this change.
