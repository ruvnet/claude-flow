/**
 * `ruflo tui` (ADR-489): the command loads its bundle from this CLI's own install only, degrades to a message when there is none,
 * and refuses an unknown page. The headless run against a real bundle is skipped when the bundle has not been built.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { aiPage, locateTuiBundle, lookFlags, tuiCommand } from '../src/commands/tui.js';

/** The command names capability-brain.ts lists, read from the source so the test fails if `tui` is dropped. */
const COMMANDS_FOR_BRAIN = [...readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-tools', 'capability-brain.ts'), 'utf8').matchAll(/'([a-z][a-z-]*)'/g)].map(match => match[1]);

const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tui-cmd-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('locateTuiBundle', () => {
  it('finds plugins/ruflo-console/dist/tui.mjs inside the package install', () => {
    const pkg = tmp();
    mkdirSync(join(pkg, 'plugins', 'ruflo-console', 'dist'), { recursive: true });
    mkdirSync(join(pkg, 'dist', 'src', 'commands'), { recursive: true });
    writeFileSync(join(pkg, 'plugins', 'ruflo-console', 'dist', 'tui.mjs'), 'export {}');

    expect(locateTuiBundle(join(pkg, 'dist', 'src', 'commands'))).toBe(join(pkg, 'plugins', 'ruflo-console', 'dist', 'tui.mjs'));
  });

  it('never looks above node_modules: a repository that ships its own bundle is not run', () => {
    const project = tmp();
    const here = join(project, 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'commands');
    mkdirSync(here, { recursive: true });
    mkdirSync(join(project, 'plugins', 'ruflo-console', 'dist'), { recursive: true });
    writeFileSync(join(project, 'plugins', 'ruflo-console', 'dist', 'tui.mjs'), 'throw new Error("hostile")');

    expect(locateTuiBundle(here)).toBeNull();
  });
});

describe('tui command', () => {
  it('is registered by name and listed for the capability brain', () => {
    expect(tuiCommand.name).toBe('tui');
    expect(COMMANDS_FOR_BRAIN).toContain('tui');
  });

  it('refuses an unknown page with exit 2 and runs nothing', async () => {
    const result = await tuiCommand.action!({ args: [], flags: { view: 'swarm; rm -rf /' }, cwd: tmp() } as never);

    expect(result).toMatchObject({ success: false, exitCode: 2 });
  });

  it('degrades to a message and exit 1 when the bundle is not in this install', async () => {
    // From a build output with no plugin beside it; skipped where the repo checkout has built one.
    if (locateTuiBundle() !== null) return;
    const result = await tuiCommand.action!({ args: [], flags: {}, cwd: tmp() } as never);

    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });

  it.skipIf(locateTuiBundle() === null)('opens each of the six pages and any other console view with --plain, and refuses an unknown name with exit 2 (real bundle)', async () => {
    for (const view of ['overview', 'cost', 'swarm', 'events', 'missions', 'ai', 'menu', 'federation', 'settings', 'room']) {
      const lines: string[] = [];
      const real = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
      try {
        const result = await tuiCommand.action!({ args: [], flags: { view, plain: true }, cwd: tmp() } as never);

        expect(result, view).toMatchObject({ success: true, exitCode: 0 });
      } finally {
        process.stdout.write = real;
      }
      expect(lines.join(''), view).toContain('1 Overview');
      expect(lines.join(''), view).not.toContain(process.env.OPENROUTER_API_KEY ?? '\u0000never');
    }

    for (const view of ['nope', 'federation; rm -rf /']) {
      expect(await tuiCommand.action!({ args: [], flags: { view, plain: true }, cwd: tmp() } as never), view).toMatchObject({ success: false, exitCode: 2 });
    }
  });

  it('reads the AI flags: a model, a numeric cap (a bad one is dropped), the endpoint list from a flag or the environment', () => {
    expect(aiPage({})).toEqual({});
    expect(aiPage({ model: 'openai/gpt-4o-mini', maxSpendUsd: 0.1, convoTargets: 'endpoint:a=https://x.example/v1|A_KEY|m' })).toEqual({ model: 'openai/gpt-4o-mini', maxSpendUsd: 0.1, convoTargets: 'endpoint:a=https://x.example/v1|A_KEY|m' });
    expect(aiPage({ 'max-spend-usd': '0.25' })).toEqual({ maxSpendUsd: 0.25 });
    expect(aiPage({ maxSpendUsd: -1 })).toEqual({});
    expect(aiPage({ maxSpendUsd: 'lots' })).toEqual({});
    expect(aiPage({ model: '' })).toEqual({});
  });

  it('declares --ai (default on, --no-ai turns it off), --model, --max-spend-usd and --convo-targets', () => {
    expect(tuiCommand.options?.find(option => option.name === 'ai')).toMatchObject({ type: 'boolean', default: true });
    for (const name of ['model', 'max-spend-usd', 'convo-targets']) expect(tuiCommand.options?.some(option => option.name === name), name).toBe(true);
  });

  it('declares --plain as a boolean option and lists it in the examples', () => {
    expect(tuiCommand.options?.find(option => option.name === 'plain')).toMatchObject({ type: 'boolean', default: false });
    expect(tuiCommand.examples?.some(example => example.command.includes('--plain'))).toBe(true);
  });

  it('tells the truth about the page keys: six pages, so 1-6 and a for AI, never 1-5', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands', 'tui.ts'), 'utf8');
    const text = [tuiCommand.description, ...(tuiCommand.examples ?? []).map(example => example.description), source].join('\n');

    expect(text).toMatch(/keys 1-6/);
    expect(text).not.toMatch(/keys 1-5/);
    expect(text).toMatch(/o c s e m a/);
  });

  it.skipIf(locateTuiBundle() === null)('--plain prints one plain frame to stdout and exits 0 (real bundle)', async () => {
    const lines: string[] = [];
    const real = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
    try {
      const result = await tuiCommand.action!({ args: [], flags: { view: 'overview', plain: true }, cwd: tmp() } as never);

      expect(result).toMatchObject({ success: true, exitCode: 0 });
    } finally {
      process.stdout.write = real;
    }
    expect(lines.join('')).toContain('what ruflo is doing here');
    expect(existsSync(locateTuiBundle()!)).toBe(true);
  });

  // Needs a non-terminal stdin and stdout, which is what a test runner has; skipped when someone runs the suite from a real terminal.
  it.skipIf(locateTuiBundle() === null || process.stdin.isTTY === true || process.stdout.isTTY === true)('without a terminal and without --plain prints a hint on stderr, nothing on stdout, and exits 2 (real bundle)', async () => {
    const out: string[] = [];
    const errs: string[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => (out.push(String(chunk)), true)) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => (errs.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      const result = await tuiCommand.action!({ args: [], flags: { view: 'overview' }, cwd: tmp() } as never);

      expect(result).toMatchObject({ success: false, exitCode: 2 });
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
    expect(out.join('')).toBe('');
    expect(errs.join('')).toMatch(/not an interactive terminal.*--plain/s);
  });
});

describe('the look and motion flags', () => {
  it('pass a valid look, an fps from 0 to 30 (a number or digits), --no-anim, --no-pictures and --boot, and nothing else', () => {
    expect(lookFlags({})).toEqual({});
    expect(lookFlags({ look: 'orbital', fps: 12, anim: false, pictures: false, boot: true, mouse: true })).toEqual({ look: 'orbital', fps: 12, anim: false, pictures: false, boot: true, mouse: true });
    expect(lookFlags({ look: 'bbs', fps: '30' })).toEqual({ look: 'bbs', fps: 30 });
    expect(lookFlags({ fps: 0 })).toEqual({ fps: 0 });
  });

  it('ignore a bad value instead of passing it on', () => {
    expect(lookFlags({ look: 'neon; rm -rf /', fps: 31 })).toEqual({});
    expect(lookFlags({ look: 7, fps: -1 })).toEqual({});
    expect(lookFlags({ fps: '1e9' })).toEqual({});
    expect(lookFlags({ fps: 'NaN', anim: true, pictures: true, boot: false })).toEqual({});
    expect(lookFlags(undefined)).toEqual({});
  });

  it('are listed in the command\'s options', () => {
    expect((tuiCommand.options ?? []).map(option => option.name)).toEqual(expect.arrayContaining(['look', 'fps', 'anim', 'pictures', 'boot', 'mouse']));
  });
});
