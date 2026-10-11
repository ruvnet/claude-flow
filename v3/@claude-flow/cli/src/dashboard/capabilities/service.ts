/**
 * Capability service: resolves dashboard requests against the LOCALLY built catalog only, validates arguments against hand-written schemas, produces the exact
 * thing the person approves on the card, re-verifies hashes after the answer, runs through fixed argv / the allowlisted ruflo tools, and keeps the run history.
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets, sanitize, type CommandName } from '../protocol/index.js';
import { printable } from '../approver.js';
import { trustedScript } from '../collect-files.js';
import { confine } from '../read.js';
import { runArgv, type Ruflo, type RunResult } from '../exec.js';
import type { AuditLog } from '../state.js';
import { buildCatalog, buildCatalogAsync, catalogBody, pluginCacheRoot, pluginsBody, readPinned, rootsFor, type Roots } from './catalog.js';
import { projectStoreRedirects } from './store.js';
import { DEFAULT_BINDINGS, type BindingTable } from './bindings.js';
import { sha256Hex } from './hash.js';
import { checkOptionValue } from './options.js';
import { projectShadowsMetaharness } from '../collect-p1.js';
import type { ArgSpec, ArgValues, Binding, CapLevel, CatalogCap, CatalogPlugin, RefuseCode } from './types.js';

type Obj = Record<string, unknown>;
export type CapCommand = Extract<CommandName, 'plugin.list' | 'plugin.enable' | 'plugin.disable' | 'capability.run' | 'mod.option.set'>;
export const CAP_COMMANDS: ReadonlySet<string> = new Set<CapCommand>(['plugin.list', 'plugin.enable', 'plugin.disable', 'capability.run', 'mod.option.set']);
export const HISTORY_MAX = 40;
/** plugin.list rebuilds the catalog: at most one per device per 5 s. */
export const LIST_MIN_INTERVAL_MS = 5000;
export const MAX_MCP_TIMEOUT_MS = 300_000;
export const RUNS_PER_MINUTE = 6;
export const READ_TIMEOUT_MS = 30_000;
export const WRITE_TIMEOUT_MS = 120_000;
const TAIL_KEEP_FULL = 3;
/** Disabling these needs the plugin name typed on the card: they are the guards. */
const GUARD_PLUGINS = new Set(['ruflo-protector', 'ruflo-mods']);

export type Outcome = 'succeeded' | 'failed' | 'denied' | 'refused' | 'expired' | 'changed';
export interface RunRecord { runId: string; capabilityId: string; plugin?: string; /** audit only, never published */ argvSha?: string; approved?: boolean; command: string; level: string; risk: string; by: string; startedAt: number; endedAt: number; exit: number | null; bytes: number; truncated: boolean; outcome: Outcome; reason?: string; tail?: string; /** Which binding ran: `mcp:<tool>`, `cli:<program> <subcommand>` or `script:<file>` (P-550). Never an argument value. */ binding?: string }
export interface Pin { pluginId: string; manifestSha: string; capabilityId?: string; fileSha12?: string; argvSha: string }
export interface Prepared {
  ok: true; command: CapCommand; level: CapLevel; risk: string; summary: string; by: string;
  /** Everything the person sees on the card, in full. */
  card: Record<string, string | number | boolean>; typed?: string; pin: Pin; capabilityId: string;
  plan: Plan; /** The validated request this was built from; execute rebuilds from it after the answer. */ request: Obj;
}
export type Refusal = { ok: false; code: string };
type Plan =
  | { t: 'list' }
  | { t: 'mcp'; tool: string; params: Obj; timeoutMs: number; shadowCheck: boolean }
  | { t: 'argv'; argv: string[]; stdin?: string; timeoutMs: number; script?: { dir: string; file: string; sha256: Record<string, string> } };

