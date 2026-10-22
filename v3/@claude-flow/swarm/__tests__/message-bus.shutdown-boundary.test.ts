import { afterEach, describe, expect, it } from 'vitest';
import { createMessageBus, type MessageBus } from '../src/message-bus.js';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const message = (to: string) => ({
  type: 'direct' as const,
  from: 'sender',
  to,
  payload: {},
  priority: 'normal' as const,
  requiresAck: false,
  ttlMs: 60_000,
});

let bus: MessageBus;
afterEach(async () => { await bus.shutdown(); });

describe('MessageBus shutdown delivery boundary', () => {
  it('does not invoke a queued subscriber after shutdown has completed', async () => {
    bus = createMessageBus({ processingIntervalMs: 5000 });
    await bus.initialize();
    const observed: string[] = [];
    bus.subscribe('target', () => { observed.push('subscriber side effect'); });
    bus.on('shutdown', () => { observed.push('shutdown'); });
    bus.on('message.delivered', () => { observed.push('delivered'); });
    await bus.send(message('target'));
    // Drain the dispatch pass while its subscriber callbacks remain queued.
    await nextTurn();
    await bus.shutdown();
    await nextTurn();
    expect(observed).toEqual(['shutdown']);
  });

  it('does not revive callbacks from the old lifecycle when immediately reinitialized', async () => {
    bus = createMessageBus({ processingIntervalMs: 5000 });
    await bus.initialize();
    let oldSubscriber = 0;
    let newSubscriber = 0;
    bus.subscribe('target', () => { oldSubscriber++; });
    await bus.send(message('target'));
    await nextTurn();
    await bus.shutdown();
    await bus.initialize();
    bus.subscribe('target', () => { newSubscriber++; });
    await bus.send(message('target'));
    await nextTurn();
    await nextTurn();
    expect(oldSubscriber).toBe(0);
    expect(newSubscriber).toBe(1);
  });

  it('cancels the other queued subscriber when the first subscriber shuts down the bus', async () => {
    bus = createMessageBus({ processingIntervalMs: 5000 });
    await bus.initialize();
    const observed: string[] = [];
    bus.subscribe('first', () => {
      observed.push('first');
      void bus.shutdown();
    });
    bus.subscribe('second', () => { observed.push('second'); });
    await bus.send(message('first'));
    await bus.send(message('second'));
    await nextTurn();
    await nextTurn();
    expect(observed).toEqual(['first']);
  });
});
