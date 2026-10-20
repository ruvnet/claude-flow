// @ts-check
/**
 * Fleet MCP client (ADR-405) — the tenant-authenticated ruOS fleet MCP over
 * streamable HTTP. This is the ONLY transport from outside a tenant's Fly
 * 6PN (laptops, workstations, CI). Remote `/mcp` is stateless, so every call
 * is a single `tools/call` with no initialize handshake.
 *
 * Credentials: RUOS_MCP_URL + RUOS_MCP_TOKEN (a `ruos_mcp_` bearer), or the
 * `@cognitum/ruos` credentials file (~/.config/ruos/credentials.json). Never
 * embedded, logged or echoed; every error message is redacted.
 *
 * Never reaches the desktop executor on :17870 (no per-tenant auth, ruOS
 * ADR-070) and refuses to issue deletion tools (deletes stay human).
 */
import { readFileSync as nodeReadFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuosError } from './types.mjs';
import { FLY_ID_RE, DESKTOP_ID_RE } from './validate.mjs';

const PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_MCP_URL = 'https://ruos.cognitum.one/mcp';
/** Deletion is a human action (ruOS guard gates these); the swarm never sends them. */
export const FORBIDDEN_TOOLS = Object.freeze(['desktop_delete', 'secret_delete']);
/** Tools that need a `desktop:control` scoped token. */
export const CONTROL_TOOLS = Object.freeze(['desktop_exec', 'desktop_start', 'desktop_stop', 'desktop_keepawake']);

/**
 * @typedef {object} FleetMcpOptions
 * @property {string|undefined} url
 * @property {string|undefined} token
 * @property {'env'|'credentials-file'|'none'=} source
 * @property {typeof fetch=} fetchImpl
 * @property {number=} requestTimeoutMs
 */

/**
 * Resolve credentials: env first, then the @cognitum/ruos credentials file.
 * @param {NodeJS.ProcessEnv} env
 * @param {(p: string) => string=} readFile
 * @returns {{ url: string|undefined, token: string|undefined, source: 'env'|'credentials-file'|'none' }}
 */
export function fleetConfigFromEnv(env, readFile = (p) => nodeReadFileSync(p, 'utf8')) {
  if (env.RUOS_MCP_URL && env.RUOS_MCP_TOKEN) return { url: env.RUOS_MCP_URL, token: env.RUOS_MCP_TOKEN, source: 'env' };
  const home = env.HOME || env.USERPROFILE;
  if (home) {
    try {
      const c = JSON.parse(readFile(join(env.XDG_CONFIG_HOME || join(home, '.config'), 'ruos', 'credentials.json')));
      const token = c.access_token ?? c.accessToken ?? c.token;
      if (typeof token === 'string' && token.length > 0) {
        const url = env.RUOS_MCP_URL || (typeof c.mcp_url === 'string' ? c.mcp_url : DEFAULT_MCP_URL);
        return { url, token, source: 'credentials-file' };
      }
    } catch { /* no credentials file */ }
  }
  return { url: undefined, token: undefined, source: 'none' };
}

export class FleetMcpClient {
  /** @param {FleetMcpOptions} opts */
  constructor(opts) {
    this.url = opts.url;
    /** @private */
    this.token = opts.token;
    this.source = opts.source ?? (opts.token ? 'env' : 'none');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 330_000;
    this.nextId = 1;
  }

  get configured() {
    return Boolean(this.url && this.token);
  }

  /** @param {string} s */
  redact(s) {
    return this.token ? s.split(this.token).join('[redacted]') : s;
  }

