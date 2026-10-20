/**
 * ADR-404 benchmark: per-event latency of the classic hook path (a node
 * process per event, `hook-handler.cjs <event>`) against the ruflo mod's
 * in-process handler for the same work, on the same inputs and project.
 *
 *   npx tsx scripts/bench-mods-latency.ts [--spawn-runs 40] [--inproc-runs 2000] [--json]
 *
 * What it measures, and what it does not:
 *   - classic: wall time of spawning the helper with the event on stdin, until
 *     it exits (what Claude Code waits for on every prompt / Bash call / edit);
 *   - classic, handed over: the same spawn with RUFLO_MODS_OWNS set, i.e. what
 *     a classic hook still costs while the mod owns its event;
 *   - mod: the mod's hook run through the declaration-faithful harness
 *     (v3/@claude-flow/cli/__tests__/mods/harness.ts) with real files. It does
 *     NOT include Claude Code's own dispatch or worker hop; those were observed
 *     live separately (ADR-404, "Benchmarks").
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { register } from '../plugins/ruflo-mods/hooks/register';
import { loadMod, realWorld } from '../v3/@claude-flow/cli/__tests__/mods/harness';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const SPAWN_RUNS = arg('spawn-runs', 40);
const INPROC_RUNS = arg('inproc-runs', 2000);
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const HELPERS = join(REPO, 'v3', '@claude-flow', 'cli', '.claude', 'helpers');

type Stats = { n: number; median: number; p95: number; mean: number };
function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { n: s.length, median: at(0.5), p95: at(0.95), mean: s.reduce((a, b) => a + b, 0) / s.length };
}

// A project like one `ruflo init` leaves: helpers copied in, a ranked memory file.
const project = mkdtempSync(join(tmpdir(), 'ruflo-mods-bench-'));
const home = mkdtempSync(join(tmpdir(), 'ruflo-mods-bench-home-'));
cpSync(HELPERS, join(project, '.claude', 'helpers'), { recursive: true });
mkdirSync(join(project, '.claude-flow', 'data'), { recursive: true });
writeFileSync(join(project, '.claude-flow', 'data', 'ranked-context.json'), JSON.stringify({
  entries: Array.from({ length: 200 }, (_, i) => ({
    id: `e${i}`, words: [`topic${i % 17}`, 'implement', 'api', `module${i}`], pageRank: (i % 10) / 100, summary: `entry ${i}`, accessCount: i % 5,
  })),
}));
const helper = join(project, '.claude', 'helpers', 'hook-handler.cjs');
const env = { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: project, CI: '1', RUFLO_HOOK_DEDUP_DIR: join(home, 'dedup') };

function spawnBench(sub: string, input: object, extraEnv: Record<string, string> = {}, mutate?: (i: number) => object): Stats {
  const samples: number[] = [];
  for (let i = 0; i < SPAWN_RUNS + 3; i++) {
    const t = performance.now();
    spawnSync(process.execPath, [helper, sub], { input: JSON.stringify(mutate ? mutate(i) : input), cwd: project, env: { ...env, ...extraEnv }, encoding: 'utf8' });
    if (i >= 3) samples.push(performance.now() - t); // first runs warm the page cache
  }
  return stats(samples);
}

async function inprocBench(run: (i: number) => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < 50; i++) await run(i); // JIT warm-up
  const samples: number[] = [];
  for (let i = 0; i < INPROC_RUNS; i++) {
    const t = performance.now();
    await run(i);
    samples.push(performance.now() - t);
  }
  return stats(samples);
}

async function main() {
  const prompt = { prompt: 'implement the api for topic3 with tests' };
  const world = realWorld(project, {});
  const mod = loadMod(register, world);
  await mod.dispatch('session.start', { cwd: project, surface: null, isInteractive: false }, (e: any) => ({ cwd: e.cwd }));
  const passthrough = (e: any) => e;

  const rows = [
    {
      event: 'route (UserPromptSubmit / prompt.submit)',
      classic: spawnBench('route', prompt),
      handedOver: spawnBench('route', prompt, { RUFLO_MODS_OWNS: 'route,post-edit' }),
      mod: await inprocBench(() => mod.dispatch('prompt.submit', { text: prompt.prompt, wait: false, origin: { kind: 'composer' } }, passthrough)),
    },
    {
      event: 'pre-bash (PreToolUse / tool.check)',
      classic: spawnBench('pre-bash', { tool_input: { command: 'npm test' } }),
      handedOver: null,
      mod: await inprocBench(() => mod.dispatch('tool.check', { tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'b' }, () => ({ decision: 'allow' }))),
    },
    {
      event: 'post-edit (PostToolUse / tool.call)',
      classic: spawnBench('post-edit', {}, {}, (i) => ({ tool_name: 'Edit', tool_input: { file_path: `src/f${i}.ts` }, tool_use_id: `c${i}` })),
      handedOver: spawnBench('post-edit', {}, { RUFLO_MODS_OWNS: 'route,post-edit' }, (i) => ({ tool_name: 'Edit', tool_input: { file_path: `src/g${i}.ts` }, tool_use_id: `h${i}` })),
      mod: await inprocBench((i) => mod.dispatch('tool.call', { tool: 'Edit', tool_use_id: `m${i}`, file_path: `src/m${i}.ts` }, () => ({ result: 'ok' }))),
    },
  ];
  const flush = await inprocBench(async (i) => {
    await mod.dispatch('tool.call', { tool: 'Edit', tool_use_id: `f${i}`, file_path: `src/f${i}.ts` }, () => ({ result: 'ok' }));
    await mod.dispatch('turn.complete', { reason: 'answer' }, () => ({ text: '' }));
  });

  const env = { node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, spawnRuns: SPAWN_RUNS, inprocRuns: INPROC_RUNS };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ env, rows, flushPerTurn: flush }, null, 2));
  } else {
    const ms = (s: Stats | null) => (s ? `${s.median.toFixed(3)} / ${s.p95.toFixed(3)}` : 'n/a');
    console.log(`node ${env.node}, ${env.cpu} x${env.cores}; spawn n=${SPAWN_RUNS}, in-process n=${INPROC_RUNS}`);
    console.log('| event | classic spawn ms (median / p95) | classic, handed over ms | mod handler ms (in-process, no engine hop) |');
    console.log('|---|---|---|---|');
    for (const r of rows) {
      console.log(`| ${r.event} | ${ms(r.classic)} | ${ms(r.handedOver)} | ${ms(r.mod)} |`);
    }
    console.log(`| edit + per-turn flush (tool.call + turn.complete) | | | ${ms(flush)} |`);
  }
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

main();
