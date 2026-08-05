/**
 * `extractArchive` (proxy/install.ts) — the only platform-divergent step in
 * the install pipeline, and previously the only one with no direct coverage.
 *
 * Motivating failure, observed on a healthy Windows 11 machine running
 * `ruflo proxy install --yes`, after the release had already been downloaded
 * and its Ed25519 signature + sha256 verified:
 *
 *   [ERROR] Install failed
 *     Expand-Archive failed (exit 1): Expand-Archive : The 'Expand-Archive'
 *     command was found in the module 'Microsoft.PowerShell.Archive', but the
 *     module could not be loaded.
 *
 * `Microsoft.PowerShell.Archive` is a *script* module reached through
 * PowerShell's autoloading, so it can fail for environment reasons unrelated
 * to the archive. The same command succeeded on the same machine minutes
 * later — intermittent, not a hard platform break. With no fallback, a
 * verified archive was discarded and the install aborted.
 *
 * These tests pin the contract rather than the mechanism: Expand-Archive stays
 * the primary zip path, tar backs it up, and only a failure of BOTH is fatal.
 * The executor is mocked, so they assert routing on every platform without
 * depending on a real powershell.exe or bsdtar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ExecCall {
  allowedCommands: string[];
  command: string;
  args: string[];
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const OK: ExecResult = { exitCode: 0, stdout: '', stderr: '' };

/** The real-world PowerShell failure this fallback exists for. */
const AUTOLOAD_FAILURE: ExecResult = {
  exitCode: 1,
  stdout: '',
  stderr:
    "Expand-Archive : The 'Expand-Archive' command was found in the module " +
    "'Microsoft.PowerShell.Archive', but the module could not be loaded.",
};

let workDir: string;
let calls: ExecCall[];

/**
 * Installs a fake `@claude-flow/security` whose SafeExecutor records every
 * invocation and defers the result to `handler`, keyed by the command name.
 */
function mockExecutor(handler: (call: ExecCall) => ExecResult | Promise<ExecResult>): void {
  calls = [];
  class FakeSafeExecutor {
    private allowedCommands: string[];
    constructor(config: { allowedCommands: string[]; timeout?: number }) {
      this.allowedCommands = config.allowedCommands;
    }
    async execute(command: string, args: string[]): Promise<ExecResult> {
      const call: ExecCall = { allowedCommands: this.allowedCommands, command, args };
      calls.push(call);
      return handler(call);
    }
  }
  vi.doMock('@claude-flow/security', () => ({ SafeExecutor: FakeSafeExecutor }));
}

async function loadExtractArchive() {
  const mod = await import('../src/proxy/install.js');
  return mod.extractArchive;
}

const commandsUsed = () => calls.map((c) => c.command);

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-extract-test-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.doUnmock('@claude-flow/security');
});

describe('extractArchive — tar.gz', () => {
  it('extracts with tar and never invokes powershell', async () => {
    mockExecutor(() => OK);
    const extractArchive = await loadExtractArchive();
    const dest = path.join(workDir, 'out');

    await extractArchive(path.join(workDir, 'meta-proxy.tar.gz'), dest, 'tar.gz');

    expect(commandsUsed()).toEqual(['tar']);
    expect(calls[0].args[0]).toBe('xzf');
    expect(calls[0].args).toContain('-C');
  });

  it('creates the destination directory', async () => {
    mockExecutor(() => OK);
    const extractArchive = await loadExtractArchive();
    const dest = path.join(workDir, 'nested', 'out');

    await extractArchive(path.join(workDir, 'a.tar.gz'), dest, 'tar.gz');

    expect(fs.existsSync(dest)).toBe(true);
  });

  it('throws when tar fails — there is no second path for tar.gz', async () => {
    mockExecutor(() => ({ exitCode: 2, stdout: '', stderr: 'not in gzip format' }));
    const extractArchive = await loadExtractArchive();

    await expect(extractArchive(path.join(workDir, 'a.tar.gz'), path.join(workDir, 'out'), 'tar.gz')).rejects.toThrow(
      /tar extraction failed \(exit 2\).*not in gzip format/s,
    );
    expect(commandsUsed()).toEqual(['tar']);
  });
});

describe('extractArchive — zip', () => {
  it('uses Expand-Archive as the primary path and does not fall back when it succeeds', async () => {
    mockExecutor(() => OK);
    const extractArchive = await loadExtractArchive();

    await extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip');

    expect(commandsUsed()).toEqual(['powershell']);
    expect(calls[0].args).toContain('-NonInteractive');
    expect(calls[0].args.join(' ')).toContain('Expand-Archive');
  });

  it('falls back to tar when Expand-Archive cannot autoload its module', async () => {
    mockExecutor((call) => (call.command === 'powershell' ? AUTOLOAD_FAILURE : OK));
    const extractArchive = await loadExtractArchive();

    await expect(
      extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip'),
    ).resolves.toBeUndefined();

    expect(commandsUsed()).toEqual(['powershell', 'tar']);
  });

  it('passes "xf" to the tar fallback — a zip is not gzip-compressed', async () => {
    mockExecutor((call) => (call.command === 'powershell' ? AUTOLOAD_FAILURE : OK));
    const extractArchive = await loadExtractArchive();

    await extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip');

    const tarCall = calls.find((c) => c.command === 'tar');
    expect(tarCall?.args[0]).toBe('xf');
  });

  it('falls back when the powershell process throws rather than exiting non-zero', async () => {
    mockExecutor((call) => {
      if (call.command === 'powershell') throw new Error('spawn powershell ENOENT');
      return OK;
    });
    const extractArchive = await loadExtractArchive();

    await expect(
      extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip'),
    ).resolves.toBeUndefined();

    expect(commandsUsed()).toEqual(['powershell', 'tar']);
  });

  it('only fails when BOTH extractors fail, and reports both causes', async () => {
    mockExecutor((call) =>
      call.command === 'powershell' ? AUTOLOAD_FAILURE : { exitCode: 1, stdout: '', stderr: 'tar: unrecognized format' },
    );
    const extractArchive = await loadExtractArchive();

    const attempt = extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip');

    await expect(attempt).rejects.toThrow(/Expand-Archive:.*module could not be loaded/s);
    await expect(attempt).rejects.toThrow(/tar fallback:.*unrecognized format/s);
    expect(commandsUsed()).toEqual(['powershell', 'tar']);
  });

  it('keeps each extractor on its own command allowlist', async () => {
    mockExecutor((call) => (call.command === 'powershell' ? AUTOLOAD_FAILURE : OK));
    const extractArchive = await loadExtractArchive();

    await extractArchive(path.join(workDir, 'meta-proxy.zip'), path.join(workDir, 'out'), 'zip');

    expect(calls.find((c) => c.command === 'powershell')?.allowedCommands).not.toContain('tar');
    expect(calls.find((c) => c.command === 'tar')?.allowedCommands).toEqual(['tar']);
  });

  it('quotes literal paths so a single quote cannot break out of the command string', async () => {
    mockExecutor(() => OK);
    const extractArchive = await loadExtractArchive();
    const awkward = path.join(workDir, "it's here.zip");

    await extractArchive(awkward, path.join(workDir, 'out'), 'zip');

    const command = calls[0].args[calls[0].args.length - 1];
    expect(command).toContain("it''s here.zip");
  });
});
