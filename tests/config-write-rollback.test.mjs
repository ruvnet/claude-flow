import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileManager } from '../v3/@claude-flow/cli/src/services/config-file-manager.ts';
test('failed atomic replacement leaves cached configuration unchanged', () => {
 const root = mkdtempSync(join(tmpdir(), 'config-rollback-')); const file = join(root, 'claude-flow.config.json');
 try {
  writeFileSync(file, JSON.stringify({ agents: { maxConcurrent: 2 } })); const m = new ConfigFileManager(); m.load(root);
  rmSync(file); mkdirSync(file);
  assert.throws(() => m.set(root, 'agents.maxConcurrent', 9));
  assert.equal(m.get(root, 'agents.maxConcurrent'), 2);
  rmSync(file, { recursive: true }); m.set(root, 'agents.maxConcurrent', 3); assert.equal(JSON.parse(readFileSync(file, 'utf8')).agents.maxConcurrent, 3);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
