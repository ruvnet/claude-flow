/** Decides when each section is collected and sent: cadences, watch hints, hash-diff publishing with heartbeat, bounded concurrency. */
import {
  buildSectionFrame, SECTION_CADENCE_S, SECTION_MIN_SEND_GAP_MS, SECTION_NAMES, SECTION_TTL_S, sectionHash, UNWATCHED_CADENCE_FACTOR,
  type SectionFrame, type SectionName,
} from './protocol/index.js';
import { control, health, isObj, memory, meta, mission_events, missions, settings, swarm, tasks, type CollectCtx, type Collector } from './collect-core.js';
import { adrs, cost, events, whatsnew } from './collect-files.js';
import { alerts, approvals, notices } from './derive.js';
import * as P1 from './collect-p1.js';
import * as P1C from './collect-p1c.js';

export const COLLECTORS: Record<SectionName, Collector> = { meta, health, alerts, control, missions, mission_events, tasks, swarm, approvals, memory, cost, events, notices, adrs, whatsnew, settings, claims: P1.claims, hive: P1.hive, workflows: P1.workflows, learning: P1.learning, metaharness: P1.metaharness, security: P1.security, perf: P1.perf, automation: P1.automation, agents: P1C.agents, autopilot: P1C.autopilot, skills: P1C.skills, timeline: P1C.timeline, ...P1.P1_PLUGIN_COLLECTORS };
/** Stages run in order; sections inside a stage run in parallel. Later stages read the cache filled by earlier ones. */
const STAGES: SectionName[][] = [
  ['meta', 'control', 'missions', 'tasks', 'swarm', 'memory', 'settings', 'cost', 'adrs', 'whatsnew'],
  ['plugins', 'capabilities', 'capability_runs', 'claims', 'hive', 'workflows', 'learning', 'metaharness', 'security', 'perf', 'automation', 'agents', 'autopilot', 'skills'],
  ['mission_events'], ['events', 'health', 'approvals'], ['alerts', 'timeline'], ['notices'],
];
const DERIVED_AFTER = new Set<SectionName>(['events', 'health', 'approvals', 'alerts', 'notices', 'timeline']);
export const FORCED_MIN_INTERVAL_MS = 5000;
const NOTICE_RING = 30;

/** Hash input without values that drift on their own (an approval's age), so an idle machine sends only heartbeats. */
function stable(name: SectionName, body: Record<string, unknown>): unknown {
  if (name !== 'approvals') return body;
  return { items: (Array.isArray(body.items) ? body.items : []).map((i: Record<string, unknown>) => ({ kind: i.kind, text: i.text })) };
}

export interface SchedulerOpts {
  ctx: Omit<CollectCtx, 'cache' | 'errors' | 'notices'>;
  emit: (frame: SectionFrame) => void;
  now?: () => number;
  /** Test hook: only these sections are scheduled. */
  only?: readonly SectionName[];
}
export interface TickResult { collected: SectionName[]; sent: SectionName[] }

export class SectionScheduler {
  private cache: CollectCtx['cache'] = {};
  private errors = new Map<string, string>();
  private hashes = new Map<SectionName, string>();
  private lastRun = new Map<SectionName, number>();
  private lastSent = new Map<SectionName, number>();
  private lastForced = new Map<SectionName, number>();
  private lastAll: number | undefined;
  private running = new Set<SectionName>();
  private ring: { at: number; level: string; text: string; key: string }[] = [];
  private lastMissionState = new Map<string, string>();
  private revBase: number; private revs = new Map<SectionName, number>();
  private watch: Set<SectionName> | null = null;
  private now: () => number;
  private names: readonly SectionName[];
  constructor(private o: SchedulerOpts) {
    this.now = o.now ?? Date.now; this.revBase = Math.floor(this.now() / 1000);
    this.names = (o.only ?? SECTION_NAMES);
  }

  /** After a reconnect the server may have lost its copy: forget what was sent so everything is re-sent once. */
  resetSent(): void { this.hashes.clear(); this.lastSent.clear(); this.lastRun.clear(); }
  /** Collect this section on the next pass whatever its cadence (request-driven republish: no immediate path, no extra quota use). */
  markDirty(name: SectionName): void { this.lastRun.delete(name); }
  setWatch(list: readonly SectionName[]): void { this.watch = new Set(list); }
  notice(level: 'info' | 'warn' | 'error', text: string, key: string): void {
    this.ring.unshift({ at: this.now(), level, text: text.slice(0, 200), key: key.slice(0, 60) }); this.ring.length = Math.min(this.ring.length, NOTICE_RING);
  }
  snapshot(): CollectCtx['cache'] { return this.cache; }
  errorsNow(): ReadonlyMap<string, string> { return this.errors; }

  /** Cadence in ms for a section right now (5 s for missions while one runs; unwatched sections are slower once a watch hint exists). */
  cadenceMs(name: SectionName): number {
    let s: number = SECTION_CADENCE_S[name];
    if (name === 'missions' && (this.cache.missions as { missions?: { state?: string }[] } | undefined)?.missions?.some(m => /^running|^executing/i.test(m.state ?? ''))) s = 5;
    if (this.watch && !this.watch.has(name) && !DERIVED_AFTER.has(name)) s *= UNWATCHED_CADENCE_FACTOR;
    return s * 1000;
  }
  private due(name: SectionName, now: number): boolean {
    if (this.running.has(name)) return false;
    const last = this.lastRun.get(name);
    return last === undefined || now - last >= this.cadenceMs(name);
  }