export interface ServiceDeps {
  home: string; /** CLAUDE_CONFIG_DIR and a relocated plugin cache; default <home>/.claude */ roots?: Roots; projectDir: string; ruflo: Ruflo; rufloBase: string[] | null; claude: string | null; audit: AuditLog;
  run?: (argv: string[], o: { cwd: string; timeoutMs: number; stdin?: string }) => Promise<RunResult>;
  table?: BindingTable; now?: () => number;
  /** Allowed recorded sources for the `ruflo` marketplace (config.json `marketplaceSources`). */
  marketplaceSources?: readonly string[];
  /** Ask the scheduler to re-publish these sections: next pass by default, `immediate` only for the run's own start/end. */
  onChange?: (sections: Array<'plugins' | 'capabilities' | 'capability_runs'>, o?: { immediate?: boolean }) => void;
}

export class CapabilityService {
  private lastList: number | undefined;
  private history: RunRecord[] = [];
  private active: { runId: string; capabilityId: string; startedAt: number; tail: string } | null = null;
  private starts: number[] = [];
  private table: BindingTable; private now: () => number;
  constructor(private d: ServiceDeps) { this.table = d.table ?? DEFAULT_BINDINGS; this.now = d.now ?? Date.now; }

  private get roots(): Roots { return this.d.roots ?? rootsFor(this.d.home); }
  /** Uncached, synchronous: used to resolve and re-verify a single plugin. */
  catalog(only?: string) { return buildCatalog(this.roots, only, this.table, this.d.marketplaceSources); }
  private shared: { at: number; p: Promise<ReturnType<typeof buildCatalog>> } | null = null;
  /** One cached, yielding build shared by the plugins and capabilities collectors of a pass (stale after 2 s or when something changed). */
  private listing() {
    const t = this.now();
    if (!this.shared || t - this.shared.at > 2000) this.shared = { at: t, p: buildCatalogAsync(this.roots, { table: this.table, marketplaceSources: this.d.marketplaceSources }) };
    return this.shared.p;
  }
  private invalidate(): void { this.shared = null; }
  async pluginsBody() { return pluginsBody(await this.listing()); }
  async capabilitiesBody() { return catalogBody(await this.listing()); }
  runsBody(): Obj {
    return {
      active: this.active ? { ...this.active } : null,
      history: this.history.map((h, i) => { const { argvSha: _a, approved: _p, ...pub } = h; return { ...pub, ...(h.tail !== undefined && i >= TAIL_KEEP_FULL ? { tail: h.tail.slice(0, 512) } : {}) }; }),
    };
  }
  /** Section sequencing helpers for the scheduler. */
  get busy(): boolean { return this.active !== null; }

  // ---------------------------------------------------------------------------------------------------------------- prepare
  async prepare(cmd: CapCommand, args: Obj, by: string): Promise<Prepared | Refusal> {
    const r = await this.prepare1(cmd, args, by);
    // A stale id (a file changed, a plugin updated) means the dashboard's copy of the catalog is old: publish the new one.
    if (!r.ok && r.code === 'unknown_capability') this.invalidate(); this.d.onChange?.(['plugins', 'capabilities']);
    return r.ok ? { ...r, request: { ...args } } : r;
  }
  private async prepare1(cmd: CapCommand, args: Obj, by: string): Promise<Prepared | Refusal> {
    try {
      switch (cmd) {
        case 'plugin.list': {
          const t = this.now(); if (this.lastList !== undefined && t - this.lastList < LIST_MIN_INTERVAL_MS) return { ok: false, code: 'rate_limited' }; this.lastList = t;
          return this.card(cmd, 'read', 'read', 'plugin.list', by, { plugin: 'all installed plugins' }, { pluginId: '', manifestSha: '', argvSha: sha256Hex('plugin.list') }, { t: 'list' });
        }
        case 'plugin.enable': case 'plugin.disable': return await this.prepareToggle(cmd, String(args.pluginId), by);
        case 'capability.run': return this.prepareRun(String(args.pluginId), String(args.capabilityId), (args.args ?? {}) as Obj, by);
        case 'mod.option.set': return await this.prepareOption(String(args.modId), String(args.key), args.value, by);
      }
    } catch { return { ok: false, code: 'prepare_failed' }; }
  }

