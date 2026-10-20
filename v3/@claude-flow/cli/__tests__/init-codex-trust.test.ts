/**
 * `init --codex-trust <standard|full>`: the generated .codex/config.toml is
 * safe by default (workspace-write, on-request approvals); only an explicit
 * `full` restores danger-full-access. The adapter owns the file contents
 * (see @claude-flow/codex tests/codex-trust-defaults.test.ts); this pins the
 * CLI side: the flag exists, both key spellings parse, anything else is
 * rejected rather than guessed, and it reaches the adapter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initCommand, readCodexTrustFlag } from '../src/commands/init.js';

describe('readCodexTrustFlag', () => {
  it('reads the normalised (camelCase) and literal (kebab) keys', () => {
    expect(readCodexTrustFlag({ codexTrust: 'full' })).toBe('full');
    expect(readCodexTrustFlag({ 'codex-trust': 'standard' })).toBe('standard');
  });

  it('is undefined when unset, so the adapter default (standard) applies', () => {
    expect(readCodexTrustFlag({})).toBeUndefined();
    expect(readCodexTrustFlag({ codexTrust: '' })).toBeUndefined();
    expect(readCodexTrustFlag({ codexTrust: false })).toBeUndefined();
  });

  it('rejects anything else with null instead of guessing a level', () => {
    expect(readCodexTrustFlag({ codexTrust: 'yolo' })).toBeNull();
    expect(readCodexTrustFlag({ codexTrust: 'FULL' })).toBeNull();
    expect(readCodexTrustFlag({ codexTrust: true })).toBeNull();
  });
});

describe('init command surface', () => {
  it('declares --codex-trust as a string option', () => {
    const opt = initCommand.options?.find((o) => o.name === 'codex-trust');
    expect(opt).toBeDefined();
    expect(opt?.type).toBe('string');
    expect(opt?.description).toMatch(/never rewritten/);
  });

  it('forwards the level to the adapter on every Codex path', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/commands/init.ts', import.meta.url)), 'utf8');
    // npx fallback, in-process initializer, and the auto-detect path
    expect(src).toMatch(/\['--codex-trust', options\.codexTrust\]/);
    expect(src).toMatch(/dual: dualMode,\s*codexTrust,/);
    expect(src).toMatch(/dual: false, \/\/ Claude Code files were already written by the main init flow above\s*codexTrust,/);
  });
});
