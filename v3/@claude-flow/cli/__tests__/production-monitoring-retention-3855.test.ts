/**
 * #3855 - MonitoringHooks must honour retentionMs on reads, not only on writes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MonitoringHooks } from '../src/production/monitoring.js';

describe('MonitoringHooks retention on read (#3855)', () => {
  afterEach(() => vi.useRealTimers());

  it('expired metrics disappear from getMetrics/getMetricsSummary without new writes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const m = new MonitoringHooks({ retentionMs: 30 });
    m.gauge('a', 1);
    m.gauge('b', 2);
    expect(m.getMetrics('a')).toHaveLength(1);
    expect(Object.keys(m.getMetricsSummary()).sort()).toEqual(['a', 'b']);

    vi.setSystemTime(1_000_050);
    expect(m.getMetrics('a')).toEqual([]);
    expect(m.getMetrics('b')).toEqual([]);
    expect(m.getMetricsSummary()).toEqual({});
  });

  it('summary alone (no prior getMetrics call) also drops expired metrics', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const m = new MonitoringHooks({ retentionMs: 30 });
    m.gauge('a', 1);
    expect(Object.keys(m.getMetricsSummary())).toEqual(['a']);
    vi.setSystemTime(3_000_050);
    expect(m.getMetricsSummary()).toEqual({});
  });

  it('getMetrics alone also drops expired metrics', () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const m = new MonitoringHooks({ retentionMs: 30 });
    m.gauge('a', 1);
    vi.setSystemTime(4_000_050);
    expect(m.getMetrics('a')).toEqual([]);
  });

  it('fresh metrics are kept; only the elapsed ones expire', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const m = new MonitoringHooks({ retentionMs: 100 });
    m.gauge('old', 1);
    vi.setSystemTime(2_000_080);
    m.gauge('new', 2);
    vi.setSystemTime(2_000_150);
    expect(m.getMetrics('old')).toEqual([]);
    expect(m.getMetrics('new')).toHaveLength(1);
    expect(Object.keys(m.getMetricsSummary())).toEqual(['new']);
  });
});
