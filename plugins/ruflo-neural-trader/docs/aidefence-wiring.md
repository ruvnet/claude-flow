# AIDefence Wiring Sketch — ruflo-neural-trader

ADR-126 follow-up #50. Per ADR-118, market data ingestion should pass
through AIDefence for PII scan + prompt-injection block before any
content reaches an LLM prompt or AgentDB store.

This document defines the **proposed wire points**. Implementation is
deferred to a separate ADR-127 follow-up — see "Out of scope" below.

## Context

Today the `market-analyst` agent (the pipeline entry point per ADR-126
Phase 5) fetches market data via:

```bash
npx neural-trader --symbol AAPL --indicators rsi,macd,bollinger
npx neural-trader --regime-detect --symbol SPY
```

The two attack-relevant surfaces are:

1. **The `--symbol` argument** — user-supplied ticker string. A
   malicious team lead (or a compromised SendMessage upstream) could
   send `--symbol "AAPL; rm -rf /"` style payloads.
2. **The JSON response from `fetchLiveBars`** — a Yahoo / FMP / Polygon
   cloud roundtrip whose response body lands in an LLM prompt
   (regime classification) and an AgentDB store
   (`trading-analysis` namespace). A poisoned upstream feed could
   embed prompt-injection text in a company name or news field.

## Proposed AIDefence gates

| Gate | Where                             | Tool                                | Action on hit |
|------|-----------------------------------|-------------------------------------|---------------|
| 1    | `--symbol $TICKER` input          | `mcp__plugin_ruflo-core_ruflo__aidefence_is_safe` | Reject — refuse to invoke neural-trader; alert team lead |
| 2    | `fetchLiveBars` response body     | `mcp__plugin_ruflo-core_ruflo__aidefence_has_pii` | Redact PII placeholders; record in session manifest |
| 3    | LLM prompt body (pre-`neural_predict`) | `mcp__plugin_ruflo-core_ruflo__aidefence_is_safe` | Quarantine to `findings.md`; don't reach model |
| 4    | AgentDB store value               | `mcp__plugin_ruflo-core_ruflo__aidefence_scan`    | Block high-entropy tokens that look like leaked credentials |

These are exactly the four gates `ruflo-browser` and `ruflo-federation`
already use — same pattern, different ingest source.

## Proposed flow

```
                ┌────────────────────────────────────┐
                │   team lead → SendMessage          │
                │   { symbol: "AAPL" }               │
                └───────────────┬────────────────────┘
                                │
                                ▼
                        ┌───────────────┐
            GATE 1 ◄────│ aidefence_is  │  reject + alert if injection
                        │     _safe     │
                        └───────┬───────┘
                                │ safe
                                ▼
                  npx neural-trader --symbol AAPL …
                                │
                                ▼
                    ┌──────────────────────┐
                    │  fetchLiveBars JSON  │
                    └──────────┬───────────┘
                               │
                               ▼
                       ┌───────────────┐
            GATE 2 ◄───│ aidefence_has │  redact PII; flag in manifest
                       │     _pii      │
                       └───────┬───────┘
                               │ clean
                               ▼
                  ┌────────────────────────┐
                  │  LLM prompt assembly   │
                  │ (neural_predict input) │
                  └─────────┬──────────────┘
                            │
                            ▼
                     ┌───────────────┐
            GATE 3 ◄─│ aidefence_is  │ quarantine to findings.md if hit
                     │    _safe      │
                     └───────┬───────┘
                             │ safe
                             ▼
                  ┌─────────────────────┐
                  │ memory_store value  │
                  └──────────┬──────────┘
                             │
                             ▼
                     ┌───────────────┐
            GATE 4 ◄─│ aidefence     │ block leaked-credential patterns
                     │    _scan      │
                     └───────┬───────┘
                             │ clean
                             ▼
                       trading-analysis
                          namespace
```

## Concrete change list (deferred)

When ADR-127 picks this up, the changes would be:

1. **`agents/market-analyst.md`** — add a "PII & injection gates" section
   mirroring `plugins/ruflo-browser/agents/browser-agent.md:79-81`. Include
   the four-gate workflow above.
2. **`agents/market-analyst.md` allowed-tools** — add
   `mcp__plugin_ruflo-core_ruflo__aidefence_is_safe`,
   `mcp__plugin_ruflo-core_ruflo__aidefence_has_pii`,
   `mcp__plugin_ruflo-core_ruflo__aidefence_scan` to the frontmatter so the agent
   has the capability.
3. **`README.md`** — add a "Safety" section like
   `plugins/ruflo-browser/README.md:74-78`.
4. **`scripts/smoke.sh`** — add gates 12-14 asserting the agent
   declares the three AIDefence tools and that the README mentions the
   safety pipeline.
5. **`docs/adrs/0001-neural-trader-contract.md`** — add an ADR entry
   for the safety gates (or supersede with an ADR-127 reference).

None of those changes ship in this PR — the wiring is a separate
follow-up tracked under ADR-127.

## Why not implement in this PR?

- The wire point depends on the comms-pipeline boundary the ADR-126
  Phase 5 work introduces (`market-analyst → trading-strategist`).
  Wiring before that boundary is stable risks landing the gates in
  the wrong place.
- The four-gate flow has implications across `risk-analyst` and
  `trading-strategist` too (the regime verdict that flows downstream
  needs to be re-scanned at every hop if we treat the SendMessage
  envelope as another attack surface). That's an ADR-scope decision.
- The plugin already passes the supply-chain audit and has no
  hardcoded secrets, no eval, and no direct child-process spawn (see
  `security-audit-2026-05-20.md`). The AIDefence wiring is a
  defense-in-depth enhancement, not a remediation of an active gap.

## Out of scope (for this PR — implementation tracked elsewhere)

- The actual code/agent-prompt changes to wire the four gates
- The smoke gate additions
- The ADR-127 successor record

These will be picked up in a follow-up that references this sketch.

## Refs

- ADR-118 — `aidefence@2.3.0` upgrade
- ADR-126 Phase 5 — comms pipeline `market-analyst → trading-strategist`
- ADR-127 (proposed) — neural-trader safety gates wiring
- `plugins/ruflo-federation/README.md:74-82` — existing four-gate pattern
- `plugins/ruflo-browser/agents/browser-agent.md:79-81` — agent-prompt
  gate example
