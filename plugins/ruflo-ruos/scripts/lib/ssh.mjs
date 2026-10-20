// @ts-check
/**
 * Per-tenant SSH transport (ADR-405 transport 2, ruOS ADR-053 Phase 2).
 *
 * sshd on :2222 is pubkey-only and armed with the tenant's own fleet-minted
 * ed25519 key, so it is the sound peer-to-peer path — but it lives on the
 * Fly 6PN, so it only works when ruflo itself runs on a same-tenant ruOS
 * desktop. The ssh binary is spawned with a FIXED argv (no shell), and the
 * remote command is a builder-produced string (command-builder.mjs).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { RuosError } from './types.mjs';
import { SSH_USER_RE, FLY_APP_RE, FLY_ID_RE } from './validate.mjs';

export const SSH_PORT = 2222;

/**
 * @typedef {object} SshOptions
 * @property {string|undefined} keyPath  path to the tenant ed25519 private key (required)
 * @property {string=} user      remote user (default 'ruv')
 * @property {string=} app       Fly app name (default 'ruos-desktop')
 * @property {typeof nodeSpawn=} spawnImpl
 */

/** @param {NodeJS.ProcessEnv} env */
export function sshConfigFromEnv(env) {
  return {
    keyPath: env.RUOS_SSH_KEY || undefined,
    user: env.RUOS_SSH_USER || 'ruv',
    app: env.RUOS_FLY_APP || 'ruos-desktop',
  };
}

/**
 * @param {import('./types.mjs').Desktop} desktop
 * @param {string} app
 */
export function sshHostFor(desktop, app) {
  if (!desktop.flyMachineId || !FLY_ID_RE.test(desktop.flyMachineId)) {
    throw new RuosError('invalid-input', 'desktop has no Fly machine id; SSH needs a cloud desktop');
  }
  if (!FLY_APP_RE.test(app)) throw new RuosError('invalid-input', 'RUOS_FLY_APP is invalid');
  return `${desktop.flyMachineId}.vm.${app}.internal`;
}

/**
 * The full ssh argv. Exported so tests can assert it is fixed.
 * @param {{ keyPath: string, user: string, host: string, command: string, connectTimeout?: number }} a
 * @returns {string[]}
 */
export function buildSshArgv(a) {
  if (!SSH_USER_RE.test(a.user)) throw new RuosError('invalid-input', 'ssh user is invalid');
  if (typeof a.keyPath !== 'string' || a.keyPath.length === 0 || a.keyPath.startsWith('-')) {
    throw new RuosError('invalid-input', 'ssh key path is invalid');
  }
  return [
    '-p', String(SSH_PORT),
    '-i', a.keyPath,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=${a.connectTimeout ?? 5}`,
    '-o', 'ServerAliveInterval=15',
    '-l', a.user,
    '--',
    a.host,
    a.command,
  ];
}

/**
 * @param {SshOptions} opts
 * @returns {import('./types.mjs').Transport}
 */
export function createSshTransport(opts) {
  if (!opts.keyPath) throw new RuosError('not-configured', 'set RUOS_SSH_KEY to the tenant ed25519 key to use the ssh transport');
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const user = opts.user ?? 'ruv';
  const app = opts.app ?? 'ruos-desktop';
  return {
    kind: 'ssh',
    exec: (desktop, command, timeoutSecs) =>
      new Promise((resolve, reject) => {
        const argv = buildSshArgv({ keyPath: /** @type {string} */ (opts.keyPath), user, host: sshHostFor(desktop, app), command });
        const child = spawnImpl('ssh', argv, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
        /** @type {Buffer[]} */ const out = [];
        /** @type {Buffer[]} */ const err = [];
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new RuosError('timeout', `ssh command timed out after ${timeoutSecs}s`));
        }, Math.max(1, timeoutSecs) * 1000);
        child.stdout?.on('data', (b) => out.push(b));
        child.stderr?.on('data', (b) => err.push(b));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new RuosError('network-down', 'ssh could not start', e));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          const stderr = Buffer.concat(err).toString('utf8');
          // 255 is ssh's own failure (connect/auth), not the remote command's.
          if (code === 255) {
            if (/permission denied|publickey/i.test(stderr)) {
              reject(new RuosError('auth-expired', 'ssh key refused (desktop not armed with this tenant key?)'));
            } else {
              reject(new RuosError('network-down', 'ssh connection failed (6PN unreachable or desktop stopped)'));
            }
            return;
          }
          resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr, exitCode: code });
        });
      }),
  };
}
