import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageBus, type MessageBus } from '../src/message-bus.js';

let bus: MessageBus;
const message = {
  type: 'direct' as const, from: 'sender', payload: {},
  priority: 'normal' as const, requiresAck: true, ttlMs: 60_000,
};
const ack = (messageId: string, from: string) => ({
  messageId, from, received: true, processedAt: new Date(),
});

beforeEach(async () => {
  vi.useFakeTimers();
  bus = createMessageBus({ ackTimeoutMs: 100, processingIntervalMs: 5000 });
  await bus.initialize();
});
afterEach(async () => {
  await bus.shutdown();
  vi.useRealTimers();
});

describe('MessageBus recipient acknowledgement tracking', () => {
  it('allows every broadcast recipient to acknowledge without orphaned timeouts', async () => {
    const timeouts = vi.fn();
    bus.on('message.ack_timeout', timeouts);
    bus.subscribe('first', (received) => { void bus.acknowledge(ack(received.id, 'first')); });
    bus.subscribe('second', (received) => { void bus.acknowledge(ack(received.id, 'second')); });
    await bus.broadcast(message);
    await vi.advanceTimersByTimeAsync(150);
    expect(timeouts).not.toHaveBeenCalled();
    expect(bus.getStats().ackRate).toBe(1);
  });

  it('does not accept an acknowledgement from another agent', async () => {
    const timeouts = vi.fn();
    bus.on('message.ack_timeout', timeouts);
    bus.subscribe('target', (received) => { void bus.acknowledge(ack(received.id, 'other')); });
    await bus.send({ ...message, to: 'target' });
    await vi.advanceTimersByTimeAsync(150);
    expect(timeouts).toHaveBeenCalledTimes(1);
  });

  it('retains the other broadcast recipient timeout after one acknowledges', async () => {
    const timeouts = vi.fn();
    bus.on('message.ack_timeout', timeouts);
    bus.subscribe('first', (received) => { void bus.acknowledge(ack(received.id, 'first')); });
    bus.subscribe('second', () => {});
    await bus.broadcast(message);
    await vi.advanceTimersByTimeAsync(150);
    expect(timeouts).toHaveBeenCalledTimes(1);
    expect(bus.getStats().ackRate).toBe(0.99);
  });

  it('clears every broadcast recipient timeout at shutdown', async () => {
    const timeouts = vi.fn();
    bus.on('message.ack_timeout', timeouts);
    bus.subscribe('first', () => {});
    bus.subscribe('second', () => {});
    await bus.broadcast(message);
    await vi.advanceTimersByTimeAsync(5);
    await bus.shutdown();
    await vi.advanceTimersByTimeAsync(150);
    expect(timeouts).not.toHaveBeenCalled();
  });

  it('clears the failed delivery attempt timeout before a successful retry', async () => {
    const timeouts = vi.fn();
    bus.on('message.ack_timeout', timeouts);
    let attempts = 0;
    bus.subscribe('target', (received) => {
      if (++attempts === 1) throw new Error('temporary subscriber failure');
      void bus.acknowledge(ack(received.id, 'target'));
    });
    await bus.send({ ...message, to: 'target' });
    await vi.advanceTimersByTimeAsync(150);
    expect(attempts).toBe(2);
    expect(timeouts).not.toHaveBeenCalled();
  });
});
