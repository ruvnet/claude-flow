// @ts-check
/**
 * Swarm ledger (ADR-405 §Swarm state and claims).
 *
 * Remote agents are recorded through ruflo's EXISTING paths, called
 * in-process via `callMCPTool` (so ADR-324 policy applies to every write):
 *   - agent store:  agent_spawn / agent_update / agent_terminate
 *                   (`.claude-flow/agents/store.json`), host in `config.host`
 *   - work claims:  claims_claim / claims_release (`.claude-flow/claims/`)
 * No new claims system and no direct writes into those stores.
 *
 * The plugin additionally owns `.claude-flow/ruos/`:
 *   events.jsonl  append-only lifecycle events (ids/sizes/states only)
 *   audit.jsonl   one record per run: runId, desktop, command sha256,
 *                 start/end, exit, bytes (ruOS does not audit detached output)
 *   hosts.json    snapshot of the caller's desktops + which agents run there
 *   runs/<id>.log local copy of the remote output (mode 0600)
 * If ruflo's CLI cannot be resolved, or policy denies a call, the ledger
 * degrades to these plugin files and reports `swarmLedger: 'unavailable'`.
 */
import { appendFileSync, mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {(name: string, input: Record<string, unknown>) => Promise<any>} CallTool
 */

/**
 * @typedef {object} Ledger
 * @property {'cli'|'unavailable'} swarmLedger
 * @property {(agentId: string, agentType: string, host: import('./types.mjs').HostRef, task: string) => Promise<void>} registerAgent
 * @property {(agentId: string, status: 'busy'|'idle', lastResult?: Record<string, unknown>) => Promise<void>} updateAgent
 * @property {(agentId: string) => Promise<void>} terminateAgent
 * @property {(runId: string, agentId: string, agentType: string) => Promise<boolean>} claim
 * @property {(runId: string, agentId: string, agentType: string) => Promise<void>} release
 * @property {(e: Omit<import('./types.mjs').RuosEvent, 'ts'>) => void} event
 * @property {(desktops: import('./types.mjs').Desktop[]) => void} snapshotHosts  merge host state, keep agent placements
 * @property {(desktopId: string|null, agentId: string, present: boolean) => void} setHostAgent  null desktopId + present=false removes the agent from every host
 * @property {(runId: string, chunk: Buffer) => void} appendOutput
 * @property {(record: Record<string, unknown>) => void} audit  per-run record → audit.jsonl (no prompt/output text)
 * @property {string[]} warnings
 */

/**
 * Same project-root rule as ruflo's getProjectCwd(), so the plugin's files
 * land beside the agent and claims stores it writes through.
 * @param {NodeJS.ProcessEnv} env
 */
export function projectCwd(env) {
  const e = env.CLAUDE_FLOW_CWD;
  return e && e !== '/' && e !== env.HOME ? e : process.cwd();
}

/**
 * Locate ruflo's in-process tool dispatcher without depending on it.
 * The dispatcher is imported, so it resolves from this plugin's own install
 * (or an explicit RUFLO_CLI_MCP_CLIENT), never from the project cwd.
 * @param {string} cwd  kept for callers; not used for module resolution
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<CallTool|null>}
 */
export async function resolveCallTool(cwd, env) {
  const candidates = [];
  if (env.RUFLO_CLI_MCP_CLIENT) candidates.push(env.RUFLO_CLI_MCP_CLIENT);
  try {
    const req = createRequire(import.meta.url);
    for (const pkg of ['@claude-flow/cli', 'ruflo', 'claude-flow']) {
      try {
        const pj = req.resolve(`${pkg}/package.json`);
        const base = pkg === '@claude-flow/cli' ? pj.replace(/package\.json$/, '') : null;
        if (base) candidates.push(join(base, 'dist/src/mcp-client.js'));
        else candidates.push(join(pj.replace(/package\.json$/, ''), 'node_modules/@claude-flow/cli/dist/src/mcp-client.js'));
      } catch { /* not installed here */ }
    }
  } catch { /* createRequire failed */ }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.callMCPTool === 'function') return mod.callMCPTool;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * @param {{ cwd: string, callTool: CallTool|null, now?: () => Date }} o
 * @returns {Ledger}
 */
export function createLedger({ cwd, callTool, now = () => new Date() }) {
  const dir = join(cwd, '.claude-flow', 'ruos');
  const runsDir = join(dir, 'runs');
  /** @type {string[]} */
  const warnings = [];
  let available = callTool !== null;

  const ensure = () => mkdirSync(runsDir, { recursive: true, mode: 0o700 });

  /**
   * Call a ruflo tool; on policy denial / missing tool, degrade instead of
   * failing the remote run.
   * @param {string} name
   * @param {Record<string, unknown>} input
   */
  const safeCall = async (name, input) => {
    if (!available || !callTool) return null;
    try {
      const r = await callTool(name, input);
      if (r && r.success === false) {
        warnings.push(`${name}: ${String(r.error ?? 'failed').slice(0, 160)}`);
        return r;
      }
      return r;
    } catch (err) {
      const msg = String(/** @type {Error} */ (err)?.message ?? err);
      warnings.push(`${name}: ${msg.slice(0, 160)}`);
      if (/not found|policy-/i.test(msg)) available = false;
      return null;
    }
  };

  /**
   * Read-merge-write hosts.json so a discovery never drops agent placements
   * and a run never drops the other hosts.
   * @param {(hosts: Map<string, any>) => void} mutate
   */
  const writeHosts = (mutate) => {
    ensure();
    const file = join(dir, 'hosts.json');
    /** @type {Map<string, any>} */
    const hosts = new Map();
    try {
      for (const h of JSON.parse(readFileSync(file, 'utf8')).hosts ?? []) hosts.set(h.desktopId, h);
    } catch { /* first write or unreadable: start fresh */ }
    mutate(hosts);
    const tmp = join(dir, `hosts.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ updatedAt: now().toISOString(), hosts: [...hosts.values()] }, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };

  /** @type {Ledger} */
  const ledger = {
    get swarmLedger() { return available ? 'cli' : 'unavailable'; },
    warnings,
    async registerAgent(agentId, agentType, host, task) {
      await safeCall('agent_spawn', {
        agentType,
        agentId,
        domain: 'ruos',
        config: { host, remote: true, taskSummary: task.slice(0, 120) },
      });
      await safeCall('agent_update', { agentId, status: 'busy' });
    },
    async updateAgent(agentId, status, lastResult) {
      await safeCall('agent_update', { agentId, status, ...(lastResult ? { config: { lastRemoteResult: lastResult } } : {}) });
    },
    async terminateAgent(agentId) {
      await safeCall('agent_terminate', { agentId });
    },
    async claim(runId, agentId, agentType) {
      const r = await safeCall('claims_claim', { issueId: `ruos-run-${runId}`, claimant: `agent:${agentId}:${agentType}` });
      return r === null || r.success !== false;
    },
    async release(runId, agentId, agentType) {
      await safeCall('claims_release', { issueId: `ruos-run-${runId}`, claimant: `agent:${agentId}:${agentType}` });
    },
    event(e) {
      ensure();
      appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ ts: now().toISOString(), ...e }) + '\n', { mode: 0o600 });
    },
    snapshotHosts(desktops) {
      writeHosts((hosts) => {
        for (const d of desktops) {
          const prev = hosts.get(d.id);
          hosts.set(d.id, {
            desktopId: d.id,
            name: d.displayName ?? d.name,
            state: d.state,
            heartbeatStatus: d.heartbeatStatus,
            // ISO string: the swarm pane (ruflo-swarm #3607) renders its age.
            heartbeatAt: d.heartbeatAt === null ? null : new Date(d.heartbeatAt * 1000).toISOString(),
            agents: prev ? prev.agents : [],
          });
        }
      });
    },
    setHostAgent(desktopId, agentId, present) {
      writeHosts((hosts) => {
        if (desktopId === null) {
          for (const [id, h] of hosts) hosts.set(id, { ...h, agents: h.agents.filter((/** @type {string} */ a) => a !== agentId) });
          return;
        }
        const h = hosts.get(desktopId) ?? { desktopId, name: desktopId, state: null, heartbeatStatus: null, heartbeatAt: null, agents: [] };
        const rest = h.agents.filter((/** @type {string} */ a) => a !== agentId);
        hosts.set(desktopId, { ...h, agents: present ? [...rest, agentId] : rest });
      });
    },
    audit(record) {
      ensure();
      appendFileSync(join(dir, 'audit.jsonl'), JSON.stringify({ ts: now().toISOString(), ...record }) + '\n', { mode: 0o600 });
    },
    appendOutput(runId, chunk) {
      ensure();
      appendFileSync(join(runsDir, `${runId}.log`), chunk, { mode: 0o600 });
    },
  };
  return ledger;
}
