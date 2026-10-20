/**
 * A harness for the ruflo mod (plugins/ruflo-mods), faithful to the Claude
 * Code function-hook declarations it is typed against (ADR-404).
 *
 * Why not `claude plugin test`: the kit runs only where Claude Code's hooks
 * module rollout switch is on, and it served off for the account these tests
 * were written on. This harness reproduces the parts of the contract the mod
 * relies on, so CI can hold them without Claude Code:
 *   - `on(event, [matcher,] hook)` returns a registration taking one `.catch`;
 *   - a dispatch runs the plugin's hooks for the event in registration order,
 *     outermost first, then core (the world beneath, answered by the test);
 *   - `next(e)` runs what is beneath; a hook that throws with no `.catch` is
 *     absent (what is beneath answers); in a `.catch`, `next` is replay-safe
 *     (`next.called`, `next.error`) and its answer stands;
 *   - `e` is frozen; matchers narrow on equal values, arrays (any of) and RegExps;
 *   - `$` ops: fs.stat rejects ENOENT for a missing path, fs.read rejects
 *     over 4 MiB, env.get/set, settings.read, session.root, ui.*, command.register.
 * What it does not model: tiers above the mod (sec-default is reasoned about,
 * not run), budgets, streaming events, rendering.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type AnyHook = ($: any, e: any, next: any) => any;
type Registration = { event: string; matcher?: Record<string, unknown>; hook: AnyHook; onCatch?: AnyHook };

export interface World {
  root: string;
  /** Real files under `root`, or an in-memory map of absolute path → text. */
  files: 'real' | Map<string, { text: string; mtimeMs: number }>;
  /** In-memory directories; initialized projects have a .claude-flow directory. */
  dirs: Set<string>;
  env: Map<string, string>;
  settings: unknown | (() => unknown);
  statuses: (string | undefined)[];
  logs: string[];
  toasts: string[];
  commands: string[];
  /** Per-op failure injection: `fs.read` → error to throw for a path. */
  failRead?: (path: string) => Error | undefined;
  failStat?: (path: string) => Error | undefined;
  failLog?: boolean;
}

export function memoryWorld(root = '/work', settings: unknown = {}): World {
  return { root, files: new Map(), dirs: new Set([root, `${root}/.claude-flow`]), env: new Map(), settings, statuses: [], logs: [], toasts: [], commands: [] };
}

export function realWorld(root: string, settings: unknown = {}): World {
  return { root, files: 'real', dirs: new Set(), env: new Map(), settings, statuses: [], logs: [], toasts: [], commands: [] };
}

const enoent = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });

function engineOf(world: World) {
  const mem = world.files === 'real' ? undefined : world.files;
  return {
    fs: {
      async stat(path: string) {
        const injected = world.failStat?.(path);
        if (injected) throw injected;
        if (mem) {
          const f = mem.get(path);
          if (!f && world.dirs.has(path)) return { kind: 'dir', size: 0, mtimeMs: 1, isLink: false };
          if (!f) throw enoent(path);
          return { kind: 'file', size: Buffer.byteLength(f.text), mtimeMs: f.mtimeMs, isLink: false };
        }
        const s = lstatSync(path);
        return { kind: s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other', size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
      },
      async read(path: string) {
        const injected = world.failRead?.(path);
        if (injected) throw injected;
        if (mem) {
          const f = mem.get(path);
          if (!f) throw enoent(path);
          return f.text;
        }
        if (!existsSync(path)) throw enoent(path);
        if (statSync(path).size > 4 * 1024 * 1024) throw new Error(`${path} is over 4 MiB`);
        return readFileSync(path, 'utf8');
      },
      async write(path: string, text: string) {
        if (mem) {
          mem.set(path, { text, mtimeMs: (mem.get(path)?.mtimeMs ?? 0) + 1 });
          return;
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      async exists(path: string) {
        return mem ? mem.has(path) || world.dirs.has(path) : existsSync(path);
      },
    },
    env: {
      async get(name: string) {
        return world.env.get(name);
      },
      async set(name: string, value: string | undefined) {
        if (value === undefined) world.env.delete(name);
        else world.env.set(name, value);
      },
    },
    settings: {
      async read() {
        return typeof world.settings === 'function' ? (world.settings as () => unknown)() : world.settings;
      },
    },
    session: {
      async root() {
        return world.root;
      },
    },
    command: {
      async register(spec: { name: string }) {
        world.commands.push(spec.name);
        return { command: spec.name };
      },
    },
    ui: {
      status(text: string | undefined) {
        world.statuses.push(text);
      },
      log(text: string) {
        if (world.failLog) throw new Error('ui.log refused');
        world.logs.push(text);
      },
      toast(text: string) {
        world.toasts.push(text);
      },
    },
  };
}

function matches(matcher: Record<string, unknown> | undefined, e: Record<string, unknown>): boolean {
  if (!matcher) return true;
  return Object.entries(matcher).every(([k, want]) => {
    const got = e[k];
    if (want instanceof RegExp) return typeof got === 'string' && want.test(got);
    if (Array.isArray(want)) return want.includes(got);
    return got === want;
  });
}

export type Core = (event: string, e: any) => any;

export function loadMod(register: (on: any, options: any) => unknown, world: World, options: Record<string, unknown> = {}) {
  const regs: Registration[] = [];
  const on = (event: string, a: unknown, b?: unknown) => {
    const reg: Registration = b ? { event, matcher: a as Record<string, unknown>, hook: b as AnyHook } : { event, hook: a as AnyHook };
    regs.push(reg);
    return {
      catch(handler: AnyHook) {
        if (reg.onCatch) throw new Error('a second .catch on one registration');
        reg.onCatch = handler;
      },
    };
  };
  register(on, options);
  const $ = engineOf(world);

  async function dispatch(event: string, e: any, core: (e: any) => any): Promise<any> {
    const chain = regs.filter((r) => r.event === event && matches(r.matcher, e));
    const run = async (i: number, ev: any): Promise<any> => {
      if (i >= chain.length) return core(ev);
      const reg = chain[i]!;
      let called = false;
      let last: Promise<any> | undefined;
      const next: any = (x: any) => {
        called = true;
        last = run(i + 1, x);
        return last;
      };
      try {
        return await reg.hook($, Object.freeze({ ...ev }), next);
      } catch (error) {
        if (!reg.onCatch) return called ? last : run(i + 1, ev);
        const caught: any = (x: any) => (called ? last : next(x));
        caught.error = { kind: 'throw', message: String((error as Error)?.message ?? error), budget: 1000 };
        caught.called = called;
        return await reg.onCatch($, Object.freeze({ ...ev }), caught);
      }
    };
    return run(0, e);
  }

  /** Runs the engine.create fold over `$` (core answers `$` as built so far). */
  async function create(): Promise<any> {
    return dispatch('engine.create', { plugins: ['ruflo-mods'] }, () => $);
  }

  return { $, dispatch, create, regs, events: () => [...new Set(regs.map((r) => r.event))] };
}
