/**
 * ADR-498 — the ruRE offer: one line beneath an answer when the model touched a file ruRE can read.
 * Off by default; offer-only (never runs ruRE, never denies, never edits a call); main loop only.
 */
import { describe, it, expect } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { candidate, offerLine } from '../../../../../plugins/ruflo-mods/hooks/rure-offer/paths';
import { loadMod, memoryWorld, type World } from './harness';

const RURE = { name: 'mcp__ruflo__rure_analyze_binary', description: 'Use when ...', mcp: true };
const mem = (w: World) => w.files as Map<string, { text: string; mtimeMs: number }>;
const file = (w: World, path: string, text = 'MZ-bytes') => mem(w).set(`/work/${path}`, { text, mtimeMs: 1 });

async function start(world: World, options: Record<string, unknown> = { rureOffer: true }) {
  const mod = loadMod(register, world, options);
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
type Mod = Awaited<ReturnType<typeof start>>
const touch = (mod: Mod, path: string, tool = 'Read', extra: object = {}) =>
  mod.dispatch('tool.call', { tool, tool_use_id: `t-${path}`, file_path: path, ...extra }, () => ({ result: 'ok' }));
const end = (mod: Mod, extra: object = {}) =>
  mod.dispatch('turn.complete', { answer: 'done', durationMs: 5, isAborted: false, turnId: 'u1', ...extra }, () => ({ text: 'done' }));

describe('ADR-498 candidate paths (pure)', () => {
  it('accepts project-relative files ruRE reads, and absolute ones only under the root', () => {
    expect(candidate('/work', 'bin/app.exe')).toBe('bin/app.exe');
    expect(candidate('/work', './lib/libx.so.1')).toBe('lib/libx.so.1');
    expect(candidate('/work', '/work/k/a.cubin')).toBe('k/a.cubin');
    expect(candidate('/work/', '/work/app.asar')).toBe('app.asar');
  });

  it('refuses everything else: other kinds, outside the root, traversal, odd characters, flags', () => {
    for (const bad of ['a.txt', 'a.ts', 'a.hex', '/etc/x.so', '/workshop/a.dll', '../a.dll', 'a/../b.dll', 'a//b.dll', '-rf.dll', 'a b.dll', 'a;b.dll', 'a\n.dll', '$(x).dll', `${'a'.repeat(200)}.dll`]) {
      expect(candidate('/work', bad), bad).toBeNull();
    }
    for (const bad of [undefined, null, 5, {}, '']) expect(candidate('/work', bad)).toBeNull();
  });

  it('the line names only the validated paths, with static words around them', () => {
    expect(offerLine(['a.dll'])).toContain('inside a.dll without running it');
    expect(offerLine(['a.dll', 'b.so'])).toContain('inside a.dll and b.so without running them');
    expect(offerLine(['a.dll', 'b.so', 'c.exe'])).toContain('a.dll, b.so and c.exe');
    expect(offerLine(['a.dll'])).toContain('It only parses; nothing is executed.');
  });
});

describe('ADR-498 offer at turn end', () => {
  it('is off unless the option is on', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    file(world, 'a.exe');
    const mod = await start(world, {});
    await touch(mod, 'a.exe');
    expect((await end(mod)).text).toBe('done');
  });

  it('offers once, beneath the answer, for a binary the model read', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    file(world, 'a.exe');
    const mod = await start(world);
    await touch(mod, 'a.exe');
    const out = await end(mod);
    expect(out.text).toMatch(/^done\n\nruRE can look inside a\.exe without running it/);
    // the same file is never offered twice, and nothing is pending for the next turn
    await touch(mod, 'a.exe');
    expect((await end(mod)).text).toBe('done');
  });

  it('is inert where the session has no ruRE tool (or only a non-MCP lookalike)', async () => {
    for (const tools of [[], [{ name: 'rure_analyze_binary', description: '', mcp: false }]]) {
      const world = memoryWorld();
      world.tools = tools;
      file(world, 'a.exe');
      const mod = await start(world);
      await touch(mod, 'a.exe');
      expect((await end(mod)).text).toBe('done');
    }
  });

  it('ignores other tools, other files, denied calls, empty and missing files', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    file(world, 'a.exe');
    file(world, 'empty.exe', '');
    file(world, 'notes.txt');
    const mod = await start(world);
    await touch(mod, 'a.exe', 'Bash');
    await touch(mod, 'notes.txt');
    await touch(mod, 'empty.exe');
    await touch(mod, 'missing.dll');
    await mod.dispatch('tool.call', { tool: 'Read', tool_use_id: 'd', file_path: 'a.exe' }, () => ({ deny: 'no' }));
    expect((await end(mod)).text).toBe('done');
  });

  it('a subagent’s answer and an aborted turn carry no line, and the pending file is not kept for later', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    file(world, 'a.exe');
    const mod = await start(world);
    await touch(mod, 'a.exe');
    expect((await end(mod, { agentId: 'sub-1' })).text).toBe('done');
    expect((await end(mod, { isAborted: true })).text).toBe('done');
    expect((await end(mod)).text).toBe('done'); // aborted turn dropped it
  });

  it('caps one line at three files, and the session at twelve', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    const names = Array.from({ length: 30 }, (_, i) => `f${i}.dll`);
    for (const n of names) file(world, n);
    const mod = await start(world);
    const listed = (text: string) => (/inside (.*?) without running/.exec(text)?.[1] ?? '').split(/, | and /).filter(Boolean);

    for (const n of names.slice(0, 6)) await touch(mod, n);
    expect(listed((await end(mod)).text as string)).toEqual(['f0.dll', 'f1.dll', 'f2.dll']);

    let total = 3;
    for (let i = 6; i < 30; i += 3) {
      for (const n of names.slice(i, i + 3)) await touch(mod, n);
      total += listed((await end(mod)).text as string).length;
    }
    expect(total).toBe(12);
  });

  it('never changes a tool call or its result', async () => {
    const world = memoryWorld();
    world.tools = [RURE];
    file(world, 'a.exe');
    const mod = await start(world);
    expect(await touch(mod, 'a.exe')).toEqual({ result: 'ok' });
  });
});
