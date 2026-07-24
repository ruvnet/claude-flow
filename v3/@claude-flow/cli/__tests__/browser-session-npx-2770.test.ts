/**
 * Regression test for #2770: on Windows every browser-session tool that
 * shells out via bare `npx` fails with ENOENT — `execFile('npx', ...)`
 * cannot launch the `npx.cmd` shim without a shell, and explicit
 * `npx.cmd` is EINVAL under Node's CVE-2024-27980 hardening. `shell: true`
 * is not an acceptable fix because `browser_session_record` forwards a
 * caller-controlled URL (space-joined args under `shell: true` = command
 * injection on the host).
 *
 * Contract pinned here:
 *   (a) when Node's bundled npx-cli.js is resolvable relative to
 *       process.execPath, npx invocations run as `node <npx-cli.js> <args>`
 *       — a real executable on every platform, no shell, args stay
 *       literal argv;
 *   (b) when it is not resolvable, the original bare-`npx` spawn is
 *       preserved (working POSIX default / exotic layouts);
 *   (c) no shell-out in this module ever passes `shell: true`.
 *
 * We cannot spawn real processes in CI, so `node:child_process.execFile`
 * is mocked (promisify-aware — the module always promisifies it) and the
 * exported tool handlers are driven directly; assertions are on the binary
 * handed to execFile. Module state (npx resolution is memoized) is reset
 * between tests via vi.resetModules() + fresh dynamic import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedCall {
  cmd: string;
  args: string[];
  opts: Record<string, unknown>;
}

const execFileCalls: CapturedCall[] = [];

// Behavior knobs the mocks read at call time (reset in beforeEach).
let npxCliJsExists = true;
let rejectCmds: string[] = [];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const fake = () => {
    throw new Error('callback-style execFile not expected — shell() promisifies');
  };
  (fake as unknown as Record<symbol, unknown>)[promisify.custom] = async (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>,
  ) => {
    execFileCalls.push({ cmd, args, opts });
    const base = cmd.split(/[\\/]/).pop() ?? cmd;
    if (rejectCmds.includes(base)) {
      const err = new Error(`spawn ${cmd} ENOENT`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return { stdout: '{}', stderr: '' };
  };
  return { ...actual, execFile: fake as unknown as typeof actual.execFile };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: unknown) =>
      String(p).includes('npx-cli.js') ? npxCliJsExists : actual.existsSync(p as import('node:fs').PathLike),
  };
});

type BrowserSessionTools = typeof import('../src/mcp-tools/browser-session-tools.js');

async function loadTools(): Promise<BrowserSessionTools['browserSessionTools']> {
  const mod: BrowserSessionTools = await import('../src/mcp-tools/browser-session-tools.js');
  return mod.browserSessionTools;
}

function tool(tools: BrowserSessionTools['browserSessionTools'], name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

/** Calls that targeted npx in any form (bare or via node <npx-cli.js>). */
function npxInvocations(): CapturedCall[] {
  return execFileCalls.filter(
    (c) => c.cmd === 'npx' || (c.args[0] ?? '').includes('npx-cli.js'),
  );
}

beforeEach(() => {
  execFileCalls.length = 0;
  npxCliJsExists = true;
  rejectCmds = [];
  vi.resetModules();
});

