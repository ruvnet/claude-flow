/**
 * Host registry + hierarchical layers (ADR-176 phase 7).
 */
import { describe, it, expect } from 'vitest';
import {
  HostRegistry, fanOutHosts, ancestorsOf, isAncestorOrEqual, layerDepth, selectChampionForLayer,
  type HostAdapter,
} from '../src/services/harness-hosts.js';

const cc: HostAdapter = { id: 'claude-code', label: 'Claude Code', detect: () => true };
const codexOff: HostAdapter = { id: 'codex', label: 'Codex', detect: () => false };
const codexOn: HostAdapter = { id: 'codex', label: 'Codex', detect: () => true };

describe('HostRegistry', () => {
  it('registers, lists, and filters to available hosts', () => {
    const r = new HostRegistry().register(cc).register(codexOff);
    expect(r.all().map(h => h.id)).toEqual(['claude-code', 'codex']);
    expect(r.available().map(h => h.id)).toEqual(['claude-code']); // codex detect=false
    expect(r.get('claude-code')).toBe(cc);
  });

  it('swallows a throwing detect() (treats host as unavailable)', () => {
    const bad: HostAdapter = { id: 'bad', label: 'bad', detect: () => { throw new Error('x'); } };
    expect(new HostRegistry().register(cc).register(bad).available().map(h => h.id)).toEqual(['claude-code']);
  });
});

describe('fanOutHosts (multi-host)', () => {
  it('runs per host and collects results, isolating per-host errors', async () => {
    const out = await fanOutHosts([cc, codexOn], async (h) => {
      if (h.id === 'codex') throw new Error('codex boom');
      return `optimized:${h.id}`;
    });
    expect(out.find(o => o.host === 'claude-code')?.result).toBe('optimized:claude-code');
    const codex = out.find(o => o.host === 'codex');
    expect(codex?.result).toBeNull();
    expect(codex?.error).toMatch(/codex boom/);
  });
});

describe('hierarchical layers', () => {
  it('computes ancestors, ancestor-or-equal, and depth', () => {
    expect(ancestorsOf('global/typescript/node-cli')).toEqual(['global', 'global/typescript', 'global/typescript/node-cli']);
    expect(isAncestorOrEqual('global/typescript', 'global/typescript/node-cli')).toBe(true);
    expect(isAncestorOrEqual('global/typescript', 'global/typescriptxyz')).toBe(false); // boundary-safe
    expect(isAncestorOrEqual('global/python', 'global/typescript')).toBe(false);
    expect(layerDepth('global/typescript/node-cli')).toBe(3);
  });

  it('selects the most-specific applicable champion, falling back to a parent', () => {
    const manifests = [
      { id: 'g', layer: 'global' },
      { id: 'ts', layer: 'global/typescript' },
      { id: 'cli', layer: 'global/typescript/node-cli' },
      { id: 'py', layer: 'global/python' }, // not applicable
    ];
    const install = 'global/typescript/node-cli/my-repo';
    expect(selectChampionForLayer(manifests, install)?.id).toBe('cli'); // deepest applicable
    // Without the framework layer, falls back to the language layer.
    expect(selectChampionForLayer(manifests.filter(m => m.id !== 'cli'), install)?.id).toBe('ts');
    // No applicable ancestor → null.
    expect(selectChampionForLayer([{ id: 'x', layer: 'global/rust' }], install)).toBeNull();
  });
});
