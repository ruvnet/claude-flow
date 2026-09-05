# ADR-143 — Deterministic Codemods for Tier-1 Routing (replacing "Agent Booster")

**Status**: Accepted — Implemented in v3.10.x (2026-05-29)
**Related**: ADR-026 (3-tier model routing), ADR-142 (per-task bandit priors), #2238, docs/reviews/intelligence-system-audit-2026-05-29.md

## Context

ADR-026 advertises **Tier 1 = Agent Booster (WASM), <1 ms, $0, no LLM** for simple
code transforms (`var-to-const`, `remove-console`, …). An audit of the live code
paths found the claim was not real:

1. **The execution path was dead code.** The only methods that invoke a booster —
   `EnhancedModelRouter.execute()` / `tryAgentBooster()` and
   `TokenOptimizer.optimizedEdit()` — are called by *nothing* in the CLI or MCP
   runtime. Every caller uses `route()`, which only emits a *recommendation*.
2. **It was also wired wrong.** `tryAgentBooster()` built the edit from a
   natural-language instruction (`"Convert all var declarations to const"`) and
   passed that as `edit` to `agent-booster`. But `agent-booster` is a *fast-apply
   merge engine* (Morph/Cursor-style): `apply({ code, edit })` expects `edit` to be
   the **target code snippet**, not an instruction. Fed an instruction it returns
   `success:false, confidence:0, strategy:"failed"`. Every Tier-1 call would have
   failed even if `execute()` were wired in.
3. **The module didn't resolve.** `import('agentic-flow/agent-booster')` →
   `ERR_MODULE_NOT_FOUND`; `agentic-flow` exports only `main` + `reasoningbank`.

So `[AGENT_BOOSTER_AVAILABLE]` only ever told Claude "do this edit yourself with
the Edit tool." No WASM, no $0 transform, no booster in the loop — the
recommendation borrowed the booster's *name* for something that never touched it.
A phantom MCP tool `agent_booster_edit_file` was referenced in `agent-tools.ts`
but never existed.

The key realisation: **Agent Booster cannot do zero-LLM intent transforms.** It is
an *applier* of a pre-computed edit, not a *generator* of one. To make the
"$0, no-LLM Tier 1" claim literally true, Tier 1 must be a transform that needs no
edit snippet at all.

## Decision

Replace the Tier-1 "Agent Booster" execution with **deterministic codemods** for
the intents that can be transformed safely without inference, using the
**TypeScript compiler API** with **formatting-preserving text-range edits** (locate
exact AST nodes, splice the original source — never re-print the file, so comments
and whitespace survive).

**Deterministic ⇒ Tier 1 (codemod, $0, no LLM):**

| intent           | rule |
|------------------|------|
| `var-to-const`   | `const` when the binding is never reassigned anywhere in the file, else `let` (conservative: `let` is always valid) |
| `remove-console` | drop `console.*(…)` expression statements; whole-line removal only when the statement owns its line |
| `add-logging`    | insert one entry `console.log("<name> called")` per function body; idempotent (skips if already present) |

**Needs judgement ⇒ NOT a codemod, routes to a model (Tier 2/3):**

`add-types`, `add-error-handling`, `async-await`. These are still *detected* by the
intent classifier, but the router deliberately does **not** return Tier 1 for them —
they fall through to complexity-based model routing. Deterministic "codemods" for
these would either be trivial (`: any`) or unsafe, which is worse than routing to a
model.

`agent-booster` remains a dependency for general fast-apply (arbitrary
LLM-produced edit snippets), but it is **out of the Tier-1 path**.

## Implementation

- **`v3/@claude-flow/cli/src/ruvector/codemods/engine.ts`** — `applyCodemod(intent, code, {language})`
  + `isDeterministicCodemod()` + `DETERMINISTIC_CODEMOD_INTENTS` /
  `MODEL_ROUTED_INTENTS`. Never throws on malformed input; includes a
  **parse-diagnostic safety net** — if a transform would introduce new parse
  errors, it returns the input unchanged (`success:false`).
- **`enhanced-model-router.ts`** — Tier-1 branch gated on `isDeterministicCodemod`;
  handler renamed `agent-booster` → `codemod` with a `deterministic` flag.
  `agentBoosterIntent` kept as a deprecated alias of the new `codemodIntent`.
  `execute()`/`tryAgentBooster()` rewritten to `tryCodemod()` calling the engine
  (removed the broken NL-instruction `agentic-flow/agent-booster` import and the
  `npx agent-booster` subprocess fallback). `canUseAgentBooster` → deprecated alias
  of `canUseCodemod`.
