/**
 * session.cjs keeps its state in <project>/.claude-flow/sessions/current.json,
 * which the opened project controls. Its contents must never steer a write
 * outside that session directory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateCrossPlatformSessionManager, generateSessionManager } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sources: ReadonlyArray<readonly [string, () => string | null, string | null]> = [
  ['package', () => null, resolve(here, '../.claude/helpers/session.cjs')],
  ['repository', () => null, resolve(here, '../../../../.claude/helpers/session.cjs')],
  ['@claude-flow/mcp repository', () => null, resolve(here, '../../mcp/.claude/helpers/session.js')],
  ['generated', generateSessionManager, null],
  ['generated cross-platform', generateCrossPlatformSessionManager, null],
];

function fixture(generate: () => string | null, source: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-session-trust-'));
  tempRoots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  const outside = join(root, 'outside');
  const helper = join(root, 'helpers', 'session.cjs');
  const sessions = join(project, '.claude-flow', 'sessions');
  for (const dir of [project, home, outside, dirname(helper)]) mkdirSync(dir, { recursive: true });
  if (source) copyFileSync(source, helper);
  else writeFileSync(helper, generate() as string);
  return { root, project, home, outside, helper, sessions };
}

function run(f: ReturnType<typeof fixture>, ...args: string[]) {
  const result = spawnSync(process.execPath, [f.helper, ...args], {
    cwd: f.project,
    env: { ...process.env, HOME: f.home, USERPROFILE: f.home, APPDATA: f.home },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

function writeCurrent(sessions: string, session: Record<string, unknown>) {
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'current.json'), JSON.stringify(session));
}

describe('session helper keeps writes inside the project session dir', () => {
  for (const [name, generate, source] of sources) {
    describe(name, () => {
      it('a crafted session id cannot choose the archive path', () => {
        const f = fixture(generate, source);
        const escape = join(f.outside, 'escaped');
        writeCurrent(f.sessions, {
          id: `../../../outside/escaped`,
          startedAt: new Date().toISOString(),
          metrics: { edits: 0 },
        });

        run(f, 'end');

        expect(existsSync(`${escape}.json`)).toBe(false);
        expect(readdirSync(f.outside)).toEqual([]);
        const archived = readdirSync(f.sessions);
        expect(archived).toHaveLength(1);
        expect(archived[0]).toMatch(/^session-\d+\.json$/);
      });

      it('never writes through a symlinked current.json', () => {
        const f = fixture(generate, source);
        const target = join(f.outside, 'target.json');
        const original = JSON.stringify({ id: 'session-1', startedAt: new Date().toISOString(), metrics: { edits: 0 } });
        writeFileSync(target, original);
        mkdirSync(f.sessions, { recursive: true });
        symlinkSync(target, join(f.sessions, 'current.json'));

        run(f, 'restore');
        run(f, 'end');

        expect(readFileSync(target, 'utf8')).toBe(original);
        expect(readdirSync(f.outside)).toEqual(['target.json']);
      });

      it('refuses a session directory that resolves outside the project', () => {
        const f = fixture(generate, source);
        mkdirSync(join(f.project, '.claude-flow'), { recursive: true });
        symlinkSync(f.outside, f.sessions, 'dir');

        run(f, 'start');

        expect(readdirSync(f.outside)).toEqual([]);
      });

      it('creates nothing outside the project when .claude-flow is a symlink', () => {
        const f = fixture(generate, source);
        symlinkSync(f.outside, join(f.project, '.claude-flow'), 'dir');

        run(f, 'start');

        expect(readdirSync(f.outside)).toEqual([]);
      });

      it('keeps the normal start / restore / end lifecycle working', () => {
        const f = fixture(generate, source);
        mkdirSync(join(f.project, '.claude-flow'), { recursive: true });

        expect(run(f, 'start').stdout).toMatch(/Session started: session-\d+/);
        expect(run(f, 'restore').stdout).toMatch(/Session restored: session-\d+/);
        const ended = run(f, 'end').stdout;
        const id = /Session ended: (session-\d+)/.exec(ended)?.[1];

        expect(id).toBeDefined();
        expect(existsSync(join(f.sessions, `${id}.json`))).toBe(true);
        expect(existsSync(join(f.sessions, 'current.json'))).toBe(false);
        expect(readdirSync(f.sessions).filter((n) => n.includes('.tmp'))).toEqual([]);
      });
    });
  }
});
