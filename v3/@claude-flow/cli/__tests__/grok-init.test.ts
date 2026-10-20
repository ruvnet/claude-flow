/**
 * `init --grok` (ADR-402) — regression coverage for the #3512 review:
 * user-config merge safety, opt-in home writes, dry run, pinned MCP launch,
 * Windows escaping, and the shipped status row.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import * as TOML from '@iarna/toml';
import {
  executeGrokInit,
  grokStatusLineCommand,
  grokTemplatesRoot,
  materializeGrokConfig,
  mergeGrokStatusLine,
  rufloMcpLaunch,
} from '../src/init/grok-generator.js';

const HOME = '/home/tester';

/** Existing, valid user configs that already set ui.status_line some other way. */
const ALREADY_SET: Record<string, string> = {
  header: '[ui.status_line]\ntype = "command"\ncommand = "mine"\n',
  spacedHeader: '[ ui.status_line ]\ntype = "command"\ncommand = "mine"\n',
  quotedHeader: '[ui."status_line"]\ntype = "command"\ncommand = "mine"\n',
  inlineTable: '[ui]\nstatus_line = { type = "command", command = "mine" }\n',
  dottedKeys: '[ui]\nstatus_line.type = "command"\nstatus_line.command = "mine"\n',
  rootDotted: 'ui.status_line.type = "command"\nui.status_line.command = "mine"\n',
};

describe('mergeGrokStatusLine (review #1)', () => {
  for (const [name, text] of Object.entries(ALREADY_SET)) {
    it(`leaves an existing status row alone: ${name}`, () => {
      expect(TOML.parse(text)).toBeTruthy();
      expect(mergeGrokStatusLine(text, HOME)).toEqual({ kind: 'already-set', ours: false });
    });
  }

  it('appends to an unrelated config and keeps every other value and comment', () => {
    const text = '# my settings\nmodel = "grok-4"\n\n[ui]\ntheme = "dark"\n\n[mcp_servers.x]\ncommand = "x"\nargs = ["a"]';
    const out = mergeGrokStatusLine(text, HOME);
    expect(out.kind).toBe('write');
    if (out.kind !== 'write') return;
    expect(out.text.startsWith(text)).toBe(true);
    const parsed = TOML.parse(out.text) as any;
    expect(parsed.model).toBe('grok-4');
    expect(parsed.ui.theme).toBe('dark');
    expect(parsed.mcp_servers.x.args).toEqual(['a']);
    expect(parsed.ui.status_line).toEqual({ type: 'command', command: grokStatusLineCommand(HOME) });
  });

  it('falls back to the snippet when ui is an inline table (cannot be extended)', () => {
    const out = mergeGrokStatusLine('ui = { theme = "dark" }\n', HOME);
    expect(out.kind).toBe('unsafe');
  });

  it('falls back to the snippet when the file is not valid TOML', () => {
    const out = mergeGrokStatusLine('[ui\nbroken = ', HOME);
    expect(out.kind).toBe('unsafe');
    if (out.kind === 'unsafe') expect(out.reason).toMatch(/could not parse/);
  });

  it('produces TOML that Python tomllib also accepts (when python3 is present)', () => {
    const out = mergeGrokStatusLine('[ui]\ntheme = "dark"\n', 'C:\\Users\\Bob');
    expect(out.kind).toBe('write');
    if (out.kind !== 'write') return;
    const py = spawnSync('python3', ['-c', 'import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.stdin.read())))'], {
      input: out.text,
      encoding: 'utf-8',
    });
    if (py.error || py.status === null) return; // no python3 on this runner
    if (py.stderr.includes('No module named')) return; // python < 3.11
    expect(py.status, py.stderr).toBe(0);
    expect(JSON.parse(py.stdout).ui.status_line.command).toBe(grokStatusLineCommand('C:\\Users\\Bob'));
  });
});

