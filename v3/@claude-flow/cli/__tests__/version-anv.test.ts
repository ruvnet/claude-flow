/**
 * `ruflo version` — ANV (Agent-Native Versioning) Phase 1.
 * https://gist.github.com/ruvnet/0d858ad440a4439b4a2281a40c39b1a0
 *
 * Black-box against the real built CLI binary (same pattern as
 * security-scan-persistence.test.ts) since the command's manifest
 * resolution walks real package/dev-checkout paths — reconstructing that
 * via mocks would test the mock, not the resolution logic.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { buildAdvisorySuffix } from '../src/commands/version.js';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);
const MANIFEST_PATH = fileURLToPath(new URL('../catalog-manifest.json', import.meta.url));

function cli(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [CLI_BIN, ...args], { encoding: 'utf-8', timeout: 15_000 });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? '', code: err.status ?? 1 };
  }
}

describe('buildAdvisorySuffix — pure function', () => {
  it('omits the hal segment when no benchmark exists', () => {
    const suffix = buildAdvisorySuffix({
      schemaVersion: 1, generation: 5, generatedAt: '2026-01-01T00:00:00.000Z',
      gitSha: 'abc12345', catalog: { agents: 1, tools: 2, skills: 3 }, benchmark: null,
    });
    expect(suffix).toBe('+ad.1.gabc12345.cat5');
  });

  it('appends the hal segment only when a real benchmark is present', () => {
    const suffix = buildAdvisorySuffix({
      schemaVersion: 1, generation: 5, generatedAt: '2026-01-01T00:00:00.000Z',
      gitSha: 'abc12345', catalog: { agents: 1, tools: 2, skills: 3 },
      benchmark: { tier: 74, verifiedAt: '2026-01-01T00:00:00.000Z' },
    }, 2);
    expect(suffix).toBe('+ad.2.gabc12345.cat5.hal74');
  });

  it('is legal semver build metadata — starts with a bare "+", npm-range-safe', () => {
    const suffix = buildAdvisorySuffix({
      schemaVersion: 1, generation: 1, generatedAt: '2026-01-01T00:00:00.000Z',
      gitSha: 'deadbeef', catalog: { agents: 0, tools: 0, skills: 0 }, benchmark: null,
    });
    expect(suffix.startsWith('+')).toBe(true);
    expect(suffix).not.toMatch(/[^a-z0-9.+-]/i);
  });
});

describe.skipIf(!CLI_BUILT)('ruflo version — CLI black-box', () => {
  it('bare "version" prints plain semver, no suffix', () => {
    const { out, code } = cli(['version']);
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('bare "--version" global flag is unaffected by ANV (still plain semver)', () => {
    const { out, code } = cli(['--version']);
    expect(code).toBe(0);
    expect(out).toMatch(/v\d+\.\d+\.\d+/);
    expect(out).not.toContain('+ad.');
  });

  it('"version --explain" renders the catalog breakdown when catalog-manifest.json exists', () => {
    if (!existsSync(MANIFEST_PATH)) return; // dev checkout without a generated manifest — see next test
    const { out, code } = cli(['version', '--explain']);
    expect(code).toBe(0);
    expect(out).toContain('Era:       AD (Agent Descent)');
    expect(out).toMatch(/Catalog:\s+generation \d+ \(agents: \d+ types, tools: \d+ MCP, skills: \d+\)/);
    expect(out).toContain('+ad.1.g');
  });

  it('catalog-manifest.json counts are real numbers, never fabricated benchmark data', () => {
    if (!existsSync(MANIFEST_PATH)) return;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(manifest.catalog.agents).toBeGreaterThan(0);
    expect(manifest.catalog.tools).toBeGreaterThan(0);
    expect(manifest.catalog.skills).toBeGreaterThan(0);
    // No benchmark tier without a real signed submission for this generation.
    if (manifest.benchmark !== null) {
      expect(manifest.benchmark).toHaveProperty('tier');
      expect(manifest.benchmark).toHaveProperty('verifiedAt');
    }
  });

  it('"--require-catalog-gte" gates cleanly: pass at/under, fail over', () => {
    if (!existsSync(MANIFEST_PATH)) return;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const under = cli(['version', '--require-catalog-gte', String(manifest.generation)]);
    expect(under.code).toBe(0);
    expect(under.out).toContain('OK');

    const over = cli(['version', '--require-catalog-gte', String(manifest.generation + 1000)]);
    expect(over.code).toBe(1);
  });
});