  private card(command: CapCommand, level: CapLevel, risk: string, capabilityId: string, by: string, card: Prepared['card'], pin: Pin, plan: Plan, typed?: string): Prepared {
    return { ok: true, command, level, risk, summary: command, by, card, pin, plan, capabilityId, request: {}, ...(typed ? { typed } : {}) };
  }

  private prepareRun(pluginId: string, capabilityId: string, rawArgs: Obj, by: string): Prepared | Refusal {
    const plugin = this.catalog(pluginId).plugins.find(p => p.id === pluginId);
    const cap = plugin?.caps.find(c => c.cid === capabilityId);
    if (!plugin || !cap || !capabilityId.startsWith(`${plugin.name}/`)) return { ok: false, code: 'unknown_capability' };
    if (cap.mode !== 'run' || !cap.binding || cap.level === null) return { ok: false, code: cap.why ?? 'no-binding' };
    const b = cap.binding;
    if (b.level !== 'read' && projectStoreRedirects(this.d.projectDir).length > 0) return { ok: false, code: 'path-outside-root' }; // the project moved ruflo's store elsewhere
    const v = validateArgs(b.args, rawArgs, this.d.projectDir);
    if (!v.ok) return { ok: false, code: v.code };
    const plan = this.planFor(b, v.values, plugin);
    if (!('t' in plan)) return plan;
    const shown = plan.t === 'mcp' ? `ruflo mcp exec -t ${plan.tool} -p ${JSON.stringify(plan.params)}` : plan.t === 'argv' ? plan.argv.join(' ') : '';
    const card = { plugin: plugin.id, version: plugin.version, manifestSha: plugin.manifestSha, capability: cap.cid, risk: b.risk, run: shown, ...v.values };
    return this.card('capability.run', b.level, b.risk, cap.cid, by, card, { pluginId, manifestSha: plugin.manifestSha, capabilityId: cap.cid, fileSha12: cap.fileSha12, argvSha: sha256Hex(shown) }, plan);
  }

