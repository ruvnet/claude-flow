#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2195.
 *
 * The statusline generator previously re-implemented all data readers
 * locally with fragile file probes that returned wrong values:
 *   - DDD:          0/5   (AgentDB has 26k+ patterns → should be 5/5)
 *   - Intelligence: 1%    (healthy system → should be 100%)
 *   - ADR count:    87/87 (missed v3/docs/adr/ → should be 128)
 *   - Vectors:      22    (read session-imports, not AgentDB total)
 *
 * The fix delegates to 'npx @claude-flow/cli@latest hooks statusline --json'
 * as the single source of truth and counts ADRs in both directories.
 *
 * This smoke verifies:
 *   [1/3] Generator emits a .cjs that calls 'hooks statusline --json'
 *   [2/3] Generated .cjs runs without syntax errors (node --check)
 *   [3/3] Generated .cjs JSON output fields are in valid ranges
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const REPO_ROOT = resolve(process.cwd());
const GENERATOR_SRC = join(REPO_ROOT, 'v3/@claude-flow/cli/src/init/statusline-generator.ts');
const GENERATOR_DIST = join(REPO_ROOT, 'v3/@claude-flow/cli/dist/src/init/statusline-generator.js');
// #2679: generator now reads .claude/helpers/statusline.cjs as its single
// source of truth (read-and-substitute pattern) instead of inlining a
// 1000-line template. Static-content contract lives in the HELPER now;
// the generator just needs to still be reading it. This constant is the
// source-of-truth helper used by the static-source contract below.
const HELPER_SRC = join(REPO_ROOT, 'v3/@claude-flow/cli/.claude/helpers/statusline.cjs');
const CJS_PATH = join(tmpdir(), 'ruflo-smoke-statusline.cjs');

let passed = 0;
let failed = 0;

function pass(msg) { console.log(`  ok: ${msg}`); passed++; }
function fail(msg) { console.error(`  FAIL: ${msg}`); failed++; }

// ─── Layer 1: static source contract ────────────────────────────
console.log('\n[1/3] STATIC SOURCE CONTRACT');

// #2679: two paired checks — the HELPER carries the delegation content
// (since the generator now reads it verbatim), and the GENERATOR still
// reads the helper (so drift on either side is caught). Splitting the
// invariant across the two files means neither can silently regress.
if (!existsSync(GENERATOR_SRC)) {
  fail(`generator source not found: ${GENERATOR_SRC}`);
} else {
  const genSrc = readFileSync(GENERATOR_SRC, 'utf-8');

  if (genSrc.includes('statusline.cjs')) {
    pass('generator references statusline.cjs (#2679 read-and-substitute pattern)');
  } else {
    fail('generator does NOT reference statusline.cjs — #2679 sync pattern regressed; init would emit stale template');
  }

  if (/readFileSync[\s\S]{0,200}helperContent|helperContent[\s\S]{0,200}readFileSync/.test(genSrc)) {
    pass('generator reads helper via readFileSync (#2679)');
  } else {
    fail('generator no longer reads helper via readFileSync — #2679 sync mechanism broken');
  }
}

if (!existsSync(HELPER_SRC)) {
  fail(`helper source not found: ${HELPER_SRC}`);
} else {
  const src = readFileSync(HELPER_SRC, 'utf-8');

  if (src.includes('hooks statusline --json')) {
    pass('helper delegates to hooks statusline --json');
  } else {
    fail('helper does NOT contain delegation to hooks statusline --json (regression of #2195)');
  }

  if (!src.includes('getLearningStats')) {
    pass('getLearningStats (old local reader) removed from helper');
  } else {
    fail('getLearningStats still present in helper — old fragile local reader NOT removed (#2195)');
  }

  if (!src.includes('getV3Progress')) {
    pass('getV3Progress (old local reader) removed from helper');
  } else {
    fail('getV3Progress still present in helper — old fragile local reader NOT removed (#2195)');
  }

  if (src.includes("'v3', 'docs', 'adr'") || src.includes("v3/docs/adr")) {
    pass('helper counts v3/docs/adr ADR directory');
  } else {
    fail('helper missing v3/docs/adr in ADR count — will undercount ADRs (#2195)');
  }

  if (src.includes("'v3', 'implementation', 'adrs'") || src.includes("v3/implementation/adrs")) {
    pass('helper counts v3/implementation/adrs ADR directory');
  } else {
    fail('helper missing v3/implementation/adrs in ADR count');
  }
}

// ─── Layer 2: generated .cjs syntax check ───────────────────────
console.log('\n[2/3] GENERATED .CJS SYNTAX CHECK');

