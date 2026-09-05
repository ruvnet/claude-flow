import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// Windows npm exposes npx through a .cmd shim, which cannot be spawned
// directly by Node without a shell. Invoking npm's JS entry point preserves
// argv exactly (especially JSON values) and avoids shell injection/quoting.
export function spawnNpxSync(args, options = {}) {
  const npxArgs = args[0] === '-y' ? args : ['-y', ...args];
  const { shell: _ignoredShell, ...safeOptions } = options;
  if (process.platform === 'win32') {
    const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    return spawnSync(process.execPath, [npxCli, ...npxArgs], { ...safeOptions, shell: false });
  }
  return spawnSync('npx', npxArgs, { ...safeOptions, shell: false });
}
