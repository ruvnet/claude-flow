export const meta = {
  name: 'intelligence-system-hardening',
  description: 'Implement audit fixes, build a real benchmark harness, optimize, validate, and rewrite perf docs with measured numbers',
  phases: [
    { title: 'Implement', detail: 'parallel fixes — distinct files, no conflicts' },
    { title: 'Validate', detail: 'build + tests; repair if broken' },
    { title: 'Benchmark', detail: 'real measurement harness -> JSON numbers' },
    { title: 'Optimize', detail: 'tune HNSW params, re-measure before/after' },
    { title: 'Docs', detail: 'rewrite README/CLAUDE.md perf claims with measured values' },
  ],
}

const REPO = '/Users/cohen/Projects/ruflo'
const CLI = `${REPO}/v3/@claude-flow/cli`
const RNG = 'an ' + 'RNG' + ' call (pseudo-random fabrication)'

const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['issue', 'applied', 'summary', 'files'],
  properties: {
    issue: { type: 'string' }, applied: { type: 'boolean' },
    summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    risk: { type: 'string' },
  },
}
const BENCH_SCHEMA = {
  type: 'object', additionalProperties: true,
  required: ['ran', 'results', 'harnessPath', 'notes'],
  properties: {
    ran: { type: 'boolean' }, harnessPath: { type: 'string' },
    results: { type: 'object', additionalProperties: true },
    notes: { type: 'string' },
  },
}
const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buildOk', 'testsOk', 'summary'],
  properties: {
    buildOk: { type: 'boolean' }, testsOk: { type: 'boolean' },
    summary: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } },
  },
}

phase('Implement')
const FIXES = [
  {
    key: 'reward-inversion', label: 'fix:reward-inversion',
    prompt: `Repo ${REPO}. CRITICAL BUG (audit finding #1, follow-up to #2222). In ${CLI}/src/commands/route.ts the \`route feedback\` command: a negative reward passed the documented way (\`-r -1.0\` or \`--reward -1.0\`) is parsed as +1.00 because the CLI flag parser strips the leading '-' from negative numeric values. Only \`--reward=-1.0\` (equals form) preserves the sign. So a user giving NEGATIVE feedback actively REINFORCES the bad agent.
Investigate the flag-parsing path (route.ts reward flag def ~line 399, value read ~line 419; and the shared CLI arg parser route uses). Fix so \`-r -1.0\`, \`--reward -1.0\`, and \`--reward=-1.0\` ALL yield reward = -1.0. Prefer the most localized correct fix; if the bug is in the shared parser, fix it there but verify other negative-number flags still work. Add a regression test (extend ${CLI}/__tests__/bug-cluster-2219-2226.test.ts or new) asserting parsed reward sign for all three syntaxes. Build (cd ${CLI} && npm run build) must stay clean. Report via schema.`,
  },
  {
    key: 'flash-fabrication', label: 'fix:flash-fabrication',
    prompt: `Repo ${REPO}. AUDIT FINDING #2: ${REPO}/v3/@claude-flow/swarm/src/attention-coordinator.ts line 972 fabricates a fake metric — it sets performanceStats.flashSpeedup to a value computed from ${RNG}: roughly "2.49 plus rng times 4.98", and line 973 hardcodes memoryReduction = 0.75. Reporting a made-up number as real telemetry is a credibility liability. The SAME pattern exists in ${REPO}/v3/@claude-flow/integration/src/attention-coordinator.ts — fix BOTH copies.
Replace the pseudo-random fabrication with an honest value: either (a) actually invoke the FlashAttention kernel's own benchmark()/measured path to get a real speedup if cheaply available, or (b) if no measurement is wired, set flashSpeedup to a sentinel meaning "unmeasured" (0 or null) and update any consumer/label so it never advertises a made-up 2.49x-7.47x. Do NOT invent a number. Update the doc-comment lines claiming "2.49x-7.47x speedup" in those files to "approximate sparse attention; speedup unverified — see docs/reviews/intelligence-system-audit-2026-05-29.md". Keep builds clean. Report via schema.`,
  },
  {
    key: 'embedding-observability', label: 'fix:embedding-observability',
    prompt: `Repo ${REPO}. AUDIT FINDING #3: in ${CLI}/src/memory/memory-initializer.ts, generateEmbedding() falls back to MOCK/hash embeddings when transformers.js/sharp fails to load, but the returned object still reports model: "Xenova/all-MiniLM-L6-v2" — so an operator cannot tell mock output (inverted semantics) from real ONNX output.
Add an explicit \`backend: 'onnx' | 'mock'\` field to the generateEmbedding return value, set truthfully by which path produced the vector. Surface it where the model name is reported — at minimum the memory_bridge_status MCP tool and any "embedding: all-MiniLM-L6-v2 (384-dim)" status string should also state backend (e.g. "...384-dim, backend=mock"). Do not change the embedding math. Add/extend a test asserting the field is 'mock' when the real model is unavailable. Keep builds clean. Report via schema.`,
  },
  {
    key: 'mcp-learning', label: 'fix:mcp-learning',
    prompt: `Repo ${REPO}. AUDIT FINDINGS #4 & #5 in ${CLI}/src/mcp-tools/hooks-tools.ts:
(A) trajectory-end (~line 2474-2493) feeds the EWC consolidator a SYNTHETIC gradient built from a sine wave over the index (an array of 384 values like sin(i*0.01)*(steps/10)) instead of the trajectory's real embedding-derived gradient. Replace it with a gradient derived from the actual recorded trajectory embeddings/outcome (mirror the library DISTILL path), or if real embeddings aren't available there, pass the real available signal or SKIP the EWC update rather than feeding sine-wave noise.
(B) hooks_intelligence_learn (~line 2920) is named "force learning cycle" but only reads/echoes stats. Either make it actually trigger a real learning/consolidation cycle (call the real distill/consolidate path), or rename/redescribe it truthfully so it doesn't claim to learn.
Make minimal correct changes. Keep build clean (cd ${CLI} && npm run build). Add a smoke assertion if practical. Report via schema. You are the ONLY agent editing hooks-tools.ts — own it.`,
  },
]
const fixes = (await parallel(
  FIXES.map((f) => () => agent(f.prompt, { label: f.label, phase: 'Implement', schema: FIX_SCHEMA, agentType: 'coder' }))
)).filter(Boolean)
log(`Implement: ${fixes.filter((f) => f.applied).length}/${FIXES.length} fixes applied`)

