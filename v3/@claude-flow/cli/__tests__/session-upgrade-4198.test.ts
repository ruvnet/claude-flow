import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { executeUpgrade } from '../src/init/executor.js';
import { generateIntelligenceStub } from '../src/init/helpers-generator.js';
import { ensureCommonJsCompanions } from '../src/init/helper-companions.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-4198-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.claude', 'helpers'), { recursive: true });
  mkdirSync(join(cwd, '.claude-flow', 'sessions'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  return cwd;
}

function run(cwd: string, script: string) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd, encoding: 'utf-8', timeout: 10_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

describe('#4198 session helper upgrades', () => {
  it('replaces stale companions while preserving existing session and memory data', async () => {
    const cwd = project();
    const helpers = join(cwd, '.claude', 'helpers');
    for (const name of ['session.cjs', 'memory.cjs']) writeFileSync(join(helpers, name), '// stale');
    const current = join(cwd, '.claude-flow', 'sessions', 'current.json');
    const session = '{"id":"session-123","context":{"keep":"value"}}';
    writeFileSync(current, session);
    mkdirSync(join(cwd, '.claude-flow', 'data'), { recursive: true });
    const memory = join(cwd, '.claude-flow', 'data', 'memory.json');
    writeFileSync(memory, '{"keep":"memory"}');

    const result = await executeUpgrade(cwd);
    expect(result.success).toBe(true);
    for (const name of ['session.cjs', 'memory.cjs']) {
      expect(result.updated).toContain(`.claude/helpers/${name}`);
      expect(readFileSync(join(helpers, name), 'utf-8')).not.toBe('// stale');
    }
    expect(readFileSync(current, 'utf-8')).toBe(session);
    expect(readFileSync(memory, 'utf-8')).toBe('{"keep":"memory"}');
    expect(run(cwd, "console.log(require('./.claude/helpers/session.cjs').restore().id)")).toContain('session-123');
    run(cwd, "require('./.claude/helpers/session.cjs').end()");
    expect(existsSync(join(cwd, '.claude-flow', 'sessions', 'session-123.json'))).toBe(true);
    run(cwd, "require('./.claude/helpers/memory.cjs').set('test', 'value')");
    expect(run(cwd, "console.log(require('./.claude/helpers/memory.cjs').get('test'))")).toContain('value');
    expect(JSON.parse(readFileSync(memory, 'utf-8')).keep).toBe('memory');
  });

  it('reports missing companions as created', async () => {
    const cwd = project();
    const result = await executeUpgrade(cwd);
    expect(result.success).toBe(true);
    for (const name of ['session.cjs', 'memory.cjs']) {
      expect(result.created).toContain(`.claude/helpers/${name}`);
      expect(result.updated).not.toContain(`.claude/helpers/${name}`);
    }
  });

  it('keeps existing companions during the default startup ensure', async () => {
    const cwd = project();
    const helpers = join(cwd, '.claude', 'helpers');
    for (const name of ['session.cjs', 'memory.cjs', 'session.js', 'memory.js']) {
      writeFileSync(join(helpers, name), '// custom helper');
    }
    expect(await ensureCommonJsCompanions(helpers)).toEqual([]);
    for (const name of ['session.cjs', 'memory.cjs', 'session.js', 'memory.js']) {
      expect(readFileSync(join(helpers, name), 'utf-8')).toBe('// custom helper');
    }
  });
});

const shipped = [
  fileURLToPath(new URL('../.claude/helpers/intelligence.cjs', import.meta.url)),
  fileURLToPath(new URL('../../../../.claude/helpers/intelligence.cjs', import.meta.url)),
];

describe.each([...shipped, 'generated'])('#4198 intelligence session ownership: %s', (source) => {
  function recall(cwd: string) {
    const helper = join(cwd, '.claude', 'helpers', 'intelligence.cjs');
    writeFileSync(helper, source === 'generated' ? generateIntelligenceStub() : readFileSync(source, 'utf-8'));
    const data = join(cwd, '.claude-flow', 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'ranked-context.json'), JSON.stringify({ entries: [{
      id: 'pattern-1', content: 'database migration', summary: 'database migration',
      words: ['database', 'migration'], category: 'patterns', confidence: 0.9, pageRank: 1,
    }] }));
    expect(run(cwd, "console.log(require('./.claude/helpers/intelligence.cjs').getContext('database migration'))"))
      .toContain('database migration');
  }

  it('does not create a session during recall before SessionStart', () => {
    const cwd = project();
    recall(cwd);
    expect(existsSync(join(cwd, '.claude-flow', 'sessions', 'current.json'))).toBe(false);
  });

  it('updates context without losing the active session identity or existing context', () => {
    const cwd = project();
    const current = join(cwd, '.claude-flow', 'sessions', 'current.json');
    writeFileSync(current, JSON.stringify({ id: 'session-123', metrics: { edits: 2 }, context: { keep: 'value' } }));
    recall(cwd);
    expect(JSON.parse(readFileSync(current, 'utf-8'))).toMatchObject({
      id: 'session-123', metrics: { edits: 2 }, context: { keep: 'value', lastMatchedPatterns: ['pattern-1'] },
    });
  });
});
