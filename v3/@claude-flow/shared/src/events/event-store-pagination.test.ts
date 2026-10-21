import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { EventStore } from './event-store.js';
import { createAgentSpawnedEvent } from './domain-events.js';

describe('SQLite event query pagination', () => {
  let store: EventStore;
  beforeEach(async () => {
    store = new EventStore({
      databasePath: ':memory:',
      autoPersistInterval: 0,
    });
    await store.initialize();
    for (let i = 0; i < 3; i++) {
      const event = createAgentSpawnedEvent(`agent-${i}`, 'coder', 'core', []);
      event.timestamp = 100 + i;
      await store.append(event);
    }
  });
  afterEach(async () => {
    await store.shutdown();
  });
  it('supports offsets without a caller-specified limit', async () => {
    expect(
      (await store.query({ offset: 1 })).map((event) => event.aggregateId),
    ).toEqual(['agent-1', 'agent-2']);
  });
  it('returns no rows for an explicit zero limit', async () => {
    expect(await store.query({ limit: 0 })).toEqual([]);
    expect(await store.query({ limit: 0, offset: 1 })).toEqual([]);
  });
  it('retains bounded page ordering', async () => {
    expect(
      (await store.query({ limit: 1, offset: 1 })).map(
        (event) => event.aggregateId,
      ),
    ).toEqual(['agent-1']);
  });
});