describe('browser-session npx shell-outs (#2770)', () => {
  describe('with Node\'s bundled npx-cli.js resolvable (the Windows fix)', () => {
    it('browser_template_apply invokes node <npx-cli.js>, never bare npx', async () => {
      const tools = await loadTools();
      await tool(tools, 'browser_template_apply').handler({ name: 'checkout-flow' });

      const npxCalls = npxInvocations();
      expect(npxCalls.length).toBeGreaterThan(0);
      for (const call of npxCalls) {
        expect(call.cmd).toBe(process.execPath);
        expect(call.args[0]).toMatch(/npx-cli\.js$/);
      }
      // Original npx argv is preserved verbatim after the cli script.
      expect(npxCalls[0].args.slice(1)).toEqual([
        '-y', '@claude-flow/cli@latest', 'memory', 'retrieve',
        '--namespace', 'browser-templates',
        '--key', 'checkout-flow',
      ]);
    });

    it('browser_cookie_use invokes node <npx-cli.js>, never bare npx', async () => {
      const tools = await loadTools();
      await tool(tools, 'browser_cookie_use').handler({ host: 'example.com' });

      const npxCalls = npxInvocations();
      expect(npxCalls.length).toBeGreaterThan(0);
      for (const call of npxCalls) {
        expect(call.cmd).toBe(process.execPath);
        expect(call.args[0]).toMatch(/npx-cli\.js$/);
      }
    });

    it('browser_session_end never spawns bare npx (memory-store index + ruvector fallback)', async () => {
      const tools = await loadTools();
      await tool(tools, 'browser_session_end').handler({
        session: 'sess-2770',
        rvf_path: 'sess-2770.rvf',
        verdict: 'pass',
      });

      const bare = execFileCalls.filter((c) => c.cmd === 'npx');
      expect(bare).toEqual([]);
      // The AgentDB index call site must still have fired, through node.
      const idx = execFileCalls.find((c) => c.args.includes('store'));
      expect(idx).toBeDefined();
      expect(idx!.cmd).toBe(process.execPath);
    });

    it('browser_session_record npx fallback passes the user URL as one literal argv element', async () => {
      // Force the direct agent-browser spawn to fail so the handler takes
      // the npx fallback — the call site that forwards input.url (#2770's
      // injection-risk site: this URL must never meet a shell).
      rejectCmds = ['agent-browser'];
      const hostileUrl = 'https://example.com/?q=a&b=`c`|d';

      const tools = await loadTools();
      await tool(tools, 'browser_session_record').handler({
        url: hostileUrl,
        task: 'regression 2770',
        session: 'sess-2770-rec',
        rvf_dir: 'tmp-2770',
      });

      const bare = execFileCalls.filter((c) => c.cmd === 'npx');
      expect(bare).toEqual([]);
      const fallback = execFileCalls.find((c) => c.args.includes('agent-browser') && c.args.includes('open'));
      expect(fallback).toBeDefined();
      expect(fallback!.cmd).toBe(process.execPath);
      expect(fallback!.args[0]).toMatch(/npx-cli\.js$/);
      // Literal argv — exactly one element equals the raw URL, unescaped/unsplit.
      expect(fallback!.args.filter((a) => a === hostileUrl)).toHaveLength(1);
    });

    it('no shell-out in the module ever passes shell: true', async () => {
      rejectCmds = ['agent-browser'];
      const tools = await loadTools();
      await tool(tools, 'browser_template_apply').handler({ name: 'tpl' });
      await tool(tools, 'browser_cookie_use').handler({ host: 'example.com' });
      await tool(tools, 'browser_session_end').handler({ session: 's1', rvf_path: 's1.rvf', verdict: 'fail' });
      await tool(tools, 'browser_session_record').handler({ url: 'https://example.com', task: 't', session: 's2', rvf_dir: 'tmp-2770' });

      expect(execFileCalls.length).toBeGreaterThan(0);
      for (const call of execFileCalls) {
        expect(call.opts?.shell).toBeUndefined();
      }
    });
  });

  describe('without a resolvable npx-cli.js (fallback contract)', () => {
    it('browser_template_apply falls back to the original bare-npx spawn', async () => {
      npxCliJsExists = false;
      const tools = await loadTools();
      await tool(tools, 'browser_template_apply').handler({ name: 'tpl' });

      const npxCalls = npxInvocations();
      expect(npxCalls.length).toBeGreaterThan(0);
      for (const call of npxCalls) {
        expect(call.cmd).toBe('npx');
      }
    });
  });
});