  private planFor(b: Binding, a: ArgValues, plugin: CatalogPlugin): Plan | Refusal {
    const timeoutMs = b.timeoutMs ?? (b.level === 'read' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
    const act = b.action;
    if (act.kind === 'mcp') return { t: 'mcp', tool: act.tool, params: act.params(a), timeoutMs, shadowCheck: b.metaharness === true };
    if (act.kind === 'cli') return this.d.rufloBase ? { t: 'argv', argv: [...this.d.rufloBase, ...act.argv(a)], timeoutMs } : { ok: false, code: 'ruflo_not_found' };
    return { t: 'argv', argv: [process.execPath, join(plugin.dir, act.file), ...act.argv(a)], timeoutMs, script: { dir: plugin.dir, file: act.file, sha256: act.sha256 } };
  }

  private async prepareToggle(cmd: 'plugin.enable' | 'plugin.disable', pluginId: string, by: string): Promise<Prepared | Refusal> {
    const plugin = this.catalog(pluginId).plugins.find(p => p.id === pluginId);
    if (!plugin) return { ok: false, code: 'unknown_plugin' };
    const enable = cmd === 'plugin.enable';
    if (enable && plugin.foreign) return { ok: false, code: 'foreign-marketplace' };
    if (!this.d.claude) return { ok: false, code: 'claude_not_found' };
    if (enable && plugin.mod) {
      const cfg = await this.configure('ruflo-mods@ruflo');
      if (cfg?.inputs.modTrust === 'refuse-risky' && !(cfg.inputs.modTrustAllow ?? '').split(/[,\s]+/).includes(plugin.id)) return { ok: false, code: 'loosens-gate' };
    }
    const argv = [this.d.claude, 'plugin', enable ? 'enable' : 'disable', pluginId, '--scope', 'user'];
    const shown = argv.join(' ');
    const guard = !enable && GUARD_PLUGINS.has(plugin.name);
    const card = { plugin: plugin.id, version: plugin.version, manifestSha: plugin.manifestSha, mod: plugin.mod, run: shown, ...(guard ? { note: `${plugin.name} is a guard: type its name to confirm` } : {}) };
    return this.card(cmd, 'manage', 'write', cmd, by, card, { pluginId, manifestSha: plugin.manifestSha, argvSha: sha256Hex(shown) }, { t: 'argv', argv, timeoutMs: READ_TIMEOUT_MS }, guard ? plugin.name : undefined);
  }

  private async prepareOption(modId: string, key: string, value: unknown, by: string): Promise<Prepared | Refusal> {
    const plugin = this.catalog(modId).plugins.find(p => p.id === modId);
    if (!plugin) return { ok: false, code: 'unknown_plugin' };
    if (plugin.foreign) return { ok: false, code: 'foreign-marketplace' };
    const opt = plugin.options.find(o => o.key === key);
    if (!opt) return { ok: false, code: 'unknown_option' };
    if (!this.d.claude) return { ok: false, code: 'claude_not_found' };
    const cfg = await this.configure(modId);
    if (!cfg) return { ok: false, code: 'config_unreadable' };
    const current = cfg.inputs[key];
    const chk = checkOptionValue(opt, value, current);
    if (!chk.ok) return { ok: false, code: chk.code };
    if (typeof chk.value === 'string' && maskSecrets(chk.value) !== chk.value) return { ok: false, code: 'secret_in_args' };
    const stdin = JSON.stringify({ [key]: String(chk.value) });
    const argv = [this.d.claude, 'plugin', 'configure', modId, '--values-stdin'];
    const shown = `${argv.join(' ')} < ${stdin}`;
    const card = { plugin: plugin.id, version: plugin.version, manifestSha: plugin.manifestSha, option: `${plugin.name}.${key}: ${current ?? '(unset)'} -> ${String(chk.value)}`, run: shown };
    return this.card('mod.option.set', 'write', 'write', `mod.option.set:${key}`, by, card, { pluginId: modId, manifestSha: plugin.manifestSha, argvSha: sha256Hex(shown + String(current))}, { t: 'argv', argv, stdin, timeoutMs: READ_TIMEOUT_MS }, GUARD_PLUGINS.has(plugin.name) && opt.rule !== 'bool' && opt.rule !== 'enum' && opt.rule !== 'range' ? plugin.name : undefined);
  }

  /** `claude plugin configure <id> --json`: the current inputs, parsed defensively. */
  private async configure(id: string): Promise<{ inputs: Record<string, string> } | null> {
    if (!this.d.claude) return null;
    try {
      const r = await this.runner([this.d.claude, 'plugin', 'configure', id, '--json'], { cwd: this.d.projectDir, timeoutMs: READ_TIMEOUT_MS });
      if (r.code !== 0) return null;
      const j = JSON.parse(r.stdout) as unknown;
      const inputs = j && typeof j === 'object' ? (j as Obj).inputs : undefined;
      return { inputs: Object.fromEntries(Object.entries(inputs && typeof inputs === 'object' ? (inputs as Obj) : {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)])) };
    } catch { return null; }
  }
  private runner(argv: string[], o: { cwd: string; timeoutMs: number; stdin?: string }): Promise<RunResult> { return (this.d.run ?? ((a, x) => runArgv(a, x)))(argv, o); }

  // ---------------------------------------------------------------------------------------------------------------- execute
  /** Record a command that never reached execution (refused, denied, expired). */
  recordNever(command: string, capabilityId: string, level: string, risk: string, by: string, outcome: Outcome, reason: string, extra: { plugin?: string; argvSha?: string } = {}): void {
    const t = this.now();
    this.push({ runId: this.newId(), capabilityId: capabilityId.slice(0, 200), ...(extra.plugin ? { plugin: extra.plugin } : {}), argvSha: extra.argvSha ?? sha256Hex(`${command}:${capabilityId}`), approved: false, command, level, risk, by, startedAt: t, endedAt: t, exit: null, bytes: 0, truncated: false, outcome, reason: reason.slice(0, 60) });
  }

