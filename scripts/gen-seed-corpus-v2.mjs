#!/usr/bin/env node
/**
 * gen-seed-corpus-v2.mjs — Richer seed corpus for ADR-149 (DRACO Phase B).
 *
 * The v1 corpus (scripts/gen-seed-corpus.mjs) shipped tasks like
 * "add a console.log to cache" — terse, no code context. The LLM judge
 * couldn't reliably grade responses to underspecified prompts, so the
 * measured scores topped out at ~42% across all models and the cost-optimal
 * router always picked the cheapest because the quality signal was weak.
 *
 * v2 fixes both ends:
 *   1. Tasks carry embedded code context (drawing on the tasks that
 *      benchmark-models.mjs and benchmark-models-midtier.mjs already use
 *      successfully for grading), so the judge has something concrete to
 *      score against.
 *   2. Embeddings are real 384-dim @xenova/transformers Xenova/all-MiniLM-L6-v2
 *      vectors (not synthetic deterministic 32-dim). The KRR can then learn
 *      a real per-query → per-model mapping that generalises to live traffic.
 *
 * Each row persisted carries `embedding`, `scores` (empty — filled by the
 * measurement step), `task` (the prompt the model sees), and `tier`
 * ('cheap' | 'mid' | 'strong'). `benchmark-seed-corpus.mjs` reads task+tier
 * directly from the corpus (no template regeneration).
 *
 * USAGE
 *   node scripts/gen-seed-corpus-v2.mjs           # write to default seed-rows.json
 *   node scripts/gen-seed-corpus-v2.mjs --out /tmp/corpus.json
 *   node scripts/gen-seed-corpus-v2.mjs --no-write  # dry run, print summary only
 *
 * Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const DEFAULT_OUT = resolvePath(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'assets', 'model-router', 'seed-rows.json');
const PROVENANCE_OUT = resolvePath(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'assets', 'model-router', 'seed-rows.provenance.json');

// ============================================================================
// CLI args
// ============================================================================
function parseArgs(argv) {
  const a = { out: DEFAULT_OUT, write: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--no-write') a.write = false;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/gen-seed-corpus-v2.mjs [--out PATH] [--no-write]');
      process.exit(0);
    }
  }
  return a;
}
const ARGS = parseArgs(process.argv);

// ============================================================================
// Task corpus — 30 tasks with embedded code context, mixed across tiers.
//
// Cheap (12): structural single-file edits with concrete code
// Mid (10):   multi-step refactor / design / debug
// Strong (8): distributed-systems / security / architecture reasoning
// ============================================================================

const TASKS = [
  // ─── CHEAP TIER (single-file, structural, has clear right answer) ──────────
  { tier: 'cheap', task: 'Rename `count` to `total` in this code. Return ONLY the corrected JavaScript, no prose:\n\nlet count = 0;\nfor (const x of items) { count += x; }\nreturn count;' },
  { tier: 'cheap', task: 'Add a console.log("debug:", value) on the line before the return. Return ONLY the JavaScript:\n\nfunction f(value) {\n  return value * 2;\n}' },
  { tier: 'cheap', task: 'Convert this `var` declaration to `const`. Return ONLY the JavaScript:\n\nvar name = "alice";' },
  { tier: 'cheap', task: 'Add TypeScript type annotations to the parameter and return value. The function adds two numbers. Return ONLY the corrected TS:\n\nfunction add(a, b) { return a + b; }' },
  { tier: 'cheap', task: 'Wrap this in a try/catch that logs the error. Return ONLY the JavaScript:\n\nconst data = JSON.parse(input);' },
  { tier: 'cheap', task: 'Fix the spelling in the comment. Return ONLY the JavaScript:\n\n// Recieves data from the server\nfunction handle() {}' },
  { tier: 'cheap', task: 'Remove the unused import `path`. Return ONLY the JavaScript:\n\nimport { readFileSync } from "fs";\nimport path from "path";\n\nconsole.log(readFileSync("./x"));' },
  { tier: 'cheap', task: 'Add the TypeScript return type annotation. The function returns a string. Return ONLY the TS:\n\nfunction greet(name: string) { return `hello ${name}`; }' },
  { tier: 'cheap', task: 'Convert this camelCase variable name to kebab-case (as a string). Return ONLY the string in quotes: myHelperFunction' },
  { tier: 'cheap', task: 'Increment the counter variable by 1. Return ONLY the JavaScript:\n\nlet counter = 0;' },
  { tier: 'cheap', task: 'Convert this function expression to an arrow function. Return ONLY the JavaScript:\n\nconst double = function(n) { return n * 2; };' },
  { tier: 'cheap', task: 'Add a default value of 10 for parameter `n`. Return ONLY the JavaScript:\n\nfunction times(n) { return n * 3; }' },

  // ─── MID TIER (multi-step, requires understanding + idiomatic output) ─────
  { tier: 'mid', task: 'Refactor this if/else chain into the Strategy pattern using TypeScript classes. Return ONLY the refactored code:\n\nfunction processPayment(method: string, amount: number) {\n  if (method === "card") return { ok: true, txn: "card-" + amount };\n  if (method === "paypal") return { ok: true, txn: "pp-" + amount };\n  if (method === "bank") return { ok: amount > 10, txn: amount > 10 ? "b-" + amount : null };\n  throw new Error("unknown");\n}' },
  { tier: 'mid', task: 'Design the minimal TypeScript types for an event-sourced bank account: Event union (Deposit, Withdraw, AccountOpened, AccountClosed), a Reducer function, and a Snapshot type. Each event has timestamp and id. Withdraw must include a reason. Return ONLY the TypeScript.' },
  { tier: 'mid', task: 'Implement a JavaScript function `longestSubarrayWithSumAtMost(arr, k)` that returns the length of the longest contiguous subarray whose sum is <= k. Use the sliding-window technique (O(n)). Include 3 inline test cases as comments. Return ONLY the JavaScript.' },
  { tier: 'mid', task: 'Implement a token-bucket rate limiter in TypeScript: `class TokenBucket { constructor(capacity: number, refillRatePerSec: number); tryAcquire(tokens?: number): boolean; }`. Refill lazily on each check. Include JSDoc on public methods. Return ONLY the TS class.' },
  { tier: 'mid', task: 'Write 3 Vitest unit tests in TDD London School (mock-first) style for this UserService. Mock the repo with vi.fn. Cover: (1) findById returns user, (2) findById returns null, (3) createUser calls repo.save with lowercased email. Return ONLY the test code.\n\nclass UserService {\n  constructor(private repo: { findById(id: string): User | null; save(u: User): User }) {}\n  findById(id: string) { return this.repo.findById(id); }\n  createUser(input: { email: string; name: string }) {\n    return this.repo.save({ id: "new", email: input.email.toLowerCase(), name: input.name });\n  }\n}' },
  { tier: 'mid', task: 'Design the OpenAPI 3.0 paths block (paths only, not full spec) for a Todo REST API: list (cursor pagination), get-by-id, create, partial-update, delete. Inline response schemas (no $ref). Return ONLY YAML.' },
  { tier: 'mid', task: 'Write a JavaScript regex that matches a GitHub PR URL on github.com of form /owner/repo/pull/NUMBER. Capture owner, repo, number as named groups. Then write 3 inline asserts (valid, invalid non-github, edge case). Return ONLY the JS.' },
  { tier: 'mid', task: 'Write a Dockerfile that builds a TypeScript Node.js app in a multi-stage build: stage 1 installs deps and compiles, stage 2 is slim production with only the compiled output and prod node_modules. Use node:20-alpine. Cache npm install separately. Return ONLY the Dockerfile.' },
  { tier: 'mid', task: 'Audit this JWT-handling code for 3 specific security issues and produce a corrected version. Return your answer as JSON: { "issues": [{"line": N, "issue": "...", "severity": "high|medium|low"}], "fixed_code": "..." }. No prose outside JSON.\n\nconst jwt = require("jsonwebtoken");\nfunction verify(token) {\n  const secret = process.env.JWT_SECRET || "devsecret";\n  const decoded = jwt.verify(token, secret);\n  console.log("user:", decoded);\n  return decoded;\n}' },
  { tier: 'mid', task: 'Find the race condition in this Node.js code and produce a corrected version. Return JSON: { "bug": "...", "why_unsafe": "...", "fixed_code": "..." }. No prose outside JSON.\n\nconst fs = require("fs");\nasync function increment() {\n  const data = JSON.parse(await fs.promises.readFile("counter.json"));\n  data.n += 1;\n  await fs.promises.writeFile("counter.json", JSON.stringify(data));\n}' },

  // ─── STRONG TIER (architecture / multi-system reasoning) ──────────────────
  { tier: 'strong', task: 'Write a PostgreSQL migration that adds a NOT NULL `created_at TIMESTAMPTZ` column with default NOW() to a 50M-row `orders` table, AND a separate down migration. Must be safe to run on a live system without locking writes for more than ~1s. Return ONLY the two SQL files concatenated, separated by `-- DOWN --`.' },
  { tier: 'strong', task: 'Compare CRDT and OT (Operational Transform) for a collaborative text editor. List 4 concrete trade-offs as JSON: { "tradeoffs": [{"dimension": "...", "crdt": "...", "ot": "...", "favors": "crdt|ot|neither"}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Design a backwards-compatible API deprecation path for an existing GET /users/:id endpoint, where the response shape needs to change (rename `email` → `primary_email`, add nested `verification: { status, verified_at }`). Spec the migration across 3 release trains. Return as structured plan with phases and consumer expectations. JSON: { "phases": [{"phase": N, "duration": "...", "server_behavior": "...", "client_action": "...", "rollback": "..."}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Plan a zero-downtime migration of an `orders` table from a single postgres instance (~200GB, 50M rows) to a sharded postgres setup (4 shards by `customer_id`). Output as JSON: { "phases": [{"phase": N, "objective": "...", "data_flow": "...", "cutover_risk": "low|medium|high", "rollback": "..."}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Design an event-sourced architecture for an inventory system (products, stock levels, orders). Include: domain events, aggregate boundaries, snapshot strategy, and replay path. Return as JSON: { "events": [...], "aggregates": [{"name": "...", "invariants": "...", "events_owned": [...]}], "snapshot_strategy": "...", "replay_strategy": "..." }. No prose outside JSON.' },
  { tier: 'strong', task: 'Write a threat model for a public webhook receiver that accepts user-provided JSON payloads up to 100KB. Use STRIDE categorization. Return as JSON: { "threats": [{"category": "S|T|R|I|D|E", "scenario": "...", "mitigation": "...", "residual_risk": "low|medium|high"}] }. Include at least 6 threats. No prose outside JSON.' },
  { tier: 'strong', task: 'Reason about the consistency guarantees of a leader-based replicated key-value store under (a) a network partition that isolates the leader, (b) recovery when the partition heals, and (c) a stale read against a follower that hasn\'t caught up. Return as JSON: { "scenarios": [{"name": "...", "guarantee": "...", "what_clients_see": "...", "mitigation": "..."}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Architect a multi-tenant database schema with row-level security for a SaaS application where tenants must NEVER see each other\'s data. Cover: schema-level isolation choices, RLS policy design, application-layer enforcement. Return as JSON: { "isolation_strategy": "...", "rls_policies": [{"table": "...", "policy_sql": "..."}], "app_layer_guards": [...], "audit_strategy": "..." }. No prose outside JSON.' },

  // Iter 4 (ADR-149) — 10 more strong-tier tasks to grow the corpus from 8 to 18.
  // Mix: distributed systems, security audits, debugging, multi-system architecture.
  { tier: 'strong', task: 'Design a distributed rate-limiter that enforces 1000 req/s per API key across N application servers behind a load balancer. Cover: counter storage (redis vs in-memory + gossip), clock skew handling, hot-key mitigation, failure modes. Return as JSON: { "architecture": "...", "counter_store": {"choice": "...", "rationale": "..."}, "clock_handling": "...", "hot_key_mitigation": "...", "failure_modes": [{"mode": "...", "behavior": "..."}], "tradeoffs": [...] }. No prose outside JSON.' },
  { tier: 'strong', task: 'You\'re told the production p99 latency on POST /api/orders jumped from 80ms to 1.2s starting 3 hours ago. Database CPU is unchanged, app server count unchanged, no deploys in 24h. Walk through your debugging plan: hypotheses ranked by likelihood, what you\'d check first, what evidence would confirm/refute each. Return as JSON: { "hypotheses": [{"rank": N, "hypothesis": "...", "evidence_to_check": "...", "confirms_if": "...", "refutes_if": "..."}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Design the failure model for a Raft-based leader election in a 5-node cluster: what happens (a) when 2 followers crash, (b) when the leader\'s network is partitioned from a quorum, (c) when a follower\'s clock drifts 10 minutes ahead, (d) during a rolling restart. Cover liveness vs safety per scenario. Return as JSON: { "scenarios": [{"scenario": "...", "safety_holds": true, "liveness": "preserved|degraded|lost", "what_happens": "...", "client_visible": "..."}] }. No prose outside JSON.' },
  { tier: 'strong', task: 'Build a threat model for a SaaS file-upload endpoint that accepts user-provided PDFs up to 10MB and renders previews. Use STRIDE; include parser exploits, SSRF via embedded URLs, ZIP-of-death-style decompression, and rendering-sandbox escape. Return as JSON: { "threats": [{"category": "S|T|R|I|D|E", "scenario": "...", "attack_vector": "...", "mitigation": "...", "residual_risk": "low|medium|high"}] }. At least 7 threats. No prose outside JSON.' },
  { tier: 'strong', task: 'A distributed cache stampede is melting the database every time a popular cache key expires. Design 3 distinct mitigations (request coalescing, probabilistic early expiration, jittered TTLs). Compare them on: implementation complexity, correctness under contention, tail-latency impact, and operational surface. Return as JSON: { "mitigations": [{"name": "...", "how_it_works": "...", "complexity": "low|medium|high", "correctness": "...", "tail_latency": "...", "ops_surface": "..."}], "recommendation": "...", "rationale": "..." }. No prose outside JSON.' },
  { tier: 'strong', task: 'Plan an A/B test rollout of a major search-ranking algorithm change. Cover: success metrics + guardrails, ramp schedule (1% → 5% → 25% → 50% → 100%), what triggers a rollback, stratification (logged-in vs anonymous, top 10% queries vs long-tail), statistical-power requirements. Return as JSON: { "metrics": {"primary": [...], "guardrails": [...]}, "ramp_phases": [{"percent": N, "duration": "...", "go_no_go_check": "..."}], "rollback_triggers": [...], "stratification": [...], "power_analysis": "..." }. No prose outside JSON.' },
  { tier: 'strong', task: 'Audit this OAuth 2.0 implementation for security issues. Identify at least 4 distinct vulnerabilities, propose remediation for each, classify severity, and indicate which OWASP API Security 2023 category each maps to. Return as JSON: { "findings": [{"vulnerability": "...", "severity": "critical|high|medium|low", "owasp_api_2023_category": "API1|API2|..."}], "remediations": [{"finding_index": N, "fix": "..."}] }. No prose outside JSON.\n\nfunction loginCallback(req, res) {\n  const code = req.query.code;\n  fetch("https://oauth.example/token", { method: "POST", body: JSON.stringify({ code, client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET }) })\n    .then(r => r.json())\n    .then(t => { res.cookie("session", t.access_token); res.redirect(req.query.redirect_to || "/"); });\n}' },
  { tier: 'strong', task: 'Design a CRDT for a collaborative whiteboard with these operations: addShape, moveShape, deleteShape, changeColor. Cover: causal ordering, conflict resolution (concurrent move vs delete), garbage collection of tombstones, network bandwidth profile. Return as JSON: { "crdt_choice": "...", "operations": [{"op": "...", "merge_rule": "..."}], "tombstone_gc": "...", "bandwidth_profile": "...", "consistency_property": "..." }. No prose outside JSON.' },
  { tier: 'strong', task: 'A microservice runs 200 pods in production with an avg memory of 380MB and a p99 of 720MB. The OOM kill rate is ~5/hour and growing. Memory profile shows the spike correlates with a /reports endpoint that aggregates ~50k records. Propose a remediation that does NOT require horizontally scaling. Cover: hypothesis for the leak/spike, fix design (streaming vs pagination vs server-side aggregation), tradeoffs, validation plan. Return as JSON: { "hypothesis": "...", "fix_design": "...", "alternatives_considered": [...], "tradeoffs": [...], "validation_plan": [...], "rollback_criteria": "..." }. No prose outside JSON.' },
  { tier: 'strong', task: 'Design a write-through caching layer for a system where read:write is 50:1 and writes must remain strongly consistent. Cover: cache-key strategy, invalidation pattern, the read-after-write race (client A writes, client B reads from a replica before invalidation arrives), and how stale-but-not-too-stale reads are bounded. Return as JSON: { "key_strategy": "...", "invalidation_pattern": "...", "raw_race_handling": "...", "staleness_bound": "...", "fallback_on_cache_miss": "...", "ops_metrics_to_watch": [...] }. No prose outside JSON.' },
];

// ============================================================================
// Embed each task with @xenova/transformers (Xenova/all-MiniLM-L6-v2, 384-dim)
// ============================================================================

async function buildEmbedder() {
  const mod = await import('@xenova/transformers');
  // Older versions: pipeline. Newer have env config — we don't need it for
  // this script since we always want CPU + ONNX (the default).
  const extractor = await mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
  return async (text) => {
    // mean-pool + L2-normalize, matching the project's standard usage.
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    // `out` is a Tensor; .data is a Float32Array (or similar typed array).
    return Array.from(out.data);
  };
}

async function main() {
  console.log(`# Seed corpus v2 generation (ADR-149)`);
  console.log(`- tasks: ${TASKS.length} (cheap=${TASKS.filter(t => t.tier === 'cheap').length}, mid=${TASKS.filter(t => t.tier === 'mid').length}, strong=${TASKS.filter(t => t.tier === 'strong').length})`);
  console.log(`- embedder: @xenova/transformers Xenova/all-MiniLM-L6-v2 (384-dim, quantized ONNX)`);
  console.log(`- output: ${ARGS.out}`);
  console.log(`- write: ${ARGS.write}\n`);

  console.log('Loading embedder (first call downloads model, ~25 MB; subsequent calls use cache)...');
  const t0 = performance.now();
  const embed = await buildEmbedder();
  console.log(`Embedder ready in ${(performance.now() - t0).toFixed(0)} ms.\n`);

  const rows = [];
  let embedTotalMs = 0;
  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];
    const tStart = performance.now();
    const vec = await embed(t.task);
    embedTotalMs += performance.now() - tStart;
    rows.push({
      embedding: vec,
      scores: {},                                  // populated by benchmark-seed-corpus.mjs
      task: t.task,
      tier: t.tier,
    });
    process.stdout.write(`\r  embedded ${i + 1}/${TASKS.length}  (${embedTotalMs.toFixed(0)} ms cumulative)`);
  }
  process.stdout.write('\n\n');

  // Sanity: embedding dim should be 384.
  const dim = rows[0].embedding.length;
  console.log(`Per-row embedding dim: ${dim}`);
  if (dim !== 384) {
    console.warn(`[WARN] expected 384-dim, got ${dim}. Continuing but downstream tools assume 384.`);
  }

  if (!ARGS.write) {
    console.log('--no-write set; not writing corpus.');
    return;
  }
  mkdirSync(dirname(ARGS.out), { recursive: true });
  writeFileSync(ARGS.out, JSON.stringify(rows, null, 0));
  console.log(`Wrote ${rows.length} rows → ${ARGS.out}`);

  // Provenance sidecar — overwrites the v1 provenance so downstream tools
  // see the corpus is now v2 and which embedder produced it.
  const provenance = {
    generated_by: 'scripts/gen-seed-corpus-v2.mjs',
    generated_at: new Date().toISOString().slice(0, 19) + 'Z',
    schema_version: 2,
    dim,
    rows: rows.length,
    tier_distribution: {
      cheap:  rows.filter(r => r.tier === 'cheap').length,
      mid:    rows.filter(r => r.tier === 'mid').length,
      strong: rows.filter(r => r.tier === 'strong').length,
    },
    embedder: 'Xenova/all-MiniLM-L6-v2 (quantized ONNX via @xenova/transformers)',
    caveat: 'v2 corpus carries embedded code context per task; the LLM judge in scripts/benchmark-seed-corpus.mjs grades against that context. To regenerate: node scripts/gen-seed-corpus-v2.mjs. To re-measure scores: OPENROUTER_API_KEY=... node scripts/benchmark-seed-corpus.mjs --live.',
    notes: [
      'Rows persist `task` + `tier` directly — benchmark-seed-corpus.mjs reads these from the row instead of regenerating from templates (the v1 approach).',
      'Embeddings are real 384-dim semantic vectors from MiniLM, not synthetic deterministic projections.',
    ],
  };
  writeFileSync(PROVENANCE_OUT, JSON.stringify(provenance, null, 2));
  console.log(`Wrote provenance → ${PROVENANCE_OUT}`);
}

main().catch(e => { console.error('[gen-seed-corpus-v2] fatal:', e); process.exit(1); });
