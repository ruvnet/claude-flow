import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
const [consumerArg, expected] = process.argv.slice(2);
assert.ok(consumerArg && ['present', 'absent'].includes(expected), 'Usage: node probe-slim-consumer.mjs CONSUMER present|absent');
const consumer = resolve(consumerArg);
const dir = mkdtempSync(join(consumer, '.ruflo-slim-proof-'));
try {
  const source = readFileSync(new URL('../../v3/@claude-flow/cli/src/commands/agntcy/runtime.ts', import.meta.url), 'utf8');
  writeFileSync(join(dir, 'runtime.mjs'), stripTypeScriptTypes(source));
  if (expected === 'present') {
    const manifest = JSON.parse(readFileSync(join(consumer, 'node_modules/@agntcy/slim-bindings/package.json')));
    assert.equal(manifest.version, '2.0.0-alpha.5');
  }
  writeFileSync(join(dir, 'probe.mjs'), `import assert from 'node:assert/strict'; import {detectAgntcyRuntime} from './runtime.mjs'; const off=await detectAgntcyRuntime({}); assert.equal(off.configured,false); const result=await detectAgntcyRuntime({RUFLO_AGNTCY_SLIM_ENDPOINT:'http://127.0.0.1:46357'}); assert.equal(result.configured,${expected === 'present'}); ${expected === 'absent' ? 'assert.match(result.reason,/not installed/);' : ''} console.log(JSON.stringify({expected:${JSON.stringify(expected)},unconfiguredFallback:true,result,scope:'SDK import only; no transport connection'}));`);
  process.stdout.write(execFileSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 15000 }));
} finally { rmSync(dir, { recursive: true, force: true }); }
