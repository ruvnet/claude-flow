import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export interface ClaudeLaunchCommand {
  command: string;
  argsPrefix: string[];
}

interface ClaudeCommandResolverOptions {
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  lookup?: (command: string, args: string[]) => string;
  fileExists?: (path: string) => boolean;
}

/**
 * Resolve Claude Code to a target that Node can spawn without a shell.
 *
 * Windows npm shims (`claude.cmd` and `claude.ps1`) are shell scripts and
 * cannot be passed directly to spawn with `shell: false`. Resolve the native
 * executable used by current Claude Code releases, or the JavaScript entry
 * used by older releases, while keeping user-provided prompts out of a shell.
 */
export function resolveClaudeLaunchCommand(
  options: ClaudeCommandResolverOptions = {},
): ClaudeLaunchCommand | null {
  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const lookup = options.lookup ?? ((command, args) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const fileExists = options.fileExists ?? existsSync;

  let matches: string[];
  try {
    const output = platform === 'win32'
      ? lookup('where.exe', ['claude'])
      : lookup('which', ['claude']);
    matches = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }

  if (platform !== 'win32') {
    const command = matches.find(fileExists);
    return command ? { command, argsPrefix: [] } : null;
  }

  const executable = matches.find((candidate) =>
    path.extname(candidate).toLowerCase() === '.exe' && fileExists(candidate));
  if (executable) return { command: executable, argsPrefix: [] };

  for (const shim of matches) {
    const npmBin = path.dirname(shim);
    const packageRoot = path.join(npmBin, 'node_modules', '@anthropic-ai', 'claude-code');
    const nativeExecutable = path.join(packageRoot, 'bin', 'claude.exe');
    if (fileExists(nativeExecutable)) {
      return { command: nativeExecutable, argsPrefix: [] };
    }

    const javascriptEntry = path.join(packageRoot, 'cli.js');
    if (fileExists(javascriptEntry)) {
      return { command: nodeExecutable, argsPrefix: [javascriptEntry] };
    }
  }

  return null;
}
