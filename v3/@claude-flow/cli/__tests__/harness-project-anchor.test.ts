import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadEffectiveFlywheelAnchor,
  PROJECT_ANCHOR_MANIFEST_SCHEMA,
  PROJECT_ANCHOR_SCHEMA,
} from '../src/services/harness-project-anchor.js';
import { humanEvalHash, type HumanEvalTask } from '../src/services/harness-frozen-eval.js';

const tasks: HumanEvalTask[] = [
  { id: 'a', q: 'authentication middleware', labels: ['auth'] },
  { id: 'b', q: 'database migration', labels: ['migration'] },
  { id: 'c', q: 'dashboard component', labels: ['dashboard'] },
  { id: 'd', q: 'integration regression', labels: ['regression'] },
];

function foreignProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'flywheel-anchor-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'downstream-app' }));
  return root;
}

describe('loadEffectiveFlywheelAnchor', () => {
  it('fails closed for a foreign project without its own benchmark (#2840)', () => {
    expect(() => loadEffectiveFlywheelAnchor(foreignProject())).toThrow(/project-local flywheel anchor required/);
  });

  it('loads a project-contained explicit anchor and binds its hash', () => {
    const root = foreignProject();
    const path = join(root, 'anchor.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: PROJECT_ANCHOR_SCHEMA, version: 'app-v1', tasks }));
    const hash = humanEvalHash(tasks);
    const selected = loadEffectiveFlywheelAnchor(root, { anchorPath: path, anchorHash: hash });
    expect(selected).toMatchObject({ version: 'app-v1', anchorRef: hash, source: 'project' });
    expect(selected.tasks).toHaveLength(4);
  });

  it('rejects anchor drift', () => {
    const root = foreignProject();
    const path = join(root, 'anchor.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: PROJECT_ANCHOR_SCHEMA, tasks }));
    expect(() => loadEffectiveFlywheelAnchor(root, {
      anchorPath: path,
      anchorHash: `sha256:${'0'.repeat(64)}`,
    })).toThrow(/hash mismatch/);
  });

  it('discovers a manifest and resolves its path relative to the manifest', () => {
    const root = foreignProject();
    const evalDir = join(root, '.claude', 'eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'app-anchor.json'), JSON.stringify({ schemaVersion: PROJECT_ANCHOR_SCHEMA, tasks }));
    writeFileSync(join(evalDir, 'flywheel-anchor.manifest.json'), JSON.stringify({
      schemaVersion: PROJECT_ANCHOR_MANIFEST_SCHEMA,
      path: 'app-anchor.json',
      sha256: humanEvalHash(tasks),
    }));
    const selected = loadEffectiveFlywheelAnchor(root);
    expect(selected.anchorRef).toBe(humanEvalHash(tasks));
    expect(selected.source).toBe('project');
  });

  it('rejects project-escaping paths', () => {
    const root = foreignProject();
    expect(() => loadEffectiveFlywheelAnchor(root, {
      anchorPath: '../outside.json',
      anchorHash: `sha256:${'0'.repeat(64)}`,
    })).toThrow();
  });
});
