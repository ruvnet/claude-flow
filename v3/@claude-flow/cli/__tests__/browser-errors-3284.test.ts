/** Regression for #3284: non-zero agent-browser exits carry JSON errors on stdout. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync }));
vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
  validateText: () => ({ valid: true }),
}));

import { execBrowserCommand } from '../src/mcp-tools/browser-tools.js';

function failure(options: { stdout?: string | Buffer; code?: string; status?: number; stderr?: string }) {
  return Object.assign(new Error('Command failed: agent-browser fill secret-value'), options);
}

async function errorText() {
  const result = await execBrowserCommand(['click', 'mat-option'], 'test-session');
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text as string) as { success: boolean; error: string };
}

describe('#3284 browser CLI error propagation', () => {
  beforeEach(() => execFileSync.mockReset());

  it('surfaces the precise CLI JSON error on a direct non-zero exit', async () => {
    execFileSync.mockImplementationOnce(() => {
      throw failure({ status: 1, stdout: JSON.stringify({ success: false, data: 'private trace', error: 'Element not found: mat-option' }) });
    });
    expect(await errorText()).toEqual({ success: false, error: 'Element not found: mat-option' });
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('surfaces the JSON error from the npx fallback after global ENOENT', async () => {
    execFileSync
      .mockImplementationOnce(() => { throw failure({ code: 'ENOENT' }); })
      .mockImplementationOnce(() => {
        throw failure({ status: 1, stdout: Buffer.from(JSON.stringify({ success: false, error: 'Wait timed out after 25000ms' })) });
      });
    expect(await errorText()).toEqual({ success: false, error: 'Wait timed out after 25000ms' });
    expect(execFileSync.mock.calls[1][0]).toBe('npx');
  });

  it('does not leak unrelated stdout, stderr, or command arguments when JSON is malformed', async () => {
    execFileSync.mockImplementationOnce(() => {
      throw failure({ status: 1, stdout: 'sensitive browser output', stderr: 'private stderr' });
    });
    const result = await errorText();
    expect(result.error).toBe('agent-browser exited with status 1 without a JSON error');
    expect(JSON.stringify(result)).not.toMatch(/sensitive|private|secret-value/);
  });

  it('does not turn an unsuccessful process into a success based on stdout', async () => {
    execFileSync.mockImplementationOnce(() => {
      throw failure({ status: 1, stdout: JSON.stringify({ success: true, data: 'unrelated' }) });
    });
    expect((await errorText()).error).toMatch(/exited with status 1/);
  });

  it('keeps the actionable install error when both executables are missing', async () => {
    execFileSync.mockImplementationOnce(() => { throw failure({ code: 'ENOENT' }); })
      .mockImplementationOnce(() => { throw failure({ code: 'ENOENT' }); });
    expect((await errorText()).error).toMatch(/Neither agent-browser nor npx found/);
  });

  it('preserves the successful JSON result', async () => {
    execFileSync.mockReturnValue(JSON.stringify({ success: true, data: { clicked: true } }));
    const result = await execBrowserCommand(['click', 'mat-option'], 'test-session');
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text as string)).toEqual({ success: true, data: { clicked: true } });
  });
});
