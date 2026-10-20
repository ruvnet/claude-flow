import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, createMessageBus } from '../src/message-bus.js';

// Covers the gap explicitly disclosed as a known limitation in message-bus.ts's
// handleDeliveryError() (introduced by #3562/#3563's event-driven rewrite): a
// broadcast message's retry re-queue used message.to ('broadcast') instead of
// the per-subscriber agentId enqueue() originally fanned the message out to,
// so a failing broadcast subscriber's retries — and eventual message.failed —
// were silently dropped into an orphaned, never-drained 'broadcast' queue.
describe('MessageBus - broadcast delivery retry accounting', () => {
  let bus: MessageBus;

  beforeEach(async () => {
    bus = createMessageBus({
      processingIntervalMs: 5,
      retryAttempts: 3,
      ackTimeoutMs: 1000,
    });
    await bus.initialize();
  });

  afterEach(async () => {
    await bus.shutdown();
  });

  it('bounds a failing broadcast subscriber at retryAttempts and emits message.failed, matching the direct-message path', async () => {
    let badInvocations = 0;
    let goodInvocations = 0;
    let failedEvents = 0;
    let retryEvents = 0;

    bus.on('message.failed', () => {
      failedEvents++;
    });
    bus.on('message.retry', () => {
      retryEvents++;
    });

    bus.subscribe('agent-bad', () => {
      badInvocations++;
      throw new Error('simulated handler crash');
    });
    bus.subscribe('agent-good', () => {
      goodInvocations++;
    });

    await bus.broadcast({
      type: 'direct',
      from: 'agent-sender',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    // retryAttempts=3, processingIntervalMs=5ms — exhausting retries takes a
    // handful of ticks; this window is generous, not tight.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The failing subscriber must be retried up to the configured bound and
    // then emit message.failed — today it is delivered exactly once and then
    // silently dropped (retried into an orphaned 'broadcast' queue nobody
    // drains), so this assertion fails against the real baseline.
    expect(badInvocations).toBe(3);
    expect(retryEvents).toBe(2);
    expect(failedEvents).toBe(1);

    // The healthy subscriber in the same broadcast must be unaffected.
    expect(goodInvocations).toBe(1);

    // Counts must stay stable after the bound, not keep climbing or re-fire.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(badInvocations).toBe(3);
    expect(retryEvents).toBe(2);
    expect(failedEvents).toBe(1);
  });

  it('does not leak an orphaned "broadcast"-keyed queue after retries resolve', async () => {
    bus.subscribe('agent-bad', () => {
      throw new Error('simulated handler crash');
    });

    await bus.broadcast({
      type: 'direct',
      from: 'agent-sender',
      payload: {},
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // getQueueDepth() sums every live queue (not just subscribed ones) — a
    // stray 'broadcast'-keyed queue entry would otherwise sit unread forever
    // and inflate this past 0.
    expect(bus.getQueueDepth()).toBe(0);
  });
});

describe('MessageBus - retry for a subscriber that unsubscribes during backoff', () => {
  it('does not recreate an orphaned queue for the departed subscriber', async () => {
    const bus = createMessageBus({ processingIntervalMs: 5, retryAttempts: 3, ackTimeoutMs: 1000 });
    await bus.initialize();
    let invocations = 0;
    bus.subscribe('agent-bad', () => {
      invocations++;
      bus.unsubscribe('agent-bad');
      throw new Error('simulated handler crash');
    });
    await bus.broadcast({
      type: 'direct',
      from: 'agent-sender',
      payload: {},
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(invocations).toBe(1);
    expect(bus.getQueueDepth()).toBe(0);
    await bus.shutdown();
  });
});
