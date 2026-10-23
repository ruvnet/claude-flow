// #4397 part 3: an npm-global claude.cmd shim must be probed through cmd.exe,
// not execFile'd directly (Node rejects that with EINVAL on Windows).
import { describe, it, expect } from 'vitest';
import { versionProbe } from '../src/mods/claude-installs.js';

describe('versionProbe (#4397)', () => {
  const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd';
  it('routes a .cmd shim on win32 through cmd.exe with a quoted path', () => {
    const p = versionProbe(shim, 'win32', 'cmd.exe');
    expect(p).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${shim}" --version"`],
      windowsVerbatimArguments: true,
    });
  });
  it('matches .bat and is case-insensitive', () => {
    expect(versionProbe('C:\\x\\CLAUDE.CMD', 'win32', 'cmd.exe')?.command).toBe('cmd.exe');
    expect(versionProbe('C:\\x\\c.bat', 'win32', 'cmd.exe')?.command).toBe('cmd.exe');
  });
  it('does not probe a shim path containing cmd metacharacters', () => {
    for (const bad of ['C:\\a&calc\\claude.cmd', 'C:\\a%PATH%\\claude.cmd', 'C:\\a^b\\claude.cmd', 'C:\\a|b\\claude.cmd']) {
      expect(versionProbe(bad, 'win32', 'cmd.exe')).toBeNull();
    }
  });
  it('execs .exe and non-Windows binaries directly', () => {
    expect(versionProbe('C:\\x\\claude.exe', 'win32')).toEqual({ command: 'C:\\x\\claude.exe', args: ['--version'] });
    expect(versionProbe('/usr/bin/claude', 'linux')).toEqual({ command: '/usr/bin/claude', args: ['--version'] });
    expect(versionProbe('/opt/claude.cmd', 'linux')?.command).toBe('/opt/claude.cmd');
  });
});