- **`hooks_codemod` MCP tool** (`hooks-tools.ts`) — the real executable Tier-1
  surface. Transforms a `file` in place (path-validated, must exist; `dryRun`
  supported) or raw `code`. Reports `cost: 0`. Refuses non-deterministic intents.
- **Recommendation emitters** — `hooks_pre-task`, `hooks_route` (description), CLI
  `hooks pre-task`, and `agent-tools` now emit `[CODEMOD_AVAILABLE] … call
  hooks_codemod` instead of `[AGENT_BOOSTER_AVAILABLE]`; the phantom
  `agent_booster_edit_file` note now points at `hooks_codemod`.

## Consequences

- **The Tier-1 "$0, no-LLM" claim is now literally true** for the 3 deterministic
  intents, and reachable end-to-end (router → `[CODEMOD_AVAILABLE]` →
  `hooks_codemod` → file rewritten at $0).
- **Three intents lost their (fake) Tier-1 status.** `add-types`,
  `add-error-handling`, `async-await` now honestly route to a model. This is a net
  correctness gain — they never actually worked as $0 transforms.
- Formatting/comments are preserved (text-range edits, not re-printing).
- `agent-booster` is no longer on any hot path; the `agentic-flow/agent-booster`
  import and `npx` fallback are gone, so a missing module can no longer silently
  fail a route.

## Follow-up optimizations

1. **Batch / glob mode** (`hooks_codemod`) — beyond a single `file`, the tool now
   accepts `files[]` or a `glob` pattern and applies the intent across every match
   in one $0 call, returning a per-file + summary report. Paths are validated and
   contained to the project root; globs reject `..`; capped at 2000 files. Uses
   Node 22 `fs.globSync` (typed locally — `@types/node` here predates it).
2. **Scope-aware `var-to-const`** (`codemods/scope-analysis.ts`) — replaces
   file-global reassignment detection with function-scope resolution: a `var`
   becomes `const` unless *its own* binding is reassigned. A reassignment in an
   unrelated function no longer forces an unrelated `var` to `let`. Sound: it only
   ever errs toward `let`, never toward an incorrect `const`.
3. **Route-time dry-run** — when a target file is known, `route()` dry-runs the
   codemod and only emits `[CODEMOD_AVAILABLE]` if it actually changes something;
   a verified no-op falls through to model routing. With no file, it recommends
   Tier-1 best-effort (the executor verifies before writing).
4. **Measured benchmark + corpus guardrail + cost-trend wiring** —
   `bench/codemod-corpus.json` (12 golden cases) + `scripts/benchmark-codemods.mjs`
   measure correctness/latency and write a run JSON (tagged
   `summary.benchmark="codemod-tier1"`) into the cost-tracker plugin's runs dir,
   the exact path `cost-trend` reads. `cost-trend` is now benchmark-aware:
   `BENCH_NAME=codemod-tier1 node scripts/trend.mjs` shows the codemod series,
   while the default trend keeps showing only legacy booster runs (untagged /
   `benchmark==="booster"`) — no cross-benchmark conflation.
   `__tests__/codemod-corpus.test.ts` fails CI on any regression vs golden.

## Verification

- `__tests__/codemod-engine.test.ts` — 23/23 (incl. 3 scope-aware cases);
  `__tests__/codemod-routing.test.ts` — 4/4 (dry-run gating);
  `__tests__/codemod-corpus.test.ts` — 13/13 (golden guardrail).
- Build clean (`tsc -b`); `__tests__/mcp-tools-deep.test.ts` (107) and
  `__tests__/router-bandit.test.ts` (8) still green.
- **Measured benchmark (12-case corpus, this host):** 100% correct (12/12),
  avg **0.55 ms/edit**, p99 **3.1 ms**, **$0** measured cost (no API call);
  estimated savings vs an LLM edit ≈ $0.0024 (Haiku) / $0.036 (Sonnet) / $0.18
  (Opus) across the corpus.
- Manual end-to-end: router returns Tier-1 codemod for `convert var to const` on a
  file with `var`s (with edit count), falls through to Haiku on a no-op file, and
  best-effort Tier-1 with no file; `hooks_codemod` glob mode transforms a whole
  tree in one $0 call; refuses `add-types`.
