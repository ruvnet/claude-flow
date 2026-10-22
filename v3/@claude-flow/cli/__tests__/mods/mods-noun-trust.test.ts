/**
 * ADR-404 — the $.ruflo noun (segments) and the mod trust gate, through the
 * harness (CI). The same behaviour runs on the real engine in
 * plugins/ruflo-mods/tests/{noun,trust}.test.ts.
 */
import { describe, it, expect } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { judge, riskOf } from '../../../../../plugins/ruflo-mods/hooks/trust';
import { MAX_SEGMENTS, createState, setSegment, statusText } from '../../../../../plugins/ruflo-mods/hooks/state';
import { loadMod, memoryWorld } from './harness';

describe('ADR-404 $.ruflo noun', () => {
  it('engine.create adds ruflo and keeps everything beneath', async () => {
    const mod = loadMod(register, memoryWorld());
    const built = await mod.create();
    expect(typeof built.ruflo.segment).toBe('function');
    expect(typeof built.fs.read).toBe('function');
  });

  it('segments: untrusted text sanitised, bounded, sorted; null clears; bad ids and overflow reject', async () => {
    const world = memoryWorld();
    const mod = loadMod(register, world);
    const built = await mod.create();
    await mod.dispatch('session.start', { cwd: '/work', surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
    await built.ruflo.segment({ id: 'ruos', text: 'a\u0007b‮\n\tc\u001b[31m\u001b]8;;http://x\u0007' });
    await built.ruflo.segment({ id: 'aa', text: 'z'.repeat(100) });
    expect(world.statuses.at(-1)).toBe(`ruflo · ${'z'.repeat(47)}… · a b c`);
    await built.ruflo.segment({ id: 'aa', text: null });
    expect(world.statuses.at(-1)).toBe('ruflo · a b c');
    await expect(built.ruflo.segment({ id: '../x', text: 'y' })).rejects.toThrow();
    await expect(built.ruflo.segment({ id: 'ok', text: 42 })).rejects.toThrow();
  });

  it('caps at MAX_SEGMENTS and an empty bar clears the line', () => {
    const s = createState();
    for (let i = 0; i < MAX_SEGMENTS; i++) setSegment(s, { id: `s${i}`, text: 'x' });
    expect(() => setSegment(s, { id: 'more', text: 'x' })).toThrow(/at most/);
    setSegment(s, { id: 's0', text: 'updated' }); // an existing id may change
    const empty = createState();
    expect(statusText(empty)).toBeUndefined();
  });

  it('snapshot answers measured facts only, as copies', async () => {
    const mod = loadMod(register, memoryWorld());
    const built = await mod.create();
    await mod.dispatch('session.start', { cwd: '/work', surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
    await mod.dispatch('prompt.submit', { text: 'design the architecture', wait: false, origin: { kind: 'composer' } }, (e) => e);
    const snap = await built.ruflo.snapshot();
    expect(snap).toMatchObject({ routed: 1, lastRoute: { agent: 'architect', matched: true, confidence: 0.6 }, policy: 'none' });
    snap.lastRoute.agent = 'mutated';
    expect((await built.ruflo.lastRoute()).agent).toBe('architect');
  });
});

describe('ADR-404 mod trust gate', () => {
  const scan = (over: object) => ({ name: 'm', tier: 'user', provenance: 'm@inline', uses: { events: [], calls: [] }, ...over });

  it('names risky calls and hooks from the host scan', () => {
    expect(riskOf(scan({ uses: { events: ['tool.check', 'turn.complete'], calls: ['process.run', 'fs.read', 'http.fetch'] } }))).toEqual([
      'process.run (runs host commands)', 'http.fetch (makes network requests)', 'on tool.check (can answer tool permission verdicts)',
    ]);
    expect(riskOf(scan({ uses: { events: 'nope', calls: [1] } as never }))).toEqual([]);
    expect(riskOf(scan({ uses: { events: [], calls: ['fs.write'] } }))).toEqual(['fs.write (writes files (settings, hooks, helpers included))']);
  });

  it('judges only other user-tier modules; refuses only under refuse-risky', () => {
    const risky = scan({ uses: { events: ['*'], calls: [] } });
    expect(judge(risky, 'observe', new Set()).refuse).toBeUndefined();
    expect(judge(risky, 'refuse-risky', new Set()).refuse).toMatch(/sees every event/);
    expect(judge(risky, 'refuse-risky', new Set(['m@inline'])).judged).toBe(false); // provenance
    expect(judge(risky, 'refuse-risky', new Set(['m'])).refuse).toBeDefined(); // a bare name is not trusted
    expect(judge({ ...risky, tier: 'prepend' }, 'refuse-risky', new Set()).judged).toBe(false);
    // No self-exemption: a later module naming itself ruflo-mods is judged like any other.
    expect(judge({ ...risky, name: 'ruflo-mods', provenance: 'ruflo-mods@inline' }, 'refuse-risky', new Set()).refuse).toMatch(/sees every event/);
    expect(judge(risky, 'off', new Set()).judged).toBe(false);
  });

  it('observe names a reloaded module again when it gains a risky call or hook', async () => {
    const world = memoryWorld();
    const mod = loadMod(register, world, {});
    await mod.create();
    const base = { name: 'helper', tier: 'user', root: '/home/u/.claude/dev-mods/s/helper', provenance: 'helper@inline' };
    await mod.dispatch('plugin.register', { ...base, uses: { events: ['turn.complete'], calls: ['ui.status'] } }, () => ({ allow: true }));
    await mod.dispatch('plugin.register', { ...base, uses: { events: ['turn.complete'], calls: ['ui.status'] } }, () => ({ allow: true }));
    const before = world.logs.length;
    await mod.dispatch('plugin.register', { ...base, uses: { events: ['turn.complete', 'tool.check'], calls: ['process.run'] } }, () => ({ allow: true }));
    expect(world.logs.length).toBe(before + 1);
    expect(world.logs.at(-1)).toContain('process.run (runs host commands)');
    // The same risk again is not repeated.
    await mod.dispatch('plugin.register', { ...base, uses: { events: ['tool.check', 'turn.complete'], calls: ['process.run'] } }, () => ({ allow: true }));
    expect(world.logs.length).toBe(before + 1);
  });

  it('through the hook: refuse-risky refuses, a failing gate refuses rather than admits', async () => {
    const world = memoryWorld();
    const mod = loadMod(register, world, { modTrust: 'refuse-risky' });
    const e = { name: 'evil', tier: 'user', root: '/x', provenance: 'evil@inline', uses: { events: ['tool.check'], calls: [] } };
    expect((await mod.dispatch('plugin.register', e, () => ({ allow: true }))).refuse).toMatch(/refuse-risky/);
    expect(await mod.dispatch('plugin.register', { ...e, uses: { events: ['turn.complete'], calls: [] } }, () => ({ allow: true }))).toEqual({ allow: true });
    expect(world.logs.join('\n')).toContain('REFUSED');
    const observing = loadMod(register, memoryWorld());
    expect(await observing.dispatch('plugin.register', e, () => ({ allow: true }))).toEqual({ allow: true });
    expect(loadMod(register, memoryWorld(), { modTrust: 'off' }).events()).not.toContain('plugin.register');
  });
});
