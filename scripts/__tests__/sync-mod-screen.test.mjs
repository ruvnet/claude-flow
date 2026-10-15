import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(__dirname, '..', 'sync-mod-screen.mjs');
const repo = join(__dirname, '..', '..');

let root;
const run = (...args) => spawnSync('node', [script, '--root', root, ...args], { encoding: 'utf8' });
const copy = name => join(root, 'plugins', name, 'hooks', 'screen.ts');
const opts = name => join(root, 'plugins', name, 'hooks', 'options.ts');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sync-screen-'));
  for (const name of ['ruflo-agentdb', 'ruflo-daa', 'ruflo-music']) {
    mkdirSync(join(root, 'plugins', name, 'hooks'), { recursive: true });
    cpSync(join(repo, 'plugins', name, 'hooks', 'screen.ts'), copy(name));
    cpSync(join(repo, 'plugins', name, 'hooks', 'options.ts'), opts(name));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('sync-mod-screen', () => {
  it('fails --check when the flag helper of a copy drifted, and write mode repairs it', () => {
    writeFileSync(opts('ruflo-daa'), readFileSync(opts('ruflo-daa'), 'utf8').replace("=== 'on'", "=== 'yes'"));
    const bad = run('--check');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('options.ts');
    expect(bad.stderr).toContain('ruflo-daa');
    expect(run().status).toBe(0);
    expect(readFileSync(opts('ruflo-daa'), 'utf8')).toContain("=== 'on'");
    expect(run('--check').status).toBe(0);
  });

  it('fails a copy whose options.ts lost the flag markers', () => {
    writeFileSync(opts('ruflo-music'), 'export {}\n');
    const r = run('--check');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('BEGIN SHARED FLAG');
  });

  it('passes on a tree whose copies match the origin', () => {
    const r = run('--check');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('screen.ts: 2 copies match');
    expect(r.stdout).toContain('options.ts: 2 copies match');
  });

  it('fails --check when the shared region of a copy drifted, and write mode repairs it', () => {
    writeFileSync(copy('ruflo-daa'), readFileSync(copy('ruflo-daa'), 'utf8').replace("['jwt',", "['jwt2',"));
    const bad = run('--check');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('ruflo-daa');
    expect(run().status).toBe(0);
    expect(run('--check').status).toBe(0);
  });

  it('keeps per-plugin additions outside the markers when it rewrites', () => {
    const src = readFileSync(copy('ruflo-music'), 'utf8');
    writeFileSync(copy('ruflo-music'), src.replace("['jwt',", "['jwt2',"));
    run();
    const after = readFileSync(copy('ruflo-music'), 'utf8');
    expect(after).toContain("['key assignment', /\\b[A-Za-z0-9_-]*(?:api");
    expect(after).toBe(src);
  });

  it('fails a copy that lost its markers', () => {
    writeFileSync(copy('ruflo-daa'), '// no markers here\n');
    const r = run('--check');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no single');
  });

  it('is loud when it finds no copies', () => {
    rmSync(join(root, 'plugins', 'ruflo-daa'), { recursive: true });
    rmSync(join(root, 'plugins', 'ruflo-music'), { recursive: true });
    const r = run('--check');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('found 0 copies');
  });

  it('passes on the real repo', () => {
    const r = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
