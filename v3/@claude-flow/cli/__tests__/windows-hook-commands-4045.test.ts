/**
 * #4045: on Windows under Git Bash the generated `cmd /c "IF EXIST ..."` hook
 * started an interactive cmd (MSYS rewrote `/c`), which executed the hook's
 * stdin JSON and created zero-byte files named after text following a `>`.
 * Windows hook commands must be a single `node -e` with no `cmd`, no shell
 * metacharacters and no `%VAR%` expansion, and must still forward stdin/args.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { helperHookCommand, pinToUserHelpers } from '../src/init/helper-commands.js';

const SCRIPT = '.claude/helpers/hook-handler.cjs';
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const codeOf = (command: string): string => {
  const m = /^node -e "(.*)"$/s.exec(command);
  expect(m, `not a node -e command: ${command}`).not.toBeNull();
  return m![1];
};
const fixture = (tag: string) => {
  const dir = mkdtempSync(join(tmpdir(), `ruflo-4045-${tag}-`));
  roots.push(dir);
  mkdirSync(join(dir, '.claude', 'helpers'), { recursive: true });
  writeFileSync(join(dir, SCRIPT), `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.stringify({tag:${JSON.stringify(tag)},argv:process.argv.slice(2),stdin:d})));`);
  return dir;
};
const run = (command: string, env: Record<string, string>, input: string) =>
  spawnSync(process.execPath, ['-e', codeOf(command)], { env: { PATH: process.env.PATH ?? '', ...env }, input, encoding: 'utf8' });

describe('#4045 Windows hook commands', () => {
  for (const scope of ['project', 'user'] as const) {
    it(`${scope} scope never goes through cmd and has no shell metacharacters`, () => {
      const command = helperHookCommand(SCRIPT, 'pre-bash', scope, true);
      expect(command).not.toMatch(/\bcmd(\.exe)?\b/i);
      expect(command).not.toMatch(/IF EXIST/i);
      const code = codeOf(command);
      expect(code).not.toMatch(/[<>|&%$`"\\]/);
    });
  }

  it('project scope runs the project helper with argv and forwards stdin', () => {
    const project = fixture('project');
    const home = fixture('home');
    const out = run(helperHookCommand(SCRIPT, 'post-edit', 'project', true),
      { CLAUDE_PROJECT_DIR: project, USERPROFILE: home }, '{"tool_input":"a => b > c"}');
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ tag: 'project', argv: ['post-edit'], stdin: '{"tool_input":"a => b > c"}' });
    expect(existsSync(join(process.cwd(), 'b'))).toBe(false);
  });

  it('project scope falls back to the user profile helper when the project has none', () => {
    const project = mkdtempSync(join(tmpdir(), 'ruflo-4045-empty-'));
    roots.push(project);
    const home = fixture('home');
    const out = run(helperHookCommand(SCRIPT, 'route', 'project', true), { CLAUDE_PROJECT_DIR: project, USERPROFILE: home }, '{}');
    expect(JSON.parse(out.stdout).tag).toBe('home');
  });

  it('user scope ignores the project helper entirely', () => {
    const project = fixture('project');
    const home = fixture('home');
    const out = run(helperHookCommand(SCRIPT, 'route', 'user', true), { CLAUDE_PROJECT_DIR: project, USERPROFILE: home }, '{}');
    expect(JSON.parse(out.stdout).tag).toBe('home');
  });

  it('passes through a non-zero exit status of the helper', () => {
    const project = fixture('project');
    writeFileSync(join(project, SCRIPT), 'process.exit(2)');
    expect(run(helperHookCommand(SCRIPT, 'pre-bash', 'project', true), { CLAUDE_PROJECT_DIR: project }, '').status).toBe(2);
  });

  it('keeps the subcommand next to the helper name so the mods ownership rule still recognises it', () => {
    const command = helperHookCommand(SCRIPT, 'route', 'project', true);
    expect(new RegExp('hook-handler\\.c?js\\\\?["\']?\\s+route(?![\\w-])').test(command)).toBe(true);
  });

  it('re-pins the new project form to the user form (and the old cmd form too)', () => {
    const project = helperHookCommand(SCRIPT, 'post-edit', 'project', true);
    expect(pinToUserHelpers(project, true)).toBe(helperHookCommand(SCRIPT, 'post-edit', 'user', true));
    const old = 'cmd /c "IF EXIST "%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs" (node "%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs" post-edit) ELSE (node "%USERPROFILE%\\.claude\\helpers\\hook-handler.cjs" post-edit)"';
    expect(pinToUserHelpers(old, true)).toBe(helperHookCommand(SCRIPT, 'post-edit', 'user', true));
  });

  it('does not re-pin a user-authored node -e command', () => {
    expect(pinToUserHelpers('node -e "console.log(1)"', true)).toBeNull();
  });
});
