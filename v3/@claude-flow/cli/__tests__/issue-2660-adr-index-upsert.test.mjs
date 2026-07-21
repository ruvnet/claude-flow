/**
 * Regression test for issue #2660: ruflo-adr adr-index could not update
 * changed ADRs because of three defects in plugins/ruflo-adr/scripts/import.mjs:
 *
 * 1. memoryStore() called `npx ... memory store` WITHOUT `--upsert`. The CLI
 *    help declares `--upsert` defaults to true but the default is NOT honored
 *    (#2594). Without explicit `--upsert`, re-running adr-index on an existing
 *    key fails UNIQUE constraint → the record is frozen at its first-indexed
 *    value forever.
 * 2. The `'exists'` sentinel (returned on UNIQUE constraint failure) was counted
 *    as a stored record/edge (old code: `r === 'ok' || r === 'exists'`). A
 *    failed write silently became a success tally — `errors` stayed empty,
 *    the summary reported full success while nothing persisted.
 * 3. Edge key had `Date.now()` + `Math.random()` suffix → never collided →
 *    upsert couldn't dedup → edges duplicated 3→6→9 on repeated runs. The
 *    edge's identity IS (relation, from, to); `capturedAt` already lives in
 *    the value.
 *
 * Standalone Node assertion runner — reads the source file directly and
 * asserts the three fixes are present. No subprocess, no CLI build, no test
 * framework required. Run: `node __tests__/issue-2660-adr-index-upsert.test.mjs`
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// plugins/ruflo-adr/scripts/import.mjs relative to v3/@claude-flow/cli/__tests__
const IMPORT_PATH = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'plugins',
  'ruflo-adr',
  'scripts',
  'import.mjs',
);

const SRC = readFileSync(IMPORT_PATH, 'utf8');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// Defect 1 — memoryStore() passes --upsert explicitly
assert(
  /^\s*'--upsert',/m.test(SRC),
  "memoryStore argv includes bare '--upsert' flag",
);
{
  const storeBlock = SRC.match(
    /spawnSync\('npx',\s*\[[\s\S]*?'memory',\s*'store'[\s\S]*?\]\)/,
  );
  assert(storeBlock !== null, 'memoryStore spawnSync block found');
  assert(
    storeBlock !== null && storeBlock[0].includes("'--upsert'"),
    "'--upsert' is inside the memoryStore spawnSync block",
  );
}

// Defect 3 — edge key is deterministic (no Date.now / Math.random)
assert(
  SRC.includes('const key = `${e.relation}:${e.from}->${e.to}`;'),
  'edge key is `${e.relation}:${e.from}->${e.to}` (deterministic)',
);
{
  const keyLine = SRC.match(/const key = `[^`]*`;/);
  assert(keyLine !== null, 'edge key line found');
  assert(
    keyLine !== null && !keyLine[0].includes('Date.now()'),
    'edge key has no Date.now()',
  );
  assert(
    keyLine !== null && !keyLine[0].includes('Math.random()'),
    'edge key has no Math.random()',
  );
}

// Defect 2 — 'exists' does NOT increment storedRecords
assert(
  SRC.includes("if (r === 'ok') storedRecords++;"),
  "records tally is `if (r === 'ok') storedRecords++;`",
);
assert(
  !SRC.includes("if (r === 'ok' || r === 'exists') storedRecords++;"),
  "old `r === 'ok' || r === 'exists'` records tally is gone",
);

// Defect 2 — 'exists' does NOT increment storedEdges
assert(
  SRC.includes("if (r === 'ok') storedEdges++;"),
  "edges tally is `if (r === 'ok') storedEdges++;`",
);
assert(
  !SRC.includes("if (r === 'ok' || r === 'exists') storedEdges++;"),
  "old `r === 'ok' || r === 'exists'` edges tally is gone",
);

// Defect 2 follow-through — 'exists' is pushed to errors, not swallowed
assert(
  /else errors\.push\(`\$\{a\.id\} \$\{a\.file\}: \$\{r\}`\);/.test(SRC),
  'records else-branch pushes to errors',
);
assert(
  /else errors\.push\(`edge \$\{e\.relation\}:\$\{e\.from\}->\$\{e\.to\}: \$\{r\}`\);/.test(
    SRC,
  ),
  'edges else-branch pushes to errors with edge identity',
);

const total = passed + failed;
console.log(`issue-2660: ${passed}/${total} assertions passed`);
if (failed > 0) {
  console.error(`issue-2660: ${failed} assertion(s) FAILED`);
  process.exit(1);
}
