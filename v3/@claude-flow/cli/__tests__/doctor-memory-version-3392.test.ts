/**
 * #3392: `npx @claude-flow/cli@latest` reuses one npx cache directory across CLI
 * versions, and npm keeps an installed dependency that still satisfies a caret
 * range — so a stale @claude-flow/memory survived a CLI upgrade with no error.
 * The fix is twofold: cli pins memory exactly (so a stale copy can no longer
 * satisfy the spec), and doctor reports when the loaded copy drifts from it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateMemoryPackageVersion, checkMemoryPackageVersion } from '../src/commands/doctor.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };

describe('#3392 evaluateMemoryPackageVersion', () => {
  it('passes when the installed version satisfies an exact pin', () => {
    expect(evaluateMemoryPackageVersion('3.0.0-alpha.25', '3.0.0-alpha.25').status).toBe('pass');
  });

  it('warns on a stale copy that a caret range would have accepted', () => {
    const check = evaluateMemoryPackageVersion('3.0.0-alpha.25', '3.0.0-alpha.24');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('3.0.0-alpha.24');
    expect(check.fix).toContain('_npx');
    expect(check.fix).toContain('@claude-flow/memory@3.0.0-alpha.25');
  });

  it('treats prerelease versions inside a prerelease range as satisfying', () => {
    expect(evaluateMemoryPackageVersion('^3.0.0-alpha.23', '3.0.0-alpha.25').status).toBe('pass');
  });

  it('warns, not fails, when the optional package is absent', () => {
    const check = evaluateMemoryPackageVersion('3.0.0-alpha.25', null);
    expect(check.status).toBe('warn');
    expect(check.fix).toContain('--include=optional');
  });

  it('warns when the declared range cannot be read or compared', () => {
    expect(evaluateMemoryPackageVersion(null, '3.0.0-alpha.25').status).toBe('warn');
    expect(evaluateMemoryPackageVersion('not a range', '3.0.0-alpha.25').status).toBe('warn');
    expect(evaluateMemoryPackageVersion('3.0.0-alpha.25', 'garbage').status).toBe('warn');
  });
});

describe('#3392 cli declares an exact @claude-flow/memory pin', () => {
  it.each(['dependencies', 'optionalDependencies'] as const)('%s pins memory to one exact version', (field) => {
    const spec = pkg[field]?.['@claude-flow/memory'];
    expect(spec, `${field} should declare @claude-flow/memory`).toBeDefined();
    // Exact semver: no range operators, so a cached older copy cannot satisfy it.
    expect(spec).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('declares the same pin in both fields (npm lets optionalDependencies win)', () => {
    expect(pkg.optionalDependencies?.['@claude-flow/memory']).toBe(pkg.dependencies?.['@claude-flow/memory']);
  });
});

describe('#3392 checkMemoryPackageVersion (real resolution)', () => {
  it('reports on the copy this CLI actually loads, and never fails', async () => {
    const check = await checkMemoryPackageVersion();
    expect(check.name).toBe('@claude-flow/memory version');
    // Which copy is loaded depends on the install layout (a hoisted workspace
    // can legitimately hold another version), so only the verdict's shape is
    // asserted here; the version comparison itself is covered above.
    expect(['pass', 'warn']).toContain(check.status);
    expect(check.message).toContain(pkg.dependencies!['@claude-flow/memory']);
  });
});