  /** Re-verify the pin on disk, then run. Any difference voids the approval. */
  async execute(p: Prepared): Promise<{ ok: true; result: Obj } | { ok: false; error: string }> {
    const fail = (outcome: Outcome, error: string) => { this.recordNever(p.command, p.capabilityId, p.level, p.risk, p.by, outcome, error, { plugin: p.pin.pluginId, argvSha: p.pin.argvSha }); this.invalidate(); this.d.onChange?.(['plugins', 'capabilities']); this.d.onChange?.(['capability_runs'], { immediate: true }); return { ok: false as const, error }; };
    if (p.plan.t === 'list') { this.invalidate(); this.d.onChange?.(['plugins', 'capabilities']); return { ok: true, result: { published: ['plugins', 'capabilities'] } }; }
    const again = await this.prepare(p.command, p.request, p.by);
    if (!again.ok || again.pin.manifestSha !== p.pin.manifestSha || again.pin.argvSha !== p.pin.argvSha || again.pin.fileSha12 !== p.pin.fileSha12 || again.pin.capabilityId !== p.pin.capabilityId) return fail('changed', 'capability_changed');
    if (this.active) return fail('refused', 'busy');
    const t = this.now(); this.starts = this.starts.filter(s => t - s < 60_000);
    if (this.starts.length >= RUNS_PER_MINUTE) return fail('refused', 'rate_limited');
    this.starts.push(t);
    const plan = again.plan;
    const runId = this.newId();
    this.active = { runId, capabilityId: p.capabilityId, startedAt: t, tail: '' };
    this.d.onChange?.(['capability_runs'], { immediate: true });
    let exit: number | null = null; let out = ''; let truncated = false; let outcome: Outcome = 'succeeded'; let reason: string | undefined;
    try {
      if (plan.t === 'mcp') {
        if (plan.shadowCheck && projectShadowsMetaharness(this.d.projectDir)) throw new RefuseError('project-shadow');
        out = JSON.stringify(await this.d.ruflo.mcp(plan.tool, plan.params, { timeoutMs: Math.min(plan.timeoutMs, MAX_MCP_TIMEOUT_MS) })); exit = 0;
      } else if (plan.t === 'argv') {
        if (plan.script && !this.scriptTrusted(plan.script)) throw new RefuseError('script-changed');
        const r = await this.runner(plan.argv, { cwd: plan.script ? plan.script.dir : this.d.projectDir, timeoutMs: plan.timeoutMs, ...(plan.stdin !== undefined ? { stdin: plan.stdin } : {}) });
        out = r.stdout + (r.stderr ? `\n${r.stderr}` : ''); exit = r.code; truncated = r.truncated;
        if (r.timedOut) { outcome = 'failed'; reason = p.level === 'read' ? 'timeout' : 'timeout_outcome_unknown'; } else if (r.code !== 0) { outcome = 'failed'; reason = `exit_${r.code}`; }
      }
    } catch (e) {
      outcome = e instanceof RefuseError ? 'refused' : 'failed';
      const msg = printable(String((e as Error).message), 60);
      // A write that timed out may have partly landed: say so instead of "failed".
      reason = e instanceof RefuseError ? e.code : /timed out/.test(msg) ? (p.level === 'read' ? 'timeout' : 'timeout_outcome_unknown') : msg; out = out || reason;
    }
    const bytes = Buffer.byteLength(out);
    const tail = printable(maskSecrets(out), 8192);
    const rec: RunRecord = { runId, capabilityId: p.capabilityId, plugin: p.pin.pluginId || undefined, argvSha: p.pin.argvSha, approved: p.level !== 'read', command: p.command, level: p.level, risk: p.risk, by: p.by, startedAt: t, endedAt: this.now(), exit, bytes, truncated: truncated || bytes > 65536, outcome, ...(reason ? { reason } : {}), binding: bindingLabel(plan), tail };
    this.active = null; this.push(rec);
    if (p.command !== 'capability.run') { this.invalidate(); this.d.onChange?.(['plugins', 'capabilities']); }
    this.d.onChange?.(['capability_runs'], { immediate: true });
    if (outcome !== 'succeeded') return { ok: false, error: reason ?? 'failed' };
    return { ok: true, result: sanitize({ runId, exit, bytes, truncated: rec.truncated, output: tail.slice(0, 2000) }) as Obj };
  }

