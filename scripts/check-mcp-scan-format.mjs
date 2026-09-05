#!/usr/bin/env node
// check-mcp-scan-format — protect iter-50's parseMcpScanText from silent
// upstream changes.
//
// iter 50 reverse-engineered upstream `harness mcp-scan` to extract
// structured findings from its plain-text output. That parser depends
// on TWO format invariants:
//
//   1. Finding lines: `  [SEV] <message>` or `  [SEV ] <message>`
//      (uppercase severity inside brackets, optional alignment padding,
//      message on same line)
//
//   2. Summary line:  `Result: <SEV> (N finding, M high)`
//
// If upstream changes either format (e.g., drops `[]` markers, switches
// to JSON, changes the Result regex), parseMcpScanText silently returns
// `[]` findings and audit-trend's introduced/cleared diff returns to
// dead code (the iter-49 latent bug).
//
// This script runs `harness mcp-scan` against ruflo itself and asserts
// BOTH format invariants hold. CI fails the workflow if either drifts.
//
// USAGE
//   node scripts/check-mcp-scan-format.mjs               # exits 0 if compatible
//   node scripts/check-mcp-scan-format.mjs --format json # CI-consumable
//
// EXIT CODES
//   0  format invariants intact (or metaharness not installed —
//      ADR-150 graceful degradation: skip with reason)
//   1  format invariant violated — parser will silently break
//   2  unexpected error

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function emit(payload, code) {
  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# check-mcp-scan-format\n`);
    if (payload.skipped) console.log(`⊘ ${payload.reason}`);
    else if (payload.ok) console.log(`✓ All ${payload.results?.length ?? 0} invariants intact.`);
    else {
      console.log(`✗ ${payload.failedCount}/${payload.results?.length ?? 0} invariants violated:`);
      for (const r of payload.results || []) {
        if (!r.ok) console.log(`  - ${r.check}`);
      }
    }
  }
  process.exit(code);
}

async function main() {
  // Resolve repo root (one level up from scripts/)
  const repoRoot = join(SCRIPT_DIR, '..');

  // 1. Run `harness mcp-scan` against ruflo. ~5s on warm cache.
  const r = spawnSync('npx', [
    '-y', '-p', 'metaharness@latest', 'harness', 'mcp-scan', repoRoot,
  ], { encoding: 'utf-8', timeout: 90_000 });

  // 2. Graceful path: dep absent
  if (r.status === null
      || /could not determine executable|404|not installed|MODULE_NOT_FOUND|ENOTFOUND/i.test(r.stderr || '')) {
    emit({
      skipped: true,
      reason: 'metaharness-not-available — install with `npm i --include=optional` to verify upstream format',
      generatedAt: new Date().toISOString(),
    }, 0);
  }

  const stdout = r.stdout || '';
  const results = [];

  // 3. INVARIANT 1: at least one finding line in a supported shape:
  //    legacy `[SEV] <message>` or fixed-width `[SEV ] <message>`.
  //    Pre-iter-50 we never asserted this — upstream changing to
  //    `* SEV: message` would have been undetectable.
  const findingLineRegex = /^\s*\[([A-Z]+)\s*\]\s+\S/m;
  const findingMatch = findingLineRegex.exec(stdout);
  results.push({
    check: 'finding line matches `[SEV]` or padded `[SEV ]` message regex',
    ok: findingMatch !== null,
    detail: findingMatch ? `first match: [${findingMatch[1]}]` : 'no match — parser will return empty findings',
  });

  // 4. INVARIANT 2: Result summary line matches the expected shape.
  //    `Result: SEV (N finding, M high)` — used to populate summary.
  const resultRegex = /Result:\s+([A-Z]+)\s+\((\d+)\s+finding/;
  const resultMatch = resultRegex.exec(stdout);
  results.push({
    check: 'Result line matches `Result: SEV (N finding, M high)` regex',
    ok: resultMatch !== null,
    detail: resultMatch
      ? `severity=${resultMatch[1]}, count=${resultMatch[2]}`
      : 'no match — summary parsing will return null',
  });

  // 5. INVARIANT 3: run the actual parser against the output. Catches
  //    any drift the regex above might miss but the parser depends on.
  let parser;
  try {
    parser = await import(join(repoRoot, 'plugins', 'ruflo-metaharness', 'scripts', '_harness.mjs'));
  } catch (e) {
    results.push({
      check: 'parseMcpScanText module loadable',
      ok: false,
      detail: e?.message?.slice(0, 100),
    });
    emit({ ok: false, results, failedCount: 1, generatedAt: new Date().toISOString() }, 1);
  }
  const parsed = parser.parseMcpScanText(stdout);
  results.push({
    check: 'parseMcpScanText returns findings array',
    ok: Array.isArray(parsed.findings),
    detail: `findings.length=${parsed.findings?.length}`,
  });
  results.push({
    check: 'parseMcpScanText extracts at least 1 finding from real output',
    ok: parsed.findings.length >= 1,
    detail: parsed.findings.length === 0
      ? 'parser produced empty findings — format may have drifted'
      : `first: severity=${parsed.findings[0].severity}, msg-prefix="${parsed.findings[0].message?.slice(0, 40)}..."`,
  });

  const failed = results.filter((x) => !x.ok);
  emit({
    ok: failed.length === 0,
    results,
    failedCount: failed.length,
    generatedAt: new Date().toISOString(),
  }, failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('check-mcp-scan-format crashed:', e?.message ?? e);
  process.exit(2);
});
