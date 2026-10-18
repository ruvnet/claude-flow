#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createRsiPlan, evaluateRsiPlan } from './lib/ecosystem-rsi.mjs';
const args = process.argv.slice(2), command = args.shift(), options = { changed: [], repoRoot: process.cwd() };
let output, ledgerPath;
for (let i = 0; i < args.length; i++) {
  const key = args[i], value = args[++i];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
  if (key === '--registry') options.registryPath = value;
  else if (key === '--graph') options.graphPath = value;
  else if (key === '--benchmark') options.benchmarkPath = value;
  else if (key === '--runtime') options.runtimePath = value;
  else if (key === '--changed') options.changed.push(value);
  else if (key === '--max-checks') options.maxChecks = Number(value);
  else if (key === '--max-duration-ms') options.maxDurationMs = Number(value);
  else if (key === '--output') output = value;
  else if (key === '--ledger') ledgerPath = value;
  else throw new Error(`Unknown option ${key}`);
}
if (!['plan', 'evaluate'].includes(command) || !options.registryPath || !options.graphPath || !output) throw new Error('Usage: ecosystem-rsi.mjs plan|evaluate --registry FILE --graph FILE --output FILE [--runtime FILE] [--changed PACKAGE] [--max-checks N]');
const plan = await createRsiPlan(options);
let result = { plan };
if (command === 'evaluate') {
  const ledger = ledgerPath ? JSON.parse(await readFile(ledgerPath, 'utf8')) : [];
  result = await evaluateRsiPlan(plan, { ...options, ledger });
}
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, selectedChecks: plan.selectedChecks.length, uncoveredPackages: plan.uncoveredPackages.length, gate: result.gate?.status ?? 'planned' }));
if (result.results && (!result.complete || result.results.some(check => check.status !== 'passed'))) process.exitCode = 1;
