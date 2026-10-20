import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function audit(packages) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-version-audit-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('../scripts/audit-umbrella-version-lockstep.mjs', import.meta.url), join(root, 'scripts/audit.mjs'));
    for (const [path, value] of Object.entries(packages)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), JSON.stringify(value));
    }
    return spawnSync(process.execPath, [join(root, 'scripts/audit.mjs')], { encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const coherent = () => ({
  'package.json': { version: '3.1.0' },
  'v3/@claude-flow/cli/package.json': { version: '3.1.0' },
  'ruflo/package.json': { version: '3.1.0', dependencies: { '@claude-flow/cli': '3.1.0' } },
});
test('accepts the coherent release train', () => assert.equal(audit(coherent()).status, 0));
test('rejects packages that all omit version identity', () => {
  const packages = coherent();
  for (const pkg of Object.values(packages)) delete pkg.version;
  assert.equal(audit(packages).status, 1);
});
test('rejects a wrapper missing its CLI dependency', () => {
  const packages = coherent(); delete packages['ruflo/package.json'].dependencies;
  assert.equal(audit(packages).status, 1);
});
