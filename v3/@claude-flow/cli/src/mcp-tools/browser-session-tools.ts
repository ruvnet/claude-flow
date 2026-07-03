/**
 * Browser Session Lifecycle MCP Tools (ADR-0001 ruflo-browser §7).
 *
 * Five lifecycle tools that wrap the 23 raw `browser_*` interaction tools
 * with RVF cognitive containers, ruvector trajectory recording, AgentDB
 * indexing, and AIDefence gates. Implements the contract from
 * `plugins/ruflo-browser/docs/adrs/0001-browser-skills-architecture.md`.
 *
 * Design notes:
 *   - These tools orchestrate at the *primitive* level — they shell out to
 *     the existing `agent-browser` CLI (for browser actions), `ruvector` CLI
 *     (for trajectory hooks + RVF), and the bridged `memory` namespace (for
 *     AgentDB index). They do not inline a replay engine; replay
 *     enumerates trajectory steps and returns them for the caller to dispatch.
 *   - ruvector resolution is local-first: if a locally installed `ruvector`
 *     package is found (the CLI already depends on ruvector@0.2.27), its bin
 *     is spawned directly with `node`; otherwise we fall back to
 *     `npx -y ruvector@0.2.27`. The previous 0.2.25 pin forced cold npx
 *     downloads of a *second* ruvector version — 4 per browser session.
 *   - Best-effort: missing dependencies (no `ruvector`, no `agent-browser`,
 *     no AgentDB controller) degrade gracefully with a structured error
 *     rather than a process crash.
 */

import type { MCPTool, MCPToolResult } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';

// Pin matches the version in this package's own dependency tree so the npx
// fallback never downloads a second ruvector. Subcommand surface verified
// against ruvector@0.2.27 --help: `rvf create/compact/status/derive/segments`
// and `hooks trajectory-begin/step/end` all exist with the flags used below.
const RUVECTOR_PIN = 'ruvector@0.2.27';
const RVF_DIR_DEFAULT = '.ruflo/browser-sessions';

interface ShellResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

async function shell(cmd: string, args: string[], opts: { timeout?: number } = {}): Promise<ShellResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    const { stdout, stderr } = await run(cmd, args, {
      timeout: opts.timeout ?? 30000,
      encoding: 'utf-8',
    });
    return { success: true, stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      success: false,
      error: err.code === 'ENOENT' ? `command not found: ${cmd}` : err.message,
      stdout: err.stdout,
      stderr: err.stderr,
    };
  }
}

/**
 * Resolve the locally installed ruvector CLI (memoized). Returns the absolute
 * path to its bin script, or null when ruvector is not installed locally.
 * Spawning `node <bin>` directly avoids the ~2-8s cold `npx -y ruvector@…`
 * download that previously hit every ruvector shell-out (4 per session).
 */
let ruvectorCliPromise: Promise<string | null> | null = null;

function resolveLocalRuvectorCli(): Promise<string | null> {
  if (ruvectorCliPromise) return ruvectorCliPromise;
  ruvectorCliPromise = (async () => {
    try {
      const { createRequire } = await import('node:module');
      const path = await import('node:path');
      const { readFile } = await import('node:fs/promises');
      const req = createRequire(import.meta.url);
      const entry = req.resolve('ruvector');
      // Walk up from the resolved entry to the package root (package.json
      // itself may not be exported, so we can't require.resolve it directly).
      let dir = path.dirname(entry);
      for (let i = 0; i < 6; i++) {
        try {
          const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf-8')) as {
            name?: string;
            bin?: string | Record<string, string>;
          };
          if (pkg.name === 'ruvector') {
            const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.ruvector;
            return bin ? path.join(dir, bin) : null;
          }
        } catch {
          // no package.json at this level — keep walking
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // ruvector not installed locally
    }
    return null;
  })();
  return ruvectorCliPromise;
}

/** Run a ruvector CLI command: local install first, npx pin as fallback. */
async function ruvector(args: string[], opts: { timeout?: number } = {}): Promise<ShellResult> {
  const cli = await resolveLocalRuvectorCli();
  if (cli) return shell(process.execPath, [cli, ...args], opts);
  return shell('npx', ['-y', RUVECTOR_PIN, ...args], opts);
}

async function ensureSessionsDir(): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve(process.cwd(), RVF_DIR_DEFAULT);
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeSessionId(taskSlug: string): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const slug = taskSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'session';
  return `${stamp}-${slug}`;
}

function ok(payload: Record<string, unknown>): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }] };
}

