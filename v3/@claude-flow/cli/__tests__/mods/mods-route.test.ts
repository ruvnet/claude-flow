/**
 * ADR-404 — the mod's router is a copy of router.cjs (a hooks module cannot
 * import outside its plugin), so these tests are what keep it from being a
 * fork: same table, same matching, same context text as hook-handler.cjs
 * `route`, and the #3567 no-match semantics.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

vi.mock('../../src/memory/memory-bridge.js', () => ({ bridgeRouteTask: vi.fn(async () => null) }));

import { NO_MATCH_CONFIDENCE as CLI_NO_MATCH } from '../../src/mcp-tools/hooks-tools.js';
import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { MATCH_CONFIDENCE, NO_MATCH_CONFIDENCE, routeTask, TASK_PATTERNS } from '../../../../../plugins/ruflo-mods/hooks/route/route-task';
import { formatRoute } from '../../../../../plugins/ruflo-mods/hooks/route/format';
import { generateHookHandler } from '../../src/init/helpers-generator';
import { loadMod, memoryWorld, realWorld } from './harness';

const CLI_ROOT = resolve(__dirname, '../..');
const HELPERS = join(CLI_ROOT, '.claude', 'helpers');
const require = createRequire(import.meta.url);
const router = require(join(HELPERS, 'router.cjs')) as {
  routeTask: (t: string) => { agent: string; confidence: number; reason: string };
  TASK_PATTERNS: Array<{ tokens: string[]; agent: string }>;
};

const MATCHED = [
  'implement the login flow', 'write tests for the parser', 'please review this PR', 'research vector databases',
  'design the architecture', 'add an api endpoint', 'fix the react component css', 'deploy with docker',
  'set up the ci/cd pipeline', 'Refactor and DEBUG it', 'unit test coverage', 'audit security of auth',
];
const NO_MATCH = ['', '   ', '...', '修复登录崩溃', 'decision about infrastructure-free stuff?'.replace('infrastructure', 'x'), 'hello there'];

describe('ADR-404 mod router parity with router.cjs', () => {
  it('carries router.cjs TASK_PATTERNS exactly', () => {
    expect(TASK_PATTERNS).toEqual(router.TASK_PATTERNS);
  });

  it.each(MATCHED)('routes %j as router.cjs does', (task) => {
    const theirs = router.routeTask(task);
    const ours = routeTask(task);
    expect(ours.matched).toBe(true);
    expect({ agent: ours.agent, confidence: ours.confidence, reason: ours.reason }).toEqual(theirs);
    expect(ours.confidence).toBe(MATCH_CONFIDENCE);
  });

  it.each(NO_MATCH)('%j is an explicit no-match at the #3567 prior', (task) => {
    const ours = routeTask(task);
    expect(ours).toMatchObject({ agent: 'coder', matched: false, reason: 'no-match-default' });
    expect(ours.confidence).toBe(router.routeTask(task).confidence);
    expect(NO_MATCH_CONFIDENCE).toBe(CLI_NO_MATCH);
    for (const m of MATCHED) expect(ours.confidence).toBeLessThan(routeTask(m).confidence);
  });

  it('treats a non-string task as no-match, never throwing', () => {
    for (const bad of [undefined, null, 42, { text: 'build' }]) expect(routeTask(bad).matched).toBe(false);
  });
});

describe('ADR-404 mod route context equals hook-handler.cjs route output', () => {
  let project: string;
  let home: string;

  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'ruflo-mods-route-'));
    home = mkdtempSync(join(tmpdir(), 'ruflo-mods-home-'));
    mkdirSync(join(project, '.claude-flow', 'data'), { recursive: true });
    const words = (s: string) => s.toLowerCase().split(/\s+/);
    writeFileSync(join(project, '.claude-flow', 'data', 'ranked-context.json'), JSON.stringify({
      entries: [
        { id: 'a', words: words('authentication login session token refresh'), pageRank: 0.4, summary: 'JWT refresh tokens for login', accessCount: 3 },
        { id: 'b', words: words('vector database hnsw index search'), pageRank: 0.2, summary: 'HNSW index for vector search', accessCount: 1 },
        { id: 'c', words: words('docker deploy pipeline'), pageRank: 0.01, content: 'Deploy via docker compose' },
      ],
    }));
  });
  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function classicRoute(prompt: string): string {
    return execFileSync(process.execPath, [join(HELPERS, 'hook-handler.cjs'), 'route'], {
      input: JSON.stringify({ prompt }),
      cwd: project,
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: project, CI: '1' },
      encoding: 'utf8',
    }).trim();
  }

  it.each([
    'implement login with refresh tokens',
    'search the vector database index',
    'deploy the docker pipeline',
    'hello',
  ])('%j: same text the model reads', async (prompt) => {
    const world = realWorld(project, {});
    const mod = loadMod(register, world);
    await mod.dispatch('session.start', { cwd: project, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
    let context: readonly string[] | undefined;
    await mod.dispatch('prompt.submit', { text: prompt, wait: false, origin: { kind: 'composer' } }, (e) => {
      context = e.context;
      return { text: e.text, context: e.context };
    });
    expect(context).toHaveLength(1);
    const classic = classicRoute(prompt);
    expect(context![0]).toBe(classic);
    const box = classic.split('\n').filter((line) => /^[+|]/.test(line));
    expect(box).toHaveLength(5);
    expect(box.map((line) => line.length)).toEqual([64, 64, 64, 64, 64]);
  });

  it('adds nothing and passes the prompt through when it does not own route', async () => {
    const world = memoryWorld('/work', {
      hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" route' }] }] },
    });
    (world.files as Map<string, any>).set('/work/.claude/helpers/hook-handler.cjs', { text: '// a helper from before the handshake', mtimeMs: 1 });
    const mod = loadMod(register, world);
    await mod.dispatch('session.start', { cwd: '/work', surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
    let seen: any;
    await mod.dispatch('prompt.submit', { text: 'build it', wait: false, origin: { kind: 'composer' } }, (e) => (seen = e));
    expect(seen.context).toBeUndefined();
    expect(seen.text).toBe('build it');
  });
});

describe('#3698 route box width and fallback parity', () => {
  let project: string;
  const prompt = 'implement';
  beforeAll(() => { project = mkdtempSync(join(tmpdir(), 'ruflo-route-width-')); });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  it.each([0, 0.6, 0.85, 1])('confidence %s keeps every row at 64 columns', (confidence) => {
    const result = { agent: 'agent'.repeat(20), confidence, reason: 'reason '.repeat(20), matched: true };
    const expected = formatRoute(prompt, result);
    const lines = expected.split('\n').slice(2);
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.length)).toEqual([64, 64, 64, 64, 64]);
    expect(expected).toContain(`Confidence: ${(confidence * 100).toFixed(1)}%`);

    writeFileSync(join(project, 'router.cjs'), `exports.routeTask = () => (${JSON.stringify(result)});`);
    const sources = [readFileSync(join(HELPERS, 'hook-handler.cjs'), 'utf8'), generateHookHandler()];
    for (const source of sources) {
      const helper = join(project, 'hook-handler.cjs');
      writeFileSync(helper, source);
      const actual = execFileSync(process.execPath, [helper, 'route'], {
        input: JSON.stringify({ prompt }), cwd: project, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: project, CLAUDE_PROJECT_DIR: project, CI: '1' },
      }).trim();
      expect(actual).toBe(expected);
    }
  });
});
