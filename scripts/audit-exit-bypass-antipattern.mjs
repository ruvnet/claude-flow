#!/usr/bin/env node
// audit-exit-bypass-antipattern — static analyzer for the iter-75 bug class.
//
// THE BUG (iter 75 in plugins/ruflo-cost-tracker/scripts/budget.mjs):
//
//   const alert = alertLevel(utilization);
//   ...
//   if (process.env.BUDGET_QUIET === '1') return console.log(JSON.stringify(out));
//                                          ^^^^^^^ early-return in JSON-mode branch
//   ...
//   if (alert.level === 'HARD_STOP') process.exit(1);    // ← UNREACHABLE in JSON mode
//
// The early return short-circuited the exit check, so cost-health's
// composite gate aggregated max(0, ...) instead of max(1, ...) and falsely
// reported HEALTHY at 190% budget. Per-script smoke can detect the literal
// pattern in one file (smoke step 32 in cost-tracker does this). This
// audit generalizes it to the entire fleet — any plugin script with the
// same shape gets flagged.
//
// USAGE
//   node scripts/audit-exit-bypass-antipattern.mjs                # scan all plugins
//   node scripts/audit-exit-bypass-antipattern.mjs --format json  # CI-consumable
//   node scripts/audit-exit-bypass-antipattern.mjs --only ruflo-cost-tracker
//
// EXIT CODES
//   0  no violations found
//   1  at least one script has the antipattern
//   2  scan error (e.g. no plugins dir)
//
// HEURISTIC (line-based; not a full AST)
//   For each .mjs file under plugins/*/scripts/, find function bodies via a
//   brace-depth tracker. Within each function:
//     - collect line numbers of `return console.log(JSON.stringify(...)` (early-return)
//     - collect line numbers of `process.exit([1-9]...)` (non-zero alert exits)
//   If ANY early-return precedes ANY non-zero exit in the same function,
//   flag the file. False positives possible (e.g. the early return is on
//   a path that can't reach the later exit anyway) but always worth a
//   human read. False negatives = bad; the heuristic errs toward flagging.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPTS_DIR);
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const ARGS = (() => {
  const a = { format: 'table', only: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--format') a.format = process.argv[++i];
    else if (v === '--only') {
      a.only = new Set((process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return a;
})();

function discoverScripts() {
  const out = [];
  let pluginDirs;
  try { pluginDirs = readdirSync(PLUGINS_DIR); } catch { return out; }
  for (const plugin of pluginDirs) {
    if (ARGS.only && !ARGS.only.has(plugin)) continue;
    const scriptsDir = join(PLUGINS_DIR, plugin, 'scripts');
    let stat;
    try { stat = statSync(scriptsDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = readdirSync(scriptsDir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.mjs')) continue;
      out.push({ plugin, file: join(scriptsDir, f), name: f });
    }
  }
  return out.sort((a, b) => (a.plugin + a.name).localeCompare(b.plugin + b.name));
}

// Track brace depth to identify function bodies. Crude but sufficient:
// when we see `function NAME(` or `function (` or `=> {`, record start.
// When matching close brace returns to that depth, record end.
function findFunctionRanges(lines) {
  const ranges = [];
  const stack = []; // entries: { startLine, startCol, depthAtStart }
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip line comments and string literals (very crude) before counting braces.
    const stripped = line.replace(/\/\/.*$/, '').replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, '""');
    // Heuristic: function-start signature appears on this line.
    // Match: `function name(`, `function (`, `async function ...`, `=> {`, `function* `
    const fnStart = /\bfunction\s*\*?\s*[\w$]*\s*\(|=>\s*\{/.test(stripped);
    if (fnStart) {
      stack.push({ startLine: i, startDepth: depth });
    }
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        // Pop any function that opened at exactly depth+1 (i.e. has now closed).
        while (stack.length && stack[stack.length - 1].startDepth === depth) {
          const fn = stack.pop();
          ranges.push({ start: fn.startLine, end: i });
        }
      }
    }
  }
  // Any unclosed (shouldn't happen in valid JS) — extend to EOF
  while (stack.length) {
    const fn = stack.pop();
    ranges.push({ start: fn.startLine, end: lines.length - 1 });
  }
  return ranges;
}

const EARLY_RETURN_RE = /\breturn\s+console\.log\s*\(\s*JSON\.stringify/;
const NONZERO_EXIT_RE = /\bprocess\.exit\s*\(\s*[1-9]\d*\s*\)/;
// Inline allowlist marker. Use on (or directly above) the early-return line
// when the code path is genuinely unreachable from the later non-zero exit.
// Example: `if (!cfg) return console.log(JSON.stringify(out));  // audit-allow: exit-bypass — no-budget path can't reach HARD_STOP`
const ALLOW_RE = /\baudit-allow:\s*exit-bypass\b/;

function auditFile(file) {
  let src;
  try { src = readFileSync(file, 'utf-8'); } catch { return null; }
  const lines = src.split('\n');
  const ranges = findFunctionRanges(lines);
  const violations = [];
  for (const fn of ranges) {
    const earlyReturns = [];
    const nonzeroExits = [];
    for (let i = fn.start; i <= fn.end; i++) {
      const line = lines[i];
      if (EARLY_RETURN_RE.test(line)) {
        // Check this line OR the line above for the suppression marker.
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
        earlyReturns.push(i + 1);
      }
      if (NONZERO_EXIT_RE.test(line)) nonzeroExits.push(i + 1);
    }
    if (earlyReturns.length === 0 || nonzeroExits.length === 0) continue;
    const firstExit = Math.min(...nonzeroExits);
    const bypassingReturns = earlyReturns.filter((ln) => ln < firstExit);
    if (bypassingReturns.length > 0) {
      violations.push({
        functionStart: fn.start + 1,
        functionEnd: fn.end + 1,
        earlyReturnLines: bypassingReturns,
        nonzeroExitLine: firstExit,
        sampleSnippets: bypassingReturns.map((ln) => ({
          line: ln, src: (lines[ln - 1] || '').trim().slice(0, 160),
        })),
      });
    }
  }
  return violations.length > 0 ? violations : null;
}

function main() {
  const scripts = discoverScripts();
  if (scripts.length === 0) {
    console.error('audit-exit-bypass-antipattern: no plugins/*/scripts/*.mjs found');
    process.exit(2);
  }

  const findings = [];
  for (const s of scripts) {
    const v = auditFile(s.file);
    if (v) findings.push({ plugin: s.plugin, file: s.file.replace(REPO_ROOT + '/', ''), violations: v });
  }

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({
      scriptsScanned: scripts.length,
      filesWithViolations: findings.length,
      findings,
      generatedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log('# audit-exit-bypass-antipattern');
    console.log('');
    console.log(`Scanned **${scripts.length}** scripts across ${new Set(scripts.map((s) => s.plugin)).size} plugins.`);
    console.log('');
    if (findings.length === 0) {
      console.log('✓ No exit-bypass antipattern found — the iter-75 bug class is contained.');
      console.log('');
      console.log('Pattern guarded against:');
      console.log('  `return console.log(JSON.stringify(...))` appearing BEFORE a');
      console.log('  `process.exit(N>0)` in the same function. See iter 75 fix for context.');
    } else {
      console.log(`⚠ Found ${findings.length} file(s) with potential exit-bypass:`);
      console.log('');
      for (const f of findings) {
        console.log(`## ${f.file}`);
        for (const v of f.violations) {
          console.log(`  - function at line ${v.functionStart}: early-return on line(s) ${v.earlyReturnLines.join(', ')} precedes process.exit on line ${v.nonzeroExitLine}`);
          for (const s of v.sampleSnippets) {
            console.log(`      L${s.line}: ${s.src}`);
          }
        }
        console.log('');
      }
      console.log('Verify each finding manually. Possible fixes:');
      console.log('  1. Replace `if (X) return console.log(JSON)` with `if (X) { console.log(JSON); } else { ... }`');
      console.log('     and move the process.exit AFTER the if/else (so both branches reach it).');
      console.log('  2. If the early return is on a code path that genuinely cannot reach the exit');
      console.log('     (e.g. no-budget-configured case), this is a false positive — confirm by');
      console.log('     reading the function. The audit errs toward flagging.');
    }
    console.log('');
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

main();
