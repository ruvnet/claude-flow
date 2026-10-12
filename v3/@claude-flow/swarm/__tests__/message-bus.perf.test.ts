import { describe, it, expect, vi } from 'vitest';
import { MessageBus, createMessageBus } from '../src/message-bus.js';

// Dream Cycle 2026-09-30 (performance): regression bounds for the MessageBus
// event-driven dispatch fix. Every assertion is a call-count bound derived
// from the configured backstop floor or from the number of messages sent --
// none depends on wall-clock ratios or on an unmeasured "pre-fix" baseline.

const spyProcessQueues = (bus: MessageBus) =>
  vi.spyOn(bus as unknown as { processQueues: () => void }, 'processQueues');

describe('MessageBus - dispatch cost bounds (dream-cycle 2026-09-30)', () => {
  it('idle: processQueues() wakeups are bounded by the >=250ms backstop even when 10ms is configured', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 }); // matches UnifiedSwarmCoordinator/SwarmHub
    const spy = spyProcessQueues(bus);
    await bus.initialize();

    const windowMs = 1000;
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    await bus.shutdown();

    // The backstop interval is floored at 250ms, so at most ceil(1000/250)
    // ticks (+1 for timer jitter) can occur with no traffic.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(Math.ceil(windowMs / 250) + 1);
  });

  it('sparse traffic: dispatch passes are bounded by messages sent, not by elapsed time', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 });
    const spy = spyProcessQueues(bus);
    await bus.initialize();

    let delivered = 0;
    bus.subscribe('agent-good', () => {
      delivered++;
    });

    const N = 20;
    for (let i = 0; i < N; i++) {
      await new Promise<void>((resolve) => {
        bus.once('message.delivered', () => resolve());
        void bus.send({
          type: 'direct',
          from: 'agent-sender',
          to: 'agent-good',
          payload: { i },
          priority: 'normal',
          requiresAck: false,
          ttlMs: 60000,
        });
      });
    }
    await bus.shutdown();

    expect(delivered).toBe(N);
    // One event-driven pass per message; one extra per backstop tick that
    // could land during the (short) run is covered by the slack of N.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2 * N);
  });

  it('saturated burst: all messages are delivered in about total/10 passes (per-agent batch cap), not one pass per message', async () => {
    const bus = createMessageBus({ processingIntervalMs: 10 });
    const spy = spyProcessQueues(bus);
    await bus.initialize();

    let delivered = 0;
    bus.subscribe('agent-good', () => {
      delivered++;
    });

    const TOTAL = 2000;
    const sends: Promise<string>[] = [];
    for (let i = 0; i < TOTAL; i++) {
      sends.push(
        bus.send({
          type: 'direct',
          from: 'agent-sender',
          to: 'agent-good',
          payload: { i },
          priority: 'normal',
          requiresAck: false,
          ttlMs: 60000,
        })
      );
    }
    await Promise.all(sends);

    // Bounded drain wait (completion is the assertion, not its duration).
    const deadline = Date.now() + 10000;
    while (delivered < TOTAL && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await bus.shutdown();

    expect(delivered).toBe(TOTAL);
    // processQueues() takes <=10 messages per agent per pass, so a full drain
    // needs ~TOTAL/10 passes; a handful of extra backstop ticks is allowed.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(TOTAL / 10);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(TOTAL / 10 + 10);
  });
});
