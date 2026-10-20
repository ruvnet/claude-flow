/**
 * ADR-404 — one owner per event. The mod takes route/post-edit over only
 * where the classic hook-handler hands them over (RUFLO_MODS_OWNS); anything
 * else leaves the classic hooks in charge. These tests run the real
 * hook-handler.cjs and ruflo-core ruflo-hook.cjs with the environment the
 * mod sets, and count what fires.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { classicConfigured, legacyCliConfigured, ownedEvents } from '../../../../../plugins/ruflo-mods/hooks/ownership';
import { loadMod, memoryWorld, realWorld, type World } from './harness';

const REPO = resolve(__dirname, '../../../../..');
const PKG_HELPERS = join(REPO, 'v3', '@claude-flow', 'cli', '.claude', 'helpers');
const CORE_HOOK = join(REPO, 'plugins', 'ruflo-core', 'scripts', 'ruflo-hook.cjs');

const CLASSIC = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: `sh -c 'D="\${CLAUDE_PROJECT_DIR:-.}"; [ -f "$D/.claude/helpers/hook-handler.cjs" ] || D="\${HOME}"; exec node "$D/.claude/helpers/hook-handler.cjs" route'` }] }],
    PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" post-edit' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-bash' }] }],
  },
};

async function start(world: World, options: Record<string, unknown> = {}) {
  const mod = loadMod(register, world, options);
  const built = await mod.create(); // the engine runs the engine.create fold before any other hook
  const next = await mod.dispatch('session.start', { cwd: world.root, surface: 'terminal', isInteractive: true }, (e) => ({ cwd: e.cwd }));
  return { mod, next, built };
}

describe('ADR-404 ownership rule', () => {
  it('recognises the generated classic commands (sh probe, quoted, Windows cmd)', () => {
    expect(classicConfigured(CLASSIC, 'route')).toBe(true);
    expect(classicConfigured(CLASSIC, 'post-edit')).toBe(true);
    const win = { hooks: { UserPromptSubmit: [{ hooks: [{ command: 'cmd /c "IF EXIST \\"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\\" (node \\"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\\" route)"' }] }] } };
    expect(classicConfigured(win, 'route')).toBe(true);
    expect(classicConfigured({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node hook-handler.cjs router-stats' }] }] } }, 'route')).toBe(false);
    expect(classicConfigured(null, 'route')).toBe(false);
  });

  it('owns an event only where no classic hook runs it or the helper hands it over', () => {
    expect(ownedEvents({}, false)).toEqual(['route', 'post-edit']);
    expect(ownedEvents(CLASSIC, false)).toEqual([]);
    expect(ownedEvents(CLASSIC, true)).toEqual(['route', 'post-edit']);
  });

  it('stands down where settings still run the CLI\'s own hooks route/post-edit (pre-hook-handler init), handshake or not', () => {
    const legacy = (route: string, edit: string) => ({ hooks: {
      UserPromptSubmit: [{ hooks: [{ command: route }] }],
      PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ command: edit }] }],
    } });
    for (const s of [
      legacy('[ -n "$PROMPT" ] && npx claude-flow@v3alpha hooks route --task "$PROMPT" --intelligence || true',
        'if [ -n "$TOOL_INPUT_file_path" ]; then npx claude-flow@v3alpha hooks post-edit --file "$TOOL_INPUT_file_path"; fi; exit 0'),
      legacy('npx @claude-flow/cli@latest hooks route --task "$PROMPT"', 'npx @claude-flow/cli@latest hooks post-edit --file x'),
      legacy('npx ruflo hooks route --task "$PROMPT"', 'ruflo hooks post-edit --file x'),
    ]) {
      expect(legacyCliConfigured(s, 'route')).toBe(true);
      expect(ownedEvents(s, true)).toEqual([]);
    }
    expect(legacyCliConfigured(CLASSIC, 'route')).toBe(false);
    expect(legacyCliConfigured(legacy('npx claude-flow hooks router-stats', 'npx myruflo hooks post-edit'), 'route')).toBe(false);
    expect(legacyCliConfigured(legacy('npx claude-flow hooks router-stats', 'npx myruflo hooks post-edit'), 'post-edit')).toBe(false);
  });

  it('never owns pre-bash or session events', () => {
    expect(ownedEvents({}, true)).not.toContain('pre-bash');
  });
});

describe('ADR-404 session start', () => {
  it.each(['missing', 'file'] as const)('does not route, learn or create project state when .claude-flow is %s', async (kind) => {
    const project = mkdtempSync(join(tmpdir(), 'ruflo-mods-uninitialized-'));
    const home = mkdtempSync(join(tmpdir(), 'ruflo-mods-initialized-home-'));
    try {
      if (kind === 'file') writeFileSync(join(project, '.claude-flow'), 'not a directory');
      mkdirSync(join(home, '.claude-flow'));
      const world = realWorld(project);
      world.env.set('HOME', home);
      world.env.set('RUFLO_MODS_OWNS', 'route,post-edit');
      const before = readdirSync(project);
      const { mod, next, built } = await start(world);
      expect(next).toEqual({ cwd: project });
      expect(world.env.has('RUFLO_MODS_OWNS')).toBe(false);

      const original = { text: 'review this code', context: ['existing context'], wait: false, origin: { kind: 'composer' } };
      expect(await mod.dispatch('prompt.submit', original, (e) => e)).toEqual(original);
      await mod.dispatch('tool.call', { tool: 'Edit', file_path: join(project, 'a.ts') }, () => ({ result: 'edited' }));
      await mod.dispatch('turn.complete', { reason: 'answer' }, () => ({ text: 'done' }));
      await mod.dispatch('session.end', {}, () => ({ ended: true }));
      expect(await built.ruflo.snapshot()).toMatchObject({ owned: [], routed: 0, edits: 0, lastRoute: null });
      expect(readdirSync(project)).toEqual(before);
      expect(existsSync(join(project, '.claude-flow', 'mods', 'session.json'))).toBe(false);
      expect(existsSync(join(project, '.claude-flow', 'data', 'pending-insights.jsonl'))).toBe(false);
      // The project gate only controls side effects; the installed guard still protects this session.
      expect(await mod.dispatch('tool.check', { tool: 'Bash', input: { command: 'rm -rf /' } }, () => ({ decision: 'allow' }))).toMatchObject({ decision: 'deny' });
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('owns nothing and writes no heartbeat when the project directory cannot be verified', async () => {
    const world = memoryWorld();
    world.failStat = (path) => path === '/work/.claude-flow' ? new Error('EACCES: permission denied') : undefined;
    world.env.set('RUFLO_MODS_OWNS', 'route');
    const { mod, next, built } = await start(world);
    expect(next).toEqual({ cwd: '/work' });
    expect(world.env.has('RUFLO_MODS_OWNS')).toBe(false);
    expect((world.files as Map<string, unknown>).size).toBe(0);
    const prompt = { text: 'implement the api', wait: false, origin: { kind: 'composer' } };
    expect(await mod.dispatch('prompt.submit', prompt, (e) => e)).toEqual(prompt);
    expect(await built.ruflo.snapshot()).toMatchObject({ owned: [], routed: 0, edits: 0 });
  });

  it('with a handshake-aware helper: owns both, sets RUFLO_MODS_OWNS, registers /ruflo-mods, writes a heartbeat', async () => {
    const world = memoryWorld('/work', CLASSIC);
    (world.files as Map<string, any>).set('/work/.claude/helpers/hook-handler.cjs', { text: '... RUFLO_MODS_OWNS ...', mtimeMs: 1 });
    const { mod } = await start(world);
    expect(world.env.get('RUFLO_MODS_OWNS')).toBe('route,post-edit');
    expect(world.commands).toEqual(['ruflo-mods']);
    const beat = JSON.parse((world.files as Map<string, any>).get('/work/.claude-flow/mods/session.json').text);
    expect(beat.owned).toEqual(['route', 'post-edit']);
    const r = await mod.dispatch('command.run', { command: 'ruflo-mods', args: '' }, () => ({ text: 'core' }));
    expect(r.text).toContain('owns:        route, post-edit');
  });

  it('with an older helper: stands down, sets nothing', async () => {
    const world = memoryWorld('/work', CLASSIC);
    (world.files as Map<string, any>).set('/work/.claude/helpers/hook-handler.cjs', { text: 'old helper', mtimeMs: 1 });
    await start(world);
    expect(world.env.has('RUFLO_MODS_OWNS')).toBe(false);
  });

  it('stands down when either copy a hook could run is too old (new project helper, old $HOME helper)', async () => {
    const world = memoryWorld('/work', CLASSIC);
    world.env.set('HOME', '/home/u');
    (world.files as Map<string, any>).set('/work/.claude/helpers/hook-handler.cjs', { text: 'RUFLO_MODS_OWNS', mtimeMs: 1 });
    (world.files as Map<string, any>).set('/home/u/.claude/helpers/hook-handler.cjs', { text: 'old', mtimeMs: 1 });
    await start(world);
    expect(world.env.has('RUFLO_MODS_OWNS')).toBe(false);
  });

  it('checks the $HOME helper settings-generator hookCmd falls back to', async () => {
    const world = memoryWorld('/work', CLASSIC);
    world.env.set('HOME', '/home/u');
    (world.files as Map<string, any>).set('/home/u/.claude/helpers/hook-handler.cjs', { text: 'RUFLO_MODS_OWNS', mtimeMs: 1 });
    await start(world);
    expect(world.env.get('RUFLO_MODS_OWNS')).toBe('route,post-edit');
  });

  it('when settings cannot be read: owns nothing and the session still starts', async () => {
    const world = memoryWorld('/work', () => { throw new Error('refused by a hook beneath'); });
    world.env.set('RUFLO_MODS_OWNS', 'route');
    const { mod, next } = await start(world);
    expect(next).toEqual({ cwd: '/work' });
    expect(world.env.has('RUFLO_MODS_OWNS')).toBe(false);
    let seen: any;
    await mod.dispatch('prompt.submit', { text: 'build', wait: false, origin: { kind: 'composer' } }, (e) => (seen = e));
    expect(seen.context).toBeUndefined();
  });

  it('draws no status line where the ruflo statusLine helper is configured', async () => {
    const world = memoryWorld('/work', { statusLine: { type: 'command', command: 'node .claude/helpers/statusline.cjs' } });
    const { mod } = await start(world);
    await mod.dispatch('prompt.submit', { text: 'build', wait: false, origin: { kind: 'composer' } }, (e) => e);
    expect(world.statuses.filter(Boolean)).toEqual([]); // cleared, never drawn
    const plain = memoryWorld('/work', {});
    const started = await start(plain);
    await started.mod.dispatch('prompt.submit', { text: 'build', wait: false, origin: { kind: 'composer' } }, (e) => e);
    expect(plain.statuses.filter(Boolean)).toEqual(['ruflo · coder 60%']);
  });
});

describe('ADR-404 no double fire with the real classic hooks', () => {
  let project: string;
  let home: string;
  let dedup: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'ruflo-mods-own-'));
    home = mkdtempSync(join(tmpdir(), 'ruflo-mods-own-home-'));
    dedup = mkdtempSync(join(tmpdir(), 'ruflo-mods-dedup-'));
    mkdirSync(join(project, '.claude-flow'));
    mkdirSync(join(project, '.claude', 'helpers'), { recursive: true });
    for (const f of ['hook-handler.cjs', 'router.cjs', 'session.cjs', 'memory.cjs', 'intelligence.cjs']) {
      copyFileSync(join(PKG_HELPERS, f), join(project, '.claude', 'helpers', f));
    }
  });
  afterEach(() => {
    for (const d of [project, home, dedup]) rmSync(d, { recursive: true, force: true });
  });

  const classic = (sub: string, input: object, env: Record<string, string>) =>
    spawnSync(process.execPath, [join(project, '.claude', 'helpers', 'hook-handler.cjs'), sub], {
      input: JSON.stringify(input),
      cwd: project,
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: project, CI: '1', RUFLO_HOOK_DEDUP_DIR: dedup, ...env },
      encoding: 'utf8',
    });

  async function promptRound(prompt: string): Promise<number> {
    const world = realWorld(project, CLASSIC);
    const { mod } = await start(world);
    let blocks = 0;
    await mod.dispatch('prompt.submit', { text: prompt, wait: false, origin: { kind: 'composer' } }, (e) => {
      blocks += e.context?.length ?? 0;
      // The engine runs the UserPromptSubmit settings hooks beneath, in the env the mod set.
      const out = classic('route', { prompt }, Object.fromEntries(world.env)).stdout.trim();
      if (out) blocks++;
      return e;
    });
    return blocks;
  }

  it('exactly one routing block per prompt with a handshake-aware helper (the mod)', async () => {
    expect(await promptRound('implement the api')).toBe(1);
  });

  it('exactly one routing block per prompt with an older helper (classic keeps it)', async () => {
    const helper = join(project, '.claude', 'helpers', 'hook-handler.cjs');
    writeFileSync(helper, readFileSync(helper, 'utf8').replaceAll('RUFLO_MODS_OWNS', 'RUFLO_X_OWNS'));
    expect(await promptRound('implement the api')).toBe(1);
  });

  it('outside a Ruflo project the configured classic route keeps ownership and the mod writes nothing', async () => {
    rmSync(join(project, '.claude-flow'), { recursive: true });
    expect(await promptRound('implement the api')).toBe(1);
    expect(existsSync(join(project, '.claude-flow'))).toBe(false);
  });

  it('exactly one edit record: classic post-edit and ruflo-core post-edit stand down for the mod', async () => {
    const world = realWorld(project, CLASSIC);
    const { mod } = await start(world);
    const env = Object.fromEntries(world.env);
    expect(env.RUFLO_MODS_OWNS).toBe('route,post-edit');
    const event = { tool_name: 'Edit', tool_input: { file_path: join(project, 'a.ts') }, tool_use_id: 'tu-1', session_id: 's1' };

    await mod.dispatch('tool.call', { tool: 'Edit', tool_use_id: 'tu-1', file_path: join(project, 'a.ts') }, () => {
      classic('post-edit', event, env);
      spawnSync(process.execPath, [CORE_HOOK, 'post-edit'], {
        input: JSON.stringify(event), cwd: project, env: { PATH: '/nonexistent', HOME: home, RUFLO_HOOK_DEDUP_DIR: dedup, ...env }, encoding: 'utf8',
      });
      return { result: 'edited', text: 'edited' };
    });
    await mod.dispatch('turn.complete', { reason: 'answer' }, () => ({ text: 'done' }));

    const pending = readFileSync(join(project, '.claude-flow', 'data', 'pending-insights.jsonl'), 'utf8').trim().split('\n');
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0]!)).toMatchObject({ type: 'edit', file: join(project, 'a.ts'), success: true });
    // Neither classic path claimed the event, so neither ran its side effect.
    expect(readdirSync(dedup)).toEqual([]);
  });

  it('without the mod the classic path records as before', () => {
    const event = { tool_name: 'Edit', tool_input: { file_path: 'b.ts' }, tool_use_id: 'tu-2' };
    classic('post-edit', event, {});
    expect(existsSync(join(project, '.claude-flow', 'data', 'pending-insights.jsonl'))).toBe(true);
    expect(readdirSync(dedup)).toHaveLength(1);
  });

  it('pre-bash is a guard: it blocks even when the handshake names it', () => {
    const r = classic('pre-bash', { tool_input: { command: 'rm -rf /' } }, { RUFLO_MODS_OWNS: 'route,post-edit,pre-bash' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('[BLOCKED]');
  });

  it('the helper the refresh fallback generates honours the handshake too', async () => {
    const { generateHookHandler } = await import('../../src/init/helpers-generator.js');
    const helper = join(project, '.claude', 'helpers', 'hook-handler.cjs');
    writeFileSync(helper, generateHookHandler());
    expect(readFileSync(helper, 'utf8')).toContain('RUFLO_MODS_OWNS');
    expect(classic('route', { prompt: 'implement the api' }, { RUFLO_MODS_OWNS: 'route' }).stdout.trim()).toBe('');
    expect(classic('route', { prompt: 'implement the api' }, {}).stdout).toContain('Primary Recommendation');
    expect(classic('pre-bash', { tool_input: { command: 'rm -rf /' } }, { RUFLO_MODS_OWNS: 'pre-bash' }).status).toBe(2);
  });

  it('hook-handler exports the ownership check it applies', () => {
    const require = (id: string) => execFileSync(process.execPath, ['-e', `const h=require(${JSON.stringify(id)});process.stdout.write(JSON.stringify([h.ownedByMod('route',{RUFLO_MODS_OWNS:' route '}),h.ownedByMod('session-end',{RUFLO_MODS_OWNS:'session-end'}),h.ownedByMod('post-edit',{})]))`], { encoding: 'utf8' });
    expect(JSON.parse(require(join(PKG_HELPERS, 'hook-handler.cjs')))).toEqual([true, false, false]);
  });
});
