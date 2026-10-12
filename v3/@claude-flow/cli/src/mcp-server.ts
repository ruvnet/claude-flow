/**
 * V3 CLI MCP Server Management
 *
 * Provides server lifecycle management for MCP integration:
 * - Start/stop/status methods with process management
 * - Health check endpoint integration
 * - Graceful shutdown handling
 * - PID file management for daemon detection
 * - Event-based status monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Health check: <10ms
 * - Graceful shutdown: <5s
 *
 * @module @claude-flow/cli/mcp-server
 * @version 3.0.0
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import { createServer, Server, request as httpRequestFn } from 'http';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { trackRequest } from './mcp-tools/request-tracker.js';
import {
  isPolicyEnforcementEnabled,
  loadMcpPolicy,
  evaluateToolCall,
} from './mcp-tools/policy-enforcer.js';

/** A failed task can be valid data; only an explicit error denotes tool failure. */
function hasToolError(result: unknown): boolean {
  return result !== null && typeof result === 'object'
    && typeof (result as { error?: unknown }).error === 'string'
    && (result as { error: string }).error.trim().length > 0;
}

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * MCP Server configuration
 */
export interface MCPServerOptions {
  transport?: 'stdio' | 'http' | 'websocket';
  host?: string;
  port?: number;
  pidFile?: string;
  logFile?: string;
  tools?: string[] | 'all';
  daemonize?: boolean;
  timeout?: number;
  requestTimeoutMs?: number;
  /**
   * Bearer token every HTTP request must present (`Authorization: Bearer <token>`).
   * http transport only. Prefer RUFLO_MCP_HTTP_TOKEN / a token file over this
   * field's CLI flag so the secret stays out of argv. Never logged or emitted.
   */
  authToken?: string;
}

/**
 * MCP Server status
 */
export interface MCPServerStatus {
  running: boolean;
  pid?: number;
  transport?: string;
  host?: string;
  port?: number;
  uptime?: number;
  tools?: number;
  startedAt?: string;
  health?: {
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  };
}

/**
 * Durable identity of the instance that wrote the PID record (#3364).
 *
 * A PID is liveness evidence, not identity. The number only means anything in
 * the PID namespace that issued it, and the OS hands it out again once the
 * process is reaped, so `kill -0` alone cannot tell "the server we recorded"
 * from "whatever now holds that number". The record therefore carries what
 * stays true for one instance — host, OS, Linux PID namespace and kernel boot,
 * and the owner's own process start time — and a recorded PID is believed only
 * while all of it still matches. Same identity model as #3363 for the policy
 * lock (`src/services/policy-runtime.ts`), which compares the lock's bytes
 * rather than a stat triple for the same reason.
 */
interface PidFileIdentity {
  v: 1;
  pid: number;
  host: string;
  platform: string;
  pidns?: string;
  boot?: string;
  start?: string;
  transport?: string;
  port?: number;
  startedAt?: string;
}

interface PidFileRecord {
  pid: number;
  raw: string;
  identity?: PidFileIdentity;
}

/**
 * Linux PID namespace of this process, e.g. `pid:[4026531836]`; undefined on
 * other platforms or without /proc. A PID from another namespace (a container,
 * a `bwrap --unshare-pid` sandbox) names a different process here.
 */
const PID_NAMESPACE = ((): string | undefined => {
  try {
    return fs.readlinkSync('/proc/self/ns/pid');
  } catch {
    return undefined;
  }
})();

/**
 * Linux boot id: one uuid per kernel boot, shared by every process on that
 * kernel and readable inside containers. `host` is only a name, and many
 * distributions keep /tmp across a reboot — ADR-071 already names
 * `/tmp/claude-flow-mcp.pid` as machine-wide on Linux — so without this a
 * record written before the machine came back up looks exactly like a live one.
 */
const BOOT_ID = ((): string | undefined => {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return undefined;
  }
})();

/**
 * A token that changes when a PID is handed to a different process: the
 * owner's start time.
 *
 * Linux reports it in /proc/<pid>/stat field 22 as clock ticks since boot,
 * which is durable together with BOOT_ID above. Elsewhere `ps -o lstart=`
 * reports an absolute wall-clock time, durable on its own. Returns undefined
 * where neither exists — on Windows, so PID reuse stays unqualified there,
 * exactly as isProcessRunning()'s process-name check already is.
 */
