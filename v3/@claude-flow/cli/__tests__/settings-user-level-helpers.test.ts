/**
 * User-level settings (~/.claude/settings.json) apply to every opened project,
 * so their hook and statusline commands must run the user's own
 * $HOME/.claude/helpers, never a helper the project supplies. Project-level
 * settings keep the #1943 project-first probe.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import { generateSettings } from '../src/init/settings-generator.js';
import { executeUpgrade, mergeSettingsForUpgrade } from '../src/init/executor.js';
import { helperHookCommand, helperStatusLineCommand, pinToUserHelpers } from '../src/init/helper-commands.js';

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Settings = { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>; statusLine: { command: string } };

function commandsOf(settings: Settings): string[] {
  const hooks = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  return [...hooks, settings.statusLine.command];
}

const settingsFor = (targetDir: string) =>
  generateSettings({ ...DEFAULT_INIT_OPTIONS, targetDir, statusline: { ...DEFAULT_INIT_OPTIONS.statusline, enabled: true } }) as Settings;

describe('generated settings by scope', () => {
  it('pins every helper command to $HOME when the target is the home directory', () => {
    const commands = commandsOf(settingsFor(homedir()));
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) {
      expect(command).not.toContain('CLAUDE_PROJECT_DIR');
      expect(command).toMatch(/\$\{HOME\}\/\.claude\/helpers\/|%USERPROFILE%|process\.env\.USERPROFILE/);
    }
  });

  it('keeps the #1943 project-first probe for a project target', () => {
    const project = mkdtempSync(join(tmpdir(), 'ruflo-settings-project-'));
    tempRoots.push(project);
    const commands = commandsOf(settingsFor(project));
    for (const command of commands) expect(command).toContain('CLAUDE_PROJECT_DIR');
  });
});

describe('helper command forms', () => {
  it('user-level Windows commands never reference the project', () => {
    expect(helperHookCommand('.claude/helpers/hook-handler.cjs', 'pre-bash', 'user', true))
      .toBe('cmd /c "node "%USERPROFILE%\\.claude\\helpers\\hook-handler.cjs" pre-bash"');
    expect(helperStatusLineCommand('user', true)).not.toContain('CLAUDE_PROJECT_DIR');
  });

  it('project-level commands are unchanged from #1943', () => {
    expect(helperHookCommand('.claude/helpers/hook-handler.cjs', 'route', 'project', false))
      .toBe(`sh -c 'D="\${CLAUDE_PROJECT_DIR:-.}"; [ -f "$D/.claude/helpers/hook-handler.cjs" ] || D="\${HOME}"; exec node "$D/.claude/helpers/hook-handler.cjs" route'`);
    expect(helperHookCommand('.claude/helpers/hook-handler.cjs', 'route', 'project', true))
      .toBe('cmd /c "IF EXIST "%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs" (node "%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs" route) ELSE (node "%USERPROFILE%\\.claude\\helpers\\hook-handler.cjs" route)"');
  });

  it('re-pins every generated project-probe form and leaves other commands alone', () => {
    for (const windows of [false, true]) {
      const probe = helperHookCommand('.claude/helpers/hook-handler.cjs', 'post-edit', 'project', windows);
      expect(pinToUserHelpers(probe, windows)).toBe(helperHookCommand('.claude/helpers/hook-handler.cjs', 'post-edit', 'user', windows));
      expect(pinToUserHelpers(helperStatusLineCommand('project', windows), windows)).toBe(helperStatusLineCommand('user', windows));
    }
    expect(pinToUserHelpers('node my-own-hook.js', false)).toBeNull();
  });
});

// Command forms earlier ruflo releases wrote into settings.json. Each one runs
// the opened project's copy of the helper; in user scope all must be re-pinned.
const GIT_ROOT = "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}";
const GIT_ROOT_ESM = "var c=require('child_process'),p=require('path'),u=require('url'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}";
const userHook = (script: string, sub: string, windows: boolean) => helperHookCommand(`.claude/helpers/${script}`, sub, 'user', windows);
const LEGACY: Array<[string, string, boolean, string]> = [
  // name, shipped command, windows, expected pinned command
  ['pre-#1943 sh form (settings-generator at 3657a6936^)',
    `sh -c 'exec node "\${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/hook-handler.cjs" pre-bash'`, false, userHook('hook-handler.cjs', 'pre-bash', false)],
  ['pre-#1943 Windows cmd form',
    'cmd /c node %CLAUDE_PROJECT_DIR%/.claude/helpers/hook-handler.cjs pre-bash', true, userHook('hook-handler.cjs', 'pre-bash', true)],
  ['ADR-059 git-root CJS form with argv.splice (48b70afca)',
    `node -e "${GIT_ROOT}var s=p.join(r,'.claude/helpers/hook-handler.cjs');process.argv.splice(1,0,s);require(s)" pre-edit`, false, userHook('hook-handler.cjs', 'pre-edit', false)],
  ['ADR-059 git-root ESM form with argv.splice',
    `node -e "${GIT_ROOT_ESM}var f=p.join(r,'.claude/helpers/auto-memory-hook.mjs');process.argv.splice(1,0,f);import(u.pathToFileURL(f).href)" import`, false, userHook('auto-memory-hook.mjs', 'import', false)],
  ['upgrade git-root ESM form without argv.splice',
    `node -e "${GIT_ROOT_ESM}var f=p.join(r,'.claude/helpers/auto-memory-hook.mjs');import(u.pathToFileURL(f).href)" sync`, false, userHook('auto-memory-hook.mjs', 'sync', false)],
  ['ADR-059 git-root statusline',
    `node -e "${GIT_ROOT}var s=p.join(r,'.claude/helpers/statusline.cjs');process.argv.splice(1,0,s);require(s)"`, false, helperStatusLineCommand('user', false)],
  ['pre-#1943 sh statusline',
    `sh -c 'exec node "\${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/statusline.cjs"'`, false, helperStatusLineCommand('user', false)],
  ['pre-ADR-059 relative statusline',
    'node .claude/helpers/statusline.cjs', false, helperStatusLineCommand('user', false)],
  ['pre-ADR-059 relative hook',
    'node .claude/helpers/hook-handler.cjs session-restore', false, userHook('hook-handler.cjs', 'session-restore', false)],
];

describe('legacy command forms in user scope', () => {
  for (const [name, command, windows, expected] of LEGACY) {
    it(`re-pins ${name}`, () => {
      expect(pinToUserHelpers(command, windows)).toBe(expected);
    });
  }

  it('leaves user-authored and already-pinned commands alone', () => {
    for (const command of [
      'node .claude/helpers/hook-handler.cjs pre-bash 2>/dev/null',
      'node .claude/helpers/hook-handler.cjs pre-bash && echo done',
      'node .claude/helpers/my-own-script.js run',
      'node ./scripts/lint.js',
      userHook('hook-handler.cjs', 'pre-bash', false),
      userHook('hook-handler.cjs', 'pre-bash', true),
      helperStatusLineCommand('user', false),
      helperStatusLineCommand('user', true),
    ]) {
      expect(pinToUserHelpers(command, command.startsWith('cmd') || command.includes('USERPROFILE'))).toBeNull();
    }
  });

  it('mergeSettingsForUpgrade re-pins every legacy form for a home target', () => {
    const existing = {
      hooks: {
        PreToolUse: [{ hooks: LEGACY.filter(([, , w]) => !w).map(([, command]) => ({ type: 'command', command })) }],
      },
      statusLine: { type: 'command', command: 'node .claude/helpers/statusline.cjs' },
    };
    const { merged } = mergeSettingsForUpgrade(existing, homedir());
    const commands = commandsOf(merged as unknown as Settings);
    for (const command of commands) {
      expect(command).not.toMatch(/CLAUDE_PROJECT_DIR|git rev-parse|(^|\s)\.claude\/helpers/);
    }
  });
});

describe('ruflo init --upgrade --settings', () => {
  const gitRootImport = `node -e "var c=require('child_process'),p=require('path'),u=require('url'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var f=p.join(r,'.claude/helpers/auto-memory-hook.mjs');import(u.pathToFileURL(f).href)" import`;
  const existing = () => ({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: helperHookCommand('.claude/helpers/hook-handler.cjs', 'pre-bash', 'project') }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: gitRootImport }, { type: 'command', command: 'node my-own-hook.js' }] }],
    },
    statusLine: { type: 'command', command: helperStatusLineCommand('project') },
  });

  it('re-pins user-level settings to $HOME and keeps user-authored hooks', () => {
    const { merged } = mergeSettingsForUpgrade(existing(), homedir());
    const commands = commandsOf(merged as unknown as Settings);
    expect(commands).toContain('node my-own-hook.js');
    for (const command of commands.filter((c) => c !== 'node my-own-hook.js')) {
      expect(command).not.toContain('CLAUDE_PROJECT_DIR');
      expect(command).not.toContain('git rev-parse');
    }
  });

  it('leaves project-level settings on the project-first forms', () => {
    const project = mkdtempSync(join(tmpdir(), 'ruflo-upgrade-project-'));
    tempRoots.push(project);
    const { merged } = mergeSettingsForUpgrade(existing(), project);
    const commands = commandsOf(merged as unknown as Settings);
    expect(commands).toContain(gitRootImport);
    expect(commands).toContain(helperStatusLineCommand('project'));
  });
});

describe('executeUpgrade creates missing settings for its target', () => {
  it('pins the commands when the target is the home directory', async () => {
    const savedHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'ruflo-upgrade-home-'));
    tempRoots.push(home);
    process.env.HOME = home;
    try {
      const result = await executeUpgrade(home, true);
      expect(result.created).toContain('.claude/settings.json');
      const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as Settings;
      for (const command of commandsOf(settings)) expect(command).not.toContain('CLAUDE_PROJECT_DIR');
    } finally {
      if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    }
  });
});

describe.skipIf(process.platform === 'win32')('user-level command at runtime', () => {
  it('runs the home helper even when the project ships its own', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-user-hook-'));
    tempRoots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    for (const dir of [join(home, '.claude', 'helpers'), join(project, '.claude', 'helpers')]) mkdirSync(dir, { recursive: true });
    const marker = (name: string) => `require('fs').writeFileSync(${JSON.stringify(join(root, name))}, '1');\n`;
    writeFileSync(join(home, '.claude', 'helpers', 'hook-handler.cjs'), marker('home-ran'));
    writeFileSync(join(project, '.claude', 'helpers', 'hook-handler.cjs'), marker('project-ran'));

    const command = helperHookCommand('.claude/helpers/hook-handler.cjs', 'route', 'user', false);
    const result = spawnSync('sh', ['-c', command], {
      cwd: project,
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'home-ran'))).toBe(true);
    expect(existsSync(join(root, 'project-ran'))).toBe(false);
  });
});
