/**
 * Tests for MemoryPoisonForensics (ADR-377 Phase 2, ruvnet/ruflo#2516, #2873).
 *
 * Covers:
 *  - recordAndAnalyze returns `safe: true` until a real baseline exists
 *  - a content-length outlier is flagged once baseline is established
 *  - a write-interval outlier is flagged
 *  - the rolling window is bounded at `windowSize`
 *  - isPoisonForensicsEnabled respects CLAUDE_FLOW_POISON_FORENSICS='0'
 *  - createMemoryPoisonForensicsHandler ignores non-memory-write tools and
 *    surfaces warnings (never blocks) for anomalous writes
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  MemoryPoisonForensics,
  isPoisonForensicsEnabled,
  createMemoryPoisonForensicsHandler,
  type WriteEvent,
} from '../src/workers/memory-poison-forensics.js';
import { HookEvent, type HookContext } from '../src/types.js';

const ENV = 'CLAUDE_FLOW_POISON_FORENSICS';

afterEach(() => {
  delete process.env[ENV];
});

function writeAt(timestamp: number, contentLength: number, overrides: Partial<WriteEvent> = {}): WriteEvent {
  return { agentId: 'agent-A', namespace: 'default', timestamp, contentLength, ...overrides };
}

describe('MemoryPoisonForensics — baseline warm-up', () => {
  it('reports safe with baselineSize=0 before any writes are recorded', () => {
    const f = new MemoryPoisonForensics({ minBaselineSize: 5 });
    const result = f.recordAndAnalyze(writeAt(1000, 100));
    expect(result.safe).toBe(true);
    expect(result.baselineSize).toBe(0);
  });

  it('stays safe until minBaselineSize prior writes exist', () => {
    const f = new MemoryPoisonForensics({ minBaselineSize: 5 });
    for (let i = 0; i < 4; i++) {
      const result = f.recordAndAnalyze(writeAt(1000 + i * 100, 100));
      expect(result.safe).toBe(true);
    }
  });
});

describe('MemoryPoisonForensics — content-length outlier', () => {
  it('flags a write far larger than the established baseline', () => {
    const f = new MemoryPoisonForensics({ minBaselineSize: 5, zScoreThreshold: 2 });
    // Establish a tight baseline: content length ~100 chars, evenly spaced writes.
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      f.recordAndAnalyze(writeAt(t, 100));
      t += 1000;
    }
    // A 50,000-char write is a massive outlier against a baseline of ~100.
    const result = f.recordAndAnalyze(writeAt(t, 50_000));
    expect(result.safe).toBe(false);
    expect(result.findings.some((finding) => finding.feature === 'content-length')).toBe(true);
  });

  it('does not flag writes close to the baseline mean', () => {
    const f = new MemoryPoisonForensics({ minBaselineSize: 5 });
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      f.recordAndAnalyze(writeAt(t, 95 + (i % 3) * 2)); // 95-99 char range
      t += 1000;
    }
    const result = f.recordAndAnalyze(writeAt(t, 97));
    expect(result.safe).toBe(true);
  });
});

describe('MemoryPoisonForensics — write-interval outlier', () => {
  it('flags a write that arrives far outside the established cadence', () => {
    const f = new MemoryPoisonForensics({ minBaselineSize: 5, zScoreThreshold: 2 });
    let t = 0;
    // Establish a steady ~1000ms cadence.
    for (let i = 0; i < 10; i++) {
      t += 1000;
      f.recordAndAnalyze(writeAt(t, 100));
    }
    // Next write arrives 1ms later — a burst far outside the ~1000ms cadence.
    const result = f.recordAndAnalyze(writeAt(t + 1, 100));
    expect(result.findings.some((finding) => finding.feature === 'write-interval')).toBe(true);
  });
});

describe('MemoryPoisonForensics — rolling window bound', () => {
  it('caps stored events at windowSize', () => {
    const f = new MemoryPoisonForensics({ windowSize: 5, minBaselineSize: 2 });
    for (let i = 0; i < 20; i++) f.recordAndAnalyze(writeAt(1000 + i * 100, 100));
    expect(f.getWindow('agent-A', 'default').length).toBe(5);
  });
});

describe('isPoisonForensicsEnabled', () => {
  it('defaults to enabled when unset', () => {
    delete process.env[ENV];
    expect(isPoisonForensicsEnabled()).toBe(true);
  });

  it('disables only on the literal value "0"', () => {
    process.env[ENV] = '0';
    expect(isPoisonForensicsEnabled()).toBe(false);
    process.env[ENV] = 'false';
    expect(isPoisonForensicsEnabled()).toBe(true);
  });
});

describe('createMemoryPoisonForensicsHandler', () => {
  function toolContext(name: string, parameters: Record<string, unknown>): HookContext {
    return {
      event: HookEvent.PostToolUse,
      timestamp: new Date(),
      tool: { name, parameters },
    };
  }

  it('ignores tools that are not memory-write calls', () => {
    const handler = createMemoryPoisonForensicsHandler(new MemoryPoisonForensics());
    const result = handler(toolContext('memory_search', { query: 'x' }));
    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it('surfaces warnings (never fails) for an anomalous write', () => {
    const forensics = new MemoryPoisonForensics({ minBaselineSize: 5, zScoreThreshold: 2 });
    const handler = createMemoryPoisonForensicsHandler(forensics);

    for (let i = 0; i < 10; i++) {
      handler(toolContext('memory_store', { agentId: 'agent-B', namespace: 'default', content: 'x'.repeat(100) }));
    }
    const result = handler(toolContext('memory_store', { agentId: 'agent-B', namespace: 'default', content: 'x'.repeat(50_000) }));

    expect(result.success).toBe(true);
    expect(result.warnings && result.warnings.length).toBeGreaterThan(0);
  });

  it('no-ops entirely when CLAUDE_FLOW_POISON_FORENSICS=0', () => {
    process.env[ENV] = '0';
    const forensics = new MemoryPoisonForensics({ minBaselineSize: 1 });
    const handler = createMemoryPoisonForensicsHandler(forensics);
    const result = handler(toolContext('memory_store', { agentId: 'agent-C', namespace: 'default', content: 'x' }));
    expect(result.success).toBe(true);
    expect(forensics.getWindow('agent-C', 'default').length).toBe(0);
  });
});
