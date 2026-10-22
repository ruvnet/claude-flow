/**
 * `ruflo pair` — session state the pair-programming skill drives.
 *
 * Every test points ctx.cwd at a fresh temp dir so nothing touches the
 * repo's own .claude-flow/. Covers: start/status/switch/mode/end/history
 * round trip, the v2 `--start`/`--end` spellings, mode validation, the
 * switch-mode "switch due" signal, and the lazy registry entry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { pairCommand, parseIntervalMinutes, readSession, PAIR_MODES } from '../src/commands/pair.js';
import type { CommandContext, ParsedFlags } from '../src/types.js';

let cwd: string;

function ctx(flags: ParsedFlags = { _: [] }, args: string[] = []): CommandContext {
  return { args, flags, cwd, interactive: false };
}

function sub(name: string) {
  const found = pairCommand.subcommands!.find(s => s.name === name);
  if (!found?.action) throw new Error(`missing subcommand ${name}`);
  return found.action;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-command-test-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('ruflo pair — registry', () => {
  it('is wired into the lazy command loader map', () => {
    // Importing commands/index.js drags in every command module (and their
    // built workspace deps), so read the registry source instead.
    const registry = fs.readFileSync(new URL('../src/commands/index.ts', import.meta.url), 'utf-8');
    expect(registry).toContain("pair: () => import('./pair.js')");
    expect(pairCommand.subcommands?.map(s => s.name)).toEqual(['start', 'status', 'switch', 'mode', 'end', 'history']);
  });

  it('offers every mode the skill documents as a --mode choice', () => {
    const startSub = pairCommand.subcommands!.find(s => s.name === 'start')!;
    const modeOption = startSub.options!.find(o => o.name === 'mode');
    expect(modeOption?.choices).toEqual(Object.keys(PAIR_MODES));
    expect(Object.keys(PAIR_MODES)).toEqual(['driver', 'navigator', 'switch', 'tdd', 'review', 'mentor', 'debug']);
  });
});

describe('ruflo pair — session lifecycle', () => {
  it('reports no session before start and does not create files', async () => {
    const result = await sub('status')(ctx({ _: [], json: true }));
    expect(result).toMatchObject({ success: true, data: { active: false } });
    expect(fs.existsSync(path.join(cwd, '.claude-flow'))).toBe(false);
  });

  it('start writes current.json with the mode, a default role and no interval', async () => {
    const result = await sub('start')(ctx({ _: [], mode: 'tdd', json: true }));
    expect(result.success).toBe(true);
    const session = readSession(cwd);
    expect(session).toMatchObject({ mode: 'tdd', aiRole: 'driver', switchIntervalMinutes: null, switches: 0 });
    expect(fs.existsSync(path.join(cwd, '.claude-flow', 'sessions', 'pair', 'current.json'))).toBe(true);
  });

  it('navigator and review modes put the AI in the navigator seat by default', async () => {
    await sub('start')(ctx({ _: [], mode: 'review' }));
    expect(readSession(cwd)?.aiRole).toBe('navigator');
  });

  it('accepts the mode as a bare word: pair start tdd', async () => {
    await sub('start')(ctx({ _: [], mode: 'driver' }, ['tdd']));
    expect(readSession(cwd)?.mode).toBe('tdd');
  });

  it('--role overrides the mode default', async () => {
    await sub('start')(ctx({ _: [], mode: 'tdd', role: 'navigator' }));
    expect(readSession(cwd)?.aiRole).toBe('navigator');
  });

  it('refuses to start a second session', async () => {
    await sub('start')(ctx({ _: [], mode: 'driver' }));
    const second = await sub('start')(ctx({ _: [], mode: 'tdd' }));
    expect(second.success).toBe(false);
    expect(readSession(cwd)?.mode).toBe('driver');
  });

  it('rejects an unknown mode without writing anything', async () => {
    const result = await sub('start')(ctx({ _: [], mode: 'yolo' }));
    expect(result.success).toBe(false);
    expect(readSession(cwd)).toBeNull();
  });

  it('switch swaps roles and counts', async () => {
    await sub('start')(ctx({ _: [], mode: 'driver' }));
    await sub('switch')(ctx());
    expect(readSession(cwd)).toMatchObject({ aiRole: 'navigator', switches: 1 });
    await sub('switch')(ctx());
    expect(readSession(cwd)).toMatchObject({ aiRole: 'driver', switches: 2 });
  });

  it('mode <name> changes the active mode and validates the positional', async () => {
    await sub('start')(ctx({ _: [], mode: 'driver' }));
    const bad = await sub('mode')(ctx({ _: [] }, ['nope']));
    expect(bad.success).toBe(false);
    const good = await sub('mode')(ctx({ _: [] }, ['debug']));
    expect(good.success).toBe(true);
    expect(readSession(cwd)?.mode).toBe('debug');
  });

  it('end moves the session into history.jsonl and clears current.json', async () => {
    await sub('start')(ctx({ _: [], mode: 'mentor' }));
    const id = readSession(cwd)!.id;
    const ended = await sub('end')(ctx({ _: [], json: true }));
    expect(ended.success).toBe(true);
    expect(readSession(cwd)).toBeNull();
    const history = (await sub('history')(ctx({ _: [], json: true }))).data as Array<{ id: string; endedAt?: string }>;
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(id);
    expect(history[0].endedAt).toBeTruthy();
  });
});

describe('ruflo pair — switch mode timing', () => {
  it('defaults the interval to 10 minutes and flags a due switch once elapsed', async () => {
    await sub('start')(ctx({ _: [], mode: 'switch' }));
    const session = readSession(cwd)!;
    expect(session.switchIntervalMinutes).toBe(10);

    let status = await sub('status')(ctx({ _: [], json: true }));
    expect((status.data as { switchDue: boolean }).switchDue).toBe(false);

    // Backdate the last switch past the interval and re-read.
    session.lastSwitchAt = new Date(Date.now() - 11 * 60_000).toISOString();
    fs.writeFileSync(path.join(cwd, '.claude-flow', 'sessions', 'pair', 'current.json'), JSON.stringify(session));
    status = await sub('status')(ctx({ _: [], json: true }));
    expect((status.data as { switchDue: boolean }).switchDue).toBe(true);

    await sub('switch')(ctx());
    status = await sub('status')(ctx({ _: [], json: true }));
    expect((status.data as { switchDue: boolean }).switchDue).toBe(false);
  });

  it('honours --interval with unit suffixes and rejects garbage', async () => {
    const bad = await sub('start')(ctx({ _: [], mode: 'switch', interval: 'soon' }));
    expect(bad.success).toBe(false);
    expect(readSession(cwd)).toBeNull();
    await sub('start')(ctx({ _: [], mode: 'switch', interval: '1h' }));
    expect(readSession(cwd)?.switchIntervalMinutes).toBe(60);
  });
});

describe('parseIntervalMinutes', () => {
  it('parses minutes by default and s/m/h suffixes', () => {
    expect(parseIntervalMinutes('15')).toBe(15);
    expect(parseIntervalMinutes('15m')).toBe(15);
    expect(parseIntervalMinutes('2h')).toBe(120);
    expect(parseIntervalMinutes('90s')).toBe(1.5);
    expect(parseIntervalMinutes(5)).toBe(5);
  });
  it('returns null for empty, zero, negative or unparseable input', () => {
    expect(parseIntervalMinutes(undefined)).toBeNull();
    expect(parseIntervalMinutes('')).toBeNull();
    expect(parseIntervalMinutes('0')).toBeNull();
    expect(parseIntervalMinutes(-3)).toBeNull();
    expect(parseIntervalMinutes('ten minutes')).toBeNull();
  });
});

describe('ruflo pair — v2 flag spellings', () => {
  it('`pair --start --mode tdd` starts and `pair --end` ends', async () => {
    const started = await pairCommand.action!(ctx({ _: [], start: true, mode: 'tdd' }));
    expect(started.success).toBe(true);
    expect(readSession(cwd)?.mode).toBe('tdd');
    const ended = await pairCommand.action!(ctx({ _: [], end: true }));
    expect(ended.success).toBe(true);
    expect(readSession(cwd)).toBeNull();
  });

  it('bare `pair` is status', async () => {
    const result = await pairCommand.action!(ctx({ _: [], json: true }));
    expect(result.data).toEqual({ active: false });
  });
});
