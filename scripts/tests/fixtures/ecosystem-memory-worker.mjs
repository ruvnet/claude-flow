// Isolated installed-package test worker; no production CLI fault flags.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [mode, databasePath, scenario, payload] = process.argv.slice(2);
const resolveFrom = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const pause = phase => new Promise(resolve => {
  process.once('message', () => resolve()); process.send({ type:'checkpoint', phase });
});
if (scenario === 'pause-reader') {
  const require = createRequire(resolve(resolveFrom));
  const { SqlJsBackend } = await import(pathToFileURL(require.resolve('@claude-flow/memory/sqljs-backend')).href);
  const original = SqlJsBackend.prototype.query;
  SqlJsBackend.prototype.query = async function(...args) { await pause('reader-open'); return original.apply(this,args); };
}
const modulePath = process.env.RUFLO_MEMORY_WORKFLOW_TEST_MODULE;
const { memoryWorkflow } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '../../lib/ecosystem-memory-workflow.mjs');
try {
  const result = await memoryWorkflow({ mode, databasePath, namespace:'race', input:JSON.parse(payload), resolveFrom,
    checkpoint: async phase => { if (phase === scenario) await pause(phase); } });
  process.send({ type:'result', result }); process.disconnect();
} catch(error) {
  process.send({ type:'failure', message:error.message, committed:error.committed, durabilityConfirmed:error.durabilityConfirmed });
  process.disconnect(); process.exitCode=1;
}
