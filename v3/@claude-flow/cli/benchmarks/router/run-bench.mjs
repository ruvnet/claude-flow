#!/usr/bin/env node
/**
 * ADR-391 router benchmark.
 *
 *   node benchmarks/router/run-bench.mjs                 # all candidates, writes results/
 *   node benchmarks/router/run-bench.mjs --candidate A   # one candidate (child mode)
 *
 * Candidates (ADR-391 §Context):
 *   A  current      routeTaskForBench, hash embedder            (default router)
 *   B  minilm       routeTaskForBench, MiniLM embedder          (ADR-390)
 *   C  ts-hash      hooks_route + CLAUDE_FLOW_ROUTER_TYPESAFE=1, hash embedder
 *   D  ts-onnx      hooks_route + typesafe, ONNX (bge-small) — needs
 *                   ROUTER_BENCH_TYPESAFE_MODEL_DIR pointing at a fetched models/ dir
 *
 * Each candidate runs in its own process from an empty temp cwd so no engine,
 * index or stored memory leaks between candidates. Requires a built dist/.
 * The corpus is read-only and frozen (see README.md for its sha256).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..', '..');
const CORPUS = join(HERE, 'corpus.jsonl');
const HOOKS = pathToFileURL(join(CLI_ROOT, 'dist', 'src', 'mcp-tools', 'hooks-tools.js')).href;
const CANDIDATES = ['A', 'B', 'C', 'D'];
const HIGH_CONF = 0.7;

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };

function loadCorpus() {
  const raw = readFileSync(CORPUS);
  const rows = raw.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { rows, sha256: createHash('sha256').update(raw).digest('hex') };
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

async function runChild(cand) {
  const { rows } = loadCorpus();
  const hooks = await import(HOOKS);
  const out = [];
  let cold = null;
  const route = async (prompt) => {
    if (cand === 'A' || cand === 'B') {
      const r = await hooks.routeTaskForBench(prompt, { embedder: cand === 'A' ? 'hash' : 'minilm' });
      return { agent: r.primaryAgent, confidence: r.confidence, embedder: r.embedder, method: r.method };
    }
    const r = await hooks.hooksRoute.handler({ task: prompt });
    const ts = r.typesafe ?? {};
    return {
      agent: r.primaryAgent?.type,
      confidence: r.primaryAgent?.confidence,
      routedBy: r.routedBy,
      tsUsed: !!ts.used,
      tsRaw: ts.choice ?? ts.answer?.choice ?? null,
      tsAbstain: ts.abstain ?? ts.answer?.abstain ?? null,
      tsReason: ts.reason,
    };
  };
  for (const row of rows) {
    const t0 = performance.now();
    const r = await route(row.prompt);
    const ms = performance.now() - t0;
    if (cold === null) cold = ms;
    out.push({ id: row.id, ms, ...r });
  }
  // The router keeps native handles (VectorDb, model sessions) alive; exit
  // explicitly once the result is flushed or spawnSync in the parent never returns.
  process.stdout.write('\n@@RESULT@@' + JSON.stringify({ cand, cold, out }) + '\n', () => process.exit(0));
}

function score(rows, preds, split) {
  const byId = new Map(preds.map((p) => [p.id, p]));
  const set = rows.filter((r) => split === 'all' || r.split === split);
  const labels = [...new Set(rows.map((r) => r.label))];
  let correct = 0, wrongHigh = 0, trapN = 0, trapOk = 0;
  const tp = {}, fp = {}, fn = {};
  for (const r of set) {
    const p = byId.get(r.id);
    const pred = p?.agent ?? 'none';
    const ok = pred === r.label;
    if (ok) correct++;
    else if ((p?.confidence ?? 0) >= HIGH_CONF) wrongHigh++;
    if (r.trap) { trapN++; if (ok) trapOk++; }
    if (ok) tp[r.label] = (tp[r.label] ?? 0) + 1;
    else { fn[r.label] = (fn[r.label] ?? 0) + 1; fp[pred] = (fp[pred] ?? 0) + 1; }
  }
  const f1s = labels.map((l) => {
    const t = tp[l] ?? 0, P = t + (fp[l] ?? 0), R = t + (fn[l] ?? 0);
    const prec = P ? t / P : 0, rec = R ? t / R : 0;
    return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  });
  return {
    n: set.length,
    accuracy: +(correct / set.length).toFixed(4),
    macroF1: +(f1s.reduce((a, b) => a + b, 0) / f1s.length).toFixed(4),
    wrongHighConfRate: +(wrongHigh / set.length).toFixed(4),
    trapAccuracy: trapN ? +(trapOk / trapN).toFixed(4) : null,
  };
}

function runParent() {
  const { rows, sha256 } = loadCorpus();
  const only = arg('--only') ? arg('--only').split(',') : CANDIDATES;
  const results = {};
  for (const cand of only) {
    const env = { ...process.env };
    delete env.CLAUDE_FLOW_ROUTER_TYPESAFE; delete env.CLAUDE_FLOW_ROUTER_EMBEDDER;
    delete env.CLAUDE_FLOW_ROUTER_TYPESAFE_MODEL_DIR; delete env.CLAUDE_FLOW_ROUTER_TYPESAFE_MANIFEST;
    if (cand === 'C' || cand === 'D') env.CLAUDE_FLOW_ROUTER_TYPESAFE = '1';
    if (cand === 'D') {
      const dir = process.env.ROUTER_BENCH_TYPESAFE_MODEL_DIR;
      if (!dir) { results[cand] = { skipped: 'ROUTER_BENCH_TYPESAFE_MODEL_DIR not set' }; continue; }
      env.CLAUDE_FLOW_ROUTER_TYPESAFE_MODEL_DIR = dir;
      env.CLAUDE_FLOW_ROUTER_TYPESAFE_MANIFEST = join(dir, 'manifest.json');
    }
    const cwd = mkdtempSync(join(tmpdir(), `router-bench-${cand}-`));
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--candidate', cand], { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 });
    const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT@@'));
    if (!line) { results[cand] = { error: (res.stderr || '').slice(-2000) }; continue; }
    const { cold, out } = JSON.parse(line.slice(10));
    const warm = out.slice(1).map((o) => o.ms);
    const r = {
      dev: score(rows, out, 'dev'),
      test: score(rows, out, 'test'),
      latencyMs: { cold: +cold.toFixed(2), p50: +pct(warm, 0.5).toFixed(3), p95: +pct(warm, 0.95).toFixed(3) },
      predictions: out,
    };
    if (cand === 'C' || cand === 'D') {
      // Raw typesafe pick before the lift/abstain gate, with abstain-gated rows counted as 'none'.
      const raw = out.map((o) => ({ id: o.id, agent: o.tsUsed ? o.tsRaw : (o.tsRaw && /abstain/.test(o.tsReason ?? '') ? 'none' : o.tsRaw), confidence: 0 }));
      r.rawTypesafeTest = score(rows, raw, 'test');
      r.typesafeUsedRate = +(out.filter((o) => o.tsUsed).length / out.length).toFixed(4);
    }
    results[cand] = r;
    console.log(`${cand}: test acc ${r.test.accuracy}  macroF1 ${r.test.macroF1}  traps ${r.test.trapAccuracy}  wrong@≥${HIGH_CONF} ${r.test.wrongHighConfRate}  p50 ${r.latencyMs.p50}ms p95 ${r.latencyMs.p95}ms cold ${r.latencyMs.cold}ms` + (r.rawTypesafeTest ? `  | raw typesafe acc ${r.rawTypesafeTest.accuracy}, used ${r.typesafeUsedRate}` : ''));
  }
  // ADR-391 promotion gate, each candidate vs A on the TEST split.
  const A = results.A;
  const gate = {};
  for (const c of Object.keys(results)) {
    if (c === 'A' || !results[c]?.test || !A?.test) continue;
    const dAcc = +((results[c].test.accuracy - A.test.accuracy) * 100).toFixed(2);
    const latReg = A.latencyMs.p95 > 0 ? +(((results[c].latencyMs.p95 - A.latencyMs.p95) / A.latencyMs.p95) * 100).toFixed(1) : null;
    gate[c] = {
      accuracyDeltaPts: dAcc,
      p95LatencyRegressionPct: latReg,
      requiredDependencyAdded: c === 'C' || c === 'D',
      passesAccuracy: dAcc > 2,
      passesLatency: latReg !== null && latReg <= 5,
      passesDependency: !(c === 'C' || c === 'D') ? true : 'optional-peer (allowed only as opt-in)',
    };
  }
  const receipt = { adr: 'ADR-391', ts: new Date().toISOString(), corpusSha256: sha256, node: process.version, host: process.platform + '-' + process.arch, highConfidence: HIGH_CONF, gate, results };
  const dir = join(HERE, 'results'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `router-bench-${receipt.ts.slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  console.log('\ngate:', JSON.stringify(gate, null, 1), '\nreceipt:', file, '\ncorpus sha256:', sha256);
}

if (arg('--candidate')) await runChild(arg('--candidate'));
else runParent();
