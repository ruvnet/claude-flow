#!/usr/bin/env node
/**
 * node scripts/collect-ecosystem-dependencies.mjs --input data/npm-downloads.latest.json --output data/npm-dependencies.latest.json
 * Offline fixture: --input fixture.json where fixture is {inventory, manifests, errors?, capturedAt?}.
 * --concurrency 6 --timeout-ms 15000 --require-complete
 * Exit 1: hard cycle; exit 2: missing metadata with --require-complete; exit 3: input/fetch setup failure.
 * No credentials, lifecycle scripts, tarballs or metadata-provided URLs are used.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDependencyGraph, inventoryNames } from './lib/ecosystem-dependency-graph.mjs';

export async function collectManifests(names, { concurrency = 6, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be 1..16');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('timeout-ms must be 100..60000');
  const manifests = Object.create(null), errors = Object.create(null); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      try {
        const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
        manifests[name] = await response.json();
      } catch (error) { manifests[name] = null; errors[name] = error.name === 'TimeoutError' ? 'registry request timed out' : error.message; }
    }
  }));
  return { manifests, errors };
}

export async function main(argv = process.argv.slice(2)) {
  const options = { input: 'data/npm-downloads.latest.json', output: 'data/npm-dependencies.latest.json', concurrency: 6, timeoutMs: 15000, requireComplete: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--require-complete') options.requireComplete = true;
    else {
      const key = { '--input': 'input', '--output': 'output', '--concurrency': 'concurrency', '--timeout-ms': 'timeoutMs' }[argv[i]];
      if (!key || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
      options[key] = ['concurrency', 'timeoutMs'].includes(key) ? Number(argv[++i]) : argv[++i];
    }
  }
  const input = JSON.parse(await readFile(options.input, 'utf8'));
  const inventory = input.inventory ?? input, names = inventoryNames(inventory);
  if (!names.length) throw new Error('Inventory contains no packages');
  const captured = input.manifests ? { manifests: input.manifests, errors: input.errors ?? {} } : await collectManifests(names, options);
  const graph = buildDependencyGraph(inventory, captured.manifests, { capturedAt: input.capturedAt ?? new Date().toISOString(), errors: captured.errors });
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(JSON.stringify({ output: options.output, ...graph.counts, hardCycles: graph.hardCycles, releaseReady: graph.releaseReady }));
  return graph.hardCycles.length ? 1 : options.requireComplete && graph.missing.length ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 3; });
}