  assertConfigured() {
    if (!this.configured) {
      throw new RuosError('not-configured', 'set RUOS_MCP_URL + RUOS_MCP_TOKEN (a desktop:control ruos_mcp_ token, narrowest lifetime) or sign in with @cognitum/ruos');
    }
    const u = new URL(/** @type {string} */ (this.url));
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))) {
      throw new RuosError('invalid-input', 'RUOS_MCP_URL must be https (http only for localhost)');
    }
    if (u.port === '17870') throw new RuosError('invalid-input', 'refusing the desktop executor port :17870 (ADR-070)');
  }

  /**
   * Call a fleet tool and return its structured payload (stateless tools/call).
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @returns {Promise<any>}
   */
  async callTool(name, args) {
    if (FORBIDDEN_TOOLS.includes(name)) {
      throw new RuosError('invalid-input', `${name} is a human action; ruflo-ruos never issues it`);
    }
    this.assertConfigured();
    /** @type {Response} */
    let res;
    try {
      res = await this.fetchImpl(/** @type {string} */ (this.url), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${this.token}`,
          'mcp-protocol-version': PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      const e = /** @type {Error} */ (err);
      if (e && e.name === 'TimeoutError') throw new RuosError('timeout', 'fleet MCP request timed out');
      throw new RuosError('network-down', 'fleet MCP unreachable');
    }
    if (res.status === 401) throw new RuosError('auth-expired', 'fleet MCP refused the credential (HTTP 401); mint a new token');
    if (res.status === 403) throw this.scopeError(name, 'HTTP 403');
    if (!res.ok) throw new RuosError('tool-error', `fleet MCP HTTP ${res.status}`);
    const msg = parseRpcBody(await res.text(), res.headers.get('content-type') || '');
    if (msg.error) {
      const text = this.redact(String(msg.error.message ?? ''));
      if (/scope|forbidden|desktop:control/i.test(text)) throw this.scopeError(name, text);
      const code = /unauthori|expired|invalid token/i.test(text) ? 'auth-expired' : 'tool-error';
      throw new RuosError(code, `fleet MCP error: ${text.slice(0, 200)}`);
    }
    const result = /** @type {any} */ (msg.result);
    const payload = toolPayload(result);
    if (result && result.isError) {
      const text = this.redact(typeof payload === 'string' ? payload : JSON.stringify(payload));
      if (/scope|desktop:control/i.test(text)) throw this.scopeError(name, text);
      throw classifyToolError(text);
    }
    return payload;
  }

  /**
   * @param {string} tool
   * @param {string} detail
   */
  scopeError(tool, detail) {
    return CONTROL_TOOLS.includes(tool)
      ? new RuosError('insufficient-scope', `${tool} needs a desktop:control token; the current token can only read status (${detail.slice(0, 80)})`)
      : new RuosError('auth-expired', `fleet MCP refused the credential (${detail.slice(0, 80)})`);
  }
}

/**
 * @param {string} text
 * @param {string} contentType
 * @returns {{ result?: unknown, error?: { message?: unknown } }}
 */
export function parseRpcBody(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data) last = JSON.parse(data);
      }
    }
    if (!last) throw new RuosError('tool-error', 'empty SSE response from fleet MCP');
    return last;
  }
  return JSON.parse(text);
}

/** @param {any} result */
export function toolPayload(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const t = Array.isArray(result.content) ? result.content.find((/** @type {any} */ c) => c.type === 'text') : null;
  if (!t) return null;
  try {
    return JSON.parse(t.text);
  } catch {
    return t.text;
  }
}

/** @param {string} text */
export function classifyToolError(text) {
  const t = text.slice(0, 300);
  if (/unauthori|expired|forbidden/i.test(t)) return new RuosError('auth-expired', `fleet: ${t}`);
  if (/not running|stopped|asleep|suspended|not started|no heartbeat/i.test(t)) return new RuosError('desktop-stopped', `fleet: ${t}`);
  if (/not found|not owned|unknown machine|no shell|lite/i.test(t)) return new RuosError('not-owned', `fleet: ${t}`);
  if (/timed? ?out/i.test(t)) return new RuosError('timeout', `fleet: ${t}`);
  return new RuosError('tool-error', `fleet: ${t}`);
}

/**
 * Hosted desktops only. Lite browsers (separate `lite_browsers` array,
 * `lite-` ids) have no shell and are never host candidates.
 * @param {any} raw
 * @returns {import('./types.mjs').Desktop[]}
 */
export function normalizeDesktops(raw) {
  const list = raw && Array.isArray(raw.desktops) ? raw.desktops : [];
  return list
    .filter((/** @type {any} */ d) => typeof d.machine_id === 'string' && DESKTOP_ID_RE.test(d.machine_id) && d.kind !== 'lite_browser')
    .map((/** @type {any} */ d) => ({
      id: d.machine_id,
      flyMachineId: typeof d.fly_machine_id === 'string' && FLY_ID_RE.test(d.fly_machine_id) ? d.fly_machine_id : null,
      name: String(d.name ?? ''),
      displayName: d.display_name ? String(d.display_name) : null,
      state: d.state ?? null,
      heartbeatStatus: d.heartbeat_status ?? null,
      heartbeatAt: typeof d.last_heartbeat_at === 'number' ? d.last_heartbeat_at : null,
      ready: d.ready === true,
    }));
}

/**
 * desktop_exec (ruOS ADR-081) returns `{status, exitCode, stdout, ...}` where
 * stdout is framed: a `▶ run: <command>` echo first, then output, then
 * `✓ SUCCESS…` / `📝 transcript:` trailers, and `… [output truncated]` when
 * the ~4 KiB head cap hits. The echo would let markers inside the command
 * false-match, so the frame is stripped here (measured live 2026-10-01).
 * @param {any} raw
 * @returns {import('./types.mjs').ExecResult}
 */
export function normalizeExec(raw) {
  const r = typeof raw === 'string' ? { stdout: raw } : (raw ?? {});
  const exit = r.exitCode ?? r.exit_code ?? null;
  let lines = String(r.stdout ?? r.output ?? '').split('\n');
  let truncated = false;
  if (lines.length && lines[0].startsWith('▶ run:')) lines = lines.slice(1);
  lines = lines.filter((l) => {
    if (/^… \[output truncated\]/.test(l)) { truncated = true; return false; }
    return !/^(✓|✗|⚠) [A-Z]+ in \d|^📝 transcript:/.test(l);
  });
  return {
    stdout: lines.join('\n').replace(/^\n+/, ''),
    stderr: String(r.stderr ?? ''),
    exitCode: typeof exit === 'number' ? exit : null,
    truncated,
  };
}

/**
 * @typedef {object} LlmRoute
 * @property {string|null} route
 * @property {string|null} provider
 * @property {string|null} gateway
 * @property {boolean} keyPresent
 */

/**
 * Fleet control-plane operations bound to one client.
 * @param {FleetMcpClient} client
 * @returns {import('./types.mjs').Fleet}
 */
export function createFleet(client) {
  return {
    listDesktops: async () => normalizeDesktops(await client.callTool('desktop_status', {})),
    start: async (id) => { await client.callTool('desktop_start', { machine_id: id }); },
    stop: async (id) => { await client.callTool('desktop_stop', { machine_id: id }); },
    keepAwake: async (fly, minutes) => {
      await client.callTool('desktop_keepawake', { machine: fly, minutes });
    },
    llmRoute: async () => {
      const r = (await client.callTool('llm_route_get', {})) ?? {};
      return { route: r.route ?? null, provider: r.provider ?? null, gateway: r.gateway ?? null, keyPresent: r.key_present === true };
    },
  };
}

/**
 * @param {FleetMcpClient} client
 * @returns {import('./types.mjs').Transport}
 */
export function createFleetTransport(client) {
  return {
    kind: 'fleet-mcp',
    exec: async (desktop, command, timeoutSecs) => {
      const timeout = Math.max(1, Math.min(300, Math.floor(timeoutSecs)));
      // Verified live: desktop_exec accepts the Fly machine id as `machine`.
      const machine = desktop.flyMachineId ?? desktop.id;
      return normalizeExec(await client.callTool('desktop_exec', { command, machine, timeout_secs: timeout }));
    },
  };
}