describe('status row command (reviews #7, #10)', () => {
  it('runs node on an absolute path, with no shell and no repo-relative script', () => {
    const cmd = grokStatusLineCommand(HOME);
    expect(cmd).toBe(`node "${join(HOME, '.grok', 'ruflo', 'host-statusline.mjs')}"`);
    expect(cmd).not.toMatch(/\bsh\b|test -f|scripts\//);
  });
});

describe('materializeGrokConfig (reviews #9, #10)', () => {
  const template = readFileSync(join(grokTemplatesRoot(), 'config.toml'), 'utf-8');

  it('never launches ruflo@latest', () => {
    expect(template).not.toMatch(/ruflo@latest/);
    const launch = rufloMcpLaunch();
    const text = materializeGrokConfig(template, launch, HOME);
    const parsed = TOML.parse(text) as any;
    expect(parsed.mcp_servers.ruflo.command).toBe(launch.command);
    expect(parsed.mcp_servers.ruflo.args).toEqual(launch.args);
    expect(JSON.stringify(parsed)).not.toMatch(/@latest/);
  });

  it('pins a published install to its own version', () => {
    const root = join(tmpdir(), 'x', 'node_modules', '@claude-flow', 'cli');
    const launch = rufloMcpLaunch(root);
    expect(launch.source).toBe('published');
    expect(launch.args).toContain('ruflo@0.0.0');
    expect(launch.args.some((a) => a.includes('latest'))).toBe(false);
  });

  it('escapes Windows paths into valid TOML strings', () => {
    const winHome = 'C:\\Users\\Bob';
    const launch = {
      command: 'node',
      args: ['C:\\src\\ruflo\\v3\\@claude-flow\\cli\\bin\\cli.js', 'mcp', 'start'],
      source: 'checkout' as const,
      version: '1.0.0',
    };
    // Uncomment the optional brain block so its {{HOME}} paths are parsed too.
    const text = materializeGrokConfig(template.replace(/^# (\[mcp_servers\.ruvnet-brain\]|command|args|env|enabled|startup_timeout_sec|tool_timeout_sec)/gm, '$1'), launch, winHome);
    const parsed = TOML.parse(text) as any;
    expect(parsed.mcp_servers.ruflo.args[0]).toBe(launch.args[0]);
    expect(parsed.mcp_servers['ruvnet-brain'].env.KB_DIR).toBe('C:\\Users\\Bob/.cache/ruvnet-brain/kb');
  });
});

describe('executeGrokInit', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-grok-init-'));
    home = mkdtempSync(join(tmpdir(), 'ruflo-grok-home-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('does not touch the home directory unless asked (review #2)', () => {
    const r = executeGrokInit({ targetDir: dir, homeDir: home });
    expect(r.success, r.errors.join('\n')).toBe(true);
    expect(readdirSync(home)).toEqual([]);
    expect(r.userConfig.action).toBe('not-requested');
    expect(r.userConfig.snippet).toMatch(/\[ui\.status_line\]/);
    expect(r.filesCreated.every((f) => f.startsWith(dir))).toBe(true);
    // Project config is valid TOML and pinned
    const cfg = TOML.parse(readFileSync(join(dir, '.grok', 'config.toml'), 'utf-8')) as any;
    expect(cfg.mcp_servers.ruflo.args.join(' ')).not.toMatch(/latest/);
  });

  it('dry run writes nothing and lists what it would write (review #2)', () => {
    const r = executeGrokInit({ targetDir: dir, homeDir: home, dryRun: true, statusLine: true });
    expect(r.success).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(r.userConfig.action).toBe('would-write');
    expect(r.filesCreated).toContain(join(home, '.grok', 'config.toml'));
    expect(r.filesCreated).toContain(join(dir, '.grok', 'config.toml'));
  });

  it('--grok-statusline merges into an existing user config and lists the path', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'config.toml'), '# keep me\n[ui]\ntheme = "dark"\n');
    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.success, r.errors.join('\n')).toBe(true);
    expect(r.userConfig.action).toBe('merged');
    expect(r.filesCreated).toContain(join(home, '.grok', 'config.toml'));
    const text = readFileSync(join(home, '.grok', 'config.toml'), 'utf-8');
    expect(text.startsWith('# keep me\n[ui]\ntheme = "dark"\n')).toBe(true);
    const parsed = TOML.parse(text) as any;
    expect(parsed.ui.status_line.command).toBe(grokStatusLineCommand(home));
    expect(existsSync(join(home, '.grok', 'ruflo', 'host-statusline.mjs'))).toBe(true);

    // A second run is a no-op on the config
    const again = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true, force: true });
    expect(again.userConfig.action).toBe('already-set');
    expect(readFileSync(join(home, '.grok', 'config.toml'), 'utf-8')).toBe(text);
  });

  it('--grok-statusline leaves a foreign status row alone and installs nothing', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    const original = '[ ui.status_line ]\ntype = "command"\ncommand = "mine"\n';
    writeFileSync(join(home, '.grok', 'config.toml'), original);
    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.userConfig.action).toBe('already-set');
    expect(r.userConfig.reason).toMatch(/its own \[ui\.status_line\]/);
    expect(readFileSync(join(home, '.grok', 'config.toml'), 'utf-8')).toBe(original);
    expect(existsSync(join(home, '.grok', 'ruflo'))).toBe(false);
    expect(r.filesCreated.some((f) => f.startsWith(home))).toBe(false);
  });

  it('--grok-statusline never rewrites a config it cannot merge safely', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    const original = 'ui = { theme = "dark" }\n';
    writeFileSync(join(home, '.grok', 'config.toml'), original);
    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.success).toBe(true);
    expect(r.userConfig.action).toBe('snippet');
    expect(r.userConfig.reason).toMatch(/would not parse/);
    expect(readFileSync(join(home, '.grok', 'config.toml'), 'utf-8')).toBe(original);
  });

  it('ships a status row that reports "loaded" after init (review #6)', () => {
    executeGrokInit({ targetDir: dir, homeDir: home });
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'host-statusline.mjs'), '--json'], {
      cwd: dir,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf-8',
      input: '',
    });
    expect(r.status, r.stderr).toBe(0);
    const snap = JSON.parse(r.stdout);
    expect(snap.loaded).toMatchObject({ mcp: true, rules: true, agents: 4, skills: 1, hook: true });
    // Only folder trust (a Grok-side setting) is left
    expect(snap.line).toMatch(/^RuFlo │ missing untrusted/);
  });

  it('host-statusline.mjs parses real TOML instead of text-matching (round-2 review, minor item 3)', () => {
    executeGrokInit({ targetDir: dir, homeDir: home });
    const runStatusline = () =>
      JSON.parse(
        spawnSync(process.execPath, [join(dir, 'scripts', 'host-statusline.mjs'), '--json'], {
          cwd: dir,
          env: { ...process.env, HOME: home, USERPROFILE: home },
          encoding: 'utf-8',
          input: '',
        }).stdout,
      );
    // Node's spawn cwd is resolved to the real path (e.g. macOS /var is a
    // symlink to /private/var) before the child ever sees process.cwd(), so
    // the section key must match that resolved path, not the tmpdir's own.
    const root = realpathSync(dir);

    // A commented-out `trusted = true` must not read as trusted (a
    // substring/regex match on the section body would say yes).
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'trusted_folders.toml'), `[folders."${root}"]\n# trusted = true\n`);
    expect(runStatusline().loaded.trusted).toBe(false);

    // A genuine (uncommented) trusted = true in the same section shape
    // still works — this isn't just rejecting everything.
    writeFileSync(join(home, '.grok', 'trusted_folders.toml'), `[folders."${root}"]\ntrusted = true\n`);
    expect(runStatusline().loaded.trusted).toBe(true);

    // An mcp_servers.ruflo table that exists but is explicitly disabled
    // must not count as "loaded" (a substring match on `[mcp_servers.name]`
    // alone would say yes regardless of `enabled`).
    writeFileSync(
      join(dir, '.grok', 'config.toml'),
      '[mcp_servers.ruflo]\ncommand = "node"\nargs = ["x"]\nenabled = false\n',
    );
    expect(runStatusline().loaded.mcp).toBe(false);
  });

  it('treats a ] inside a quoted trusted-folder key as part of the path (round-3 review)', () => {
    executeGrokInit({ targetDir: dir, homeDir: home });
    const weird = join(dir, 'a]b');
    mkdirSync(weird, { recursive: true });
    const root = realpathSync(weird);
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'trusted_folders.toml'), `[folders."${root}"]\ntrusted = true\n`);
    const r = spawnSync(process.execPath, [join(grokTemplatesRoot(), 'scripts', 'host-statusline.mjs'), '--json'], {
      cwd: weird,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf-8',
      input: '',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).loaded.trusted).toBe(true);
  });

  it('writes through a symlinked ~/.grok/config.toml instead of replacing it (round-2 review, minor item 1)', () => {
    // A dotfiles-managed setup often symlinks ~/.grok/config.toml at a real
    // file living elsewhere (e.g. a dotfiles repo checkout).
    const realTarget = join(home, 'dotfiles-config.toml');
    writeFileSync(realTarget, '# keep me\n[ui]\ntheme = "dark"\n');
    mkdirSync(join(home, '.grok'), { recursive: true });
    const symlinkPath = join(home, '.grok', 'config.toml');
    symlinkSync(realTarget, symlinkPath);

    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.success, r.errors.join('\n')).toBe(true);

    // The symlink itself must survive, still pointing at the same target.
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(symlinkPath)).toBe(realpathSync(realTarget));

    // The status row was written THROUGH the symlink, into the real file.
    const written = readFileSync(realTarget, 'utf-8');
    expect(written.startsWith('# keep me\n[ui]\ntheme = "dark"\n')).toBe(true);
    const parsed = TOML.parse(written) as any;
    expect(parsed.ui.status_line.command).toBe(grokStatusLineCommand(home));
  });

  it('rejects an existing user config with an unserializable value before writing anything (round-2 review, minor item 2)', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    const dest = join(home, '.grok', 'config.toml');
    // A TOML integer literal above 2^53 parses to a BigInt (@iarna/toml),
    // which crashes JSON.stringify — previously discovered only as the LAST
    // step of init, after project files were already written.
    const original = '# keep me\ngiant = 99999999999999999999\n';
    writeFileSync(dest, original);

    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.success).toBe(false);
    expect(r.errors.join('\n')).toMatch(/config\.toml/);
    expect(r.errors.join('\n')).toMatch(/giant/);
    expect(r.errors.join('\n')).toMatch(/BigInt|serialize/i);

    // Nothing was written: not the user config, not a single project file.
    expect(readFileSync(dest, 'utf-8')).toBe(original);
    expect(r.filesCreated).toEqual([]);
    expect(existsSync(join(dir, '.grok'))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps init working when a BigInt sits beside an existing status row (round-3 review)', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    const dest = join(home, '.grok', 'config.toml');
    // Nothing is serialized when the user already has [ui.status_line], so
    // the integer must not fail the whole init.
    const original = 'giant = 99999999999999999999\n[ui.status_line]\ntype = "command"\ncommand = "mine"\n';
    writeFileSync(dest, original);

    const r = executeGrokInit({ targetDir: dir, homeDir: home, statusLine: true });
    expect(r.success, r.errors.join('\n')).toBe(true);
    expect(r.userConfig.action).toBe('already-set');
    expect(readFileSync(dest, 'utf-8')).toBe(original);
    expect(existsSync(join(dir, '.grok', 'config.toml'))).toBe(true);
  });

  it('copies the scripts byte-for-byte from templates (no second copy to drift)', () => {
    executeGrokInit({ targetDir: dir, homeDir: home });
    for (const f of ['grok-team-bus.mjs', 'grok-team-store.mjs', 'grok-subagent-stop-hook.mjs', 'host-statusline.mjs']) {
      expect(readFileSync(join(dir, 'scripts', f), 'utf-8')).toBe(
        readFileSync(join(grokTemplatesRoot(), 'scripts', f), 'utf-8'),
      );
    }
  });
});
