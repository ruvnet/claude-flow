/**
 * `ruflo proxy install|start|stop|status|logs|update|uninstall` (ADR-307) —
 * the full lifecycle command set, kept in its own file so
 * src/commands/proxy.ts (the ADR-313/314/315 consent subcommands) stays
 * under the repo's 500-line-per-file convention. Merged into one
 * `proxyCommand` in proxy.ts.
 */

import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { hasConsent, recordConsent, revokeConsent } from '../funnel/index.js';
import { installProxy, uninstallProxy } from '../proxy/install.js';
import {
  startForeground,
  startBackground,
  stopProxy,
  getProxyStatus,
  type ProxyStatus,
  readProxyLogTail,
  watchProxyLog,
  ProxyNotInstalledError,
  ProxyAlreadyRunningError,
} from '../proxy/lifecycle.js';
import { proxyTokenPath } from '../proxy/paths.js';
import { removeInjectedToken, startTokenRefreshPump } from '../proxy/token-bridge.js';

/** Pinned and reviewed; later upgrades remain explicit commands. */
export const DEFAULT_PROXY_RELEASE = '0.4.0';

const PROXY_COMMAND = 'npx ruflo@latest proxy';
const AUTH_COMMAND = 'npx ruflo@latest auth';

/**
 * Human-oriented next steps for `ruflo proxy` and `ruflo proxy status`.
 * Keep this independent of the command framework so the state-specific
 * guidance has a small, direct regression-test surface.
 */
export function proxyConsoleGuidance(status: ProxyStatus): string[] {
  if (!status.installed) {
    return [
      '',
      'Next step',
      `  ${PROXY_COMMAND} install --yes    Install signed Meta-Proxy v${DEFAULT_PROXY_RELEASE}`,
      '',
      'After installation, start it in the background:',
      `  ${PROXY_COMMAND} start --service`,
    ];
  }

  if (!status.running) {
    return [
      '',
      'Next step',
      `  ${PROXY_COMMAND} start --service    Start the proxy in the background`,
      '',
      'Foreground mode (shows live logs; Ctrl+C stops it):',
      `  ${PROXY_COMMAND} start`,
      '',
      'Optional: enable Cognitum cloud routing (local-only is the default):',
      `  ${AUTH_COMMAND} login`,
      `  ${PROXY_COMMAND} config --cloud --yes`,
    ];
  }

  return [
    '',
    'Meta Proxy is ready.',
    `  Logs:    ${PROXY_COMMAND} logs`,
    `  Stop:    ${PROXY_COMMAND} stop`,
    '',
    'Optional: enable Cognitum cloud routing (local-only is the default):',
    `  ${AUTH_COMMAND} login`,
    `  ${PROXY_COMMAND} config --cloud --yes`,
  ];
}

export function printProxyConsoleGuidance(status: ProxyStatus): void {
  for (const line of proxyConsoleGuidance(status)) output.writeln(line);
}

const INSTALL_DISCLOSURE = [
  'Installing the Meta LLM Proxy (ADR-304/307).',
  '',
  'This downloads a separately-released Rust binary (Ed25519-signature and',
  'checksum verified before anything is written to disk) and runs it as a',
  'local process bound to 127.0.0.1 only. The proxy routes to LOCAL',
  'backends by default — no prompt leaves this machine. Cloud routing is a',
  'separate, explicit opt-in (`ruflo proxy config --cloud`), never enabled',
  'by install alone.',
  '',
  'Uninstall anytime: ruflo proxy uninstall',
].join('\n');

