import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = readFileSync(new URL('../scripts/check-metaharness-pins.mjs', import.meta.url), 'utf8');
function run(source) {
 const root = mkdtempSync(join(tmpdir(), 'oracle-pin-'));
 try {
  const cli = join(root, 'v3/@claude-flow/cli');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(cli, 'src/services'), { recursive: true });
  mkdirSync(join(root, 'plugins/ruflo-metaharness/scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/check-metaharness-pins.mjs'), script);
  const dependencies = Object.fromEntries(['metaharness', '@metaharness/router', '@metaharness/darwin', '@metaharness/flywheel', '@metaharness/radio', '@metaharness/turn-credit'].map(name => [name, '~1.2.3']));
  writeFileSync(join(cli, 'package.json'), JSON.stringify({ dependencies }));
  if (source !== null) writeFileSync(join(cli, 'src/services/distill-oracle.ts'), source);
  for (const [file, name] of [['_harness.mjs','METAHARNESS'],['_darwin.mjs','DARWIN'],['_redblue.mjs','REDBLUE']]) writeFileSync(join(root, 'plugins/ruflo-metaharness/scripts', file), `const ${name}_PIN_VERSION = '~1.2.3';`);
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-metaharness-pins.mjs'), '--offline', '--format', 'json'], { encoding: 'utf8' });
  return { status: result.status, payload: JSON.parse(result.stdout) };
 } finally { rmSync(root, { recursive: true, force: true }); }
}
test('missing and unreadable oracle constants fail the offline lock-step check', () => {
 for (const source of [null, 'export const unrelated = 1;']) { const r = run(source); assert.equal(r.status, 1); assert.equal(r.payload.constCheck.status, 'UNREADABLE'); }
});
test('an unparseable oracle version fails instead of reporting in-range', () => {
 const r = run("const MH_DARWIN_PIN = 'invalid';"); assert.equal(r.status, 1); assert.equal(r.payload.constCheck.status, 'unparseable');
});
test('valid oracle pin remains accepted offline', () => { const r = run("const MH_DARWIN_PIN = '1.2.3';"); assert.equal(r.status, 0); });
