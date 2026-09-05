/**
 * @claude-flow/browser - Causal Recovery Store (ADR-122 Phase 2)
 *
 * In-process store for selector-break events with origin-scoped risk scoring.
 *
 * Phase 2 ships an in-memory + JSON-persistence implementation so the
 * recovery loop works without external dependencies. Phase 2.5 swaps the
 * backend for AgentDB causal-edge MCP tools (`mcp__claude-flow__agentdb_causal-edge`)
 * once we have the bridge wired.
 *
 * The IBreakStore interface keeps the swap a one-file change.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SelectorBreakEventSchema,
  type SelectorBreakEvent,
  type CausalRiskAnnotation,
  type RecoveryExplanation,
  type SelectorBreakKind,
} from '../domain/causal-recovery.js';

export interface IBreakStore {
  recordBreak(event: Omit<SelectorBreakEvent, 'id' | 'timestamp'> & Partial<Pick<SelectorBreakEvent, 'id' | 'timestamp'>>): Promise<SelectorBreakEvent>;
  /** Get all break events for an origin. */
  listBreaks(origin: string): Promise<SelectorBreakEvent[]>;
  /** Risk score for a (origin, selector) pair, computed from break-history. */
  getRisk(origin: string, selector: string): Promise<CausalRiskAnnotation>;
  /** Explain a current failure using prior break events + suggest alternative locators. */
  explainRecovery(origin: string, failingSelector: string, options?: { lastKnownRole?: string; lastKnownName?: string }): Promise<RecoveryExplanation>;
  /** Clear store (tests). */
  clear(): Promise<void>;
}

interface StoreState {
  /** All recorded breaks. */
  breaks: SelectorBreakEvent[];
  /** Per-origin attempt counts (for risk denominator). */
  attempts: Record<string, Record<string, number>>;
}

export class InMemoryBreakStore implements IBreakStore {
  protected state: StoreState = { breaks: [], attempts: {} };