const installSub: Command = {
  name: 'install',
  description: 'Download, verify, and install the meta-proxy binary (ADR-307)',
  options: [
    // NOT named 'version' — index.ts:107 globally intercepts any --version/-v
    // anywhere in argv (`if (flags.version || flags.V) { showVersion(); return; }`)
    // BEFORE subcommand dispatch, regardless of which command defines it. A
    // subcommand-local --version is silently swallowed by the CLI's own
    // `ruflo --version` handling — confirmed the hard way in E2E testing.
    { name: 'release', description: `Release version to install (default: ${DEFAULT_PROXY_RELEASE})`, type: 'string' },
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    // Resolve the reviewed default before the consent gate. An explicit empty
    // override still fails below without recording a consent receipt.
    const version = typeof ctx.flags.release === 'string' ? ctx.flags.release : DEFAULT_PROXY_RELEASE;
    if (!version) {
      output.printError(
        'ruflo proxy install requires --release <x.y.z> — there is no version-discovery ' +
          'endpoint yet (see the plan doc for the tracked follow-up). Find the latest at ' +
          'the release channel and pass it explicitly.',
      );
      return { success: false, exitCode: 1 };
    }

    if (!hasConsent('proxy-install')) {
      output.writeln(INSTALL_DISCLOSURE);
      output.writeln('');
      const confirmed = Boolean(ctx.flags.yes);
      if (!confirmed) {
        output.writeln(`Re-run with --yes to confirm: ruflo proxy install --yes (installs ${version})`);
        return { success: true, data: { confirmed: false } };
      }
      recordConsent('proxy-install', true, 'proxy-install');
    }

    try {
      const spinner = output.createSpinner({ text: `Installing meta-proxy ${version}...`, spinner: 'dots' });
      spinner.start();
      const result = await installProxy({ version, log: (line) => spinner.setText(line) });
      spinner.succeed(`meta-proxy ${version} installed`);
      output.writeln(`  binary: ${result.binaryPath}`);
      output.writeln(`  sha256: ${result.sha256}`);
      return { success: true, data: result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      output.printError('Install failed', message);
      return { success: false, message, exitCode: 1 };
    }
  },
};

const updateSub: Command = {
  name: 'update',
  description: 'Re-verify and replace the installed binary with a specific version (never automatic)',
  options: [{ name: 'release', description: 'Release version to install', type: 'string', required: true }],
  action: async (ctx): Promise<CommandResult> => {
    const version = typeof ctx.flags.release === 'string' ? ctx.flags.release : undefined;
    if (!version) {
      output.printError('ruflo proxy update requires --release <x.y.z>');
      return { success: false, exitCode: 1 };
    }
    try {
      const spinner = output.createSpinner({ text: `Updating meta-proxy to ${version}...`, spinner: 'dots' });
      spinner.start();
      const result = await installProxy({ version, log: (line) => spinner.setText(line) });
      spinner.succeed(`meta-proxy updated to ${version}`);
      output.writeln(`  binary: ${result.binaryPath}`);
      return { success: true, data: result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      output.printError('Update failed', message);
      return { success: false, message, exitCode: 1 };
    }
  },
};

const startSub: Command = {
  name: 'start',
  description: 'Start meta-proxy (foreground by default; --service to detach)',
  options: [
    { name: 'service', description: 'Run detached (background), survives terminal close but not a reboot — full OS-service registration is not yet implemented', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    const service = Boolean(ctx.flags.service);
    try {
      if (service) {
        const { pid } = await startBackground();
        output.printSuccess(`meta-proxy started in the background (pid ${pid})`);
        output.writeln('  Note: survives this terminal closing, but not a reboot — OS-service registration is not yet implemented.');
        output.writeln('  Logs: ruflo proxy logs');
        return { success: true, data: { pid } };
      }
      output.writeln('Starting meta-proxy in the foreground — press Ctrl+C to stop.');
      await startTokenRefreshPump();
      await startForeground(); // never returns normally
      return { success: true };
    } catch (e) {
      if (e instanceof ProxyNotInstalledError || e instanceof ProxyAlreadyRunningError) {
        output.printError(e.message);
        return { success: false, message: e.message, exitCode: 1 };
      }
      const message = e instanceof Error ? e.message : String(e);
      output.printError('Failed to start meta-proxy', message);
      return { success: false, message, exitCode: 1 };
    }
  },
};

const superviseSub: Command = {
  name: 'supervise',
  description: 'Internal detached supervisor for token refresh and meta-proxy lifecycle',
  action: async (): Promise<CommandResult> => {
    await startTokenRefreshPump();
    await startForeground(true);
    return { success: true };
  },
};

const stopSub: Command = {
  name: 'stop',
  description: 'Stop a running meta-proxy process',
  action: async (): Promise<CommandResult> => {
    const result = await stopProxy();
    removeInjectedToken();
    if (!result.wasRunning) {
      output.writeln('meta-proxy was not running.');
      return { success: true, data: result };
    }
    output.printSuccess(`meta-proxy stopped (was pid ${result.pid})`);
    return { success: true, data: result };
  },
};

const statusSub: Command = {
  name: 'status',
  description: 'Show meta-proxy install + process status',
  options: [{ name: 'json', description: 'Machine-readable output', type: 'boolean', default: false }],
  action: async (ctx): Promise<CommandResult> => {
    const status = getProxyStatus();
    if (ctx.flags.json) {
      output.printJson(status);
      return { success: true, data: status };
    }
    output.writeln('Meta Proxy');
    output.writeln(`  Installation: ${status.installed ? 'ready' : 'not installed'}`);
    output.writeln(`  Process: ${status.running ? `running (pid ${status.pid})` : 'not running'}`);
    if (status.stalePidFile) output.writeln('  (a stale PID file was found and will be cleared on next start)');
    printProxyConsoleGuidance(status);
    return { success: true, data: status };
  },
};

const logsSub: Command = {
  name: 'logs',
  description: 'Show meta-proxy --service logs',
  options: [
    { name: 'follow', short: 'f', description: 'Stream new log lines as they arrive', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (ctx.flags.follow) {
      output.writeln('Following meta-proxy logs — press Ctrl+C to stop.');
      try {
        const watcher = watchProxyLog((line) => output.writeln(line));
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            watcher.close();
            resolve();
          });
        });
        return { success: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        output.printError(message);
        return { success: false, message, exitCode: 1 };
      }
    }
    const tail = readProxyLogTail();
    if (!tail) {
      output.writeln('No log content yet — meta-proxy has never been started in --service mode.');
      return { success: true, data: { empty: true } };
    }
    output.writeln(tail);
    return { success: true };
  },
};

const uninstallSub: Command = {
  name: 'uninstall',
  description: 'Stop the proxy (if running), remove the binary, token, and consent receipt',
  action: async (): Promise<CommandResult> => {
    const status = getProxyStatus();
    if (status.running) {
      await stopProxy();
      output.writeln('Stopped the running meta-proxy process.');
    }
    const removed = await uninstallProxy();
    const { existsSync, unlinkSync } = await import('node:fs');
    const tokenPath = proxyTokenPath();
    if (existsSync(tokenPath)) unlinkSync(tokenPath);
    removeInjectedToken();
    revokeConsent('proxy-install', 'proxy-uninstall');
    output.printSuccess(removed ? 'meta-proxy uninstalled.' : 'Nothing was installed — cleaned up any leftover state.');
    return { success: true, data: { removed } };
  },
};

export const proxyLifecycleSubcommands: Command[] = [installSub, updateSub, startSub, superviseSub, stopSub, statusSub, logsSub, uninstallSub];