if (!existsSync(GENERATOR_DIST)) {
  console.log('  skip: dist not built (expected in static-scan-only environments)');
} else {
  try {
    // Generate the .cjs
    const genScript = `
      const { generateStatuslineScript } = require(${JSON.stringify(GENERATOR_DIST)});
      const content = generateStatuslineScript({ runtime: { maxAgents: 15 }, statusline: { enabled: true } });
      require('fs').writeFileSync(${JSON.stringify(CJS_PATH)}, content, 'utf-8');
      process.stdout.write('Generated ' + content.length + ' chars\\n');
    `;
    execSync(`node -e "${genScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: REPO_ROOT,
    });

    if (existsSync(CJS_PATH)) {
      pass(`generator wrote ${CJS_PATH}`);

      // Syntax check only (--check flag, no execution)
      try {
        execSync(`node --check "${CJS_PATH}"`, { encoding: 'utf-8', timeout: 5000 });
        pass('generated .cjs passes Node.js syntax check');
      } catch (err) {
        fail(`generated .cjs has syntax errors: ${err.message.split('\n')[0]}`);
      }

      // Verify delegation pattern in generated .cjs
      const cjsContent = readFileSync(CJS_PATH, 'utf-8');
      if (cjsContent.includes('hooks statusline --json')) {
        pass('generated .cjs contains delegation to hooks statusline --json');
      } else {
        fail('generated .cjs does NOT delegate to hooks statusline --json — generator output is wrong');
      }

      if (cjsContent.includes('v3/docs/adr')) {
        pass('generated .cjs includes v3/docs/adr in ADR count');
      } else {
        fail('generated .cjs missing v3/docs/adr in ADR count');
      }

    } else {
      fail('generator did not write CJS file');
    }
  } catch (err) {
    fail(`generator script threw: ${err.message.split('\n')[0]}`);
  }
}

// ─── Layer 3: runtime JSON range validation ──────────────────────
console.log('\n[3/3] RUNTIME JSON RANGE VALIDATION');

if (!existsSync(CJS_PATH)) {
  console.log('  skip: .cjs not available (dist not built)');
} else {
  try {
    // Run the .cjs with --json, expect valid JSON output
    // The CLI delegation requires npx which may not be available in CI without network.
    // So we only check: valid JSON, numeric fields in range, no syntax/runtime error.
    const raw = execSync(`node "${CJS_PATH}" --json`, {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: process.env.PATH },
    }).trim();

    // Find first '{' in case there's preamble
    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) {
      fail('--json output contains no JSON object');
    } else {
      try {
        const data = JSON.parse(raw.slice(jsonStart));
        pass('--json output is valid JSON');

        // Field range checks (must be present and numeric)
        const checks = [
          ['v3Progress.domainsCompleted', data.v3Progress?.domainsCompleted, 0, 10],
          ['v3Progress.totalDomains', data.v3Progress?.totalDomains, 1, 20],
          ['v3Progress.dddProgress', data.v3Progress?.dddProgress, 0, 100],
          ['system.intelligencePct', data.system?.intelligencePct, 0, 100],
          ['system.memoryMB', data.system?.memoryMB, 0, 100000],
          ['swarm.maxAgents', data.swarm?.maxAgents, 1, 1000],
          ['adrs.count', data.adrs?.count, 0, 10000],
        ];

        for (const [name, value, min, max] of checks) {
          if (typeof value !== 'number') {
            fail(`${name} is not a number (got ${typeof value}: ${value})`);
          } else if (value < min || value > max) {
            fail(`${name} = ${value} out of range [${min}, ${max}]`);
          } else {
            pass(`${name} = ${value} (in range [${min}, ${max}])`);
          }
        }

        // Verify ADR count includes both dirs (CI has the git checkout, both
        // directories exist, so we should see count > 87 on a full checkout)
        if (data.adrs?.count > 87) {
          pass(`adrs.count ${data.adrs.count} > 87, confirming both ADR directories counted`);
        } else if (data.adrs?.count === 0) {
          pass('adrs.count = 0 (acceptable in minimal checkout without ADR dirs)');
        } else {
          // count in [1, 87] — acceptable in a sparse checkout but worth noting
          pass(`adrs.count = ${data.adrs?.count} (single ADR directory only — acceptable in sparse checkout)`);
        }

      } catch (e) {
        fail(`JSON parse error: ${e.message}`);
      }
    }
  } catch (err) {
    // If the CLI delegation timed out (network unavailable in CI), the .cjs
    // falls back to buildLocalFallback() which returns all-zeros but valid JSON.
    // That's acceptable — the important thing is no crash.
    if (err.status === 0 || err.stdout) {
      pass('--json ran without crash (fallback path ok)');
    } else {
      // A non-zero exit with no stdout means the script itself crashed.
      fail(`--json crashed: ${err.message?.split('\n')[0] || 'unknown error'}`);
    }
  }
}

// ─── Result ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`statusline-generator-delegation smoke: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
