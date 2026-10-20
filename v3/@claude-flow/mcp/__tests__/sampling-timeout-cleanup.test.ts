import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SamplingManager } from '../src/sampling.js';
import type { CreateMessageRequest, CreateMessageResult, ILogger } from '../src/types.js';
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request: CreateMessageRequest = { messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }], maxTokens: 10 };
const result: CreateMessageResult = { role: 'assistant', content: { type: 'text', text: 'reply' }, model: 'test', stopReason: 'endTurn' };
const manager = (createMessage: () => Promise<CreateMessageResult>) => {
  const sampling = new SamplingManager(logger, { timeout: 30_000 });
  sampling.registerProvider({ name: 'test', isAvailable: async () => true, createMessage });
  return sampling;
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('clears the deadline after a successful provider call', async () => {
  expect(await manager(async () => result).createMessage(request)).toEqual(result);
  expect(vi.getTimerCount()).toBe(0);
});
it('clears the deadline while preserving the original provider rejection', async () => {
  const error = new Error('provider failed');
  await expect(manager(async () => { throw error; }).createMessage(request)).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not accumulate timers across repeated completed calls', async () => {
  const sampling = manager(async () => result);
  for (let i = 0; i < 20; i++) await sampling.createMessage(request);
  expect(vi.getTimerCount()).toBe(0);
});
it('still rejects at the deadline and does not turn a late reply into completion', async () => {
  let reply!: (value: CreateMessageResult) => void;
  const sampling = manager(() => new Promise(resolve => { reply = resolve; }));
  const completed = vi.fn();
  sampling.on('sampling:complete', completed);
  const waiting = expect(sampling.createMessage(request)).rejects.toThrow('Sampling timeout');
  await vi.advanceTimersByTimeAsync(30_000);
  await waiting;
  reply(result);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
