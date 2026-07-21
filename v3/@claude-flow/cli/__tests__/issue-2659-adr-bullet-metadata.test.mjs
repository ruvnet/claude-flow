// Regression test for issue #2659 — adr-index parser drops Status/Date/Tags for
// bullet-prefixed metadata from adr-create's own template.
//
// The regexes in plugins/ruflo-adr/scripts/lib/parse-adrs.mjs used `^` line
// anchors, but adr-create's template writes fields as `- **Status**: proposed`
// (leading `- `). The anchor silently dropped every bullet-prefixed field to
// Unknown/empty. This test asserts each regex includes the `(?:[-*]\s*)?`
// bullet-prefix guard AND functionally parses bullet-prefixed input.
//
// Run: node v3/@claude-flow/cli/__tests__/issue-2659-adr-bullet-metadata.test.mjs
// (no test framework, no deps — standalone Node assert runner, T21 pattern.)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAdr } from '../../../../plugins/ruflo-adr/scripts/lib/parse-adrs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../../../../plugins/ruflo-adr/scripts/lib/parse-adrs.mjs');
const src = readFileSync(SRC, 'utf-8');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

// --- 1. Source-level: each of the 5 regexes includes `(?:[-*]\s*)?` after `^` ---
// In the .mjs source the guard appears as `(?:[-*]\s*)?` in regex literals
// (single backslash) and as `(?:[-*]\\s*)?` in the template-literal REL
// (double backslash, because it's a string for new RegExp). We count both.
const GUARD_LIT = '(?:[-*]\\s*)?';      // regex literal form: \s
const GUARD_STR = '(?:[-*]\\\\s*)?';    // template-literal form: \\s
const guardCount = (src.split(GUARD_LIT).length - 1) + (src.split(GUARD_STR).length - 1);
check('source has ≥5 guard occurrences across both forms (found ' + guardCount + ')',
  guardCount >= 5);

// Spot-check each of the 5 regexes: guard precedes the expected field marker.
// Regex literals use single-backslash escapes (\s, \*); the REL template
// literal uses double-backslash (\\s, \\*) because it feeds new RegExp().
check('parseStatus v3-style: guard precedes **Status',
  src.includes('^(?:[-*]\\s*)?\\*\\*Status:?\\*\\*:?\\s*'));
check('parseStatus MADR: guard precedes **Status: (full-bold)',
  src.includes('^(?:[-*]\\s*)?\\*\\*Status:\\s*([A-Za-z]'));
check('parseDate: guard precedes **Date**',
  src.includes('^(?:[-*]\\s*)?\\*\\*Date\\*\\*:\\s*(\\S+)'));
check('parseTags: guard precedes **Tags**',
  src.includes('^(?:[-*]\\s*)?\\*\\*Tags\\*\\*:\\s*(.+)'));
check('parseLinks REL: guard precedes **${label}',
  src.includes('`^(?:[-*]\\\\s*)?\\\\*\\\\*${label}'));

// --- 2. Functional: parseAdr on a bullet-prefixed ADR (adr-create template) ---
const BULLET_ADR = `# ADR-099: Bullet Metadata Test

- **Status**: proposed
- **Date**: 2026-07-13
- **Tags**: golden-corpus, ddd, microservices

## Context

Sample context for bullet-prefixed metadata.

## Relationships

- **Supersedes**: ADR-001
`;
const tmpFile = join(__dirname, 'issue-2659-fixture.md');
writeFileSync(tmpFile, BULLET_ADR);
const parsed = parseAdr(tmpFile, __dirname);

check('bullet Status → "proposed"', parsed.status === 'proposed');
check('bullet Date → "2026-07-13"', parsed.date === '2026-07-13');
check('bullet Tags → 3 elements', parsed.tags.length === 3);
check('bullet Tags → includes golden-corpus', parsed.tags.includes('golden-corpus'));
check('bullet Tags → includes ddd', parsed.tags.includes('ddd'));
check('bullet Tags → includes microservices', parsed.tags.includes('microservices'));
check('bullet Supersedes → 1 edge with relation=supersedes',
  parsed.links.length === 1 && parsed.links[0].relation === 'supersedes');
check('bullet Supersedes → from=ADR-001', parsed.links[0].from === 'ADR-001');

// --- 3. Backward-compat: old non-bullet format still works ---
const OLD_ADR = `# ADR-100: Legacy Metadata Test

**Status**: accepted
**Date**: 2025-01-15
**Tags**: legacy, compat

## Context

Sample context.

**Supersedes**: ADR-002
`;
writeFileSync(tmpFile, OLD_ADR);
const oldParsed = parseAdr(tmpFile, __dirname);
check('legacy Status → "accepted"', oldParsed.status === 'accepted');
check('legacy Date → "2025-01-15"', oldParsed.date === '2025-01-15');
check('legacy Tags → 2 elements', oldParsed.tags.length === 2);
check('legacy Tags → includes legacy', oldParsed.tags.includes('legacy'));
check('legacy Supersedes → 1 edge', oldParsed.links.length === 1 && oldParsed.links[0].relation === 'supersedes');
check('legacy Supersedes → from=ADR-002', oldParsed.links[0].from === 'ADR-002');

// --- 4. parseLinks REL with bullet-prefixed relationship lines (direct regex) ---
const REL = (label) => new RegExp(`^(?:[-*]\\s*)?\\*\\*${label}(?:\\s*\\([^)]*\\))?:?\\*\\*:?\\s*(.+)$`, 'mi');
check('REL(Supersedes) matches `- **Supersedes**: ADR-001`', REL('Supersedes').exec('- **Supersedes**: ADR-001')?.[1]?.trim() === 'ADR-001');
check('REL(Related) matches `- **Related**: ADR-003`', REL('Related').exec('- **Related**: ADR-003')?.[1]?.trim() === 'ADR-003');
check('REL(Supersedes) still matches non-bullet `**Supersedes**: ADR-004`', REL('Supersedes').exec('**Supersedes**: ADR-004')?.[1]?.trim() === 'ADR-004');

unlinkSync(tmpFile);

// --- Summary ---
console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
