/**
 * ADR-404 — edit learning signals in the classic consolidator's format, and
 * the cost-tracker budget ladder on live session cost.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { appendRecords, MAX_LINES } from '../../../../../plugins/ruflo-mods/hooks/learn/insights';
import { alertLevel, budgetOf, LEVELS } from '../../../../../plugins/ruflo-mods/hooks/cost/budget';
import { loadMod, memoryWorld, type World } from './harness';

const REPO = resolve(__dirname, '../../../../..');
const PENDING = '/work/.claude-flow/data/pending-insights.jsonl';

async function start(world: World, options: Record<string, unknown> = {}) {
  const mod = loadMod(register, world, options);
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
const mem = (w: World) => w.files as Map<string, { text: string; mtimeMs: number }>;
const edit = (mod: Awaited<ReturnType<typeof start>>, file: string, result: object, tool = 'Edit') =>
  mod.dispatch('tool.call', { tool, tool_use_id: `t-${file}`, file_path: file }, () => result);
const endTurn = (mod: Awaited<ReturnType<typeof start>>) => mod.dispatch('turn.complete', { reason: 'answer' }, () => ({ text: 'ok' }));

describe('ADR-404 edit records', () => {
  it('writes recordEdit lines once per turn, failures included, denials never', async () => {
    const world = memoryWorld();
    mem(world).set('/work/.claude-flow/sessions/current.json', { text: JSON.stringify({ context: { sessionId: 'ruflo-s1' } }), mtimeMs: 1 });
    const mod = await start(world);
    await edit(mod, '/work/a.ts', { result: 'ok', text: 'ok' });
    await edit(mod, '/work/b.ts', { isError: true, result: 'boom', text: 'boom' }, 'Write');
    await edit(mod, '/work/c.ts', { deny: 'no' }, 'MultiEdit');
    await mod.dispatch('tool.call', { tool: 'Read', tool_use_id: 'r', file_path: '/work/d.ts' }, () => ({ result: 'x' }));
    expect(mem(world).has(PENDING)).toBe(false); // nothing written mid-turn
    await endTurn(mod);
    const lines = mem(world).get(PENDING)!.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.file, l.success, l.sessionId])).toEqual([['/work/a.ts', true, 'ruflo-s1'], ['/work/b.ts', false, 'ruflo-s1']]);
  });

  it('has the key order and types intelligence.cjs recordEdit writes', () => {
    const project = mkdtempSync(join(tmpdir(), 'ruflo-mods-learn-'));
    try {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(join(REPO, 'v3/@claude-flow/cli/.claude/helpers/intelligence.cjs'))}).recordEdit('x.ts', false)`], {
        env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: project }, cwd: project,
      });
      const classic = JSON.parse(readFileSync(join(project, '.claude-flow/data/pending-insights.jsonl'), 'utf8').trim());
      const ours = JSON.parse(appendRecords('', [{ type: 'edit', file: 'x.ts', success: false, timestamp: 1, sessionId: null }]).trim());
      expect(Object.keys(ours)).toEqual(Object.keys(classic));
      expect(Object.fromEntries(Object.entries(ours).map(([k, v]) => [k, typeof v]))).toEqual(Object.fromEntries(Object.entries(classic).map(([k, v]) => [k, typeof v])));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('keeps existing lines and the classic 2000-line cap', () => {
    const existing = Array.from({ length: MAX_LINES }, (_, i) => JSON.stringify({ i })).join('\n') + '\n';
    const next = appendRecords(existing, [{ type: 'edit', file: 'z', success: true, timestamp: 1, sessionId: null }]).trim().split('\n');
    expect(next).toHaveLength(MAX_LINES);
    expect(JSON.parse(next[0]!)).toEqual({ i: 1 });
    expect(JSON.parse(next.at(-1)!).file).toBe('z');
  });

  it('never overwrites a pending file it cannot read; the records wait for the next turn', async () => {
    const world = memoryWorld();
    mem(world).set(PENDING, { text: '{"keep":1}\n', mtimeMs: 1 });
    let fail = true;
    world.failRead = (p) => (p === PENDING && fail ? new Error('EIO: i/o error') : undefined);
    const mod = await start(world);
    await edit(mod, '/work/a.ts', { result: 'ok' });
    await endTurn(mod);
    expect(mem(world).get(PENDING)!.text).toBe('{"keep":1}\n');
    fail = false;
    await mod.dispatch('session.end', { reason: 'other', sessionId: 's', resume: { id: 's' } }, () => ({ sessionId: 's' }));
    expect(mem(world).get(PENDING)!.text.trim().split('\n')).toHaveLength(2);
  });

  it('records nothing when it does not own post-edit', async () => {
    const world = memoryWorld('/work', { hooks: { PostToolUse: [{ hooks: [{ command: 'node .claude/helpers/hook-handler.cjs post-edit' }] }] } });
    mem(world).set('/work/.claude/helpers/hook-handler.cjs', { text: '// a helper from before the handshake', mtimeMs: 1 });
    const mod = await start(world);
    await edit(mod, '/work/a.ts', { result: 'ok' });
    await endTurn(mod);
    expect(mem(world).has(PENDING)).toBe(false);
  });

  it('a bad file_path records as unknown, as recordEdit does', async () => {
    const world = memoryWorld();
    const mod = await start(world);
    await mod.dispatch('tool.call', { tool: 'Edit', tool_use_id: 'x', file_path: { evil: true } }, () => ({ result: 'ok' }));
    await endTurn(mod);
    expect(JSON.parse(mem(world).get(PENDING)!.text.trim()).file).toBe('unknown');
  });
});

describe('ADR-404 budget ladder', () => {
  it('uses budget.mjs thresholds exactly', () => {
    const source = readFileSync(join(REPO, 'plugins/ruflo-cost-tracker/scripts/budget.mjs'), 'utf8');
    const theirs = [...source.matchAll(/utilization >= (\d\.\d+)\) return \{ level: '([A-Z_]+)'/g)].map((m) => ({ level: m[2], at: Number(m[1]) }));
    expect(theirs).toEqual(LEVELS.map((l) => ({ level: l.level, at: l.at })));
    expect([0, 0.49, 0.5, 0.75, 0.9, 1, 3].map(alertLevel)).toEqual(['OK', 'OK', 'INFO', 'WARNING', 'CRITICAL', 'HARD_STOP', 'HARD_STOP']);
  });

  it('reads a bad budget as off, never as a zero budget', () => {
    for (const bad of [0, -1, 'abc', NaN, Infinity, undefined, true]) expect(budgetOf(bad)).toBeUndefined();
    expect(budgetOf('2.5')).toBe(2.5);
  });

  it('says each rung once, on the way up, from session.measure', async () => {
    const world = memoryWorld();
    const mod = await start(world, { costBudgetUsd: 10 });
    for (const usd of [1, 5.5, 6, 7.6, 9.2, 9.3, 12]) {
      await mod.dispatch('session.measure', { context: {}, rateLimits: [], cost: { usd }, changed: ['cost'] }, (e) => ({ changed: e.changed }));
    }
    expect(world.toasts.map((t) => t.split(':')[0])).toEqual(['› ruflo budget INFO', '⚠ ruflo budget WARNING', '✗ ruflo budget CRITICAL', '✗ ruflo budget HARD_STOP']);
  });

  it('with costHardStop, refuses new agents at HARD_STOP and only then', async () => {
    const world = memoryWorld();
    const mod = await start(world, { costBudgetUsd: 1, costHardStop: true });
    const spawn = () => mod.dispatch('agent.spawn', { prompt: 'p', description: 'd', subagentType: 'coder' }, () => ({ model: 'sonnet' }));
    expect(await spawn()).toEqual({ model: 'sonnet' });
    await mod.dispatch('session.measure', { context: {}, rateLimits: [], cost: { usd: 1.01 }, changed: ['cost'] }, (e) => ({ changed: e.changed }));
    expect((await spawn()).deny).toContain('halted');
  });

  it('hooks nothing when no budget is set', () => {
    const mod = loadMod(register, memoryWorld(), {});
    expect(mod.events()).not.toContain('session.measure');
    expect(mod.events()).not.toContain('agent.spawn');
    expect(loadMod(register, memoryWorld(), { costBudgetUsd: 5 }).events()).not.toContain('agent.spawn');
  });
});
