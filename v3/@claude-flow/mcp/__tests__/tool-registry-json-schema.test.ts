import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../src/tool-registry.js';
import type { ILogger } from '../src/types.js';

const logger: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('ToolRegistry JSON Schema compatibility (#2990)', () => {
  it.each([
    ['string', 'plain text'],
    ['object', { nested: true }],
    ['array', ['one', 2]],
    ['number', 42],
    ['boolean', false],
    ['null', null],
  ])('accepts an unconstrained property with a %s value', async (_kind, value) => {
    const registry = createToolRegistry(logger);
    expect(registry.register({
      name: 'store_value',
      description: 'Store any JSON value',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { description: 'Any JSON value' },
        },
        required: ['key', 'value'],
      },
      handler: async (input) => ({ value: input.value }),
    })).toBe(true);

    const result = await registry.execute('store_value', { key: 'test', value });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text!)).toEqual({ value });
  });
});
