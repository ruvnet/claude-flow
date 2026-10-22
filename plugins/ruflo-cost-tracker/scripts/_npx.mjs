import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { RUFLO_CLI_PKG, resolveRufloCli } from './_ruflo-cli.mjs';

// Windows npm exposes npx through a .cmd shim, which cannot be spawned
// directly by Node without a shell. Invoking npm's JS entry point preserves
// argv exactly (especially JSON values) and avoids shell injection/quoting.
export function spawnNpxSync(args, options = {}) {
  const npxArgs = args[0] === '-y' ? args : ['-y', ...args];
  const { shell: _ignoredShell, ...safeOptions } = options;
  // #3558: `@claude-flow/cli@latest` runs the ruflo CLI already installed on
  // this machine when there is one (_ruflo-cli.mjs); npx is the fallback.
  // CLI_CORE=1's `@claude-flow/cli-core@alpha` still goes through npx.
  const cli = npxArgs[1] === RUFLO_CLI_PKG ? resolveRufloCli() : null;
  if (cli) {
    return spawnSync(cli.command, [...cli.args, ...npxArgs.slice(2)], { ...safeOptions, shell: false });
  }
  if (process.platform === 'win32') {
    const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    return spawnSync(process.execPath, [npxCli, ...npxArgs], { ...safeOptions, shell: false });
  }
  return spawnSync('npx', npxArgs, { ...safeOptions, shell: false });
}
