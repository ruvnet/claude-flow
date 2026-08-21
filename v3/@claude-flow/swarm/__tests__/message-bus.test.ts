import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, createMessageBus } from '../src/message-bus.js';

describe('MessageBus - delivery retry accounting', () => {
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

  it('bounds delivery attempts at retryAttempts and emits message.failed exactly once for a permanently-throwing subscriber', async () => {
    let callbackInvocations = 0;
    let failedEvents = 0;
    let retryEvents = 0;

    bus.on('message.failed', () => {
      failedEvents++;
    });
    bus.on('message.retry', () => {
      retryEvents++;
    });

    bus.subscribe('agent-bad', () => {
      callbackInvocations++;
      throw new Error('simulated handler crash');
    });

    await bus.send({
      type: 'direct',
      from: 'agent-good',
      to: 'agent-bad',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    // retryAttempts=3, processingIntervalMs=5ms — exhausting retries takes a
    // handful of ticks; this window is generous, not tight.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(callbackInvocations).toBe(3);
    expect(retryEvents).toBe(2);
    expect(failedEvents).toBe(1);

    // Confirm the failed message doesn't keep re-queuing after the bound —
    // counts must stay stable, not keep climbing.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(callbackInvocations).toBe(3);
    expect(retryEvents).toBe(2);
    expect(failedEvents).toBe(1);
  });

  it('delivers a healthy subscriber exactly once with no retry/failed events', async () => {
    let callbackInvocations = 0;
    let deliveredEvents = 0;
    let failedEvents = 0;
    let retryEvents = 0;

    bus.on('message.delivered', () => {
      deliveredEvents++;
    });
    bus.on('message.failed', () => {
      failedEvents++;
    });
    bus.on('message.retry', () => {
      retryEvents++;
    });

    bus.subscribe('agent-good', () => {
      callbackInvocations++;
    });

    await bus.send({
      type: 'direct',
      from: 'agent-sender',
      to: 'agent-good',
      payload: { hello: 'world' },
      priority: 'normal',
      requiresAck: false,
      ttlMs: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(callbackInvocations).toBe(1);
    expect(deliveredEvents).toBe(1);
    expect(retryEvents).toBe(0);
    expect(failedEvents).toBe(0);
  });
});
