/**
 * #3851: `ruflo <cmd> | consumer` lost everything after the first pipe buffer
 * (64 KiB) because the bin wrappers call process.exit(0) right after
 * cli.run(), and stdout writes to a pipe are asynchronous on POSIX.
 *
 * Runs the real CLI class and the same `run().then(process.exit(0))` tail the
 * bin wrappers use, with stdout a pipe and a deliberately slow reader.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const cliDir = resolve(__dirname, '..');
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const BYTES = 2 * 1024 * 1024;

function runPiped(exitStyle: 'zero' | 'fail'): Promise<{ out: Buffer; code: number | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'cli-3851-'));
  const script = join(dir, 'run.ts');
  writeFileSync(script, `
import { CLI } from ${JSON.stringify(join(cliDir, 'src', 'index.ts'))};
import { commandParser } from ${JSON.stringify(join(cliDir, 'src', 'parser.ts'))};
commandParser.registerCommand({
  name: 'bigout-3851', description: 'test',
  action: async () => {
    const line = JSON.stringify({ k: 'x'.repeat(1000) }) + '\\n';
    let n = 0;
    while (n < ${BYTES}) { process.stdout.write(line); n += line.length; }
    return ${exitStyle === 'fail' ? '{ success: false, exitCode: 3 }' : '{ success: true }'};
  },
});
new CLI().run(['bigout-3851'])
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
`);
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, script], { cwd: cliDir, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    // slow reader: pause so the pipe buffer fills while the child is exiting
    child.stdout!.pause();
    setTimeout(() => {
      child.stdout!.on('data', (c: Buffer) => chunks.push(c));
      child.stdout!.resume();
    }, 1500);
    child.on('error', rej);
    child.on('close', (code) => {
      rmSync(dir, { recursive: true, force: true });
      res({ out: Buffer.concat(chunks), code });
    });
  });
}

describe('#3851 piped stdout is not truncated by process.exit', () => {
  it('delivers all output on a clean exit', async () => {
    const { out, code } = await runPiped('zero');
    expect(code).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(BYTES);
    for (const l of out.toString().trim().split('\n').slice(0, 3)) JSON.parse(l);
    // last line must be a complete JSON document, i.e. nothing was cut off
    const lines = out.toString().trimEnd().split('\n');
    expect(() => JSON.parse(lines[lines.length - 1])).not.toThrow();
  }, 60_000);

  it('delivers all output when the command fails (process.exit(exitCode) in CLI.run)', async () => {
    const { out, code } = await runPiped('fail');
    expect(code).toBe(3);
    const lines = out.toString().trimEnd().split('\n');
    expect(out.length).toBeGreaterThanOrEqual(BYTES);
    expect(() => JSON.parse(lines[lines.length - 1])).not.toThrow();
  }, 60_000);
});
