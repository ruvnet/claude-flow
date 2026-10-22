// @ts-check
/**
 * Shared types and the typed error for ruflo-ruos (ADR-405).
 *
 * Plain .mjs with JSDoc so the plugin needs no build step; `tsc --checkJs`
 * type-checks it (see scripts/typecheck.sh).
 */

/**
 * A desktop the caller owns, normalised from the fleet `desktop_status` tool.
 * @typedef {object} Desktop
 * @property {string} id              fleet registry machine id (32 hex)
 * @property {string|null} flyMachineId  Fly machine id (14 hex) or null for enrolled endpoints
 * @property {string} name
 * @property {string|null} displayName
 * @property {string|null} state       last observed Fly run state ('started', 'stopped', ...)
 * @property {string|null} heartbeatStatus  'asleep' | 'stale' | 'missing' | other (live)
 * @property {number|null} heartbeatAt  unix seconds of the last heartbeat
 * @property {boolean} ready           provisioning flag — NOT liveness
 */

/**
 * The single seam between the adapter and a remote desktop. Both transports
 * run the same one-line shell strings produced by command-builder.mjs.
 * @typedef {object} ExecResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {boolean=} truncated   the fleet head-capped stdout
 */

/**
 * @typedef {object} Transport
 * @property {'fleet-mcp'|'ssh'} kind
 * @property {(desktop: Desktop, command: string, timeoutSecs: number) => Promise<ExecResult>} exec
 */

/**
 * Fleet control-plane calls (always the tenant-authenticated fleet MCP).
 * @typedef {object} Fleet
 * @property {() => Promise<Desktop[]>} listDesktops
 * @property {(id: string) => Promise<void>} start
 * @property {(id: string) => Promise<void>} stop
 * @property {(flyMachineId: string|null, minutes: number) => Promise<void>} keepAwake
 * @property {() => Promise<{ route: string|null, provider: string|null, gateway: string|null, keyPresent: boolean }>} llmRoute
 */

/**
 * A detached job on a desktop. Two implementations (jobs.mjs):
 * ExecPollTransport (nohup + offset polling over desktop_exec, available
 * now) and JobsApiTransport (ruOS ADR-105 jobs API, feature-detected).
 * @typedef {object} JobStart
 * @property {string} jobId
 * @property {string} commandSha256   hash of the launched command (audit record)
 */
/**
 * @typedef {'queued'|'running'|'exited'|'failed'|'cancelled'|'stopped'|'lost'} JobState
 */
/**
 * @typedef {object} JobPoll
 * @property {Buffer} chunk
 * @property {number} nextOffset
 * @property {boolean} running
 * @property {JobState} state
 * @property {number|null} exitCode
 * @property {boolean} truncated
 */
/**
 * @typedef {object} JobTransport
 * @property {'exec-poll'|'jobs-api'} kind
 * @property {boolean=} longPoll   poll() itself waits server-side; no client sleep between polls
 * @property {(desktop: Desktop, spec: RunSpec & { timeoutSecs: number }) => Promise<JobStart>} start
 * @property {(desktop: Desktop, jobId: string, offset: number) => Promise<JobPoll>} poll
 * @property {(desktop: Desktop, jobId: string) => Promise<boolean>} cancel
 */

/**
 * What the swarm ledger records about one remote agent.
 * @typedef {object} HostRef
 * @property {'ruos'} kind
 * @property {string} desktopId
 * @property {string} desktopName
 * @property {'fleet-mcp'|'ssh'} transport
 * @property {'exec-poll'|'jobs-api'=} jobs
 * @property {string} runId
 * @property {string|null=} stopAt   next forced 23:00 America/Toronto stop (cloud desktops)
 */

/**
 * @typedef {object} RunSpec
 * @property {string} runId
 * @property {string} prompt
 * @property {'claude'} runner
 * @property {('haiku'|'sonnet'|'opus')=} model
 * @property {number=} maxBudgetUsd
 */

/**
 * @typedef {'run.started'|'run.output'|'run.completed'|'run.failed'|'run.stopped'|'desktop.state'} EventType
 */

/**
 * Event-log row. Carries ids, sizes and states only — never prompt text or
 * agent output (those stay in the per-run local log, mode 0600).
 * @typedef {object} RuosEvent
 * @property {string} ts
 * @property {EventType} type
 * @property {string=} runId
 * @property {string=} agentId
 * @property {string=} desktopId
 * @property {string=} desktopName
 * @property {number=} bytes
 * @property {number|null=} exitCode
 * @property {string=} error
 * @property {string=} state
 */

/** @typedef {'not-configured'|'invalid-input'|'not-owned'|'ambiguous'|'confirm-required'|'auth-expired'|'network-down'|'desktop-stopped'|'auto-stopped'|'autostop-window'|'tool-error'|'remote-error'|'timeout'|'insufficient-scope'|'capacity'|'llm-unconfigured'} RuosErrorCode */

export class RuosError extends Error {
  /**
   * @param {RuosErrorCode} code
   * @param {string} message
   * @param {unknown=} cause
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'RuosError';
    /** @type {RuosErrorCode} */
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
