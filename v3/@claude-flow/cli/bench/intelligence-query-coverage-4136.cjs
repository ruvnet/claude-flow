#!/usr/bin/env node
/**
 * Reproducible synthetic recall/latency comparison for #4136.
 * Usage: node bench/intelligence-query-coverage-4136.cjs <intelligence.cjs>
 * Run against a base revision and the candidate to compare identical inputs.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const helperPath = process.argv[2];
if (!helperPath) {
  process.stderr.write('Usage: node intelligence-query-coverage-4136.cjs <intelligence.cjs>\n');
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-recall-bench-'));
try {
  process.env.CLAUDE_PROJECT_DIR = root;
  const data = path.join(root, '.claude-flow', 'data');
  fs.mkdirSync(data, { recursive: true });

  const filler = Array.from({ length: 120 }, (_, i) => `background${i}`);
  const entries = Array.from({ length: 472 }, (_, i) => ({
    id: `decoy-${i}`,
    summary: `unrelated memory ${i}`,
    words: ['unrelated', 'memory', 'workflow', 'generic', ...filler],
    pageRank: 0.001,
  }));
  entries.push({
    id: 'generic-hub', summary: 'HTTP 500 incident index',
    words: ['http', '500', ...filler], pageRank: 0.15,
  });
  entries.push({
    id: 'correct', summary: 'PostgREST RPC P0002 mapping',
    words: ['postgrest', 'http', '500', 'p0002', 'rpc', ...filler], pageRank: 0.001,
  });
  fs.writeFileSync(path.join(data, 'ranked-context.json'), JSON.stringify({ entries }));

  const helper = require(path.resolve(helperPath));
  const prompt = 'why does PostgREST return HTTP 500 for P0002 from an RPC';
  const times = [];
  let first;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const hit = helper.getContextDetailed(prompt);
    times.push(performance.now() - start);
    if (i === 0) first = hit?.surfaced?.[0]?.id ?? null;
  }
  times.sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({
    entries: entries.length,
    calls: times.length,
    first,
    medianMs: Math.round(times[15] * 100) / 100,
    p95Ms: Math.round(times[28] * 100) / 100,
  }) + '\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
