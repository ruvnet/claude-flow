// #4397: the bridge search candidate window must not silently drop rows
// beyond the newest 1000 (regression vs 3.38.3, which used 10000).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBridgeSearchWindow, DEFAULT_BRIDGE_SEARCH_WINDOW } from '../src/memory/memory-bridge.js';

describe('bridge search window (#4397)', () => {
  it('defaults to 10000, not 1000', () => {
    expect(DEFAULT_BRIDGE_SEARCH_WINDOW).toBe(10000);
    expect(resolveBridgeSearchWindow({})).toBe(10000);
  });
  it('honours and clamps CLAUDE_FLOW_SEARCH_WINDOW', () => {
    expect(resolveBridgeSearchWindow({ CLAUDE_FLOW_SEARCH_WINDOW: '2500' })).toBe(2500);
    expect(resolveBridgeSearchWindow({ CLAUDE_FLOW_SEARCH_WINDOW: '1' })).toBe(100);
    expect(resolveBridgeSearchWindow({ CLAUDE_FLOW_SEARCH_WINDOW: '9999999' })).toBe(100000);
    expect(resolveBridgeSearchWindow({ CLAUDE_FLOW_SEARCH_WINDOW: 'abc' })).toBe(10000);
  });
  it('the search SELECT uses the resolved window, not a literal 1000', () => {
    const src = readFileSync(join(__dirname, '../src/memory/memory-bridge.ts'), 'utf8');
    expect(src).toContain('LIMIT ${resolveBridgeSearchWindow()}');
  });
});
