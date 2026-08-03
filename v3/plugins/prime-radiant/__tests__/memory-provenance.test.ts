import { describe, expect, it, vi } from 'vitest';
import { PrimeRadiantPlugin } from '../src/plugin.js';

function createContext() {
  const store = vi.fn(async () => undefined);
  const services = new Map<string, unknown>([
    ['memory', {
      store,
      registerPreStoreHook: vi.fn(),
    }],
    ['hiveMind', {
      getAgentStates: vi.fn(async () => [
        {
          id: 'agent-a',
          communicationsWith: { 'agent-b': 3 },
          totalCommunications: 3,
        },
        {
          id: 'agent-b',
          communicationsWith: { 'agent-a': 2 },
          totalCommunications: 2,
        },
      ]),
    }],
  ]);

  const context = {
    get<T>(key: string): T {
      return services.get(key) as T;
    },
    set(key: string, value: unknown): void {
      services.set(key, value);
    },
    has(key: string): boolean {
      return services.has(key);
    },
  };

  return { context, store };
}

describe('Prime Radiant memory provenance', () => {
  it('stores computed swarm stability as a system observation', async () => {
    const plugin = new PrimeRadiantPlugin();
    const { context, store } = createContext();
    const initialized = await plugin.initialize(context);
    expect(initialized.success).toBe(true);

    const hook = plugin.getHooks().find(({ name }) => name === 'pr/post-swarm-task');
    expect(hook).toBeDefined();
    await hook!.handler(context, {
      isSwarmTask: true,
      taskId: 'task-123',
    });

    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'pr/stability-metrics',
      key: 'task-task-123',
      provenance_type: 'system_observation',
    }));
  });
});