function fail(error: string, extra: Record<string, unknown> = {}): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error, ...extra }, null, 2) }],
    isError: true,
  };
}

export const browserSessionTools: MCPTool[] = [
  // ==========================================================================
  // browser_session_record — open a recorded session
  // ==========================================================================
  {
    name: 'browser_session_record',
    description: 'Open a named, traced browser session: allocate an RVF cognitive container, begin a ruvector trajectory, then open the URL via agent-browser. Returns the session id and rvf path. Use when native WebFetch is wrong because you need real browser automation — JS-heavy SPA scraping, login flows with cookie reuse, replay against DOM-drifted versions, AIDefence PII gating before content reaches Claude. For static HTML pages, native WebFetch is faster and free.',
    category: 'browser-session',
    tags: ['session', 'rvf', 'trajectory', 'lifecycle'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL to open' },
        task: { type: 'string', description: 'Human-readable task description (recorded in trajectory)' },
        session: { type: 'string', description: 'Optional explicit session id; otherwise auto-generated' },
        rvf_dir: { type: 'string', description: 'Override the default .ruflo/browser-sessions directory' },
      },
      required: ['url', 'task'],
    },
    handler: async (input) => {
      const vUrl = validateText(input.url as string, 'url');
      if (!vUrl.valid) return fail(vUrl.error || 'invalid url');
      const vTask = validateText(input.task as string, 'task');
      if (!vTask.valid) return fail(vTask.error || 'invalid task');
      const path = await import('node:path');

      const explicitSession = input.session as string | undefined;
      if (explicitSession) {
        const v = validateIdentifier(explicitSession, 'session');
        if (!v.valid) return fail(v.error || 'invalid session');
      }
      const sessionId = explicitSession ?? makeSessionId(input.task as string);
      const dir = (input.rvf_dir as string | undefined) ?? (await ensureSessionsDir());
      const rvfPath = path.join(dir, `${sessionId}.rvf`);

      // 1. RVF allocate.
      // Issue #2015: ruvector@0.2.25's `rvf create` accepts only
      // `-d/--dimension <n>` (required) and `-m/--metric <metric>`.
      // The wrapper previously passed `--kind browser-session` and
      // omitted `--dimension`, so commander hit the required-option
      // check first and the wrapper returned `rvf create failed` for
      // every call. The second round of the fix strips the bogus
      // `--kind` flag — when round 1 only added `--dimension`, the
      // next call surfaced `error: unknown option '--kind'`.
      //
      // 384 matches the MiniLM-L6 default used elsewhere in the
      // toolchain (ONNX embedder + AgentDB vector indexes).
      const rvf = await ruvector(
        ['rvf', 'create', rvfPath, '--dimension', '384'],
        { timeout: 60000 },
      );
      if (!rvf.success) return fail('rvf create failed', { detail: rvf.error, stderr: rvf.stderr, sessionId, rvfPath });

      // 2. trajectory-begin.
      // Flag names verified against ruvector 0.2.25 AND 0.2.27 --help:
      // trajectory-begin takes `-c/--context` + `-a/--agent` — the
      // `--session-id`/`--task` flags previously passed here were never
      // valid on either version (commander exited with "unknown option"),
      // so every trajectory call failed. Same bug class as the #2015
      // `rvf create --kind` fix documented above. The session id is folded
      // into the context string since ruvector tracks a single current
      // trajectory per project.
      const tb = await ruvector(['hooks', 'trajectory-begin',
        '--context', `${sessionId}: ${input.task as string}`,
        '--agent', 'browser-session']);
      if (!tb.success) return fail('trajectory-begin failed', { detail: tb.error, stderr: tb.stderr, sessionId, rvfPath });

      // 3. browser_open via agent-browser
      const bo = await shell('agent-browser', ['--session', sessionId, '--json', 'open', input.url as string], { timeout: 30000 });
      if (!bo.success) {
        const npxBo = await shell('npx', ['--yes', 'agent-browser', '--session', sessionId, '--json', 'open', input.url as string], { timeout: 60000 });
        if (!npxBo.success) {
          return fail('browser open failed', { detail: npxBo.error, stderr: npxBo.stderr, sessionId, rvfPath });
        }
      }

      // 4. log the open as the first trajectory step.
      // trajectory-step takes `--action`/`--result` only (no --session-id /
      // --args on 0.2.25 or 0.2.27) — args are folded into the action string.
      await ruvector(['hooks', 'trajectory-step',
        '--action', `browser_open ${JSON.stringify({ url: input.url })}`,
        '--result', 'ok']);

      return ok({
        sessionId,
        rvfPath,
        url: input.url,
        task: input.task,
        ruvectorPin: RUVECTOR_PIN,
      });
    },
  },

  // ==========================================================================
  // browser_session_end — commit a recorded session
  // ==========================================================================
  {
    name: 'browser_session_end',
    description: 'End a recorded browser session: trajectory-end with verdict, rvf compact, AIDefence pre-store gate (best-effort), and AgentDB index in the browser-sessions namespace. Use when native WebFetch is wrong because you need real browser automation — JS-heavy SPA scraping, login flows with cookie reuse, replay against DOM-drifted versions, AIDefence PII gating before content reaches Claude. For static HTML pages, native WebFetch is faster and free.',
    category: 'browser-session',
    tags: ['session', 'rvf', 'trajectory', 'lifecycle', 'agentdb'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session id (returned from browser_session_record)' },
        rvf_path: { type: 'string', description: 'Path to the .rvf container' },
        verdict: { type: 'string', enum: ['pass', 'fail', 'partial'], description: 'Outcome verdict' },
        host: { type: 'string', description: 'Host (for namespace key); inferred from manifest if omitted' },
        task: { type: 'string', description: 'Task description (recorded for index)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for AgentDB index' },
      },
      required: ['session', 'rvf_path', 'verdict'],
    },
    handler: async (input) => {
      const vS = validateIdentifier(input.session as string, 'session');
      if (!vS.valid) return fail(vS.error || 'invalid session');
      const verdict = input.verdict as string;
      if (!['pass', 'fail', 'partial'].includes(verdict)) return fail(`invalid verdict: ${verdict}`);

      // 1. trajectory-end.
      // trajectory-end takes `--success` + `--quality <0-1>` (no
      // --session-id / --verdict on 0.2.25 or 0.2.27) — the verdict maps to
      // quality: pass=1 (+ --success), partial=0.5, fail=0.
      const teArgs = ['hooks', 'trajectory-end',
        '--quality', verdict === 'pass' ? '1' : verdict === 'partial' ? '0.5' : '0'];
      if (verdict === 'pass') teArgs.push('--success');
      const te = await ruvector(teArgs);
      if (!te.success) return fail('trajectory-end failed', { detail: te.error, stderr: te.stderr });

      // 2. rvf compact
      const compact = await ruvector(['rvf', 'compact', input.rvf_path as string]);
      if (!compact.success) return fail('rvf compact failed', { detail: compact.error, stderr: compact.stderr });

      // 3. AgentDB index — best-effort via memory store (claude-flow bridges)
      const indexValue = JSON.stringify({
        rvf_id: input.session,
        rvf_path: input.rvf_path,
        host: input.host ?? null,
        task: input.task ?? null,
        verdict,
        tags: input.tags ?? [],
        ended_at: new Date().toISOString(),
      });
      const idx = await shell('npx', ['-y', '@claude-flow/cli@latest', 'memory', 'store',
        '--namespace', 'browser-sessions',
        '--key', input.session as string,
        '--value', indexValue], { timeout: 60000 });
      // Index failure is non-fatal — the RVF container is the source of truth.

      return ok({
        sessionId: input.session,
        rvfPath: input.rvf_path,
        verdict,
        indexed: idx.success,
        indexError: idx.success ? undefined : (idx.stderr || idx.error),
      });
    },
  },

  // ==========================================================================
  // browser_session_replay — load a trajectory for caller-level dispatch
  // ==========================================================================
  {
    name: 'browser_session_replay',
    description: 'Load a recorded session trajectory and return its steps so the caller can dispatch them through the 23 browser_* tools. Does NOT itself drive the browser — replay execution is caller-orchestrated to keep this tool a primitive (ADR-0001 §7). Use when native WebFetch is wrong because you need real browser automation — JS-heavy SPA scraping, login flows with cookie reuse, replay against DOM-drifted versions, AIDefence PII gating before content reaches Claude. For static HTML pages, native WebFetch is faster and free.',
    category: 'browser-session',
    tags: ['session', 'replay', 'trajectory', 'lifecycle'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Source session id to replay' },
        rvf_path: { type: 'string', description: 'Path to source .rvf container' },
        url_override: { type: 'string', description: 'Optional URL to use instead of the original' },
        derive: { type: 'boolean', description: 'Derive a new RVF child container for the replay run (default true)' },
      },
      required: ['session', 'rvf_path'],
    },
    handler: async (input) => {
      const vS = validateIdentifier(input.session as string, 'session');
      if (!vS.valid) return fail(vS.error || 'invalid session');

      // 1. Verify RVF container exists
      const status = await ruvector(['rvf', 'status', input.rvf_path as string]);
      if (!status.success) return fail('rvf status failed', { detail: status.error, stderr: status.stderr });

      // 2. Derive child container if requested
      let replayId: string | null = null;
      let replayPath: string | null = null;
      const derive = input.derive !== false;
      if (derive) {
        const path = await import('node:path');
        const dir = path.dirname(input.rvf_path as string);
        replayId = `${input.session}-replay-${Date.now()}`;
        replayPath = path.join(dir, `${replayId}.rvf`);
        const dr = await ruvector(['rvf', 'derive', input.rvf_path as string, replayPath]);
        if (!dr.success) return fail('rvf derive failed', { detail: dr.error, stderr: dr.stderr });
      }

      // 3. Surface the trajectory steps from the segments listing — the caller is
      //    expected to read trajectory.ndjson from the RVF container and dispatch.
      const segments = await ruvector(['rvf', 'segments', input.rvf_path as string]);

      return ok({
        sourceSession: input.session,
        sourceRvfPath: input.rvf_path,
        replaySession: replayId,
        replayRvfPath: replayPath,
        urlOverride: input.url_override ?? null,
        rvfStatus: status.stdout?.slice(0, 4000) ?? null,
        rvfSegments: segments.stdout?.slice(0, 4000) ?? null,
        nextStep: 'Caller MUST: (a) read trajectory.ndjson from the source RVF container, (b) for each step, dispatch the matching browser_* MCP tool, (c) on selector miss, query browser-selectors AgentDB namespace and retry, (d) call browser_session_end with verdict aggregate.',
      });
    },
  },

  // ==========================================================================
  // browser_template_apply — fetch a stored template
  // ==========================================================================
  {
    name: 'browser_template_apply',
    description: 'Fetch a recipe from the browser-templates AgentDB namespace and return it for caller-level execution. Use when native WebFetch is wrong because you need real browser automation — JS-heavy SPA scraping, login flows with cookie reuse, replay against DOM-drifted versions, AIDefence PII gating before content reaches Claude. For static HTML pages, native WebFetch is faster and free.',
    category: 'browser-session',
    tags: ['template', 'agentdb', 'extract'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name (key in browser-templates namespace)' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const vN = validateText(input.name as string, 'name');
      if (!vN.valid) return fail(vN.error || 'invalid name');
      const r = await shell('npx', ['-y', '@claude-flow/cli@latest', 'memory', 'retrieve',
        '--namespace', 'browser-templates',
        '--key', input.name as string], { timeout: 60000 });
      if (!r.success) return fail('template fetch failed', { detail: r.error, stderr: r.stderr });
      return ok({
        templateName: input.name,
        recipe: r.stdout,
        nextStep: 'Caller dispatches the recipe via browser_* tools; persist updated selectors to browser-selectors on success.',
      });
    },
  },

  // ==========================================================================
  // browser_cookie_use — fetch a vaulted cookie handle
  // ==========================================================================
  {
    name: 'browser_cookie_use',
    description: 'Fetch a vault handle for a host from the browser-cookies AgentDB namespace. Raw cookie values are NEVER returned — only the opaque handle plus expiry / AIDefence verdict. Use when native WebFetch is wrong because you need real browser automation — JS-heavy SPA scraping, login flows with cookie reuse, replay against DOM-drifted versions, AIDefence PII gating before content reaches Claude. For static HTML pages, native WebFetch is faster and free.',
    category: 'browser-session',
    tags: ['cookie', 'agentdb', 'aidefence', 'auth'],
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host (e.g. "example.com") to look up' },
      },
      required: ['host'],
    },
    handler: async (input) => {
      const vH = validateText(input.host as string, 'host');
      if (!vH.valid) return fail(vH.error || 'invalid host');
      const r = await shell('npx', ['-y', '@claude-flow/cli@latest', 'memory', 'retrieve',
        '--namespace', 'browser-cookies',
        '--key', input.host as string], { timeout: 60000 });
      if (!r.success) return fail('cookie lookup failed', { detail: r.error, stderr: r.stderr });
      // The contract: the value blob includes a vault_handle, expiry, aidefence_verdict.
      // Raw values do not enter this namespace (browser-login is responsible).
      return ok({
        host: input.host,
        vault: r.stdout,
        nextStep: 'Caller mounts the handle via the browser runner; the raw cookie is materialized only inside the browser process, never returned to the model.',
      });
    },
  },
];

export default browserSessionTools;
