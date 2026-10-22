/** ADR-401: Windows browser launch targets resolve without cmd.exe. */
import { describe, expect, it } from 'vitest';
import { resolveAgentBrowserLaunch, resolveNpxLaunch } from '../src/runtime/browser-command.js';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const NPM_BIN = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
const AB_ROOT = `${NPM_BIN}\\node_modules\\agent-browser`;

/** Fake filesystem + where.exe for a Windows host. */
function windows(files: Record<string, string | true>, where: Record<string, string[]> = {}) {
  return {
    platform: 'win32' as const,
    nodeExecutable: NODE,
    fileExists: (p: string) => p in files,
    readFile: (p: string) => {
      const v = files[p];
      if (typeof v !== 'string') throw new Error(`ENOENT ${p}`);
      return v;
    },
    lookup: (_command: string, args: string[]) => {
      const found = where[args[0]];
      if (!found) throw new Error('INFO: Could not find files');
      return found.join('\r\n') + '\r\n';
    },
  };
}

describe('resolveAgentBrowserLaunch', () => {
  it('spawns the command name directly on POSIX, without a shell', () => {
    expect(resolveAgentBrowserLaunch({ platform: 'linux' })).toEqual({ command: 'agent-browser', argsPrefix: [] });
    expect(resolveAgentBrowserLaunch({ platform: 'darwin' })).toEqual({ command: 'agent-browser', argsPrefix: [] });
  });

  it('prefers a native .exe found on PATH', () => {
    const exe = 'C:\\tools\\agent-browser.exe';
    const opts = windows({ [exe]: true }, { 'agent-browser': [`${NPM_BIN}\\agent-browser.cmd`, exe] });
    expect(resolveAgentBrowserLaunch(opts)).toEqual({ command: exe, argsPrefix: [] });
  });

  it('maps the npm .cmd shim to node plus the package bin entry', () => {
    const entry = `${AB_ROOT}\\bin\\agent-browser.js`;
    const opts = windows(
      { [`${AB_ROOT}\\package.json`]: JSON.stringify({ bin: { 'agent-browser': 'bin/agent-browser.js' } }), [entry]: true },
      { 'agent-browser': [`${NPM_BIN}\\agent-browser`, `${NPM_BIN}\\agent-browser.cmd`] },
    );
    expect(resolveAgentBrowserLaunch(opts)).toEqual({ command: NODE, argsPrefix: [entry] });
  });

  it('accepts a string-valued bin field', () => {
    const entry = `${AB_ROOT}\\cli.js`;
    const opts = windows(
      { [`${AB_ROOT}\\package.json`]: JSON.stringify({ bin: 'cli.js' }), [entry]: true },
      { 'agent-browser': [`${NPM_BIN}\\agent-browser.cmd`] },
    );
    expect(resolveAgentBrowserLaunch(opts)?.argsPrefix).toEqual([entry]);
  });

  it('rejects a bin entry that escapes the package directory', () => {
    const outside = `${NPM_BIN}\\node_modules\\evil.js`;
    const opts = windows(
      { [`${AB_ROOT}\\package.json`]: JSON.stringify({ bin: { 'agent-browser': '..\\evil.js' } }), [outside]: true },
      { 'agent-browser': [`${NPM_BIN}\\agent-browser.cmd`] },
    );
    expect(resolveAgentBrowserLaunch(opts)).toBeNull();
  });

  it('never returns a batch file, which would imply cmd.exe even with shell:false', () => {
    const batch = `${AB_ROOT}\\run.cmd`;
    const opts = windows(
      { [`${AB_ROOT}\\package.json`]: JSON.stringify({ bin: { 'agent-browser': 'run.cmd' } }), [batch]: true },
      { 'agent-browser': [`${NPM_BIN}\\agent-browser.cmd`] },
    );
    expect(resolveAgentBrowserLaunch(opts)).toBeNull();
    expect(resolveAgentBrowserLaunch(windows({}, { 'agent-browser': [`${NPM_BIN}\\agent-browser.bat`] }))).toBeNull();
  });

  it('returns null when nothing resolves', () => {
    expect(resolveAgentBrowserLaunch(windows({}))).toBeNull();
  });
});

describe('resolveNpxLaunch', () => {
  it('spawns npx directly on POSIX', () => {
    expect(resolveNpxLaunch({ platform: 'linux' })).toEqual({ command: 'npx', argsPrefix: [] });
  });

  it("uses node plus the running Node's own npx-cli.js on Windows", () => {
    const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
    expect(resolveNpxLaunch(windows({ [cli]: true }))).toEqual({ command: NODE, argsPrefix: [cli] });
  });

  it('falls back to the npm that where.exe npx points at', () => {
    const cli = 'D:\\nvm\\v22\\node_modules\\npm\\bin\\npx-cli.js';
    const opts = windows({ [cli]: true }, { npx: ['D:\\nvm\\v22\\npx.cmd'] });
    expect(resolveNpxLaunch(opts)).toEqual({ command: NODE, argsPrefix: [cli] });
  });

  it('returns null rather than reaching for a shell when npx-cli.js is absent', () => {
    expect(resolveNpxLaunch(windows({}, { npx: ['D:\\nvm\\v22\\npx.cmd'] }))).toBeNull();
  });
});
