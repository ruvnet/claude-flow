/** ADR-401: tool-supplied browser arguments never reach a shell, on any platform. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
const resolveAgentBrowserLaunch = vi.hoisted(() => vi.fn());
const resolveNpxLaunch = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync }));
vi.mock('../src/runtime/browser-command.js', () => ({ resolveAgentBrowserLaunch, resolveNpxLaunch }));
vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
  validateText: () => ({ valid: true }),
}));

import { execBrowserCommand } from '../src/mcp-tools/browser-tools.js';

// Shell metacharacters for cmd.exe and POSIX shells, plus a multi-line script.
const HOSTILE = [
  'x" & calc.exe & "',
  '%COMSPEC% /c whoami',
  'a ^| b && c',
  '$(id) `id` ; rm -rf /',
  'line1\r\nnet user pwn /add',
  "');require('child_process').execSync('calc');//",
];

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });

describe('execBrowserCommand never spawns through a shell', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    resolveAgentBrowserLaunch.mockReset();
    resolveNpxLaunch.mockReset();
  });
  afterEach(() => Object.defineProperty(process, 'platform', realPlatform));

  for (const platform of ['win32', 'linux']) {
    it(`passes hostile values as literal argv with no shell option (${platform}, global path)`, async () => {
      setPlatform(platform);
      resolveAgentBrowserLaunch.mockReturnValue({ command: 'node', argsPrefix: ['/pkg/bin/agent-browser.js'] });
      execFileSync.mockReturnValue('{"success":true}');

      for (const payload of HOSTILE) {
        await execBrowserCommand(['fill', '#field', payload], 'test-session');
        const [command, argv, options] = execFileSync.mock.calls.at(-1)!;
        expect(command).toBe('node');
        expect(argv).toEqual(['/pkg/bin/agent-browser.js', '--session', 'test-session', '--json', 'fill', '#field', payload]);
        expect(options.shell).toBeFalsy();
      }
    });

    it(`passes hostile values as literal argv with no shell option (${platform}, npx fallback)`, async () => {
      setPlatform(platform);
      resolveAgentBrowserLaunch.mockReturnValue(null);
      resolveNpxLaunch.mockReturnValue({ command: 'node', argsPrefix: ['/npm/bin/npx-cli.js'] });
      execFileSync.mockReturnValue('{"success":true}');

      for (const payload of HOSTILE) {
        await execBrowserCommand(['eval', payload], 'test-session');
        const [command, argv, options] = execFileSync.mock.calls.at(-1)!;
        expect(command).toBe('node');
        expect(argv).toEqual(['/npm/bin/npx-cli.js', '--yes', 'agent-browser', '--session', 'test-session', '--json', 'eval', payload]);
        expect(options.shell).toBeFalsy();
      }
    });
  }

  it('falls back to npx when the resolved global launch reports ENOENT', async () => {
    setPlatform('win32');
    resolveAgentBrowserLaunch.mockReturnValue({ command: 'C:\\gone\\agent-browser.exe', argsPrefix: [] });
    resolveNpxLaunch.mockReturnValue({ command: 'node', argsPrefix: ['/npm/bin/npx-cli.js'] });
    execFileSync
      .mockImplementationOnce(() => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); })
      .mockReturnValueOnce('{"success":true}');

    const result = await execBrowserCommand(['click', '#go']);
    expect(result.isError).toBeFalsy();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    for (const call of execFileSync.mock.calls) expect(call[2].shell).toBeFalsy();
  });

  it('fails with the install hint, and spawns nothing, when Windows cannot resolve either launcher', async () => {
    setPlatform('win32');
    resolveAgentBrowserLaunch.mockReturnValue(null);
    resolveNpxLaunch.mockReturnValue(null);

    const result = await execBrowserCommand(['fill', '#f', HOSTILE[0]]);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text as string).error).toMatch(/Neither agent-browser nor npx found/);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe('static guard', () => {
  it('browser-tools.ts sets no shell option on any spawn', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/mcp-tools/browser-tools.ts', import.meta.url), 'utf8');
    // Strip comments so the ADR-401 note can mention the word.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bshell\s*:/);
  });
});