  async recordBreak(input: Omit<SelectorBreakEvent, 'id' | 'timestamp'> & Partial<Pick<SelectorBreakEvent, 'id' | 'timestamp'>>): Promise<SelectorBreakEvent> {
    const event = SelectorBreakEventSchema.parse({
      id: input.id ?? `brk-${Date.now()}-${randomBytes(3).toString('hex')}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
      origin: input.origin,
      path: input.path,
      selector: input.selector,
      action: input.action,
      kind: input.kind,
      reason: input.reason,
      lastKnownRole: input.lastKnownRole,
      lastKnownName: input.lastKnownName,
      sessionId: input.sessionId,
    });
    this.state.breaks.push(event);
    return event;
  }

  /** Record an attempt (success or failure) — denominator for risk scoring. */
  recordAttempt(origin: string, selector: string): void {
    const perOrigin = this.state.attempts[origin] ?? (this.state.attempts[origin] = {});
    perOrigin[selector] = (perOrigin[selector] ?? 0) + 1;
  }

  async listBreaks(origin: string): Promise<SelectorBreakEvent[]> {
    return this.state.breaks.filter(b => b.origin === origin);
  }

  async getRisk(origin: string, selector: string): Promise<CausalRiskAnnotation> {
    const breaks = this.state.breaks.filter(b => b.origin === origin && b.selector === selector);
    const attempts = this.state.attempts[origin]?.[selector] ?? Math.max(breaks.length, 1);
    const riskScore = Math.min(1, breaks.length / attempts);
    const lastBreak = breaks[breaks.length - 1];
    return {
      selector,
      riskScore,
      breakCount: breaks.length,
      lastBreakId: lastBreak?.id,
      lastBreakKind: lastBreak?.kind,
    };
  }

  async explainRecovery(
    origin: string,
    failingSelector: string,
    options: { lastKnownRole?: string; lastKnownName?: string } = {},
  ): Promise<RecoveryExplanation> {
    // Prior breaks on the same origin+selector family. We consider "family"
    // generously: a selector @e3 today might be @e4 tomorrow but they share
    // role/name from prior snapshots — match those too if provided.
    const exact = this.state.breaks.filter(b => b.origin === origin && b.selector === failingSelector);
    const familyByRole = options.lastKnownRole
      ? this.state.breaks.filter(b => b.origin === origin && b.lastKnownRole === options.lastKnownRole)
      : [];
    const familyByName = options.lastKnownName
      ? this.state.breaks.filter(b => b.origin === origin && b.lastKnownName === options.lastKnownName)
      : [];
    const priorBreaks = dedupeBreaks([...exact, ...familyByRole, ...familyByName]);

    const suggestions: RecoveryExplanation['suggestions'] = [];
    if (options.lastKnownRole && options.lastKnownName) {
      suggestions.push({
        strategy: 'find-role',
        value: `${options.lastKnownRole} --name "${options.lastKnownName}"`,
        confidence: 0.85,
        rationale: 'Last successful resolution had a stable role+name pair. Role-based locators survive structural reflows.',
      });
    } else if (options.lastKnownName) {
      suggestions.push({
        strategy: 'find-text',
        value: options.lastKnownName,
        confidence: 0.65,
        rationale: 'Last known accessible name; text-based locators are reasonably stable for visible elements.',
      });
    }
    // Generic fallback ordering, by SOTA stability heuristics.
    suggestions.push({
      strategy: 'find-testid',
      value: '(use page-specific testid if known)',
      confidence: 0.95,
      rationale: 'data-testid is the most resilient locator strategy — survives styling and layout changes.',
    });

    return {
      origin,
      failingSelector,
      priorBreaks,
      suggestions,
    };
  }

  async clear(): Promise<void> {
    this.state = { breaks: [], attempts: {} };
  }

  /** Direct accessor for the in-memory state (tests / persistence). */
  snapshot(): StoreState {
    return this.state;
  }

  /** Restore state from a previous snapshot. */
  restore(state: StoreState): void {
    this.state = state;
  }
}

function dedupeBreaks(events: SelectorBreakEvent[]): SelectorBreakEvent[] {
  const seen = new Set<string>();
  const out: SelectorBreakEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** JSON-on-disk persistence wrapper. */
export class JsonFileBreakStore extends InMemoryBreakStore {
  constructor(private readonly path: string) {
    super();
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) return;
    try {
      const raw = await readFile(this.path, 'utf8');
      this.restore(JSON.parse(raw) as StoreState);
    } catch {
      // Corrupt file — start fresh rather than crashing the agent.
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.snapshot(), null, 2), 'utf8');
  }

  async recordBreak(input: Parameters<InMemoryBreakStore['recordBreak']>[0]): Promise<SelectorBreakEvent> {
    const event = await super.recordBreak(input);
    await this.save();
    return event;
  }
}

/**
 * Helper: classify an adapter ActionResult error into a SelectorBreakKind.
 *
 * Maps agent-browser / Playwright stderr patterns to our taxonomy. Returns
 * `unknown` rather than throwing so callers always get something to record.
 */
export function classifyBreak(reason: string | undefined): SelectorBreakKind {
  if (!reason) return 'unknown';
  const r = reason.toLowerCase();
  // Check navigation FIRST: "frame detached during navigation" is fundamentally a
  // navigation event, not a stale-element event — without this order swap, the
  // generic `detached` branch wins and mis-classifies.
  if (r.includes('navigation') || r.includes('frame detached')) return 'navigation-during-action';
  if (r.includes('not found') || r.includes('no element')) return 'element-not-found';
  if (r.includes('not visible') || r.includes('hidden')) return 'element-not-visible';
  if (r.includes('not enabled') || r.includes('disabled')) return 'element-not-enabled';
  if (r.includes('detached') || r.includes('stale element')) return 'element-detached';
  if (r.includes('stale ref') || (r.includes('@e') && r.includes('expired'))) return 'ref-stale';
  if (r.includes('timeout') || r.includes('timed out')) return 'timeout';
  return 'unknown';
}

/** Parse a URL into origin + path for causal-graph isolation. */
export function parseUrl(url: string): { origin: string; path: string } {
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname + u.search };
  } catch {
    return { origin: url, path: '/' };
  }
}