  private scriptTrusted(s: { dir: string; file: string; sha256: Record<string, string> }): boolean {
    const root = pluginCacheRoot(this.roots); if (!root) return false;
    let proj: string; try { proj = realpathSync(this.d.projectDir); } catch { proj = this.d.projectDir; }
    const abs = confine(s.dir, s.file); if (!abs || !trustedScript(abs, proj, root)) return false;
    return Object.entries(s.sha256).every(([rel, want]) => { const f = readPinned(s.dir, rel); return f !== null && sha256Hex(f.text) === want; });
  }

  private push(r: RunRecord): void { this.history.unshift(r); this.history.length = Math.min(this.history.length, HISTORY_MAX); this.audit(r); }
  private audit(r: RunRecord): void {
    this.d.audit.write('capability_run', { runId: r.runId, capabilityId: r.capabilityId, command: r.command, plugin: r.plugin, argvSha: r.argvSha, level: r.level, risk: r.risk, by: r.by, approvedBy: r.approved ? 'local' : 'none', startedAt: r.startedAt, endedAt: r.endedAt, exit: r.exit, bytes: r.bytes, truncated: r.truncated, outcome: r.outcome, reason: r.reason });
  }
  private newId(): string { return `run_${randomBytes(9).toString('base64url')}`; }
}
/** What ran, in a few safe words: the tool name, the program and its first subcommand, or the pinned script file. */
export function bindingLabel(plan: Plan): string | undefined {
  const clean = (t: string) => t.replace(/[^A-Za-z0-9_./ -]/g, '').slice(0, 60);
  if (plan.t === 'mcp') return `mcp:${clean(plan.tool)}`.slice(0, 80);
  if (plan.t === 'argv') return (plan.script ? `script:${clean(plan.script.file)}` : `cli:${clean((plan.argv[0] ?? '').split('/').pop() ?? '')} ${clean(plan.argv[1] ?? '')}`.trim()).slice(0, 80);
  return undefined;
}
class RefuseError extends Error { constructor(public code: RefuseCode) { super(code); } }

// -------------------------------------------------------------------------------------------------------------------- arguments
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
/** Validate request arguments against the capability's own schema. Unknown names, wrong types, option-like strings and paths outside the project are refused. */
export function validateArgs(spec: readonly ArgSpec[], given: Obj, projectDir: string): { ok: true; values: ArgValues } | { ok: false; code: string } {
  const values: ArgValues = {};
  for (const k of Object.keys(given)) if (!spec.some(s => s.name === k)) return { ok: false, code: `invalid_arguments:unknown_argument:${printable(k, 32)}` };
  for (const s of spec) {
    const v = given[s.name];
    if (v === undefined) { if (s.required) return { ok: false, code: `invalid_arguments:missing_argument:${s.name}` }; continue; }
    if (s.type === 'bool') { if (typeof v !== 'boolean') return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` }; values[s.name] = v; continue; }
    if (s.type === 'int') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (s.min ?? 0) || v > (s.max ?? 1_000_000)) return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` };
      values[s.name] = v; continue;
    }
    if (typeof v !== 'string' || CONTROL.test(v) || v.length > (s.max ?? 200)) return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` };
    if (maskSecrets(v) !== v) return { ok: false, code: 'secret_in_args' };
    if (s.type === 'enum') { if (!s.enum?.includes(v)) return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` }; values[s.name] = v; continue; }
    if (v === '' || v.startsWith('-')) return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` };
    if (s.type === 'path') {
      if (v.startsWith('/') || v.split(/[\\/]/).some(p => p === '..' || p.startsWith('.'))) return { ok: false, code: 'path-outside-root' };
      const abs = confine(projectDir, v);
      if (!abs) return { ok: false, code: 'path-outside-root' };
      values[s.name] = v; continue;
    }
    if (!s.pattern) return { ok: false, code: 'invalid_arguments:no-schema' }; // free text is never accepted
    if (!s.pattern.test(v)) return { ok: false, code: `invalid_arguments:bad_argument:${s.name}` };
    values[s.name] = v;
  }
  return { ok: true, values };
}
export type { CatalogCap };
