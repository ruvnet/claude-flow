import { afterEach, describe, expect, it } from 'vitest';
import { createMessageBus, type MessageBus } from '../src/message-bus.js';
import type { Message } from '../src/types.js';

let bus: MessageBus;
afterEach(async () => { await bus.shutdown(); });

async function enqueue(priorities: Message['priority'][], capacity: number): Promise<string[]> {
  bus = createMessageBus({ maxQueueSize: capacity });
  for (const [index, priority] of priorities.entries()) {
    await bus.send({
      from: 'sender', to: 'target', type: 'direct', priority,
      payload: String(index), requiresAck: false, ttlMs: 60_000,
    });
  }
  expect(bus.getQueueDepth()).toBe(capacity);
  return bus.getMessages('target').map((message) => message.payload as string);
}

describe('MessageBus queue overflow priority', () => {
  it('retains urgent messages when a full queue also contains high priority', async () => {
    expect(await enqueue(['urgent', 'high', 'urgent'], 2)).toEqual(['0', '2']);
  });

  it('still discards low before normal, high, or urgent', async () => {
    expect(await enqueue(['urgent', 'normal', 'low', 'high', 'urgent'], 4))
      .toEqual(['0', '4', '3', '1']);
  });

  it('still discards normal before high or urgent', async () => {
    expect(await enqueue(['normal', 'high', 'urgent', 'urgent'], 3))
      .toEqual(['2', '3', '1']);
  });

  it('drops the oldest of the lowest available priority and preserves FIFO', async () => {
    expect(await enqueue(['high', 'urgent', 'high', 'urgent', 'urgent'], 4))
      .toEqual(['1', '3', '4', '2']);
  });

  it('continues to bound an all-urgent queue by evicting its oldest entry', async () => {
    expect(await enqueue(['urgent', 'urgent', 'urgent'], 2)).toEqual(['1', '2']);
  });
});
