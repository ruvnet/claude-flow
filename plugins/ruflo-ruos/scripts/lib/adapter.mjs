// @ts-check
/**
 * ruOS host adapter (ADR-405): discover → (opt-in start) → launch → stream →
 * stop, with typed failures. Collaborators are injected (London-school):
 * Fleet (control plane), JobTransport (launch/poll/cancel), Ledger (swarm
 * state + audit), clock.
 */
import { RuosError } from './types.mjs';
import { resolveDesktop, assertRunId, assertAgentId, assertInt, assertPrompt } from './validate.mjs';
import { checkWindow } from './autostop.mjs';
import { validateBinding } from './run-store.mjs';

const TERMINAL = new Set(['exited', 'failed', 'cancelled']);
export const POLL_MIN_MS = 1000;
export const POLL_MAX_MS = 10_000;
/** after a cancel, keep reading output for at most this long (server KILLs at 10 s) */
export const CANCEL_DRAIN_MS = 15_000;

/** heartbeat older than this is not evidence the desktop is up */
export const HEARTBEAT_FRESH_SECS = 180;

/**
 * @param {import('./types.mjs').Desktop} d
 * @param {number} nowMs
 */
export function isUp(d, nowMs) {
  if (d.heartbeatStatus && ['asleep', 'missing', 'stale'].includes(d.heartbeatStatus)) return false;
  if (d.heartbeatAt === null) return false;
  return nowMs / 1000 - d.heartbeatAt <= HEARTBEAT_FRESH_SECS;
}

/**
 * @typedef {object} AdapterDeps
 * @property {import('./types.mjs').Fleet} fleet
 * @property {import('./types.mjs').JobTransport} jobs
 * @property {'fleet-mcp'|'ssh'=} transportKind  the exec path under the job transport
 * @property {import('./ledger.mjs').Ledger} ledger
 * @property {() => number=} now
 * @property {(ms: number) => Promise<void>=} sleep
 */

/**
 * @typedef {object} RunOptions
 * @property {string} desktop        desktop reference (id, fly id or name)
 * @property {string} prompt
 * @property {string} runId
 * @property {string} agentId
 * @property {string=} agentType
 * @property {('haiku'|'sonnet'|'opus')=} model
 * @property {number=} maxBudgetUsd
 * @property {number=} timeoutSecs   wall-clock cap for the whole run
 * @property {boolean=} allowStart   opt-in: wake a stopped desktop
 * @property {boolean=} ignoreAutoStop
 * @property {(chunk: Buffer) => void=} onOutput
 * @property {import('./run-store.mjs').RunBinding=} binding local provenance, not proof of remote workspace execution
 * @property {AbortSignal=} signal
 */

/**
 * @typedef {object} RunOutcome
 * @property {string} runId
 * @property {string} agentId
 * @property {string} desktopId
 * @property {'completed'|'failed'|'stopped'} status
 * @property {number|null} exitCode
 * @property {number} bytes
 * @property {number} dispatchMs     local call → launch acknowledged
 * @property {number|null} firstOutputMs  local call → first output byte
 * @property {number} totalMs
 * @property {string} swarmLedger
 * @property {string|null} stopAt
 * @property {'exec-poll'|'jobs-api'} jobs
 * @property {string[]} warnings
 */

/** @typedef {{ bytes: number, firstOutputMs: number|null, offset: number }} Stream */

