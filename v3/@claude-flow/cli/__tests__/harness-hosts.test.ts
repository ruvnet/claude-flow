/**
 * Host registry + hierarchical layers (ADR-176 phase 7).
 */
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  HostRegistry, defaultHostRegistry, fanOutHosts, ancestorsOf, isAncestorOrEqual, layerDepth,
  selectChampionForLayer,
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

describe('defaultHostRegistry (built-in hosts)', () => {
  // #3372: Grok Build CLI reads `.mcp.json`, `.agents/skills/**/SKILL.md` and
  // AGENTS.md/CLAUDE.md natively (measured on grok 1.0.34), so it belongs in
  // the ADR-176 per-host fan-out. `all()` never calls detect(), so this
  // assertion spawns nothing.
  it('registers claude-code, codex and grok', () => {
    const r = defaultHostRegistry();
    expect(r.all().map(h => h.id)).toEqual(['claude-code', 'codex', 'grok']);
    expect(r.get('grok')?.label).toBe('Grok Build');
  });

  // Detection goes through the shared commandExists() probe, i.e. PATH. Drive
  // it with a fake executable rather than the developer's real Grok install —
  // running the real binary would create ~/.grok.
  it.skipIf(process.platform === 'win32')('detects grok from PATH via commandExists()', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'ruflo-grok-bin-'));
    const emptyDir = mkdtempSync(join(tmpdir(), 'ruflo-grok-nobin-'));
    const fake = join(binDir, 'grok');
    writeFileSync(fake, '#!/bin/sh\nexit 0\n');
    chmodSync(fake, 0o755);
    const originalPath = process.env.PATH;
    try {
      // Only the fake is reachable, so a real `grok` on the developer's PATH
      // can never be the thing that answers here.
      process.env.PATH = binDir;
      expect(defaultHostRegistry().get('grok')!.detect()).toBe(true);
      process.env.PATH = emptyDir;
      expect(defaultHostRegistry().get('grok')!.detect()).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
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
