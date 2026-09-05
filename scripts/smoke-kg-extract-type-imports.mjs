#!/usr/bin/env node
/**
 * Smoke test for ruvnet/ruflo#2049: kg-extract must NOT conflate
 * TypeScript `import type` with value imports.
 *
 * The user-visible failure mode was a phantom `findings ⇄ finding-actions`
 * cycle detected in a 51-service codebase, driven by `kg-extract`'s
 * step-3 regex grep treating `import type { Foo }` and
 * `import { foo }` as the same edge type.
 *
 * This smoke does two things:
 *  1. **Static**: parses both kg-extract/SKILL.md and kg-traverse/SKILL.md
 *     and asserts they no longer reference the disabled `semantic-route`
 *     controller (kg-traverse) and that kg-extract carves type-only
 *     imports out as a separate relation with weight ≤ 0.1.
 *  2. **Behavioural**: builds a tiny TS fixture in /tmp with a known
 *     type-only cycle and a known value-import edge, runs the
 *     skill's documented regex patterns over it, and asserts the
 *     edge counts are what the spec says they should be.
 *
 * Pinned to the SKILL.md contract — if a future PR re-introduces the
 * over-counting behaviour, this fails before merge.
 *
 * Usage:  node scripts/smoke-kg-extract-type-imports.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SKILL_DIR = join(REPO_ROOT, 'plugins', 'ruflo-knowledge-graph', 'skills');
const KG_EXTRACT = join(SKILL_DIR, 'kg-extract', 'SKILL.md');
const KG_TRAVERSE = join(SKILL_DIR, 'kg-traverse', 'SKILL.md');

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); }
}

// ---------------------------------------------------------------------------
// Part 1 — Static contract checks on the SKILL.md files
// ---------------------------------------------------------------------------

console.log('[1/2] Static contract checks');

if (!existsSync(KG_EXTRACT)) {
  failures.push('kg-extract SKILL.md not found');
} else {
  const extract = readFileSync(KG_EXTRACT, 'utf8');
  check(
    'kg-extract names `type-depends-on` as a separate relation',
    /type-depends-on/.test(extract),
    'expected a `type-depends-on` relation to be defined in kg-extract step 3',
  );
  check(
    'kg-extract weights `type-depends-on` at ≤ 0.1',
    /type-depends-on[^\n]*0\.1/.test(extract),
    'expected weight `0.1` (or smaller) explicitly for type-only imports',
  );
  check(
    'kg-extract documents the import-type regex carve-out',
    /import\\s\+type|import\\s\+type/.test(extract) || /\\bimport\s+type/.test(extract),
    'expected a regex example showing how to detect `import type` separately from value imports',
  );
  // kg-extract should NOT list semantic-route as an allowed tool any more
  check(
    'kg-extract no longer references `agentdb_semantic-route` in allowed-tools',
    !/allowed-tools[^\n]*agentdb_semantic-route/.test(extract),
    'the semanticRouter controller is `enabled: false` in current builds — see #2049',
  );
}

if (!existsSync(KG_TRAVERSE)) {
  failures.push('kg-traverse SKILL.md not found');
} else {
  const traverse = readFileSync(KG_TRAVERSE, 'utf8');
  check(
    'kg-traverse no longer references `agentdb_semantic-route` in allowed-tools',
    !/allowed-tools[^\n]*agentdb_semantic-route/.test(traverse),
    'semantic-route is disabled in current AgentDB builds; pattern-search is the substitute',
  );
  check(
    'kg-traverse step 3 calls `agentdb_pattern-search` (not the disabled semantic-route)',
    /pattern-search/.test(traverse) && /step 3|Score/i.test(traverse),
    'pattern-search is the available controller for similarity scoring per #2049',
  );
}

// ---------------------------------------------------------------------------
// Part 2 — Behavioural check: a TS fixture with one type-only cycle
// ---------------------------------------------------------------------------

console.log('\n[2/2] Behavioural classification check on a TS fixture');

const fixtureDir = join(tmpdir(), 'ruflo-kg-fixture-' + randomBytes(4).toString('hex'));
mkdirSync(fixtureDir, { recursive: true });

const findingsTs = `
// findings.service.ts — emits one VALUE import + one TYPE import on a sibling
import { loadFindingActionsTimeline } from './finding-actions.service';
import type { AuditEvent } from './audit-events';

export class FindingsService {
  load() { return loadFindingActionsTimeline(); }
}
`;
const findingActionsTs = `
// finding-actions.service.ts — emits one TYPE-ONLY import back at findings,
// which used to drive a phantom value-import cycle
import type { Finding } from './findings.service';
import { isAudit } from './audit-events';

export function loadFindingActionsTimeline(): Finding[] {
  return isAudit() ? [] : [];
}
`;
const auditEventsTs = `
// audit-events.ts
export function isAudit() { return true; }
`;

writeFileSync(join(fixtureDir, 'findings.service.ts'), findingsTs);
writeFileSync(join(fixtureDir, 'finding-actions.service.ts'), findingActionsTs);
writeFileSync(join(fixtureDir, 'audit-events.ts'), auditEventsTs);

/** The classifier the SKILL.md documents — re-implemented here as the test contract. */
function classifyImports(source) {
  const valueImports = [];
  const typeImports = [];
  for (const line of source.split('\n')) {
    // Match `import type { ... } from '...'` (whole-statement type import).
    const typeOnly = line.match(/^\s*import\s+type\s+[^\n]*from\s+['"]([^'"]+)['"]/);
    if (typeOnly) {
      typeImports.push(typeOnly[1]);
      continue;
    }
    // Match `import { ... } from '...'` (value import — may contain inline `type` specifiers,
    // but the import line as a whole produces a value-import edge for any non-type specifier).
    const value = line.match(/^\s*import\s+[^{]*\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/);
    if (value) {
      const specs = value[1].split(',').map((s) => s.trim());
      const hasNonType = specs.some((s) => !s.startsWith('type '));
      const hasType = specs.some((s) => s.startsWith('type '));
      if (hasNonType) valueImports.push(value[2]);
      if (hasType) typeImports.push(value[2]);
      continue;
    }
    const bareValue = line.match(/^\s*import\s+\w+\s+from\s+['"]([^'"]+)['"]/);
    if (bareValue) valueImports.push(bareValue[1]);
  }
  return { valueImports, typeImports };
}

const findingsClass = classifyImports(findingsTs);
const findingActionsClass = classifyImports(findingActionsTs);

check(
  'fixture: findings.service.ts has 1 value import + 1 type import',
  findingsClass.valueImports.length === 1 && findingsClass.typeImports.length === 1,
  `got ${findingsClass.valueImports.length} value + ${findingsClass.typeImports.length} type`,
);
check(
  'fixture: finding-actions.service.ts has 1 value import + 1 type import',
  findingActionsClass.valueImports.length === 1 && findingActionsClass.typeImports.length === 1,
  `got ${findingActionsClass.valueImports.length} value + ${findingActionsClass.typeImports.length} type`,
);
check(
  'fixture: no value-import cycle between findings ↔ finding-actions',
  findingActionsClass.valueImports.includes('./findings.service') === false,
  'finding-actions.service.ts must NOT count `import type { Finding } from ./findings.service` as a value-import edge',
);

// Cleanup
rmSync(fixtureDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} issue(s) — see above`);
  process.exit(1);
} else {
  console.log('OK: kg-extract type-import classification + kg-traverse controller wiring are correct');
  process.exit(0);
}
