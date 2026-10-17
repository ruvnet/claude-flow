import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const entry = new URL('../src/index.ts', import.meta.url).href;

describe('doctor JSON through CLI.run', () => {
  let project: string;
  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'doctor-json-cli-'));
    mkdirSync(join(project, 'home'));
    writeFileSync(join(project, 'broken.json'), '{ invalid json');
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  function run(component: string, extra: string[] = [], env: Record<string, string> = {}) {
    const args = ['doctor', '--json', '-c', component, '--verbose', ...extra];
    return spawnSync(process.execPath, [
      '--import', pathToFileURL(require.resolve('tsx')).href, '--input-type=module', '-e',
      `import { CLI } from ${JSON.stringify(entry)}; await new CLI({interactive:false}).run(${JSON.stringify(args)});`,
    ], {
      cwd: project, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, HOME: join(project, 'home'), USERPROFILE: join(project, 'home'),
        DEBUG: '1', RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_ENCRYPT_AT_REST: '0',
        CLAUDE_FLOW_ENCRYPTION_KEY: '', ...env },
    });
  }

  it('keeps verbose and config diagnostics off stdout', () => {
    const child = run('node', ['--config', join(project, 'broken.json')]);
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ schemaVersion: 1, checks: [{
      id: 'node', name: 'Node.js Version', status: 'pass', detail: `${process.version} (>= 20 required)`,
    }] });
    expect(child.stdout).not.toContain('\x1b');
    expect(child.stderr).toContain('Executing: doctor');
  });

  it('exits 1 with parseable JSON on a failed real check', () => {
    const child = run('encryption', [], { CLAUDE_FLOW_ENCRYPT_AT_REST: '1' });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(1);
    expect(JSON.parse(child.stdout).checks[0]).toMatchObject({ id: 'encryption', status: 'fail' });
  });
});
