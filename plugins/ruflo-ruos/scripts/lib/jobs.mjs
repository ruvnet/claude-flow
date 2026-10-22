// @ts-check
/**
 * Job transports (ADR-405 §Jobs). The adapter drives a JobTransport; two
 * implementations:
 *
 *  - ExecPollTransport — available now. Stages the prompt and launches a
 *    detached `nohup setsid` runner via desktop_exec, then polls the log by
 *    byte offset. All strings come from command-builder.mjs.
 *  - JobsApiTransport — ruOS ADR-105 jobs API (`feat/ruos-jobs`), used when
 *    feature-detected. The server owns detach, capture, exit, cancel,
 *    keepawake and audit. Backends: REST with the tenant token, or the local
 *    stdio `@cognitum/ruos` MCP server (`desktop_job_*` — stdio-only, never on
 *    the remote connector). The run id is the idempotency key.
 */
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { RuosError } from './types.mjs';
import { assertRunId, assertInt, newNonce } from './validate.mjs';
import {
  buildPrepare, buildPromptChunks, buildLaunch, buildPoll, buildStop, buildJobCommand,
  parsePoll, parseLaunch, parseStopped, commandSha256,
} from './command-builder.mjs';

/** @typedef {() => string} NonceFn  fresh marker nonce per command */
/** @type {NonceFn} */
const defaultNonce = () => newNonce(nodeRandomBytes);

/**
 * @param {import('./types.mjs').Transport} exec
 * @param {import('./types.mjs').Desktop} desktop
 * @param {import('./types.mjs').RunSpec} spec
 * @param {NonceFn} nonce
 */
async function stagePrompt(exec, desktop, spec, nonce) {
  const chunks = buildPromptChunks(spec.runId, spec.prompt);
  const run = async (/** @type {string} */ c) => {
    const r = await exec.exec(desktop, c, 30);
    if (r.exitCode !== null && r.exitCode !== 0) throw new RuosError('remote-error', `staging failed (exit ${r.exitCode})`);
    return r;
  };
  await run(buildPrepare(spec.runId, nonce()));
  for (const c of chunks.commands) await run(c);
  return chunks;
}

/**
 * @param {import('./types.mjs').Transport} exec
 * @param {NonceFn=} nonce
 * @returns {import('./types.mjs').JobTransport}
 */
export function createExecPollTransport(exec, nonce = defaultNonce) {
  return {
    kind: 'exec-poll',
    async start(desktop, spec) {
      const chunks = await stagePrompt(exec, desktop, spec, nonce);
      const n = nonce();
      const cmd = buildLaunch(spec, n);
      const lr = await exec.exec(desktop, cmd, 60);
      const launched = parseLaunch(lr.stdout, n);
      if (launched.noRunner) throw new RuosError('remote-error', 'claude is not installed on the desktop');
      if (lr.exitCode !== null && lr.exitCode !== 0) throw new RuosError('remote-error', `launch failed (exit ${lr.exitCode})`);
      if (launched.sha256 !== chunks.sha256) throw new RuosError('remote-error', 'prompt integrity check failed (sha256 mismatch)');
      if (launched.pid === null) throw new RuosError('remote-error', 'runner did not report a pid');
      // Hash the command with its nonce masked so the audit hash is stable.
      return { jobId: spec.runId, commandSha256: commandSha256(cmd.split(n).join('<nonce>')) };
    },
    async poll(desktop, jobId, offset) {
      const n = nonce();
      const p = parsePoll((await exec.exec(desktop, buildPoll(jobId, offset, n), 30)).stdout, n);
      if (p === 'norun') throw new RuosError('remote-error', 'run directory vanished on the desktop');
      const next = offset + p.chunk.length;
      /** @type {import('./types.mjs').JobState} */
      const state = p.exitCode !== null ? (p.exitCode === 0 ? 'exited' : 'failed') : p.alive ? 'running' : 'lost';
      return { chunk: p.chunk, nextOffset: next, running: state === 'running', state, exitCode: p.exitCode, truncated: false };
    },
    async cancel(desktop, jobId) {
      const n = nonce();
      return parseStopped((await exec.exec(desktop, buildStop(jobId, n), 30)).stdout, n);
    },
  };
}

/**
 * Backend contract for the ruOS jobs API (ruos-desktop ADR-105, live).
 * @typedef {object} JobsRead
 * @property {string} chunk          base64
 * @property {number} next_offset
 * @property {boolean} running       true while queued too: "keep polling"
 * @property {string} state
 * @property {number|null} exit_code
 * @property {boolean} truncated
 * @property {('up'|'asleep'|'unknown')=} desktop
 * @property {string=} stop_at
 * @property {string|null=} error
 */
/**
 * @typedef {object} JobsBackend
 * @property {(body: { machine: string, command: string, timeout_secs: number, idempotency_key: string }) => Promise<{ job_id: string, state?: string, idempotent_replay?: boolean }>} create
 * @property {(jobId: string, offset: number, max: number, waitMs: number) => Promise<JobsRead>} read
 * @property {(jobId: string) => Promise<void>} cancel
 * @property {(machine: string) => Promise<unknown[]>} list
 */

const STATES = new Set(['queued', 'running', 'exited', 'failed', 'cancelled', 'stopped', 'lost']);
export const JOBS_CHUNK_MAX = 65536;
/** server long-poll cap is 25 000 ms; leave headroom under the request timeout */
export const JOBS_WAIT_MS = 20_000;
export const JOBS_TIMEOUT_MAX = 21_600;

