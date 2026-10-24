#!/usr/bin/env node
/** Fail-closed coverage audit for the explicit bounded-RSI repair test workflow. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(ROOT, '../../../../../..');
const WORKFLOW = resolve(REPOSITORY_ROOT, '.github/workflows/rsi-experiment.yml');
const REPAIR_PREFIX = 'v3/@claude-flow/cli/scripts/rsi/repair/';

export function repairTests(directory = ROOT) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => entry.name).sort();
}

export function executableRepairReferences(workflowText) {
  assert.equal(typeof workflowText, 'string', 'workflow text');
  const references = [];
  for (const line of workflowText.split(/\r?\n/)) {
    const command = line.match(/^\s*run:\s*node\s+--test\s+(.+)\s*$/)?.[1];
    if (!command) continue;
    for (const token of command.trim().split(/\s+/)) {
      if (token.startsWith(REPAIR_PREFIX) && token.endsWith('.test.mjs'))
        references.push(token.slice(REPAIR_PREFIX.length));
    }
  }
  return references;
}

export function auditRepairTestCoverage(tests, references) {
  assert(Array.isArray(tests) && Array.isArray(references), 'coverage arrays');
  const counts = new Map();
  for (const name of references) counts.set(name, (counts.get(name) ?? 0) + 1);
  const missing = tests.filter(name => (counts.get(name) ?? 0) === 0);
  const duplicates = tests.filter(name => (counts.get(name) ?? 0) > 1);
  assert.deepEqual(missing, [], 'repair tests missing from executable workflow: ' + missing.join(','));
  assert.deepEqual(duplicates, [], 'repair tests referenced more than once: ' + duplicates.join(','));
  return { testFiles: tests.length, executableReferences: tests.length, missing: [], duplicates: [] };
}

export function auditRepositoryCoverage() {
  const tests = repairTests();
  const references = executableRepairReferences(readFileSync(WORKFLOW, 'utf8'));
  return auditRepairTestCoverage(tests, references);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(auditRepositoryCoverage())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
