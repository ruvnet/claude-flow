// @ts-check
/** London-school test doubles for ruflo-ruos (ADR-405). */

export const DESKTOP_ID = '43faac2ae346b16fafdd7c6b70061294';
export const FLY_ID = '85050dc77130e8';
export const OTHER_ID = '59fc0c7fcdd873c1eba47092dfee29e2';

/**
 * @param {Partial<import('../scripts/lib/types.mjs').Desktop>=} o
 * @returns {import('../scripts/lib/types.mjs').Desktop}
 */
export function desktop(o = {}) {
  return {
    id: DESKTOP_ID,
    flyMachineId: FLY_ID,
    name: 'ruos-work',
    displayName: 'Work Desktop',
    state: 'started',
    heartbeatStatus: 'ok',
    heartbeatAt: Math.floor(Date.UTC(2026, 9, 1, 15, 0, 0) / 1000),
    ready: true,
    ...o,
  };
}

/** A clock that only moves when sleep() is called or tick() is used. */
export function fakeClock(startMs = Date.UTC(2026, 9, 1, 15, 0, 0)) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => { t += ms; },
    tick: (/** @type {number} */ ms) => { t += ms; },
  };
}

/**
 * @param {import('../scripts/lib/types.mjs').Desktop[]|(() => import('../scripts/lib/types.mjs').Desktop[])} desktops
 */
export function fakeFleet(desktops) {
  /** @type {Array<[string, unknown[]]>} */
  const calls = [];
  return {
    calls,
    listDesktops: async () => { calls.push(['listDesktops', []]); return typeof desktops === 'function' ? desktops() : desktops; },
    start: async (/** @type {string} */ id) => { calls.push(['start', [id]]); },
    stop: async (/** @type {string} */ id) => { calls.push(['stop', [id]]); },
    keepAwake: async (/** @type {string|null} */ f, /** @type {number} */ m) => { calls.push(['keepAwake', [f, m]]); },
    llmRoute: async () => { calls.push(['llmRoute', []]); return { route: 'shared', provider: 'cognitum', gateway: 'unconfigured', keyPresent: false }; },
  };
}

/**
 * The marker nonce a builder command was made with (see command-builder say()).
 * @param {string} cmd
 */
export const nonceOf = (cmd) => /'RUOS%s_[A-Z_]+[^']*' '([0-9a-f]{16})'/.exec(cmd)?.[1] ?? null;

/**
 * A scripted transport: `respond(command)` returns the ExecResult or throws.
 * Fixtures write markers as `RUOS_NAME`; they are rewritten to the command's
 * `RUOS<nonce>_NAME` the way a real desktop would print them.
 * @param {(cmd: string, n: number) => import('../scripts/lib/types.mjs').ExecResult | Promise<import('../scripts/lib/types.mjs').ExecResult>} respond
 */
export function fakeTransport(respond) {
  /** @type {string[]} */
  const commands = [];
  return {
    kind: /** @type {'fleet-mcp'} */ ('fleet-mcp'),
    commands,
    exec: async (/** @type {any} */ _d, /** @type {string} */ cmd) => {
      commands.push(cmd);
      const r = await respond(cmd, commands.length);
      const n = nonceOf(cmd);
      return n ? { ...r, stdout: r.stdout.replace(/^RUOS_/gm, `RUOS${n}_`) } : r;
    },
  };
}

/** @param {string} stdout */
export const ok = (stdout) => ({ stdout, stderr: '', exitCode: 0 });

export function fakeLedger() {
  /** @type {Array<[string, unknown[]]>} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  /** @type {Buffer[]} */
  const output = [];
  return {
    calls, events, output,
    swarmLedger: /** @type {'cli'} */ ('cli'),
    warnings: /** @type {string[]} */ ([]),
    registerAgent: async (/** @type {unknown[]} */ ...a) => { calls.push(['registerAgent', a]); },
    updateAgent: async (/** @type {unknown[]} */ ...a) => { calls.push(['updateAgent', a]); },
    terminateAgent: async (/** @type {unknown[]} */ ...a) => { calls.push(['terminateAgent', a]); },
    claim: async (/** @type {unknown[]} */ ...a) => { calls.push(['claim', a]); return true; },
    release: async (/** @type {unknown[]} */ ...a) => { calls.push(['release', a]); },
    event: (/** @type {any} */ e) => { events.push(e); },
    snapshotHosts: (/** @type {unknown[]} */ ...a) => { calls.push(['snapshotHosts', a]); },
    setHostAgent: (/** @type {unknown[]} */ ...a) => { calls.push(['setHostAgent', a]); },
    appendOutput: (/** @type {string} */ _r, /** @type {Buffer} */ c) => { output.push(c); },
    audits: /** @type {any[]} */ ([]),
    audit(/** @type {any} */ r) { this.audits.push(r); },
  };
}
