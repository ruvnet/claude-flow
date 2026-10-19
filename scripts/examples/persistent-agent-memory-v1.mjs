#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agentMemoryWorkflow } from '../lib/ecosystem-agent-memory-workflow.mjs';
import { memoryWorkflow } from '../lib/ecosystem-memory-workflow.mjs';

const resolveFrom = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const harnessResolveFrom = process.env.RUFLO_HARNESS_RESOLVE_FROM;
if (!resolveFrom || !harnessResolveFrom) throw new Error('RUFLO_MEMORY_RESOLVE_FROM and RUFLO_HARNESS_RESOLVE_FROM required');
if (process.argv[2] === '--worker') {
  let source = '';
  for await (const chunk of process.stdin) {
    source += chunk;
    if (Buffer.byteLength(source) > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
  }
  const { mode, databasePath, namespace, input, allowExecution } = JSON.parse(source);
  console.log(JSON.stringify(await agentMemoryWorkflow({ mode, databasePath, namespace, input, allowExecution, resolveFrom, harnessResolveFrom })));
} else {
  // Only this example's disposable directory is removed. Existing databases
  // can be used explicitly through the bounded --worker JSON interface.
  const directory = await mkdtemp(join(tmpdir(), 'ruflo-agent-memory-v1-'));
  const databasePath = join(directory, 'memory.sqlite'), namespace = 'starter-agent-v1';
  const values = [randomInt(1, 1000), randomInt(1, 1000), randomInt(1, 1000)];
  const expectedValue = values[0] + values[1] + values[2];
  const call = (mode, input) => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      input: JSON.stringify({ mode, databasePath, namespace, input }), encoding: 'utf8', timeout: 20000,
      maxBuffer: 1024 * 1024, env: { ...process.env, NODE_TEST_CONTEXT: '' },
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    return JSON.parse(child.stdout.trim().split('\n').at(-1));
  };
  try {
    const first = call('first', { values, expectedValue });
    const second = call('second', { discount: 7, expectedValue: expectedValue - 7,
      expectedDigest: createHash('sha256').update(JSON.stringify(values)).digest('hex') });
    assert.equal(first.taskSuccess, true); assert.equal(second.taskSuccess, true);
    assert.notEqual(first.pid, second.pid);
    const saved = await memoryWorkflow({ mode: 'retrieve', databasePath, namespace, resolveFrom, input: { vector: [0, 0, 1] } });
    assert.equal(saved.results[0].key, 'second-result');
    assert.equal(JSON.parse(saved.results[0].content).value, expectedValue - 7);
    console.log(JSON.stringify({ starter: 'persistent-agent-memory-v1', taskSuccess: true, first, second, finalIndexed: saved.indexed,
      llmUsed: false, generatedSemanticEmbeddings: false, securitySandbox: false, totalCostUsd: 0 }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
