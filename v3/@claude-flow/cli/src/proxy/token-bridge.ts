/** ADR-318 access-token-only bridge from ruflo auth to meta-proxy. */

import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { getValidAccessToken } from '../auth/client.js';
import { getProfile, listProfiles } from '../auth/state.js';
import { proxyConfigPath, proxyInjectedTokenPath } from './paths.js';

const REFRESH_POLL_MS = 30_000;

function configureInjectedTokenPath(): void {
  const target = proxyConfigPath();
  fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const raw = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const line = `ruflo_injected_token_path = ${JSON.stringify(proxyInjectedTokenPath())}`;
  const pattern = /^ruflo_injected_token_path\s*=.*$/m;
  const next = pattern.test(raw) ? raw.replace(pattern, line) : `${raw}${raw && !raw.endsWith('\n') ? '\n' : ''}${line}\n`;
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function removeInjectedToken(): void {
  try { fs.unlinkSync(proxyInjectedTokenPath()); } catch { /* absent */ }
}

export async function refreshInjectedToken(): Promise<boolean> {
  const { defaultProfile } = listProfiles();
  const profile = getProfile(defaultProfile);
  if (!profile) {
    removeInjectedToken();
    return false;
  }
  try {
    const accessToken = await getValidAccessToken(defaultProfile);
    const current = getProfile(defaultProfile);
    if (!current) return false;
    const body = JSON.stringify({ schemaVersion: 1, accessToken, expiresAt: current.accessTokenExpiresAt });
    configureInjectedTokenPath();
    const target = proxyInjectedTokenPath();
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, target);
    return true;
  } catch {
    removeInjectedToken();
    return false;
  }
}

export async function startTokenRefreshPump(): Promise<() => void> {
  await refreshInjectedToken();
  const timer = setInterval(() => void refreshInjectedToken(), REFRESH_POLL_MS);
  const stop = () => {
    clearInterval(timer);
    removeInjectedToken();
  };
  process.once('exit', removeInjectedToken);
  return stop;
}