phase('Validate')
const validation = await agent(
  `Repo ${REPO}. Validate the working tree after parallel fixes to: route.ts, attention-coordinator.ts (swarm + integration), memory-initializer.ts, hooks-tools.ts.
1. cd ${CLI} && npm run build — must be clean (tsc). If the fixes introduced type errors, FIX them minimally and rebuild until clean.
2. If attention-coordinator changed and the swarm package has a build script: cd ${REPO}/v3/@claude-flow/swarm && npm run build (skip if no build script).
3. Run targeted tests: cd ${CLI} && npx vitest run __tests__/bug-cluster-2219-2226.test.ts __tests__/statusline-cost-display.test.ts plus any new tests the fixes added.
Report buildOk/testsOk and failures via schema. Do NOT weaken or delete tests to pass — fix the code.`,
  { label: 'validate:build+test', phase: 'Validate', schema: VALIDATE_SCHEMA, agentType: 'coder' }
)
log(`Validate: build=${validation?.buildOk} tests=${validation?.testsOk}`)

phase('Benchmark')
const bench = await agent(
  `Repo ${REPO}. Build a REAL reusable benchmark harness at ${REPO}/scripts/benchmark-intelligence.mjs (clean, documented, exit 0, safe to re-run) and RUN it to produce measured numbers against the built ${CLI}/dist exports on THIS machine:
- HNSW search vs in-process brute-force cosine baseline at N = 1000, 5000, 20000, and 50000 if feasible: per-query ms + speedup ratio + recall@10.
- Int8 quantization: measured compression ratio + reconstruction cosine.
- RaBitQ: memory compression ratio; retrieval speed only if a populated index is feasible else "not measured".
- SONA WASM adapt latency (ms/call, warmed).
- MoE: confirm the gate learns (probability shift after rewards).
- Embedding backend actually in use (onnx vs mock) — honest.
Every value MUST come from a run — never hardcode or guess; mark unmeasurable items null with a reason. Emit numbers in the schema results object and print a markdown table to stdout.`,
  { label: 'benchmark:harness', phase: 'Benchmark', schema: BENCH_SCHEMA, agentType: 'perf-analyzer' }
)
log(`Benchmark: ran=${bench?.ran} -> ${bench?.harnessPath || 'no harness'}`)

phase('Optimize')
const optimize = await agent(
  `Repo ${REPO}. HNSW search underperforms (audit ~1.48x peak, slower than brute force below N~5k). Attempt a GENUINE optimization, then RE-MEASURE with ${bench?.harnessPath || REPO + '/scripts/benchmark-intelligence.mjs'} and report before/after HONESTLY.
Levers (only what the code exposes): HNSW ef_construction / M / ef_search in the build/search path (${CLI}/src/memory + @ruvector/core config); the brute-force LIMIT 1000 fallback cap; ensuring the index is used above the crossover N.
Rules: (1) measure before AND after with the same harness; (2) if a change does NOT improve measured numbers, REVERT it and say so; (3) be honest — if HNSW only wins at large N (expected for ANN), report that rather than forcing a number. Report before/after and which changes you kept. Keep builds clean.`,
  { label: 'optimize:hnsw', phase: 'Optimize', schema: BENCH_SCHEMA, agentType: 'perf-analyzer' }
)
log(`Optimize: ran=${optimize?.ran}`)

phase('Docs')
const measured = JSON.stringify({ benchmark: bench?.results ?? null, optimized: optimize?.results ?? null })
const docs = await agent(
  `Repo ${REPO}. Rewrite performance claims across docs using the MEASURED numbers below (NOT old hardcoded multipliers). Measured JSON: ${measured}
Revise ONLY the perf/capability claims in:
- ${REPO}/README.md — "150x-12,500x", "2.49x-7.47x", "75x", "32x", "3.92x", SONA "<0.05ms" → measured values or honest qualifiers ("approximate", "at N>=20k", "unverified" where no benchmark exists).
- ${REPO}/CLAUDE.md, ${REPO}/v3/CLAUDE.md, ${CLI}/CLAUDE.md — the "V3 Performance Targets" / "Intelligence System" tables.
- Add a one-line pointer in each perf table to docs/reviews/intelligence-system-audit-2026-05-29.md and scripts/benchmark-intelligence.mjs as source of truth.
Rules: every number must trace to the measured JSON or be marked "unverified/target". Keep CONFIRMED real numbers (Int8 ratio, RaBitQ memory ratio, SONA adapt ms, MoE converges). Mark HNSW with its real measured speedup + "ANN wins at large N" caveat. Remove/qualify the Flash Attention 2.49-7.47x claim. Report files changed and before->after for each headline number via schema.`,
  { label: 'docs:rewrite', phase: 'Docs', schema: FIX_SCHEMA, agentType: 'coder' }
)
log(`Docs: applied=${docs?.applied} files=${(docs?.files || []).length}`)

return { fixes, validation, benchmark: bench, optimize, docs }