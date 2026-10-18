#!/usr/bin/env node
import { memoryWorkflow } from './lib/ecosystem-memory-workflow.mjs';

// Input contains caller-supplied vectors, not generated semantic embeddings.
const [mode, databasePath, namespace] = process.argv.slice(2);
if (!databasePath || process.argv.length !== 5) throw new Error('Usage: ecosystem-memory.mjs write|retrieve database.sqlite namespace < input.json');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Input exceeds 1 MiB');
}
const started = performance.now();
const result = await memoryWorkflow({ mode, databasePath, namespace, input: JSON.parse(input), resolveFrom: process.env.RUFLO_MEMORY_RESOLVE_FROM });
console.log(JSON.stringify({ ...result, pid: process.pid, elapsedMs: performance.now() - started }));
