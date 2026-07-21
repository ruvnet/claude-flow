/**
 * Filesystem layout for the managed meta-proxy binary (ADR-307), all under
 * the same `~/.ruflo` state dir every other funnel/proxy/auth file uses
 * (src/funnel/state.ts's `funnelStateDir()` — respects RUFLO_STATE_DIR for
 * tests). Centralized here so doctor.ts, install.ts, and lifecycle.ts share
 * one definition instead of three copies drifting apart.
 */

import { join } from 'node:path';
import { funnelStateDir } from '../funnel/index.js';

const BINARY_NAME = process.platform === 'win32' ? 'meta-proxy.exe' : 'meta-proxy';

export function proxyBinaryPath(): string {
  return join(funnelStateDir(), 'bin', BINARY_NAME);
}

export function proxyPidFilePath(): string {
  return join(funnelStateDir(), 'proxy.pid');
}

export function proxyLockFilePath(): string {
  return join(funnelStateDir(), 'proxy.lock');
}

export function proxyLogFilePath(): string {
  return join(funnelStateDir(), 'proxy.log');
}

export function proxyInstallManifestPath(): string {
  return join(funnelStateDir(), 'proxy', 'install-manifest.json');
}

export function proxyConfigPath(): string {
  return join(funnelStateDir(), 'proxy-config.toml');
}

export function proxyTokenPath(): string {
  return join(funnelStateDir(), 'proxy-token');
}

export function proxyInjectedTokenPath(): string {
  return join(funnelStateDir(), 'proxy-injected-token.json');
}

export interface InstallManifest {
  version: string;
  sha256: string;
  verifiedAt: string;
  pubkeyFingerprint: string;
}

/**
 * True if `bind` (a `host:port` string from proxy-config.toml) targets a
 * loopback address — decides whether the non-loopback exposure warning
 * fires (ADR-307). Recognizes the whole IPv4 127.0.0.0/8 block, IPv6 `::1`,
 * IPv4-mapped IPv6 loopback, and the `localhost` hostname.
 *
 * A plain `bind.startsWith('127.0.0.1')` check (the obvious first draft)
 * misclassifies `[::1]:port` as non-loopback — a real bug meta-proxy's own
 * Rust `is_loopback_bind` fixed for the identical reason; this mirrors that
 * fix rather than repeating the mistake on the TypeScript side.
 */
export function isLoopbackBind(bind: string): boolean {
  const hostPart = (host: string): boolean => {
    const stripped = host.replace(/^\[/, '').replace(/\]$/, '');
    if (stripped.toLowerCase() === 'localhost') return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(stripped)) return true; // 127.0.0.0/8
    if (stripped === '::1') return true;
    if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(stripped)) return true; // IPv4-mapped loopback
    return false;
  };

  // IPv6 bracketed form: [::1]:11435
  const bracketed = bind.match(/^\[([^\]]+)\]:\d+$/);
  if (bracketed) return hostPart(bracketed[1]);

  // host:port (IPv4 or hostname) — split on the LAST colon so a bare IPv6
  // address without brackets (ambiguous, shouldn't occur in practice) isn't
  // misparsed as host:port.
  const lastColon = bind.lastIndexOf(':');
  const host = lastColon === -1 ? bind : bind.slice(0, lastColon);
  return hostPart(host);
}