function processStartToken(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  // DA-CRIT-3: validate the PID numerically and pass it as an argv entry,
  // never interpolated into a shell string.
  const safePid = String(Math.floor(pid));
  try {
    // `pid (comm) state ppid ...` — comm is parenthesised and may itself
    // contain spaces and parentheses, so parse after the last ')'.
    const stat = fs.readFileSync(`/proc/${safePid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const starttime = afterComm[19];
    if (starttime && /^\d+$/.test(starttime)) return starttime;
  } catch {
    // Not Linux, or no /proc — fall through to ps.
  }
  try {
    const lstart = execFileSync('ps', ['-p', safePid, '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim();
    return lstart || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hosts treated as same-machine-only for MCP HTTP tool-call authorization
 * purposes (see startHttpServer's non-loopback authorization gate below).
 * Deliberately exact-string matching only (no DNS resolution) so anything
 * not spelled exactly one of these three fails closed rather than open.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Exported for tests — see LOOPBACK_HOSTS. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Explicit, documented opt-out of the non-loopback authorization gate in
 * startHttpServer(). Exported for tests.
 */
export function isUnauthenticatedHttpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP;
  return v === '1' || v === 'true';
}

/**
 * The full startHttpServer() authorization gate, as a pure function:
 * true means "refuse to start" (see the thrown error for why).
 *
 * A non-loopback bind is allowed when requests are authenticated (a bearer
 * token is configured on the http transport) or the operator explicitly opts
 * out with RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1. Loopback binds are never
 * refused, with or without a token. Exported for tests.
 */
export function shouldRefuseUnauthenticatedHttp(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
  authenticated = false,
): boolean {
  return !isLoopbackHost(host) && !authenticated && !isUnauthenticatedHttpAllowed(env);
}

/** Printable ASCII without space (RFC 6750 token-ish), 16-512 chars. */
const AUTH_TOKEN_PATTERN = /^[\x21-\x7e]{16,512}$/;

/**
 * Resolve the HTTP bearer token. Precedence: explicit value (CLI flag), token
 * file, then RUFLO_MCP_HTTP_TOKEN. An unset/empty env var means "no token";
 * a token that is set but malformed throws, so a typo can never silently
 * start the server unauthenticated. Exported for tests.
 */
export function resolveMcpHttpAuthToken(
  input: { token?: string; tokenFile?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
): string | undefined {
  let raw: string | undefined;
  let source = '';
  if (input.token !== undefined) {
    raw = input.token;
    source = '--auth-token';
  } else if (input.tokenFile !== undefined) {
    source = '--auth-token-file';
    try {
      raw = readFile(input.tokenFile).replace(/\r?\n$/, '');
    } catch {
      throw new Error('Could not read the MCP HTTP auth token file given to --auth-token-file');
    }
  } else if (env.RUFLO_MCP_HTTP_TOKEN !== undefined && env.RUFLO_MCP_HTTP_TOKEN !== '') {
    raw = env.RUFLO_MCP_HTTP_TOKEN;
    source = 'RUFLO_MCP_HTTP_TOKEN';
  }
  if (raw === undefined) return undefined;
  if (!AUTH_TOKEN_PATTERN.test(raw)) {
    // The value is deliberately not echoed.
    throw new Error(
      `Invalid MCP HTTP auth token from ${source}: it must be 16-512 printable ASCII characters with no spaces`
    );
  }
  return raw;
}

/**
 * Default configuration
 */
type ResolvedMCPServerOptions = Required<Omit<MCPServerOptions, 'authToken'>> & { authToken?: string };

const DEFAULT_OPTIONS: ResolvedMCPServerOptions = {
  transport: 'stdio',
  host: 'localhost',
  port: 3000,
  pidFile: path.join(os.tmpdir(), 'claude-flow-mcp.pid'),
  logFile: path.join(os.tmpdir(), 'claude-flow-mcp.log'),
  tools: 'all',
  daemonize: false,
  timeout: 30000,
  requestTimeoutMs: 30000,
};

export function parseMcpToolSelection(value: string | undefined): string[] | 'all' {
  if (!value || value.trim().toLowerCase() === 'all') return 'all';
  const selectors = value.split(',').map((item) => item.trim()).filter(Boolean);
  return selectors.length > 0 ? selectors : 'all';
}

/**
 * Apply the existing `--tools` contract to advertised schemas. A selector can
 * be an exact tool name, a category, or a namespace prefix (`memory` matches
 * `memory_store`). Execution remains registered internally; only the fixed
 * per-request schema catalogue is reduced.
 */
export function filterAdvertisedMcpTools<T extends { name: string; category?: string }>(
  tools: T[],
  selection: string[] | 'all',
): T[] {
  if (selection === 'all') return tools;
  const selectors = new Set(selection.map((item) => item.toLowerCase()));
  return tools.filter((tool) => {
    const name = tool.name.toLowerCase();
    const category = tool.category?.toLowerCase();
    return selectors.has(name)
      || (category !== undefined && selectors.has(category))
      || Array.from(selectors).some((selector) => name.startsWith(`${selector}_`));
  });
}

export interface McpSchemaOverhead {
  toolCount: number;
  bytes: number;
  estimatedTokens: number;
  contextWindowTokens?: number;
  ratio?: number;
  risk: 'normal' | 'high';
}

/** Conservative JSON-size estimate for the fixed tools/list catalogue. */
export function assessMcpSchemaOverhead(
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  contextWindowTokens?: number,
): McpSchemaOverhead {
  const catalogue = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  const bytes = Buffer.byteLength(JSON.stringify(catalogue), 'utf8');
  const estimatedTokens = Math.ceil(bytes / 4);
  const validWindow = Number.isFinite(contextWindowTokens) && Number(contextWindowTokens) > 0
    ? Number(contextWindowTokens)
    : undefined;
  const ratio = validWindow ? estimatedTokens / validWindow : undefined;
  return {
    toolCount: tools.length,
    bytes,
    estimatedTokens,
    ...(validWindow === undefined ? {} : { contextWindowTokens: validWindow }),
    ...(ratio === undefined ? {} : { ratio }),
    risk: (ratio !== undefined ? ratio >= 0.2 : estimatedTokens >= 8_000)
      ? 'high'
      : 'normal',
  };
}

/**
 * MCP Server Manager
 *
 * Manages the lifecycle of the MCP server process
 */
export class MCPServerManager extends EventEmitter {
  private options: ResolvedMCPServerOptions;
  private process?: ChildProcess;
  private server?: Server;
  private startTime?: Date;
  private healthCheckInterval?: NodeJS.Timeout;
  private mcpServers: Array<{ stop(): Promise<void> }> = [];
  /**
   * This manager's own lifecycle (#3364). A stdio server keeps no PID record,
   * so nothing on disk can answer "is this manager running?" — only the
   * manager can. `idle` is a manager that has never started, and only there
   * does the #2934 fallback in getStatus() ("assume a client-launched stdio
   * server") apply; `stopped` is a handle on a server that is gone, and it
   * says so rather than reporting whatever PID the shared file happens to hold.
   */
  private lifecycle: 'idle' | 'running' | 'stopped' = 'idle';
  /**
   * The exact bytes this manager wrote to the PID file, while they are still
   * there (#3364). stop() retracts the record only while it is byte for byte
   * the one we wrote: the slot may have changed hands in between.
   */
  private ownedRecord: string | null = null;

  constructor(options: MCPServerOptions = {}) {
    super();
    // `options.tools`, populated by the `mcp start --tools` CLI flag, is
    // spread last below and therefore takes precedence over this env fallback.
    const environmentTools = parseMcpToolSelection(process.env.CLAUDE_FLOW_MCP_TOOLS);
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(environmentTools === 'all' ? {} : { tools: environmentTools }),
      ...options,
    };
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<MCPServerStatus> {
    // #3364: the PID file is a single slot per os.tmpdir() (per user on
    // macOS/Windows; the machine-wide /tmp on Linux unless TMPDIR is set), and
    // it records the port-bound (http/websocket) server, where a second
    // instance would conflict. A stdio server is owned by the client that
    // spawned it and any number run side by side (one per MCP client or
    // project), so a stdio server never claims that slot, and never refuses to
    // start over — or clears — a live server's record. ADR-071 made this
    // singleton safe against self-detection and PID reuse; a stdio server has
    // no business claiming it at all. What it does instead is track its own
    // lifecycle, because for a server that leaves no record that is the only
    // evidence there is.
    const usesPidFile = this.options.transport !== 'stdio';

    // Refuse to start a second port-bound server over a live one. The record
    // is read directly rather than through getStatus(), whose #2934 fallback
    // answers about this process, not about the recorded server — and whose
    // own PID would otherwise have to be filtered out again here.
    if (usesPidFile) {
      const record = await this.readPidRecord();
      if (record && this.recordedServerIsLive(record)) {
        if (record.pid !== process.pid) {
          throw new Error(`MCP Server already running (PID: ${record.pid})`);
        }
      } else if (record) {
        // Stale record — a dead PID, a PID since handed to another process, or
        // an identity from another host, kernel boot or PID namespace. Cleaned
        // up here, as the getStatus() call this replaced used to do.
        await this.removePidFile();
      }
    }

    const startTime = performance.now();
    this.startTime = new Date();

    this.emit('starting', { options: { ...this.options, authToken: this.options.authToken ? '[redacted]' : undefined } });

    try {
      if (this.options.transport === 'stdio') {
        // For stdio transport, spawn the server process
        await this.startStdioServer();
      } else {
        // For HTTP/WebSocket, start in-process server
        await this.startHttpServer();
      }
      this.lifecycle = 'running';

      const duration = performance.now() - startTime;

      // Write PID file, and remember the bytes so stop() retracts only ours
      if (usesPidFile) {
        this.ownedRecord = await this.writePidFile();
      }

      // Start health check monitoring
      this.startHealthMonitoring();

      const finalStatus = await this.getStatus();

      this.emit('started', {
        ...finalStatus,
        startupTime: duration,
      });

      return finalStatus;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(force = false): Promise<void> {
    const status = await this.getStatus();

    if (!status.running) {
      return;
    }

    this.emit('stopping', { force });

    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.process) {
        // Graceful shutdown
        if (!force) {
          this.process.kill('SIGTERM');
          await this.waitForExit(5000);
        }

        // Force kill if still running
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }

        this.process = undefined;
      }

      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => resolve());
        });
        this.server = undefined;
      }

      if (this.mcpServers.length > 0) {
        const servers = this.mcpServers;
        this.mcpServers = [];
        await Promise.all(servers.map((server) => server.stop()));
      }

      // #3364: retract the record only if this manager wrote it, and only
      // while it is still ours byte for byte — another server may have taken
      // the slot. A live stdio server wrote nothing, so it has nothing to
      // retract; a manager that never started — the one `mcp stop` builds —
      // still clears the recorded server, exactly as before.
      if (this.ownedRecord !== null) {
        await this.removePidFile(this.ownedRecord);
      } else if (this.lifecycle !== 'running' || this.options.transport !== 'stdio') {
        await this.removePidFile();
      }

      this.lifecycle = 'stopped';
      this.ownedRecord = null;
      this.startTime = undefined;
      this.emit('stopped');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get server status
   */
  async getStatus(): Promise<MCPServerStatus> {
    // #3364: this manager's own lifecycle is the authority on this manager.
    // While it is serving stdio it IS the server — it never wrote a record, so
    // a recorded PID belongs to somebody else. Once it has stopped it is not
    // running, whatever the record says. The marker is live lifecycle, not a
    // one-way "has served stdio" flag that survives the server it described.
    if (this.lifecycle === 'running' && this.options.transport === 'stdio') {
      return {
        running: true,
        pid: process.pid,
        transport: 'stdio',
        startedAt: this.startTime?.toISOString(),
        uptime: this.startTime
          ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
          : undefined,
      };
    }
    if (this.lifecycle === 'stopped') {
      return { running: false };
    }

    // Check PID file
    const record = await this.readPidRecord();

    if (!record) {
      // No PID file found. Detect if we are running in stdio mode
      // (e.g., launched by Claude Code via `claude mcp add`).
      const isStdio = !process.stdin.isTTY;
      const envTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
      if (isStdio || envTransport === 'stdio' || this.options.transport === 'stdio') {
        return {
          running: true,
          pid: process.pid,
          transport: 'stdio',
          startedAt: this.startTime?.toISOString(),
          uptime: this.startTime
            ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
            : undefined,
        };
      }
      return { running: false };
    }

    // Check that the recorded server is still the instance the record names
    if (!this.recordedServerIsLive(record)) {
      // Clean up stale PID file
      await this.removePidFile();
      return { running: false };
    }

    // Build status
    const status: MCPServerStatus = {
      running: true,
      pid: record.pid,
      transport: this.options.transport,
      host: this.options.host,
      port: this.options.port,
      startedAt: this.startTime?.toISOString(),
      uptime: this.startTime
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : undefined,
    };

    // Get health status for HTTP transport
    if (this.options.transport !== 'stdio') {
      status.health = await this.checkHealth();
    }

    return status;
  }

  /**
   * Check server health
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    if (this.options.transport === 'stdio') {
      // #3364: while this manager is serving stdio it IS the server, so it is
      // healthy by definition and must not read — or, from the 30s monitor in
      // startHealthMonitoring(), clear — the record it deliberately never
      // wrote. Once it has stopped it is not healthy either: it is a handle on
      // a dead server, not a window onto whatever PID the shared file holds.
      if (this.lifecycle === 'running') {
        return { healthy: true };
      }
      if (this.lifecycle === 'stopped') {
        return { healthy: false, error: 'Server stopped' };
      }
      // For stdio, check if the recorded process is running
      const record = await this.readPidRecord();
      if (record === null) {
        return { healthy: false, error: 'No PID file found' };
      }
      if (!this.recordedServerIsLive(record)) {
        // Clean up stale PID file
        await this.removePidFile();
        return { healthy: false, error: 'Process not running (cleaned up stale PID)' };
      }
      return { healthy: true };
    }

    // For HTTP/WebSocket, make health check request
    try {
      const response = await this.httpRequest(
        `http://${this.options.host}:${this.options.port}/health`,
        'GET',
        this.options.timeout
      );

      return {
        healthy: response.status === 'ok',
        metrics: {
          connections: response.connections || 0,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Restart the server
   */
  async restart(): Promise<MCPServerStatus> {
    await this.stop();
    return await this.start();
  }

  /**
   * Start stdio server in-process
   * Handles stdin/stdout directly like V2 implementation
   */
  private async startStdioServer(): Promise<void> {
    // ruflo#1910 — protect the JSON-RPC stdout from any stray
    // console.log/info/debug emitted by lazily-loaded modules
    // (@ruvector/router, @claude-flow/neural, transformers.js, ONNX,
    // semantic-router init, etc.). Codex closes the MCP transport
    // the moment it sees a non-JSON line on stdout, and one such
    // line during a tool batch bricked the whole session.
    //
    // Strategy: replace console.log/info/debug with stderr writers
    // for the rest of the process. JSON-RPC frames go out via the
    // dedicated `writeFrame()` helper below (process.stdout.write
    // with the original native binding, NOT console.log), so the
    // hijack can't accidentally redirect protocol frames too.
    process.env.MCP_STDIO_MODE = '1';
    const originalLog = console.log;  // eslint-disable-line no-console
    console.log = (...args: unknown[]) => process.stderr.write('[stdout→stderr] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
    console.info = (...args: unknown[]) => process.stderr.write('[stdout→stderr] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
    console.debug = (...args: unknown[]) => process.stderr.write('[stdout→stderr] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');

    // #2426 — Force blocking writes on stdout so JSON-RPC frames larger than
    // the OS pipe buffer (64KB on macOS) are delivered atomically. Without
    // this, `process.stdout.write()` returns after a partial write when the
    // pipe buffer is full; the truncated frame is unparseable JSON and the
    // MCP client (Claude Code) silently drops all 314 tools. The MCP SDK's
    // StdioServerTransport does the same thing for this reason. `setBlocking`
    // is an internal Node API but stable since v10 and used in many MCP
    // implementations; we feature-gate it so we degrade gracefully on
    // exotic stdout handles (e.g., when not bound to a pipe in tests).
    const stdoutHandle = (process.stdout as unknown as {
      _handle?: { setBlocking?: (b: boolean) => void };
    })._handle;
    if (stdoutHandle && typeof stdoutHandle.setBlocking === 'function') {
      stdoutHandle.setBlocking(true);
    }
    // Same for stderr — long structured error messages can also exceed the
    // pipe buffer and tearing those mid-message corrupts the client's log view.
    const stderrHandle = (process.stderr as unknown as {
      _handle?: { setBlocking?: (b: boolean) => void };
    })._handle;
    if (stderrHandle && typeof stderrHandle.setBlocking === 'function') {
      stderrHandle.setBlocking(true);
    }

    /** Send a single JSON-RPC frame to the real stdout. Use this instead
     * of `console.log` so the hijack above can't redirect protocol frames. */
    const writeFrame = (msg: unknown): void => {
      process.stdout.write(JSON.stringify(msg) + '\n');
    };
    // Reference originalLog to keep the eslint-disable meaningful — also
    // gives us an escape hatch if a test wants to verify it was replaced.
    void originalLog;

    // Catch fatal errors that would otherwise close the transport
    // mid-batch with no JSON-RPC error returned to the client.
    process.on('uncaughtException', (err) => {
      process.stderr.write(`[mcp-stdio] uncaughtException: ${err.stack || err.message}\n`);
    });
    process.on('unhandledRejection', (reason) => {
      process.stderr.write(`[mcp-stdio] unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}\n`);
    });

    // Import the tool registry
    const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');

    const VERSION = '3.0.0';
    const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // Log to stderr to not corrupt stdout
    console.error(
      `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Starting in stdio mode`
    );

    // Auto-initialize memory database before tools are registered (#1524)
    // This ensures memory_store and other memory tools work immediately
    // without waiting for the first tool call to trigger lazy init.
    try {
      const { initializeMemoryDatabase, checkMemoryInitialization } = await import('./memory/memory-initializer.js');
      const status = await checkMemoryInitialization();
      if (!status.initialized) {
        console.error(
          `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Auto-initializing memory database...`
        );
        const result = await initializeMemoryDatabase({ force: false, verbose: false });
        if (result.success) {
          console.error(
            `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Memory database initialized at ${result.dbPath}`
          );
        } else if (result.error && !result.error.includes('already exists')) {
          console.error(
            `[${new Date().toISOString()}] WARN [claude-flow-mcp] (${sessionId}) Memory database init returned: ${result.error}`
          );
        }
      } else {
        console.error(
          `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Memory database already initialized (v${status.version || 'unknown'})`
        );
      }
    } catch (memInitError) {
      // Graceful degradation: server continues even if memory init fails.
      // Memory tools will attempt lazy init on first call via ensureInitialized().
      console.error(
        `[${new Date().toISOString()}] WARN [claude-flow-mcp] (${sessionId}) Memory auto-init failed (tools will retry on first call): ${memInitError instanceof Error ? memInitError.message : String(memInitError)}`
      );
    }
    console.error(JSON.stringify({
      arch: process.arch,
      mode: 'mcp-stdio',
      nodeVersion: process.version,
      pid: process.pid,
      platform: process.platform,
      protocol: 'stdio',
      sessionId,
      version: VERSION,
    }));

    // Send server initialization notification
    writeFrame({
      jsonrpc: '2.0',
      method: 'server.initialized',
      params: {
        serverInfo: {
          name: 'ruflo',
          version: VERSION,
          capabilities: {
            tools: { listChanged: true },
            resources: {},
          },
        },
      },
    });

    // Handle stdin messages (S-5: bounded buffer to prevent OOM)
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
    let buffer = '';

    process.stdin.on('data', async (chunk) => {
      buffer += chunk.toString();

      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error(
          `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Buffer exceeded ${MAX_BUFFER_SIZE} bytes, rejecting`
        );
        buffer = '';
        writeFrame({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Request too large' },
        });
        return;
      }

      // Process complete JSON messages
      let lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            const response = await this.handleMCPMessage(message, sessionId);
            if (response) {
              writeFrame(response);
            }
          } catch (error) {
            console.error(
              `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Failed to parse message:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    });

    process.stdin.on('end', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) stdin closed, shutting down...`
      );
      process.exit(0);
    });

    // Handle process termination
    process.on('SIGINT', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Received SIGINT, shutting down...`
      );
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error(
        `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Received SIGTERM, shutting down...`
      );
      process.exit(0);
    });

    // Mark as ready immediately for stdio
    this.emit('ready');
  }

  /**
   * Handle incoming MCP message
   */
  private async handleMCPMessage(
    message: { jsonrpc: string; id?: string | number; method?: string; params?: unknown },
    sessionId: string
  ): Promise<{ jsonrpc: string; id?: string | number; result?: unknown; error?: { code: number; message: string } } | null> {
    const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');

    if (!message.method) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32600, message: 'Invalid Request: missing method' },
      };
    }

    const params = (message.params || {}) as Record<string, unknown>;

    try {
      switch (message.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'ruflo', version: '3.0.0' },
              capabilities: {
                tools: { listChanged: true },
                resources: {},
              },
            },
          };

        case 'tools/list':
          const tools = filterAdvertisedMcpTools(listMCPTools(), this.options.tools);
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            },
          };

        case 'tools/call':
          const toolName = params.name as string;
          const toolParams = (params.arguments || {}) as Record<string, unknown>;

          if (!hasTool(toolName)) {
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32601, message: `Tool not found: ${toolName}` },
            };
          }

          if (isPolicyEnforcementEnabled()) {
            const check = evaluateToolCall(loadMcpPolicy(), sessionId, toolName);
            if (!check.allowed) {
              trackRequest(toolName, false);
              return {
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32001, message: `Policy denied: ${check.reason}` },
              };
            }
          }

          try {
            const result = await callMCPTool(toolName, toolParams, { sessionId, transport: 'stdio' });
            const isError = hasToolError(result);
            trackRequest(toolName, !isError);
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError },
            };
          } catch (error) {
            trackRequest(toolName, false);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Tool execution failed',
              },
            };
          }

        // The server advertises `resources` (so clients such as Codex offer list_mcp_resources), and a declared capability must
        // be served: it exposes no resources, so the answers are empty, and a read is the spec's "resource not found" (ADR-490).
        case 'resources/list':
          return { jsonrpc: '2.0', id: message.id, result: { resources: [] } };

        case 'resources/templates/list':
          return { jsonrpc: '2.0', id: message.id, result: { resourceTemplates: [] } };

        case 'resources/read':
          return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Resource not found' } };

        case 'notifications/initialized':
          // Client notification - no response needed
          console.error(
            `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Client initialized`
          );
          return null;

        case 'ping':
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {},
          };

        default:
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          };
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Error handling ${message.method}:`,
        error
      );
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  /**
   * Start HTTP server in-process
   */
  private async startHttpServer(): Promise<void> {
    // Authorization gate first, before any import or bind: a refused start must
    // not depend on (or touch) anything else.
    const authToken = this.options.authToken || undefined;
    if (authToken && this.options.transport !== 'http') {
      // The standalone websocket transport has no working token check, so a
      // token there would be a false promise of protection.
      throw new Error('An MCP HTTP auth token is only supported with --transport http');
    }
    if (shouldRefuseUnauthenticatedHttp(this.options.host, process.env, !!authToken)) {
      // No ToolAuthorizer is wired below: @claude-flow/mcp's tool-call
      // authorization is fully opt-in (requireToolAuthorization/toolAuthorizer),
      // so without this check every registered tool (memory_*, hooks_*,
      // agentdb_*, hive-mind_*, ...) would be callable by any client that can
      // reach this host:port, unauthenticated — the same shape as
      // CVE-2026-81735 (CVSS 10/10, UI-TARS-desktop mcp-http-server: optional
      // auth middleware never wired by the integrating CLI + a non-loopback
      // bind). Loopback stays unaffected; this only gates an explicit
      // non-default `--host`. A configured bearer token (below) lifts the gate.
      throw new Error(
        `Refusing to start the MCP HTTP server on non-loopback host "${this.options.host}": ` +
          'this server is unauthenticated unless a token is set, so every registered MCP tool ' +
          'would be reachable over the network. Set RUFLO_MCP_HTTP_TOKEN (or --auth-token-file) ' +
          'to require a bearer token, bind to a loopback host (127.0.0.1, ::1, or localhost), or set ' +
          'RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1 to acknowledge the risk and proceed ' +
          '(e.g. when a trusted reverse proxy or network boundary already enforces auth).'
      );
    }
    // Dynamically import the MCP server package
    // FIX for issue #942: Use proper package import instead of broken relative path
    const { createMCPServer } = await import('@claude-flow/mcp');

    const logger = {
      debug: (msg: string, data?: unknown) => this.emit('log', { level: 'debug', msg, data }),
      info: (msg: string, data?: unknown) => this.emit('log', { level: 'info', msg, data }),
      warn: (msg: string, data?: unknown) => this.emit('log', { level: 'warn', msg, data }),
      error: (msg: string, data?: unknown) => this.emit('log', { level: 'error', msg, data }),
    };

    const { listMCPTools, callMCPTool } = await import('./mcp-client.js');
    const fallbackSessionId = `http-${randomUUID()}`;
    const cliTools = filterAdvertisedMcpTools(listMCPTools(), this.options.tools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
      tags: tool.tags,
      version: tool.version,
      cacheable: tool.cacheable,
      cacheTTL: tool.cacheTTL,
      handler: async (input: unknown, context?: { sessionId?: string }) => {
        try {
          const result = await callMCPTool(
            tool.name,
            (input as Record<string, unknown>) || {},
            { sessionId: context?.sessionId || fallbackSessionId, transport: this.options.transport === 'websocket' ? 'websocket' : 'http' }
          );
          trackRequest(tool.name, !hasToolError(result));
          return result;
        } catch (error) {
          trackRequest(tool.name, false);
          throw error;
        }
      },
    }));

    // Use one MCP server with two HTTP transports for the localhost default.
    // Both loopback sockets therefore share sessions, tools, and notifications.
    const dualLoopback = this.options.host === 'localhost';
    const mcpServer = createMCPServer(
      {
        name: 'Claude-Flow MCP Server V3',
        version: '3.0.0',
        transport: this.options.transport as 'http' | 'websocket',
        host: dualLoopback ? '127.0.0.1' : this.options.host,
        additionalHosts: dualLoopback && this.options.transport === 'http' ? ['::1'] : undefined,
        port: this.options.port,
        enableMetrics: true,
        enableCaching: true,
        requestTimeout: this.options.requestTimeoutMs,
        auth: authToken
          ? { enabled: true, method: 'token', tokens: [authToken] }
          : undefined,
      },
      logger
    );
    const registration = mcpServer.registerTools(
      cliTools as Parameters<typeof mcpServer.registerTools>[0]
    );
    if (registration.failed.length > 0) {
      throw new Error(`Failed to register MCP tools: ${registration.failed.join(', ')}`);
    }
    await mcpServer.start();
    this.mcpServers = [mcpServer];
  }

  /**
   * Wait for server to be ready
   */
  private async waitForReady(timeout = 10000): Promise<void> {
    // For stdio transport, we're ready immediately (in-process)
    if (this.options.transport === 'stdio') {
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const health = await this.checkHealth();
      if (health.healthy) {
        return;
      }
      await this.sleep(100);
    }

    throw new Error('Server failed to start within timeout');
  }

  /**
   * Wait for process to exit
   */
  private async waitForExit(timeout: number): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      this.process!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        this.emit('health', health);

        if (!health.healthy) {
          this.emit('unhealthy', health);
        }
      } catch (error) {
        this.emit('health-error', error);
      }
    }, 30000);
    this.healthCheckInterval.unref();
  }

  /**
   * Write the PID record.
   *
   * Line 1 is the bare PID, byte for byte what this file has always held, so
   * every existing reader keeps working: an older ruflo's
   * `parseInt(content.trim(), 10)` stops at the newline, and
   * `v3/scripts/start-mcp.sh` reads the first line. Line 2 is the durable
   * identity of the instance that wrote it (#3364). Returns the bytes written,
   * which stop() uses to retract only its own record.
   */
  private async writePidFile(): Promise<string> {
    const pid = this.process?.pid || process.pid;
    const identity: PidFileIdentity = {
      v: 1,
      pid,
      host: os.hostname(),
      platform: process.platform,
      pidns: PID_NAMESPACE,
      boot: BOOT_ID,
      start: processStartToken(pid),
      transport: this.options.transport,
      port: this.options.port,
      startedAt: (this.startTime ?? new Date()).toISOString(),
    };
    const record = `${pid}\n${JSON.stringify(identity)}\n`;
    await fs.promises.writeFile(this.options.pidFile, record, 'utf8');
    return record;
  }

  /**
   * Read the PID record.
   *
   * A bare-integer file — an older ruflo, `start-mcp.sh --daemon`, or a
   * hand-written one — parses to a record with no identity, which keeps
   * exactly the old behaviour: the PID is checked for liveness and nothing
   * more. An identity line is only believed for the PID it names.
   */
  private async readPidRecord(): Promise<PidFileRecord | null> {
    try {
      const raw = await fs.promises.readFile(this.options.pidFile, 'utf8');
      const newline = raw.indexOf('\n');
      const pid = parseInt((newline === -1 ? raw : raw.slice(0, newline)).trim(), 10);
      if (!Number.isInteger(pid) || pid <= 0) return null;

      let identity: PidFileIdentity | undefined;
      const rest = newline === -1 ? '' : raw.slice(newline + 1).trim();
      if (rest) {
        try {
          const parsed = JSON.parse(rest) as PidFileIdentity | null;
          if (parsed && parsed.v === 1 && parsed.pid === pid) identity = parsed;
        } catch {
          // Truncated, or a second line we don't recognise — PID only.
        }
      }
      return { pid, raw, identity };
    } catch {
      return null;
    }
  }

  /**
   * Is the recorded server still the instance the record names? (#3364)
   *
   * `kill -0`, and isProcessRunning()'s process-name check on top of it, only
   * answer "something with this number is alive". Durable identity answers
   * "it is still the one we wrote down":
   *  - another host, OS, kernel boot or PID namespace issues its own PIDs, so
   *    the number says nothing here. On Linux this is the ordinary stale case,
   *    because /tmp commonly survives a reboot;
   *  - within one boot the OS reuses a PID once the process is reaped, and the
   *    owner's start time is what tells the two apart.
   * Where the start time cannot be read — Windows — the answer falls back to
   * isProcessRunning(), i.e. exactly the evidence used today.
   */
  private recordedServerIsLive(record: PidFileRecord): boolean {
    const { pid, identity } = record;
    if (identity) {
      if (
        identity.host !== os.hostname() ||
        identity.platform !== process.platform ||
        identity.pidns !== PID_NAMESPACE ||
        identity.boot !== BOOT_ID
      ) {
        return false;
      }
      if (identity.start !== undefined) {
        const start = processStartToken(pid);
        if (start !== undefined && start !== identity.start) return false;
      }
    }
    return this.isProcessRunning(pid);
  }

  /**
   * Remove PID file. With `ownedRecord`, only while the file still holds
   * exactly those bytes: the slot may have changed hands (#3364).
   */
  private async removePidFile(ownedRecord?: string): Promise<void> {
    let ours = true;
    if (ownedRecord !== undefined) {
      try {
        ours = (await fs.promises.readFile(this.options.pidFile, 'utf8')) === ownedRecord;
      } catch {
        ours = false; // Already gone
      }
    }
    if (ours) {
      try {
        await fs.promises.unlink(this.options.pidFile);
      } catch {
        // Ignore errors
      }
    }
    // Also clean up legacy PID file location from older versions
    try {
      const legacyPath = path.join(process.env.CLAUDE_FLOW_CWD || process.cwd(), '.claude-flow', 'mcp-server.pid');
      if (legacyPath !== this.options.pidFile) {
        await fs.promises.unlink(legacyPath);
      }
    } catch {
      // Ignore — file may not exist
    }
  }

  /**
   * Check if process is running AND is a node/claude-flow process.
   * Plain `kill -0` returns true for any process with the same owner,
   * which causes false positives when the OS recycles the PID.
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }

    // Verify it's actually a node process (guards against PID reuse)
    // DA-CRIT-3: Use execFileSync to prevent command injection via PID values
    try {
      const safePid = String(Math.floor(Math.abs(pid)));
      let cmdline = '';
      try {
        // Try /proc on Linux
        cmdline = fs.readFileSync(`/proc/${safePid}/cmdline`, 'utf8');
      } catch {
        // Fall back to ps on macOS/other
        try {
          cmdline = execFileSync('ps', ['-p', safePid, '-o', 'comm='], {
            encoding: 'utf8',
            timeout: 1000,
          }).trim();
        } catch {
          // ps failed — fall through
        }
      }
      if (!cmdline) return true; // Can't inspect, fall back to kill check
      // Must be a node process to be our MCP server
      return cmdline.includes('node') || cmdline.includes('claude-flow') || cmdline.includes('npx');
    } catch {
      // If we can't inspect the process (macOS, Windows, permissions), fall back to kill check
      return true;
    }
  }

  /**
   * Make HTTP request
   */
  private async httpRequest(
    url: string,
    method: string,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);

      const req = httpRequestFn(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method,
          timeout,
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ status: res.statusCode === 200 ? 'ok' : 'error' });
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create MCP server manager
 */
