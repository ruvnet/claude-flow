import { describe, expect, it, vi } from 'vitest';
import { win32 } from 'node:path';
import { resolveClaudeLaunchCommand } from '../src/runtime/claude-command.js';

describe('#3071 Claude Code command resolution', () => {
  it('uses which and the resolved executable on POSIX', () => {
    const lookup = vi.fn(() => '/usr/local/bin/claude\n');

    expect(resolveClaudeLaunchCommand({
      platform: 'linux',
      lookup,
      fileExists: (path) => path === '/usr/local/bin/claude',
    })).toEqual({ command: '/usr/local/bin/claude', argsPrefix: [] });
    expect(lookup).toHaveBeenCalledWith('which', ['claude']);
  });

  it('resolves the native Claude executable behind a Windows npm shim', () => {
    const npmBin = 'C:\\Users\\tester\\AppData\\Roaming\\npm';
    const nativeExecutable = win32.join(
      npmBin,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    );
    const lookup = vi.fn(() => [
      win32.join(npmBin, 'claude'),
      win32.join(npmBin, 'claude.cmd'),
    ].join('\r\n'));

    expect(resolveClaudeLaunchCommand({
      platform: 'win32',
      lookup,
      fileExists: (path) => path === nativeExecutable,
    })).toEqual({ command: nativeExecutable, argsPrefix: [] });
    expect(lookup).toHaveBeenCalledWith('where.exe', ['claude']);
  });

  it('runs older JavaScript installs through Node without a shell', () => {
    const npmBin = 'C:\\Users\\tester\\AppData\\Roaming\\npm';
    const javascriptEntry = win32.join(
      npmBin,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );

    expect(resolveClaudeLaunchCommand({
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      lookup: () => win32.join(npmBin, 'claude.cmd'),
      fileExists: (path) => path === javascriptEntry,
    })).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: [javascriptEntry],
    });
  });

  it('returns null when lookup fails or no safe direct target exists', () => {
    expect(resolveClaudeLaunchCommand({
      platform: 'win32',
      lookup: () => { throw new Error('not found'); },
    })).toBeNull();

    expect(resolveClaudeLaunchCommand({
      platform: 'win32',
      lookup: () => 'C:\\npm\\claude.cmd',
      fileExists: () => false,
    })).toBeNull();
  });
});
