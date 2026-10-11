/** Device pairing (RFC 8628 style): generate key, request a code, poll until approved, pin the server key. */
import { arch, hostname, platform } from 'node:os';
import { fromB64u, generateKeyPair, fingerprint, sanitize } from './protocol/index.js';
import { saveConfig, saveKey, normalizeBaseUrl, StateError, ensureDir, wipeState, type Config } from './state.js';
import { validateConnectUrl } from './run.js';
import type { Level } from './protocol/index.js';

export interface LinkOptions {
  home: string; baseUrl: string; name?: string; level?: Level; rufloVersion?: string; projectDir?: string;
  out?: (line: string) => void; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
  /** Cap on how long we wait for approval (seconds); also bounded by the server's expiresIn. */
  maxWaitSec?: number;
}

const REQ_TIMEOUT_MS = 15_000;
const MAX_NET_ERRORS = 5;
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v);

async function postJson(f: typeof fetch, url: string, body: unknown): Promise<{ status: number; json: J }> {
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
  const text = await r.text();
  if (text.length > 64 * 1024) throw new StateError('bad_response', 'server response too large');
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { throw new StateError('bad_response', `server returned non-JSON (status ${r.status})`); }
  return { status: r.status, json: isObj(json) ? json : {} };
}

/** Returns the stored config. Never prints keys. Throws StateError with a clear code on failure. */
export async function link(o: LinkOptions): Promise<Config> {
  const out = o.out ?? (() => undefined);
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const base = normalizeBaseUrl(o.baseUrl);
  const name = (o.name ?? hostname()).replace(/[^\w .@-]/g, '').slice(0, 80) || 'ruflo';
  const keys = generateKeyPair();

  const start = await postJson(f, `${base}/api/device/code`, { publicKey: keys.publicKey, name, platform: `${platform()}-${arch()}`, rufloVersion: o.rufloVersion });
  if (start.status !== 200 && start.status !== 201) throw new StateError('code_request_failed', `dashboard refused the pairing request (HTTP ${start.status}${typeof start.json.error === 'string' ? `: ${sanitize(start.json.error).slice(0, 60)}` : ''})`);
  const { deviceCode, userCode, verificationUri } = start.json;
  let interval = Number(start.json.interval ?? 5), expiresIn = Number(start.json.expiresIn ?? 600);
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') throw new StateError('bad_response', 'pairing response is missing fields');
  let verify: URL;
  try { verify = new URL(verificationUri); } catch { throw new StateError('bad_response', 'verification URL is invalid'); }
  if (verify.host !== new URL(base).host) throw new StateError('bad_response', 'verification URL is on a different host than the dashboard');
  interval = Math.min(Math.max(Number.isFinite(interval) ? interval : 5, 1), 30);
  expiresIn = Math.min(Math.max(Number.isFinite(expiresIn) ? expiresIn : 600, 30), o.maxWaitSec ?? 900);

  out(`To link this ruflo to your dashboard:`);
  out(`  1. Open   ${verify.toString()}`);
  out(`  2. Sign in and enter the code   ${sanitize(userCode).replace(/[^\w-]/g, '')}`);
  out(`  3. Approve "${name}" (key fingerprint ${fingerprint(keys.publicKey)})`);
  out(`Once linked, \`ruflo dashboard run\` publishes to ${new URL(base).host} (every ~10 s): mission objectives and states, task counts, swarm/agent names, memory counts, ADR titles and statuses, health. Secrets are masked, but objectives and titles are shown as written. Nothing is sent until you run it; level read never executes anything.`);
  out(`Waiting for approval (expires in ${Math.round(expiresIn / 60)} min, Ctrl-C to cancel)...`);

  const deadline = now() + expiresIn * 1000;
  let netErrors = 0;
  while (now() < deadline) {
    await sleep(interval * 1000);
    let r: { status: number; json: J };
    try { r = await postJson(f, `${base}/api/device/token`, { deviceCode }); netErrors = 0; } catch (e) {
      if (e instanceof StateError) throw e;
      if (++netErrors >= MAX_NET_ERRORS) throw new StateError('network', `cannot reach the dashboard: ${(e as Error).message}`.slice(0, 160));
      continue;
    }
    const status = r.json.status ?? r.json.error;
    if (status === 'slow_down' || r.status === 429) { interval = Math.min(interval + 5, 60); continue; }
    if (status === 'pending' || status === 'authorization_pending') continue;
    if (status === 'denied' || status === 'access_denied') throw new StateError('denied', 'the pairing request was denied in the dashboard');
    if (status === 'expired' || status === 'expired_token') throw new StateError('expired', 'the pairing code expired; run link again');
    if (status === 'approved') return finish(r.json);
    if (r.status >= 400) throw new StateError('token_failed', `dashboard error (HTTP ${r.status})`);
  }
  throw new StateError('timeout', 'timed out waiting for approval; run link again');

  function finish(j: J): Config {
    const { deviceId, tenantId, serverPublicKey, connectUrl } = j;
    if (typeof deviceId !== 'string' || typeof tenantId !== 'string' || typeof serverPublicKey !== 'string' || typeof connectUrl !== 'string') throw new StateError('bad_response', 'approval response is missing fields');
    if (fromB64u(serverPublicKey).length !== 32) throw new StateError('bad_response', 'server public key is malformed');
    const cfg: Config = {
      baseUrl: base, connectUrl: validateConnectUrl(connectUrl, base), deviceId, tenantId, publicKey: keys.publicKey, serverPublicKey,
      level: o.level ?? 'read', autoApprove: false, enabled: true, name, projectDir: o.projectDir,
    };
    ensureDir(o.home);
    try { saveKey(o.home, keys.privateKey); saveConfig(o.home, cfg); } catch (e) { wipeState(o.home); throw e; }
    return cfg;
  }
}
