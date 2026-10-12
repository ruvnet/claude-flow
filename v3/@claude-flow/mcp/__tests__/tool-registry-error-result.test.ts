import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../src/tool-registry.js';
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('handler-declared tool errors', () => {
  it.each([{ success: false, error: 'invalid key' }, { results: [], error: 'storage unavailable' }])('preserves error payloads and records failure', async (payload) => {
    const registry = createToolRegistry(logger);
    registry.register({ name: 'failing_tool', description: 'test', inputSchema: { type: 'object', properties: {} }, handler: async () => payload });
    const completed = vi.fn();
    registry.on('tool:completed', completed);
    const result = await registry.execute('failing_tool', {});
    expect(result.isError).toBe(true);
    expect(registry.getMetadata('failing_tool')?.errorCount).toBe(1);
    expect(JSON.parse(result.content[0].text!)).toEqual(payload);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it('does not interpret recorded negative task outcomes as tool errors', async () => {
    const registry = createToolRegistry(logger);
    registry.register({ name: 'record', description: 'test', inputSchema: { type: 'object', properties: {} }, handler: async () => ({ success: false, recorded: true }) });
    expect((await registry.execute('record', {})).isError).toBe(false);
  });
});
