/**
 * Regression tests for #2369 (and the batchable companions #2370 / #2371).
 *
 * All three bugs are the same shape: the rename from `claude-flow` to `ruflo`
 * left three runtime call sites referencing the deprecated dist-tag
 * `claude-flow@v3alpha` (or `claude-flow@alpha`), each of which silently
 * routes users / workers / detectors to a pre-rename build that lacks
 * autopilot, browser, wasm-agent, and other current MCP tools.
 *
 * The tests pin the runtime contracts so a future grep-and-replace can't
 * silently undo the fix.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Strip block comments AND line comments so the sanity sweeps only see
// runtime code. The fix commits intentionally cite the deprecated dist-tag
// in their explanatory comments — that's documentation, not the bug.
// The tests must not flag it.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('#2369 — stale MCP key handling in init', () => {
  // We test the runtime by reading the compiled source for the predicates
  // we want to pin. Spinning up the full executor for these cases would
  // run the rest of `init` (skills/agents/helpers) which is overkill.
  const executorSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/init/executor.ts'),
    'utf-8',
  );

  it('detectExistingRufloMCP recognises the legacy `claude-flow@alpha` key at the top level', () => {
    expect(executorSrc).toMatch(/'claude-flow@alpha'\s+in\s+servers/);
  });

  it('detectExistingRufloMCP recognises the legacy `claude-flow@v3alpha` key at the top level', () => {
    expect(executorSrc).toMatch(/'claude-flow@v3alpha'\s+in\s+servers/);
  });

  it('detectExistingRufloMCP also recognises legacy keys in project-scoped registrations', () => {
    // The project-scoped path needs the same widening — pin both.
    expect(executorSrc).toMatch(/'claude-flow@alpha'\s+in\s+mcp/);
    expect(executorSrc).toMatch(/'claude-flow@v3alpha'\s+in\s+mcp/);
  });

  it('writeMCPConfig surfaces a loud message naming the deprecated key when an existing local .mcp.json uses one (Scenario A)', () => {
    // The Scenario A guard must read the local file, detect a stale key,
    // and push a `skipped` line that NAMES the deprecated key (so the
    // user can find it). Pin both the message shape and the inclusion of
    // the "deprecated key" phrase, since silent skip is the bug.
    expect(executorSrc).toMatch(/uses deprecated key/);
    expect(executorSrc).toMatch(/claude-flow@alpha/);
    expect(executorSrc).toMatch(/claude-flow@v3alpha/);
  });
});

describe('#2370 — swarm.ts MCP-down hint references the current package', () => {
  const swarmSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/commands/swarm.ts'),
    'utf-8',
  );
  const swarmCode = stripComments(swarmSrc);

  it('does not reference the deprecated `claude-flow@v3alpha` dist-tag in code (comments OK)', () => {
    expect(swarmCode).not.toMatch(/claude-flow@v3alpha/);
  });

  it('points users at `ruflo@latest` with the `-y` flag (forces fresh fetch)', () => {
    expect(swarmSrc).toMatch(/npx -y ruflo@latest/);
  });

  it('uses the `--` separator before the npx invocation (avoids claude-mcp flag ambiguity)', () => {
    expect(swarmSrc).toMatch(/claude mcp add claude-flow -- npx -y ruflo@latest/);
  });
});

describe('#2371 — ContainerWorkerPool spawns workers with the current package', () => {
  const poolSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/container-worker-pool.ts'),
    'utf-8',
  );
  const poolCode = stripComments(poolSrc);

  it('does not spawn workers via the deprecated `claude-flow@v3alpha` dist-tag in code (comments OK)', () => {
    expect(poolCode).not.toMatch(/claude-flow@v3alpha/);
  });

  it('spawns workers via `ruflo@latest` with `-y` so npx never falls back to a stale local install', () => {
    // The argv array must contain the three tokens in order. Match the
    // structure rather than the exact whitespace so trivial reformatting
    // doesn't break the test.
    expect(poolSrc).toMatch(/['"]npx['"]\s*,\s*['"]-y['"]\s*,\s*['"]ruflo@latest['"]/);
  });
});

describe('Sanity — no other runtime source references the deprecated dist-tags', () => {
  // Sweep the runtime source tree once. This is a low-cost guard against
  // a future contributor reintroducing the stale string via copy-paste.
  // Doc paths (CLAUDE.md, README.md, ADRs) are intentionally excluded —
  // they may legitimately reference legacy syntax for historical context.
  const srcRoot = path.resolve(__dirname, '../src');

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  it('no runtime .ts/.js code references `claude-flow@v3alpha` (comments and legacy-key recognition lists are OK)', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = fs.readFileSync(file, 'utf-8');
      const code = stripComments(text);
      // Strip the legitimate appearances:
      // (a) the legacy-key recognition list in detectExistingRufloMCP
      // (b) the staleKeys array in writeMCPConfig
      const stripped = code
        .replace(/'claude-flow@v3alpha'\s+in\s+\w+/g, '')
        .replace(/\['claude-flow@alpha',\s*'claude-flow@v3alpha'\]/g, '');
      if (/claude-flow@v3alpha/.test(stripped)) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);
  });
});

// Force this file to be treated as a module so test isolation works under
// the project's vitest config without a tsconfig export tweak.
export {};

// Keep imports referenced even though we use them only for type-side checks.
void os;
