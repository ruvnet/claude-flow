# ADR 437: The Cost page across providers: Claude Code, Codex, OpenRouter and local models

Status: Accepted (ships in ruflo-console 0.27.0 with ruflo-cost-tracker 0.27.0)

Date: 2026 10 03

Scope: `plugins/ruflo-cost-tracker` (`data/prices.json`, `scripts/_pricebook.mjs`, `_ledger.mjs`, `ledger.mjs`, `advise.mjs`, `local-cost.mjs`, `openrouter.mjs`, four skills), `plugins/ruflo-console` (`hooks/data/cost-ledger.ts`, `hooks/views/cost-providers.ts`, the Cost page)

Source: five research briefs (2026-10-03): the `npx skills` ecosystem, Claude Code, Codex CLI, OpenRouter, locally hosted models. Figures marked UNVERIFIED in the briefs are not relied on here.

## 1. The problem

The cost system priced Claude Code only, with three stale tiers (Sonnet at $3/$15 when the current rate is $2/$10), no de-duplication, no 5-minute/1-hour cache split, and a model it did not know cost $0 without a word. The Cost page knew only this session's spend from `usage()`. Nothing covered Codex, OpenRouter or local models, and nothing said what to change.

The `npx skills` search found no skill that tracks cost across providers, prices cache writes by TTL, covers local models or reads OpenRouter's billed cost. The only real Claude Code cost skill (ECC `cost-tracking`) is a reader of a hook's own log. What was worth taking: "latest cumulative row per session, never sum every row", "log missing means say so, never fabricate", prices in data not prose, a ranked report with the cheapest fix per driver, and an explicit yes before any metered action.

## 2. Decision

- **One provider-agnostic row**, read from logs already on the machine, nothing sent: `{provider, model, ts, session, input (uncached), cache_read, cache_write_5m, cache_write_1h, output, reasoning, effort, sidechain}`.
- **One dated, sourced price book** (`data/prices.json`, `COST_PRICES` to override). No rate is hard-coded anywhere; the old per-tier `PRICING` is now derived from it. An unknown model is **unpriced and listed, never $0**; a family fallback is marked approximate. A regex entry stops `gpt-5.6-sol` being priced as `gpt-5` (found by running the ledger on real logs).
- **USD and Codex credits are never added.** GPT-6 Codex models are billed in credits (the model name was read from a real rollout); their cached-input rate is unpublished, so cached input is billed at the input rate and the note says it is an upper bound.
- **Counting rules**, each a way trackers double-count, each held by a test that was shown to fail when the rule is broken: Claude de-duplicated by `message.id + requestId`; Codex by deltas of the running `total_token_usage` (never also `last_token_usage`), skipping unchanged totals, treating a falling total as a new base, cached input as a subset of input, replayed fork events and archived copies de-duplicated, the model from `turn_context`.
- **OpenRouter** (`openrouter.mjs`): network, so it prints the call and sends nothing without `--yes`; one host; the key only from the environment and never printed; OpenRouter's own `usage.cost` / `total_cost` is authoritative and is not recomputed from list prices; BYOK shows the 5% fee and the upstream cost apart.
- **Local models** (`local-cost.mjs`): cost = fixed (amortisation + idle power) + marginal (extra watts while generating), shown at 5/25/50/100% busy because utilisation decides the answer, with the busy fraction above which local beats a named hosted model. An estimate from the user's own inputs; throughput is not measured.
- **The advisor** (`advise.mjs`) reprices the user's own tokens: cache hit ratio, 1-hour cache writes that were not re-read enough to pay back, sub-agents on a top tier, Codex reasoning share, context bloat, unpriced models. A finding with no defensible number says `saving n/a`. It changes nothing.
- **The console Cost page** gains "Across providers" and "Savings you can act on". A mod cannot read logs, so one probe runs the plugin's `ledger.mjs --format json --advise` (one pass for both) from its install path, read from `installed_plugins.json` and validated; the probe does not run when the plugin is absent, and the page then says so and links the Plugin Catalog. It runs only while the Cost page is in front, at most every five minutes, locally.

## 3. Not done, and why

- **No live OpenRouter or local-server probe in the page.** OpenRouter needs a key and the network; the page does not ask for either. Use `/cost-openrouter`.
- **No electricity or hardware figures are invented.** They are inputs.
- **Claude transcript output tokens can under-count streamed output** (the per-step value is a placeholder until the result message): the ledger says so. `/usage` is authoritative for the live session.
- **Subscriptions bill by window, not by token.** Every dollar figure is a list-price estimate, labelled so.
- **Windows install paths are not accepted** by the probe's path check yet.
- **Not verified live in a real pane:** the page's look at narrow widths, and a run of the probe from a real install under Claude Code's `$.process.run` (the specs use the fixture world).

## 4. Kept honest

- Runtime tests build throwaway Claude and Codex logs and assert each counting rule, unpriced handling, USD/credits separation, the local break-even against its own cost curve, the OpenRouter consent gate and that a key in the environment is never echoed. The plugin smoke runs them (step 45).
- Console specs hold the parser, the path validation (rejecting `..`, shell characters, relative paths), that the argv is fixed, that a stale ledger is not shown as live, and the page copy.
