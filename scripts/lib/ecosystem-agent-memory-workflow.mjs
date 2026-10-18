import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryWorkflow } from './ecosystem-memory-workflow.mjs';

// The package's public kernel really executes these local tool workers. This is
// a bounded consumer composition, not LLM reasoning, arbitrary code execution,
// a security sandbox, or a claim about the package's general DAG semantics.
export async function agentMemoryWorkflow({ mode, databasePath, namespace, input,
  resolveFrom, harnessResolveFrom, allowExecution = true }) {
  const start = performance.now();
  if (!['first', 'second'].includes(mode)) throw new Error('Expected first or second task');
  if (!resolveFrom) throw new Error('RUFLO_MEMORY_RESOLVE_FROM required');
  if (!harnessResolveFrom) throw new Error('RUFLO_HARNESS_RESOLVE_FROM required');
  if (typeof namespace !== 'string' || !namespace.trim()) throw new Error('Namespace required');
  if (typeof allowExecution !== 'boolean') throw new Error('allowExecution must be boolean');
  if (!Number.isSafeInteger(input?.expectedValue)) throw new Error('Independent expectedValue must be a safe integer');
  if (mode === 'first' && (!Array.isArray(input.values) || input.values.length !== 3 ||
      input.values.some(n => !Number.isSafeInteger(n) || n < 0 || n > 9999))) throw new Error('Expected three bounded nonnegative integers');
  if (mode === 'second' && (!Number.isSafeInteger(input.discount) || input.discount < 0 || input.discount > 9999 ||
      !/^[a-f0-9]{64}$/.test(input.expectedDigest ?? ''))) throw new Error('Expected bounded discount and input digest');

  // This package exports import-only: resolve with ESM from the exact consumer.
  const entry = execFileSync(process.execPath, ['--input-type=module', '-e',
    "process.stdout.write(import.meta.resolve('@metaharness/harness'))"], {
    cwd: dirname(resolve(harnessResolveFrom)), encoding: 'utf8', timeout: 5000,
    maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const pkg = JSON.parse(await readFile(join(dirname(fileURLToPath(entry)), '..', 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@metaharness/harness');
  assert.equal(pkg.version, '0.2.0', 'This consumer is qualified only for harness 0.2.0');
  const { HarnessKernel, AlgorithmRouter, AgentPool, PolicyGate, allowTools,
    VerifierRegistry, predicateVerifier } = await import(entry);
  // Check all qualified versions before a callback can mutate a database.
  const consumer = createRequire(resolve(resolveFrom));
  const memoryEntry = consumer.resolve('@claude-flow/memory/sqljs-backend');
  const memoryRequire = createRequire(memoryEntry);
  const vectorEntry = consumer.resolve('ruvector');
  const expectedVersions = { memory: '3.0.5', ruvector: '0.2.41', core: '0.1.33', sqljs: '1.15.0' };
  const installedVersions = {
    memory: JSON.parse(await readFile(join(dirname(memoryEntry), '..', 'package.json'), 'utf8')).version,
    ruvector: consumer('ruvector/package.json').version,
    core: createRequire(vectorEntry)('@ruvector/core/package.json').version,
    sqljs: JSON.parse(await readFile(join(dirname(memoryRequire.resolve('sql.js')), '..', 'package.json'), 'utf8')).version,
  };
  assert.deepEqual(installedVersions, expectedVersions, 'Unqualified memory dependency versions');
  const digest = text => createHash('sha256').update(text).digest('hex');
  const operations = [], invocations = [];
  let versions, retrieved;
  const memory = async (operation, payload) => {
    const result = await memoryWorkflow({ mode: operation, databasePath, namespace, input: payload, resolveFrom });
    versions = result.versions;
    assert.deepEqual(versions, expectedVersions);
    operations.push({ operation, indexed: result.indexed });
    return result;
  };
  const kind = mode === 'first' ? 'sum-inputs' : 'use-saved-total';
  const worker = ({ goal }) => {
    const began = performance.now();
    invocations.push(kind);
    const output = mode === 'first'
      ? { type: 'bounded-local-sum-v1', total: input.values.reduce((a, b) => a + b, 0), inputDigest: digest(JSON.stringify(input.values)) }
      : { type: 'bounded-local-remaining-v1', value: goal.context.saved.total - input.discount,
        inputDigest: goal.context.saved.inputDigest, sourceRecord: { id: retrieved.id, version: retrieved.version } };
    return { output, quality: 1, confidence: 1, risk: 0, costUsd: 0, latencyMs: performance.now() - began };
  };
  // A caller-supplied fixed oracle checks the result, independently of the
  // worker's quality/confidence report. This is not adversarial model evaluation.
  const verify = output => mode === 'first'
    ? output.type === 'bounded-local-sum-v1' && output.total === input.expectedValue && output.inputDigest === digest(JSON.stringify(input.values))
    : output.type === 'bounded-local-remaining-v1' && output.value === input.expectedValue && output.inputDigest === input.expectedDigest;
  const kernel = new HarnessKernel({
    router: new AlgorithmRouter({ bounded: { intent: 'bounded', steps: [{ kind }] } }),
    pool: new AgentPool([{ id: 'local-arithmetic', model: 'deterministic-tool:no-llm', handles: [kind], run: worker }]),
    policy: new PolicyGate(allowExecution ? [allowTools([kind], 0)] : [], 0),
    budget: { costUsd: 0, risk: 0, retries: 0, confidence: 1 }, breakerThreshold: 1,
    verifiers: new VerifierRegistry().register(predicateVerifier('fixed-result-oracle', 'property', verify)),
    retrieveMemory: async () => {
      // The kernel calls this before its worker policy gate. Namespace is
      // routing, not authentication; allowExecution:false does not forbid reads.
      if (mode !== 'second') return {};
      const found = await memory('retrieve', { vector: [1, 0, 0], k: 1 });
      retrieved = found.results[0];
      if (retrieved?.key !== 'first-result') throw new Error('Persisted first task result not found');
      const saved = JSON.parse(retrieved.content);
      if (saved?.type !== 'bounded-local-sum-v1' || !Number.isSafeInteger(saved.total) || saved.total < 0 || saved.total > 29997 ||
          !/^[a-f0-9]{64}$/.test(saved.inputDigest ?? '')) throw new Error('Invalid persisted first task result');
      return { saved };
    },
    updateMemory: async result => {
      // Actual 0.2.0 calls this on failed runs too. Never persist a rejected run.
      if (!result.success || !result.receiptsValid) return;
      const record = { key: mode === 'first' ? 'first-result' : 'second-result', content: JSON.stringify(result.result), vector: mode === 'first' ? [1, 0, 0] : [0, 0, 1] };
      await memory('write', { records: mode === 'first' ? [record,
        { key: 'distractor', content: '{"type":"unrelated"}', vector: [0, 1, 0] }] : [record] });
    },
  });
  const run = await kernel.run({ text: 'Execute bounded deterministic local arithmetic', intent: 'bounded' }, `local-${mode}`);
  assert.equal(run.receiptsValid, true); assert.equal(run.totalCostUsd, 0); assert.equal(run.steps.length, 1);
  return { starter: 'persistent-agent-memory-v1', mode, pid: process.pid, harnessVersion: pkg.version,
    versions, taskSuccess: run.success, result: run.result, receiptsValid: run.receiptsValid, receipts: run.receipts,
    // Kernel receipt inputHash excludes goal/context. Bind the consumer input
    // separately; this digest is evidence, not a signature or authorization.
    consumerInputDigest: digest(JSON.stringify({ mode, namespace, input, allowExecution })),
    retrievedRecord: retrieved && { id: retrieved.id, version: retrieved.version, key: retrieved.key },
    steps: run.steps.map(step => ({ status: step.status, attempts: step.attempts })),
    operations, invocations, elapsedMs: performance.now() - start, totalCostUsd: 0,
    llmUsed: false, generatedSemanticEmbeddings: false, securitySandbox: false };
}