/**
 * @param {JobsBackend} backend
 * @param {import('./types.mjs').Transport} exec  used only to stage the prompt file
 * @param {NonceFn=} nonce
 * @returns {import('./types.mjs').JobTransport}
 */
export function createJobsApiTransport(backend, exec, nonce = defaultNonce) {
  return {
    kind: 'jobs-api',
    longPoll: true,
    async start(desktop, spec) {
      await stagePrompt(exec, desktop, spec, nonce);
      const command = buildJobCommand(spec);
      const { job_id } = await backend.create({
        machine: desktop.flyMachineId ?? desktop.id,
        command,
        // The server clamps above 21 600 s; we never ask for more.
        timeout_secs: Math.min(assertInt(spec.timeoutSecs, 1, 7 * 86_400, 'timeoutSecs'), JOBS_TIMEOUT_MAX),
        idempotency_key: assertRunId(spec.runId),
      });
      if (typeof job_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(job_id)) throw new RuosError('remote-error', 'jobs API returned an invalid job id');
      return { jobId: job_id, commandSha256: commandSha256(command) };
    },
    async poll(_desktop, jobId, offset) {
      const r = await backend.read(jobId, offset, JOBS_CHUNK_MAX, JOBS_WAIT_MS);
      const state = STATES.has(r.state) ? /** @type {import('./types.mjs').JobState} */ (r.state) : 'lost';
      const chunk = Buffer.from(String(r.chunk ?? ''), 'base64');
      // Trust byte offsets, not chunk length: the server may skip a capped tail.
      const nextOffset = typeof r.next_offset === 'number' && r.next_offset >= offset ? r.next_offset : offset + chunk.length;
      return { chunk, nextOffset, running: r.running === true, state, exitCode: typeof r.exit_code === 'number' ? r.exit_code : null, truncated: r.truncated === true };
    },
    async cancel(_desktop, jobId) {
      await backend.cancel(jobId); // TERM, then KILL after 10 s → cancelled
      return true;
    },
  };
}

/**
 * REST backend for the live jobs API, Bearer token with `desktop:control`.
 * Status mapping (ADR-105):
 *   POST 202 new · 200 `idempotent_replay` → success, reuse job_id
 *   POST 409 → same key, different request: a client bug, never retried
 *   POST 429 → per-tenant cap (4), no server queue → `capacity` (adapter backs off)
 *   GET  503 → desktop up but the poll did not answer → retried here with backoff
 *   400 → invalid-input (e.g. a Lite machine target), never retried
 *   401 → auth-expired · 403 → insufficient-scope · 404 → not-owned (never retried)
 *   DELETE 200 → job ends `cancelled`, exit 143, output before the cancel kept
 * @param {{ baseUrl: string, token: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} o
 * @returns {JobsBackend & { detect: (machine: string) => Promise<boolean> }}
 */
export function createRestJobsBackend(o) {
  const f = o.fetchImpl ?? globalThis.fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = new URL('/api/v1/desktop/jobs', o.baseUrl).toString();
  /**
   * @param {string} method
   * @param {string} url
   * @param {unknown=} body
   * @param {number=} timeoutMs
   */
  const call = async (method, url, body, timeoutMs = 60_000) => {
    /** @type {Response} */
    let res;
    try {
      res = await f(url, {
        method,
        headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RuosError('network-down', 'ruOS jobs API unreachable');
    }
    if (res.status === 400) throw new RuosError('invalid-input', 'jobs API refused the request (400; e.g. a Lite browser target has no shell); not retried');
    if (res.status === 401) throw new RuosError('auth-expired', 'jobs API refused the credential');
    if (res.status === 403) throw new RuosError('insufficient-scope', 'jobs API needs a desktop:control token');
    if (res.status === 404) throw new RuosError('not-owned', 'job not found (not yours, or gone)');
    if (res.status === 409) throw new RuosError('invalid-input', 'idempotency key reused with a different request (client bug; not retried)');
    if (res.status === 429) throw new RuosError('capacity', 'per-tenant job concurrency cap reached (no server queue)');
    if (res.status === 503) throw new RuosError('timeout', 'desktop did not answer the poll (503)');
    if (!res.ok) throw new RuosError('tool-error', `jobs API HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
  /** @param {string} id */
  const jobUrl = (id) => `${base}/${encodeURIComponent(id)}`;
  return {
    create: (body) => call('POST', base, body),
    read: async (id, offset, max, waitMs) => {
      const wait = Math.max(0, Math.min(25_000, Math.floor(waitMs)));
      const url = `${jobUrl(id)}?offset=${offset}&max=${max}${wait ? `&wait_ms=${wait}` : ''}`;
      for (let attempt = 0; ; attempt++) {
        try {
          return await call('GET', url, undefined, wait + 30_000);
        } catch (e) {
          // 503 = desktop up but the poll did not answer: bounded backoff.
          if (!(e instanceof RuosError) || e.code !== 'timeout' || attempt >= 3) throw e;
          await sleep(1000 * 2 ** attempt);
        }
      }
    },
    cancel: async (id) => { await call('DELETE', jobUrl(id)); },
    list: async (machine) => {
      const r = await call('GET', `${base}?machine=${encodeURIComponent(machine)}`);
      return Array.isArray(r.jobs) ? r.jobs : Array.isArray(r) ? r : [];
    },
    /** Feature detection: the list route answers → the jobs API is deployed. */
    detect: async (machine) => {
      try {
        await call('GET', `${base}?machine=${encodeURIComponent(machine)}`);
        return true;
      } catch (e) {
        if (e instanceof RuosError && (e.code === 'auth-expired' || e.code === 'insufficient-scope')) throw e;
        return false;
      }
    },
  };
}
