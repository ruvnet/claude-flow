#!/usr/bin/env node
// @ts-check
/**
 * ruflo-ruos local benchmark (ADR-405): adapter overhead vs a raw call.
 *
 * Both sides run the same fake `claude` (prints immediately, then exits)
 * through /bin/sh on THIS machine, so network and fleet latency are zero and
 * what remains is the adapter's own cost: builder, prompt chunking, sha
 * check, launch, poll loop and ledger writes. Remote latency is measured
 * separately against a live desktop (see the PR) — it dominates in practice.
 *
 *   node scripts/bench.mjs [--n 20]
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuosHostAdapter } from './lib/adapter.mjs';
import { createLedger } from './lib/ledger.mjs';
import { createExecPollTransport } from './lib/jobs.mjs';

const n = Number(process.argv[process.argv.indexOf('--n') + 1]) || 20;
const root = mkdtempSync(join(tmpdir(), 'ruflo-ruos-bench-'));
const home = join(root, 'home');
const bin = join(root, 'bin');
mkdirSync(home, { recursive: true });
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho first; cat > /dev/null; echo done\n');
chmodSync(join(bin, 'claude'), 0o755);
const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };

/** @param {string} cmd @returns {Promise<{stdout:string,stderr:string,exitCode:number}>} */
const sh = (cmd) => new Promise((res) => {
  execFile('/bin/sh', ['-c', cmd], { env }, (err, stdout, stderr) => res({ stdout, stderr, exitCode: err ? Number(/** @type {any} */ (err).code ?? 1) : 0 }));
});

/** bench-only transport: runs builder strings in a local shell */
const transport = { kind: /** @type {'fleet-mcp'} */ ('fleet-mcp'), exec: async (/** @type {any} */ _d, /** @type {string} */ c) => sh(c) };
const desk = { id: 'a'.repeat(32), flyMachineId: null, name: 'local', displayName: 'local', state: 'started', heartbeatStatus: 'ok', heartbeatAt: 0, ready: true };
const fleet = {
  listDesktops: async () => [{ ...desk, heartbeatAt: Math.floor(Date.now() / 1000) }],
  start: async () => {}, stop: async () => {}, keepAwake: async () => {},
  llmRoute: async () => ({ route: 'shared', provider: 'local', gateway: 'configured', keyPresent: true }),
};
const prompt = 'Summarise the repository README in three bullet points.\n'.repeat(20);

/** @param {number[]} xs */
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (/** @type {number} */ p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), min: +s[0].toFixed(1) };
};

const raw = [];
const firstOut = [];
const total = [];
for (let i = 0; i < n; i++) {
  writeFileSync(join(home, 'p.txt'), prompt);
  let t = performance.now();
  await sh(`cd "$HOME" && claude -p < p.txt`);
  raw.push(performance.now() - t);

  const ledger = createLedger({ cwd: join(root, 'proj'), callTool: null });
  const adapter = new RuosHostAdapter({ fleet, jobs: createExecPollTransport(transport), ledger, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))) });
  t = performance.now();
  const out = await adapter.run({ desktop: desk.id, prompt, runId: `r-bench${String(i).padStart(28, '0')}`, agentId: `bench-${i}`, timeoutSecs: 60, ignoreAutoStop: true });
  total.push(performance.now() - t);
  if (out.firstOutputMs !== null) firstOut.push(out.firstOutputMs);
}

const result = {
  n,
  promptBytes: Buffer.byteLength(prompt),
  rawCallMs: stats(raw),
  adapterFirstOutputMs: stats(firstOut),
  adapterTotalMs: stats(total),
  note: 'local /bin/sh, zero network; adapter = prepare + 1 chunk + launch + >=1 poll + ledger files. Poll sleep capped at 20ms here; production backs off 1s->10s.',
};
console.log(JSON.stringify(result, null, 2));
