import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../src/commands/doctor.js';
import { CommandParser } from '../src/parser.js';
import { output } from '../src/output.js';
import * as nativeAddon from '../src/commands/doctor-native-addon.js';

describe('doctor --json (#3416)', () => {
  let stdout: string;

  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(output, 'createSpinner');
    vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
    vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function run(args: string[]) {
    const parser = new CommandParser();
    parser.registerCommand(doctorCommand);
    const parsed = parser.parse(['doctor', ...args]);
    expect(parser.validateFlags(parsed.flags, doctorCommand)).toEqual([]);
    const result = await doctorCommand.action!({
      flags: parsed.flags, args: parsed.positional, cwd: process.cwd(), interactive: false,
    });
    return { result, document: JSON.parse(stdout) };
  }

  it('prints exactly one JSON document with the real Node check and a stable ID', async () => {
    const { result, document } = await run(['--json', '-c', 'node', '--verbose']);
    expect(result).toMatchObject({ success: true, exitCode: 0 });
    expect(document).toEqual({ schemaVersion: 1, checks: [{
      id: 'node', name: 'Node.js Version', status: 'pass',
      detail: `${process.version} (>= 20 required)`,
    }] });
    expect(stdout).not.toContain('\x1b');
    expect(output.createSpinner).not.toHaveBeenCalled();
  });

  it('keeps warning-only checks successful and includes suggested fixes', async () => {
    const { result, document } = await run(['--json', '-c', 'encryption']);
    expect(result).toMatchObject({ success: true, exitCode: 0 });
    expect(document.checks[0]).toMatchObject({ id: 'encryption', status: 'warn' });
    expect(document.checks[0].fix).toContain('CLAUDE_FLOW_ENCRYPT_AT_REST=1');
  });

  it('preserves failed health-check exit status with valid JSON', async () => {
    vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '1');
    const { result, document } = await run(['--json', '-c', 'encryption']);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(document.checks[0]).toMatchObject({ id: 'encryption', status: 'fail' });
    expect(document.checks[0].detail).toContain('unset');
  });

  it('retains the check ID when a health check rejects', async () => {
    vi.spyOn(nativeAddon, 'checkNativeAddonHeaders').mockRejectedValue(new Error('probe failed'));
    const { result, document } = await run(['--json', '-c', 'native-addon']);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(document.checks).toEqual([{
      id: 'native-addon', name: 'Check', status: 'fail', detail: 'probe failed',
    }]);
  });

  it.each(['missing', 'toString', '__proto__', ''])('reports invalid component %j as JSON', async component => {
    const { result, document } = await run(['--json', '-c', component]);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(document).toMatchObject({ schemaVersion: 1, checks: [], error: expect.stringContaining('Unknown doctor component') });
  });

  it.each(['--fix', '--install', '--fix-handles'])('rejects %s before taking repair actions', async flag => {
    const { result, document } = await run(['--json', flag]);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(document).toMatchObject({ schemaVersion: 1, checks: [], error: expect.stringContaining('cannot be combined') });
    expect(output.createSpinner).not.toHaveBeenCalled();
  });

  it('expands grouped checks with distinct stable IDs', async () => {
    const { document } = await run(['--json', '-c', 'proxy']);
    expect(document.checks.map((check: { id: string }) => check.id)).toEqual([
      'proxy-consent', 'proxy-binary', 'proxy-process', 'proxy-bind',
    ]);
    expect(document.checks.every((check: { detail: unknown }) => typeof check.detail === 'string')).toBe(true);
  });

  it('uses the same canonical ID for component aliases', async () => {
    const first = await run(['--json', '-c', 'learning']);
    stdout = '';
    const second = await run(['--json', '-c', 'learning-bridge']);
    expect(first.document.checks[0].id).toBe('learning');
    expect(second.document.checks[0].id).toBe('learning');
  });

  it('keeps the default human-readable renderer', async () => {
    const result = await doctorCommand.action!({
      flags: { _: [], component: 'node' }, args: [], cwd: process.cwd(), interactive: false,
    });
    expect(result.success).toBe(true);
    expect(stdout).toContain('RuFlo Doctor');
    expect(stdout).toContain('Node.js Version');
    expect(stdout).toContain('Summary:');
    expect(stdout).not.toContain('schemaVersion');
  });
});