export function createMCPServerManager(
  options?: MCPServerOptions
): MCPServerManager {
  return new MCPServerManager(options);
}

/**
 * Singleton server manager instance
 */
let serverManager: MCPServerManager | null = null;
let currentTransport: string | undefined = undefined;

/**
 * Get or create server manager singleton
 *
 * FIX for issue #942: Recreate singleton if transport type changes
 * Previously, once created with stdio (default), HTTP options were ignored
 */
export function getServerManager(
  options?: MCPServerOptions
): MCPServerManager {
  const requestedTransport = options?.transport;

  // Recreate if transport type changes (fixes HTTP transport not working)
  if (serverManager && requestedTransport && requestedTransport !== currentTransport) {
    serverManager = new MCPServerManager(options);
    currentTransport = requestedTransport;
  }

  if (!serverManager) {
    serverManager = new MCPServerManager(options);
    currentTransport = options?.transport;
  }
  return serverManager;
}

/**
 * Quick start MCP server
 */
export async function startMCPServer(
  options?: MCPServerOptions
): Promise<MCPServerStatus> {
  const manager = getServerManager(options);
  return await manager.start();
}

/**
 * Quick stop MCP server
 */
export async function stopMCPServer(force = false): Promise<void> {
  if (serverManager) {
    await serverManager.stop(force);
  }
}

/**
 * Get MCP server status
 */
export async function getMCPServerStatus(): Promise<MCPServerStatus> {
  const manager = getServerManager();
  return await manager.getStatus();
}

export default MCPServerManager;
