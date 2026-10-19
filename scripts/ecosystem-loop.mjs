#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRsiPlan, evaluateRsiPlan } from './lib/ecosystem-rsi.mjs';

export async function runEcosystemLoop(options) {
  const iterations = options.iterations ?? 2, maxDurationMs = options.maxDurationMs ?? 120000;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5) throw new Error('Iterations must be 1..5');
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 300000) throw new Error('Total duration must be 1..300000 milliseconds');
  let ledger = options.ledger ?? [];
  if (!Array.isArray(ledger) || ledger.length > 1000) throw new Error('Invalid ledger');
  const start = performance.now(), history = []; let receipt;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const remaining = Math.floor(maxDurationMs - (performance.now() - start));
    if (remaining < 1) break;
    const plan = await createRsiPlan(options);
    const previouslyKnown = ledger.some(entry => entry.inputHash === plan.inputHash);
    receipt = await evaluateRsiPlan(plan, { repoRoot: options.repoRoot, maxDurationMs: remaining, ledger });
    ledger = receipt.ledger.slice(-100);
    history.push({ iteration: iteration + 1, inputHash: plan.inputHash, checksPassed: receipt.checksPassed, uncoveredPackages: plan.uncoveredPackages.length, newSourceEvidence: !previouslyKnown });
    if (!receipt.sourceUnchanged || receipt.results.some(check => check.status === 'timedout')) break;
  }
  if (!receipt) throw new Error('Loop budget exhausted before evaluation');
  const failed = receipt.results.filter(check => check.status !== 'passed');
  return { ...receipt, ledger, loop: { requestedIterations: iterations, completedIterations: history.length, budgetMs: maxDurationMs, durationMs: performance.now() - start, history, newSourceIdentities: history.filter(item => item.newSourceEvidence).length, adoptionMeasured: false, automaticPromotion: false },
    nextActions: [...failed.map(check => ({ kind: 'check-regression', checkId: check.id, priority: 110, nextAction: 'Repair the failing registered check before expanding capability claims.' })), ...receipt.nextActions] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { repoRoot: process.cwd(), registryPath: 'data/ecosystem-capabilities.json', graphPath: 'data/npm-dependencies.latest.json', runtimePath: 'data/npm-runtime-relationships.latest.json', benchmarkPath: 'data/npm-download-benchmark.latest.json', changed: [] };
  let output = 'data/ecosystem-rsi.latest.json', ledgerPath = 'data/ecosystem-rsi.ledger.json';
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--iterations') options.iterations = Number(value);
    else if (key === '--max-duration-ms') options.maxDurationMs = Number(value);
    else if (key === '--max-checks') options.maxChecks = Number(value);
    else if (key === '--changed') options.changed.push(value);
    else if (key === '--output') output = value;
    else if (key === '--ledger') ledgerPath = value;
    else throw new Error(`Unknown option ${key}`);
  }
  try { options.ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await runEcosystemLoop(options);
  const protectedPaths = new Set(Object.keys(result.plan.sourceBinding.files).map(p => resolve(p)));
  if (protectedPaths.has(resolve(output)) || protectedPaths.has(resolve(ledgerPath)) || resolve(output) === resolve(ledgerPath)) throw new Error('Output must not overwrite inputs, sources or ledger');
  async function put(path, value) { await mkdir(dirname(resolve(path)), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temp, path); }
  await put(output, result); await put(ledgerPath, result.ledger);
  console.log(JSON.stringify({ output, cycles: result.loop.completedIterations, checksPassed: result.checksPassed, covered: result.plan.affected.length - result.plan.uncoveredPackages.length, affected: result.plan.affected.length, gate: result.gate.status }));
  process.exitCode = result.checksPassed ? (result.complete ? 0 : 2) : 1;
}