export class RuosHostAdapter {
  /** @param {AdapterDeps} deps */
  constructor(deps) {
    this.fleet = deps.fleet;
    this.jobs = deps.jobs;
    this.transportKind = deps.transportKind ?? 'fleet-mcp';
    this.ledger = deps.ledger;
    this.runs = deps.ledger.runs;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async discover() {
    const desktops = await this.fleet.listDesktops();
    this.ledger.snapshotHosts(desktops);
    return desktops;
  }

  /** @param {string} ref */
  async resolve(ref) {
    return resolveDesktop(await this.fleet.listDesktops(), ref);
  }

  /**
   * Wake a stopped desktop only when the caller opted in; then wait for a
   * FRESH heartbeat (`ready` is a provisioning flag, not liveness).
   * @param {import('./types.mjs').Desktop} desktop
   * @param {{ allowStart?: boolean, waitSecs?: number }} o
   */
  async ensureUp(desktop, o) {
    if (isUp(desktop, this.now())) return desktop;
    if (!o.allowStart) {
      throw new RuosError('desktop-stopped', `desktop ${desktop.displayName ?? desktop.name} is not running; pass --start to wake it (billable)`);
    }
    if (!desktop.flyMachineId) {
      throw new RuosError('desktop-stopped', 'desktop is an enrolled endpoint without a cloud machine; start it on the device');
    }
    await this.fleet.start(desktop.id);
    this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'starting' });
    const deadline = this.now() + (o.waitSecs ?? 180) * 1000;
    let delay = 2000;
    while (this.now() < deadline) {
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, 10_000);
      const fresh = resolveDesktop(await this.fleet.listDesktops(), desktop.id);
      if (isUp(fresh, this.now())) {
        this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'started' });
        return fresh;
      }
    }
    throw new RuosError('timeout', 'desktop did not report a fresh heartbeat after start');
  }

  /**
   * After a transport failure mid-run: did the desktop stop under us?
   * @param {import('./types.mjs').Desktop} desktop
   * @param {unknown} err
   */
  async classifyMidRun(desktop, err) {
    if (err instanceof RuosError && (err.code === 'auth-expired' || err.code === 'invalid-input')) return err;
    try {
      const fresh = resolveDesktop(await this.fleet.listDesktops(), desktop.id);
      if (!isUp(fresh, this.now())) {
        return new RuosError('auto-stopped', 'desktop stopped mid-run (weekday 23:00 America/Toronto auto-stop or idle autosleep)', err);
      }
    } catch (probeErr) {
      if (probeErr instanceof RuosError && probeErr.code === 'auth-expired') return probeErr;
    }
    return err instanceof RuosError ? err : new RuosError('remote-error', String(err), err);
  }

  /**
   * Fail fast when the desktop has no LLM route for `claude -p`. Observed
   * live: `gateway: "unconfigured"` with `route: "shared"` still ran, so only
   * a missing/disabled route is fatal; an unconfigured gateway is a warning.
   */
  async checkLlmRoute() {
    let r;
    try {
      r = await this.fleet.llmRoute();
    } catch (err) {
      if (err instanceof RuosError && (err.code === 'auth-expired' || err.code === 'network-down')) throw err;
      this.ledger.warnings.push('llm_route_get unavailable; launching without a route check');
      return;
    }
    if (!r.route || ['none', 'disabled', 'off'].includes(r.route)) {
      throw new RuosError('llm-unconfigured', 'the desktop has no LLM route for claude -p; configure one in ruOS (llm_route_set) first');
    }
    if (r.gateway === 'unconfigured' && !r.keyPresent) {
      this.ledger.warnings.push(`llm route "${r.route}" with no gateway key; relying on the shared route`);
    }
  }

  /**
   * @param {import('./types.mjs').Desktop} desktop
   * @param {import('./types.mjs').RunSpec & { timeoutSecs: number }} spec
   */
  async startWithBackoff(desktop, spec) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.jobs.start(desktop, spec);
      } catch (err) {
        if (!(err instanceof RuosError) || err.code !== 'capacity' || attempt >= 3) throw err;
        this.ledger.warnings.push(`job concurrency cap reached; retry ${attempt + 1}/3`);
        await this.sleep(5000 * 2 ** attempt);
      }
    }
  }

  /**
   * @param {RunOptions} o
   * @returns {Promise<RunOutcome>}
   */
  async run(o) {
    const t0 = this.now();
    const runId = assertRunId(o.runId);
    const agentId = assertAgentId(o.agentId);
    const agentType = assertAgentId(o.agentType ?? 'coder');
    const timeoutSecs = assertInt(o.timeoutSecs ?? 900, 30, 6 * 3600, 'timeoutSecs');
    assertPrompt(o.prompt); // validate before any remote call
    const binding = validateBinding(o.binding);
    if (this.runs.read(runId)) throw new RuosError('run-exists', 'run id already exists; attach to reconcile it, never launch it again');

    let desktop = await this.resolve(o.desktop);
    // The 23:00 auto-stop applies to cloud desktops only, not enrolled devices.
    const win = checkWindow(t0, timeoutSecs);
    if (desktop.flyMachineId && !win.ok && !o.ignoreAutoStop) {
      throw new RuosError('autostop-window', `run may outlast the next auto-stop in ${win.minutesUntilStop} min (weekday 23:00 America/Toronto); shorten --timeout or pass --ignore-autostop`);
    }
    const name = desktop.displayName ?? desktop.name;
    const stopAt = desktop.flyMachineId ? new Date(win.nextStopMs).toISOString() : null;
    /** @type {import('./types.mjs').HostRef} */
    const host = { kind: 'ruos', desktopId: desktop.id, desktopName: name, transport: this.transportKind, jobs: this.jobs.kind, runId, stopAt };

    this.runs.reserve({ runId, agentId, agentType, desktopId: desktop.id, jobs: this.jobs.kind, transport: this.transportKind,
      jobId: this.jobs.kind === 'exec-poll' ? runId : null, state: 'starting', connection: 'unknown', startedAt: new Date(t0).toISOString(),
      commandSha256: '', exitCode: null, timeoutSecs, stopAt, binding });
    try {
      const claimed = await this.ledger.claim(runId, agentId, agentType);
      if (!claimed) throw new RuosError('policy-denied', `run ${runId} is already claimed`);
      await this.ledger.registerAgent(agentId, agentType, host, o.prompt);
      this.ledger.snapshotHosts([desktop]);
      this.ledger.setHostAgent(desktop.id, agentId, true);
    } catch (err) {
      // No remote launch was attempted. A refusal remains recorded and cannot be retried under the same run identity.
      this.runs.update(runId, { state: 'stopped', error: 'ledger-refused' });
      throw err;
    }

    /** @type {Stream} */
    const st = { bytes: 0, firstOutputMs: null, offset: 0 };
    let dispatchMs = 0;
    /** @type {RunOutcome['status']} */ let status = 'failed';
    /** @type {number|null} */ let exitCode = null;
    let commandSha256 = '';
    let jobId = runId;
    let launchAttempted = false;
    try {
      desktop = await this.ensureUp(desktop, { allowStart: o.allowStart });
      await this.checkLlmRoute();
      launchAttempted = true;
      const started = await this.startWithBackoff(desktop, { runId, prompt: o.prompt, runner: 'claude', model: o.model, maxBudgetUsd: o.maxBudgetUsd, timeoutSecs });
      jobId = started.jobId;
      commandSha256 = started.commandSha256;
      // Persist the server's actual identity before the first poll. A lost acknowledgement leaves an uncertain record, never a restart.
      this.runs.update(runId, { jobId, state: 'running', connection: 'healthy', commandSha256 });
      dispatchMs = this.now() - t0;
      this.ledger.event({ type: 'run.started', runId, agentId, desktopId: desktop.id, desktopName: name });
      if (desktop.flyMachineId) {
        await this.fleet.keepAwake(desktop.flyMachineId, Math.min(1440, Math.ceil(timeoutSecs / 60) + 5)).catch(() => {
          this.ledger.warnings.push('keepawake failed; idle autosleep may stop the run');
        });
      }
      const end = await this.stream(desktop, jobId, runId, agentId, st, { t0, timeoutSecs, signal: o.signal, onOutput: o.onOutput });
      status = end.status;
      exitCode = end.exitCode;
    } catch (err) {
      if (!launchAttempted) {
        this.runs.update(runId, { state: 'stopped', error: err instanceof RuosError ? err.code : 'preflight-failed' });
        await this.finish(desktop.id, agentId, agentType, runId, 'stopped', null, 0);
        throw err;
      }
      const e = await this.classifyMidRun(desktop, err);
      this.uncertain(runId, agentId, desktop.id, e);
      this.audit({ runId, jobId, desktopId: desktop.id, agentId, commandSha256, t0, status: 'unknown', exitCode: null, bytes: st.bytes, error: e.code });
      // Transport loss is not execution failure. Keep the claim and placement until the host reports a terminal outcome.
      throw e;
    }
    this.runs.update(runId, { state: status, connection: 'healthy', exitCode });
    this.ledger.event({
      type: status === 'stopped' ? 'run.stopped' : status === 'completed' ? 'run.completed' : 'run.failed',
      runId, agentId, desktopId: desktop.id, exitCode, bytes: st.bytes,
    });
    this.audit({ runId, jobId, desktopId: desktop.id, agentId, commandSha256, t0, status, exitCode, bytes: st.bytes });
    await this.finish(desktop.id, agentId, agentType, runId, status, exitCode, st.bytes);
    return {
      runId, agentId, desktopId: desktop.id, status, exitCode, bytes: st.bytes, dispatchMs, firstOutputMs: st.firstOutputMs,
      totalMs: this.now() - t0, swarmLedger: this.ledger.swarmLedger, stopAt, jobs: this.jobs.kind, warnings: [...this.ledger.warnings],
    };
  }

  /**
   * Poll a job to a terminal state with adaptive backoff (1 s while output
   * flows, up to 10 s when idle). Each exec poll is audited on ruOS and
   * waits behind the desktop's run lock, so idle polling must stay sparse.
   * @param {import('./types.mjs').Desktop} desktop
   * @param {string} jobId
   * @param {string} runId
   * @param {string} agentId
   * @param {Stream} st
   * @param {{ t0: number, timeoutSecs: number, signal?: AbortSignal, onOutput?: (c: Buffer) => void, observer?: boolean }} o
   * @returns {Promise<{ status: RunOutcome['status'], exitCode: number|null }>}
   */
  async stream(desktop, jobId, runId, agentId, st, o) {
    let delay = POLL_MIN_MS;
    let lostOnce = false;
    /** @type {number|null} */ let cancelAt = null;
    for (;;) {
      if (o.signal?.aborted && cancelAt === null) {
        // Cancel, then keep draining: the job API keeps output written
        // before the cancel and ends `cancelled` (exit 143, SIGTERM).
        await this.jobs.cancel(desktop, jobId).catch(() => false);
        cancelAt = this.now();
      }
      if (cancelAt !== null && this.now() - cancelAt > CANCEL_DRAIN_MS) {
        throw new RuosError('reconciliation-required', 'stop requested but no terminal acknowledgement; attach to reconcile');
      }
      if (this.now() - o.t0 > o.timeoutSecs * 1000) {
        if (o.observer) throw new RuosError('observer-detached', 'observer wait ended; remote job was not cancelled');
        await this.jobs.cancel(desktop, jobId).catch(() => false);
        throw new RuosError('timeout', `run exceeded ${o.timeoutSecs}s and was stopped`);
      }
      const polledAt = this.now();
      const p = await this.jobs.poll(desktop, jobId, st.offset);
      const before = this.runs.required(runId);
      if ((before.connection !== 'healthy' || this.now() - Date.parse(before.updatedAt) >= 60_000) && p.state !== 'lost' && p.state !== 'stopped') {
        this.runs.update(runId, { connection: 'healthy', ...(['queued', 'running'].includes(p.state) && before.state !== 'stopping' ? { state: 'running' } : {}) });
      }
      const nextOffset = Math.max(st.offset + p.chunk.length, p.nextOffset);
      // One durable transaction commits output and its cursor before notifying a client. Duplicate observers are fenced by expectedOffset.
      if (nextOffset !== st.offset || p.chunk.length) this.runs.checkpoint(runId, { expectedOffset: st.offset, nextOffset, chunk: p.chunk });
      if (p.chunk.length > 0) {
        if (st.firstOutputMs === null) st.firstOutputMs = this.now() - o.t0;
        st.bytes += p.chunk.length;
        o.onOutput?.(p.chunk);
        this.ledger.event({ type: 'run.output', runId, agentId, desktopId: desktop.id, bytes: p.chunk.length });
      }
      st.offset = nextOffset;
      if (p.truncated) this.ledger.warnings.push('job output exceeded the server cap; tail truncated');
      if (p.chunk.length > 0) { delay = POLL_MIN_MS; continue; }
      if (TERMINAL.has(p.state)) {
        // `exited` carries any exit code (ADR-105): only 0 is completed.
        // `cancelled` (exit 143) is a stop, never a failure.
        const status = p.state === 'cancelled' || cancelAt !== null ? 'stopped' : p.state === 'exited' && p.exitCode === 0 ? 'completed' : 'failed';
        return { status, exitCode: p.exitCode };
      }
      if (p.state === 'stopped') {
        throw new RuosError('auto-stopped', `desktop stopped mid-run; HOME persists — wake it and \`attach --run ${runId}\` to read the output`);
      }
      if (p.state === 'lost') {
        if (lostOnce) throw new RuosError('reconciliation-required', 'runner has no exit receipt; outcome is unknown, attach to reconcile');
        lostOnce = true; // exit.code is written just after the runner exits: re-check once
        continue;
      }
      // With long-poll the server already waited (wait_ms); only guard against
      // a server that answers instantly so the loop never spins.
      if (this.jobs.longPoll && this.now() - polledAt >= POLL_MIN_MS) continue;
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, POLL_MAX_MS);
    }
  }

  /** Persist an uncertain outcome without removing the execution claim. @param {string} runId @param {string} agentId @param {string} desktopId @param {RuosError} error */
  uncertain(runId, agentId, desktopId, error) {
    const disconnected = ['network-down', 'auth-expired', 'insufficient-scope', 'auto-stopped', 'desktop-stopped'].includes(error.code);
    const previous = this.runs.required(runId);
    this.runs.update(runId, { state: disconnected && ['running', 'stopping'].includes(previous.state) ? previous.state : 'unknown', connection: disconnected ? 'disconnected' : 'unknown', error: error.code });
    this.ledger.event({ type: disconnected ? 'run.disconnected' : 'run.unknown', runId, agentId, desktopId, error: error.code });
  }

  /**
   * Reconnect to the recorded job and committed cursor. Observation never launches, wakes, restarts or cancels remote work.
   * @param {{ desktop?: string, runId: string, agentId?: string, offset?: number, timeoutSecs?: number, onOutput?: (c: Buffer) => void }} o
   */
  async attach(o) {
    const runId = assertRunId(o.runId);
    const saved = this.runs.required(runId);
    if (saved.jobs !== this.jobs.kind || saved.transport !== this.transportKind) throw new RuosError('binding-mismatch', 'select the original jobs and exec transport before attaching');
    if (saved.jobId === null) throw new RuosError('reconciliation-required', 'launch acknowledgement was lost; resolve the existing job by its run id on the host before attaching; never launch again');
    if (o.agentId !== undefined && o.agentId !== saved.agentId) throw new RuosError('binding-mismatch', 'agent does not match the saved run');
    if (o.offset !== undefined && o.offset !== saved.nextOffset) throw new RuosError('revision-conflict', 'attach uses the durable cursor; use logs to replay earlier output');
    const timeoutSecs = assertInt(o.timeoutSecs ?? 300, 1, 6 * 3600, 'timeoutSecs');
    const desktop = await this.resolve(o.desktop ?? saved.desktopId);
    if (desktop.id !== saved.desktopId) throw new RuosError('binding-mismatch', 'desktop does not match the saved run');
    if (['completed', 'failed', 'stopped'].includes(saved.state)) return { runId, desktopId: desktop.id, status: saved.state, exitCode: saved.exitCode, bytes: 0, offset: saved.nextOffset };
    /** @type {Stream} */
    const st = { bytes: 0, firstOutputMs: null, offset: saved.nextOffset };
    this.ledger.event({ type: 'run.attached', runId, agentId: saved.agentId, desktopId: desktop.id });
    try {
      const end = await this.stream(desktop, saved.jobId, runId, saved.agentId, st, { t0: this.now(), timeoutSecs, onOutput: o.onOutput, observer: true });
      const latest = this.runs.update(runId, { state: end.status, connection: 'healthy', exitCode: end.exitCode });
      this.ledger.event({ type: end.status === 'completed' ? 'run.completed' : end.status === 'stopped' ? 'run.stopped' : 'run.failed', runId, agentId: saved.agentId, desktopId: desktop.id, exitCode: end.exitCode, bytes: st.bytes });
      await this.finish(desktop.id, saved.agentId, saved.agentType, runId, end.status, end.exitCode, latest.localBytes);
      return { runId, desktopId: desktop.id, ...end, bytes: st.bytes, offset: st.offset };
    } catch (err) {
      if (err instanceof RuosError && err.code === 'observer-detached') {
        this.ledger.event({ type: 'run.detached', runId, agentId: saved.agentId, desktopId: desktop.id });
        return { runId, desktopId: desktop.id, status: 'detached', exitCode: null, bytes: st.bytes, offset: st.offset };
      }
      // A competing reader can advance the cursor; it is not a remote failure and must not downgrade its newer state.
      if (err instanceof RuosError && ['revision-conflict', 'run-busy'].includes(err.code)) throw err;
      const e = await this.classifyMidRun(desktop, err);
      this.uncertain(runId, saved.agentId, desktop.id, e);
      throw e;
    }
  }

  /**
   * ruflo's own per-run audit record: the detached process's output is not
   * in the ruOS activity feed (ruOS ADR-045 covers only chat-proxy runs).
   * @param {{ runId: string, jobId: string, desktopId: string, agentId: string, commandSha256: string, t0: number, status: string, exitCode: number|null, bytes: number, error?: string }} r
   */
  audit(r) {
    this.ledger.audit({
      runId: r.runId, jobId: r.jobId, desktopId: r.desktopId, agentId: r.agentId, jobs: this.jobs.kind,
      commandSha256: r.commandSha256, startedAt: new Date(r.t0).toISOString(), endedAt: new Date(this.now()).toISOString(),
      status: r.status, exitCode: r.exitCode, bytes: r.bytes, ...(r.error ? { error: r.error } : {}),
    });
  }

  /**
   * @param {string} desktopId
   * @param {string} agentId
   * @param {string} agentType
   * @param {string} runId
   * @param {string} status
   * @param {number|null} exitCode
   * @param {number} bytes
   */
  async finish(desktopId, agentId, agentType, runId, status, exitCode, bytes) {
    this.ledger.setHostAgent(desktopId, agentId, false);
    await this.ledger.updateAgent(agentId, 'idle', { runId, status, exitCode, bytes });
    await this.ledger.release(runId, agentId, agentType);
  }

  /**
   * Request stop for the exact persisted run revision and source binding. Acknowledgement is reconciled by attach.
   * @param {{ desktop?: string, runId: string, jobId?: string, confirm?: boolean, expectedRevision?: number, bindingDigest?: string }} o
   */
  async stopRun(o) {
    if (!o.confirm) throw new RuosError('confirm-required', 'stopping a run interrupts work; pass --confirm');
    const runId = assertRunId(o.runId);
    const saved = this.runs.required(runId);
    if (saved.jobs !== this.jobs.kind || saved.transport !== this.transportKind) throw new RuosError('binding-mismatch', 'stop must use the original transport');
    if (saved.jobId === null) throw new RuosError('reconciliation-required', 'job identity is not acknowledged; reconcile it on the host before stopping');
    if (o.jobId !== undefined && o.jobId !== saved.jobId) throw new RuosError('binding-mismatch', 'job id does not match the saved run');
    const desktop = await this.resolve(o.desktop ?? saved.desktopId);
    if (desktop.id !== saved.desktopId) throw new RuosError('binding-mismatch', 'desktop does not match the saved run');
    this.runs.requestStop(runId, o.expectedRevision, o.bindingDigest);
    try {
      const stopped = await this.jobs.cancel(desktop, saved.jobId);
      this.ledger.event({ type: 'run.stop-requested', runId, desktopId: desktop.id, state: stopped ? 'requested' : 'not-running' });
      return { runId, desktopId: desktop.id, stopped, acknowledgement: 'pending' };
    } catch (err) {
      const e = await this.classifyMidRun(desktop, err);
      this.uncertain(runId, saved.agentId, desktop.id, e);
      throw e;
    }
  }

  /**
   * Stop the whole desktop — explicit confirm required (discards in-memory state).
   * @param {{ desktop: string, confirm?: boolean }} o
   */
  async stopDesktop(o) {
    if (!o.confirm) throw new RuosError('confirm-required', 'stopping a desktop interrupts all work on it; pass --confirm');
    const desktop = await this.resolve(o.desktop);
    await this.fleet.stop(desktop.id);
    this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'stopping' });
    return { desktopId: desktop.id };
  }
}
