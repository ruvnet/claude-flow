import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandContext } from '../src/types.js';

const captured = vi.hoisted(() => ({ stdout: [] as string[], stderr: [] as string[] }));
vi.mock('../src/output.js', () => ({
  output: {
    writeln: (value = '') => { captured.stdout.push(value); },
    printJson: (value: unknown) => { captured.stdout.push(JSON.stringify(value)); },
    printTable: () => { captured.stdout.push('<table>'); },
    printBox: () => { captured.stdout.push('<box>'); },
    printError: (value: string) => { captured.stderr.push(value); },
    printWarning: (value: string) => { captured.stderr.push(value); },
    bold: (value: string) => value,
    dim: (value: string) => value,
    success: (value: string) => value,
    error: (value: string) => value,
    warning: (value: string) => value,
    info: (value: string) => value,
    createSpinner: () => ({
      start: () => { captured.stdout.push('<spinner-start>'); },
      setText: () => {},
      succeed: () => { captured.stdout.push('<spinner-success>'); },
      fail: () => { captured.stdout.push('<spinner-fail>'); },
    }),
  },
}));

import { securityCommand } from '../src/commands/security.js';

const scan = securityCommand.subcommands!.find(command => command.name === 'scan')!;
let target: string;

async function run(outputFormat: string) {
  const ctx: CommandContext = {
    args: [],
    flags: { _: [], target, depth: 'quick', type: 'code', output: outputFormat },
    cwd: target,
    interactive: false,
  };
  return scan.action!(ctx);
}

beforeEach(() => {
  captured.stdout.length = 0;
  captured.stderr.length = 0;
  target = mkdtempSync(join(tmpdir(), 'ruflo-scan-output-'));
  writeFileSync(join(target, 'secret.ts'), 'export const key = "AKIAIOSFODNN7EXAMPLE";\n');
});

afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

describe('security scan machine-readable output', () => {
  it('retains the human-readable scan summary for text output', async () => {
    const result = await run('text');
    expect(result.success).toBe(false);
    expect(captured.stdout).toContain('Security Scan');
    expect(captured.stdout).toContain('<table>');
    expect(captured.stdout).toContain('<box>');
  });

  it('prints one valid JSON document with raw severity and no text progress', async () => {
    const result = await run('json');
    expect(result.success).toBe(false); // A high-severity finding keeps the scan gate.
    expect(captured.stdout).toHaveLength(1);
    const record = JSON.parse(captured.stdout[0]);
    expect(record.summary).toMatchObject({ high: 1, total: 1 });
    expect(record.findings[0]).toMatchObject({ severity: 'high', type: 'Hardcoded Secret', location: 'secret.ts:1' });
    const persisted = JSON.parse(readFileSync(join(target, '.claude/security-scans/scan-code-quick.json'), 'utf8'));
    expect(persisted.findings).toEqual(record.findings);
  });

  it('prints a SARIF 2.1.0 document with a rule, result, and source location', async () => {
    const result = await run('sarif');
    expect(result.success).toBe(false);
    expect(captured.stdout).toHaveLength(1);
    const sarif = JSON.parse(captured.stdout[0]);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].results[0]).toMatchObject({
      level: 'error',
      locations: [{ physicalLocation: { artifactLocation: { uri: 'secret.ts' }, region: { startLine: 1 } } }],
    });
  });

  it('rejects an unknown format before scanning or reporting clean', async () => {
    const result = await run('xml');
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr.join('\n')).toContain('Invalid --output');
  });
});