  private ctx(): CollectCtx { return { ...this.o.ctx, now: this.now, cache: this.cache, errors: this.errors, notices: () => this.ring }; }

  private async collectOne(name: SectionName, force: boolean): Promise<boolean> {
    this.running.add(name); const t = this.now(); this.lastRun.set(name, t);
    try {
      const body = await COLLECTORS[name](this.ctx());
      this.errors.delete(name);
      this.afterCollect(name, body);
      const frame = this.frameIfNeeded(name, body, force, t);
      if (frame) { this.o.emit(frame); return true; }
      return false;
    } catch (e) {
      const msg = `${(e as Error).message ?? 'failed'}`.slice(0, 160);
      if (!this.errors.has(name)) this.notice('warn', `${name} could not be read: ${msg}`, `collect:${name}`);
      this.errors.set(name, msg);
      return false;
    } finally { this.running.delete(name); }
  }

  private afterCollect(name: SectionName, body: Record<string, unknown>): void {
    this.cache[name] = body;
    if (name !== 'missions') return;
    for (const m of (Array.isArray(body.missions) ? body.missions : []).filter(isObj)) {
      const id = String(m.id), st = String(m.state), prev = this.lastMissionState.get(id);
      if (prev !== undefined && prev !== st) this.notice(/fail|error/i.test(st) ? 'error' : 'info', `Mission ${id}: ${prev} -> ${st}`, `mission:${id}`);
      this.lastMissionState.set(id, st);
    }
  }

  /** Send when content changed, or when half the ttl has elapsed (heartbeat), or when forced. */
  private frameIfNeeded(name: SectionName, body: Record<string, unknown>, force: boolean, t: number): SectionFrame | null {
    // The server drops a frame that follows the previous one of this section too closely, without telling us. Do not mark it sent: it is retried on a later pass.
    const lastAt = this.lastSent.get(name);
    if (!force && lastAt !== undefined && t - lastAt < SECTION_MIN_SEND_GAP_MS(name)) { this.lastRun.delete(name); return null; } // retried on the next pass
    const frame0 = buildSectionFrame(name, body as never, { rev: 0, at: t });
    const hash = sectionHash(stable(name, frame0.body));
    const heartbeat = t - (this.lastSent.get(name) ?? 0) >= (SECTION_TTL_S[name] * 1000) / 2;
    if (!force && hash === this.hashes.get(name) && !heartbeat) return null;
    const rev = (this.revs.get(name) ?? this.revBase) + (this.revs.has(name) ? 1 : 0);
    this.revs.set(name, rev); this.hashes.set(name, hash); this.lastSent.set(name, t);
    return { ...frame0, rev };
  }

  /** One scheduling pass: collect every due section (watched first) and send what changed. */
  async tick(): Promise<TickResult> {
    const now = this.now(); const res: TickResult = { collected: [], sent: [] };
    const rank = (n: SectionName) => (this.watch?.has(n) ? 0 : 1);
    for (const stage of STAGES) {
      const due = stage.filter(n => this.names.includes(n) && this.due(n, now)).sort((x, y) => rank(x) - rank(y));
      await Promise.all(due.map(async n => { res.collected.push(n); if (await this.collectOne(n, false)) res.sent.push(n); }));
    }
    return res;
  }

  /** Force one section out now (rate-limited per section). */
  async refresh(name: SectionName, opts: { immediate?: boolean } = {}): Promise<{ sent: boolean; rateLimited?: boolean }> {
    const now = this.now(); const last = this.lastForced.get(name);
    // `immediate` is for the connector's own publishes (a run just started or ended), never for a browser's request.
    if (!opts.immediate && last !== undefined && now - last < FORCED_MIN_INTERVAL_MS) return { sent: false, rateLimited: true };
    if (!opts.immediate) this.lastForced.set(name, now);
    // The connector's own publish must not be lost to a pass that is already collecting this section (its data may predate the change): wait for it.
    for (let i = 0; opts.immediate && this.running.has(name) && i < 100; i++) await new Promise(r => setTimeout(r, 20));
    if (!this.names.includes(name)) return { sent: false };
    if (DERIVED_AFTER.has(name) === false && this.running.has(name)) return { sent: false };
    if (opts.immediate) { // wait out the server's per-section gap instead of losing the publish
      const wait = (this.lastSent.get(name) ?? -Infinity) + SECTION_MIN_SEND_GAP_MS(name) - this.now();
      if (wait > 0 && wait < 5000) await new Promise(r => setTimeout(r, wait));
    }
    return { sent: await this.collectOne(name, true) };
  }

  /** Force everything out (state.refresh), rate-limited as a whole. */
  async refreshAll(): Promise<{ sent: SectionName[]; rateLimited?: boolean }> {
    const now = this.now();
    if (this.lastAll !== undefined && now - this.lastAll < FORCED_MIN_INTERVAL_MS) return { sent: [], rateLimited: true };
    this.lastAll = now;
    const sent: SectionName[] = [];
    for (const stage of STAGES) await Promise.all(stage.filter(n => this.names.includes(n)).map(async n => { if (await this.collectOne(n, true)) sent.push(n); }));
    return { sent };
  }
}
