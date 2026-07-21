#!/usr/bin/env node
/**
 * Static guard for ruvnet/ruflo#2132 — plugin `hooks.json` commands must be
 * cross-platform (work on Windows without WSL / Git Bash).
 *
 * The reporter ran the plugin hooks on native Windows and every `PostToolUse`
 * fired exit code 126 ("cannot execute binary file") because the commands
 * hardcoded:
 *
 *   - `/bin/bash -c '...'` — no such path on Windows
 *   - POSIX-only pipelines: `jq`, `xargs -0`, `tr '\n' '\0'`, `sed`, `awk`
 *   - `.sh` scripts with `#!/usr/bin/env bash` shebang
 *
 * The fix pattern (used by `.claude/settings.json` and `hook-handler.cjs` —
 * which already works on Windows) is to invoke `node` directly with a `.cjs`
 * or `.mjs` script:
 *
 *   "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/helpers/hook-handler.cjs\" post-edit"
 *
 * ## POSIX-only exemption (added in #2132 fix PR)
 *
 * A hooks.json file may declare `"_platform": "posix"` at the top level to
 * mark it as intentionally Mac/Linux-only. Such files are EXEMPT from the
 * cross-platform patterns audit. The exemption exists because the 3 plugin
 * hooks.json files in this repo use POSIX bash pipelines that are
 * battle-tested on Mac/Linux; the Windows path is provided via init-time
 * settings.json override (see v3/@claude-flow/cli/src/init/settings-generator.ts).
 *
 * Audit logic:
 *  1. Files with "_platform": "posix" - skip pattern scan, check Windows path exists
 *  2. All other files - strict cross-platform scan (original behaviour)
 *
 * Windows path check: for every POSIX-exempt file in a plugins/<name>/hooks/ dir,
 * verify that plugins/<name>/scripts/ruflo-hook.cjs exists (the Node shim that
 * init copies to `.claude/helpers/` on Windows). This proves the Windows path
 * is covered without requiring platform detection at audit time.
 *
 * This audit walks every plugin `hooks.json` in the tree (skipping
 * node_modules and worktrees) and fails if it finds any of the broken
 * patterns. Wired into v3-ci.yml as `plugin-hooks-cross-platform-audit`.
 *
 * False-positive avoidance: only the `command` field of `hooks[].hooks[]`
 * entries is scanned. Comments, descriptions, and the top-level `_note`
 * field are ignored.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Directories to skip when walking
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

// Skip everything under .claude/worktrees — those are scratch copies
function isSkippedPath(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  if (rel.startsWith('.claude/worktrees/')) return true;
  return false;
}

function* walkForHooksJson(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (isSkippedPath(full)) continue;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      yield* walkForHooksJson(full);
    } else if (st.isFile() && entry === 'hooks.json') {
      yield full;
    }
  }
}

// Patterns that break native Windows. Each rule has a label + a regex
// applied to the `command` string (not the surrounding JSON).
const BAD_PATTERNS = [
  { label: '/bin/bash literal',  regex: /\/bin\/bash\b/,                hint: 'replace with `node "..../hook-handler.cjs" <subcommand>` — same pattern as .claude/settings.json' },
  { label: '/bin/sh literal',    regex: /\/bin\/sh\b/,                  hint: 'replace with `node ...` like .claude/settings.json' },
  { label: 'pipe to jq',         regex: /\|\s*jq\b/,                    hint: 'parse JSON inside a node helper (the cli-side hook script can read stdin via process.stdin)' },
  { label: 'xargs -0',           regex: /\bxargs\s+-0\b/,               hint: 'do argument passing inside the node helper, not via shell' },
  { label: 'tr to NUL byte',     regex: /\btr\s+['"]\\n['"]\s+['"]\\0['"]/, hint: 'unnecessary if you stop piping through xargs' },
  { label: '.sh script in cmd',  regex: /\.sh\b/,                       hint: 'replace .sh shim with a .cjs helper that has no shebang requirement' },
];

let violations = [];
const scanned = [];
const posixExempt = [];
let posixWindowsPathMissing = false;

for (const file of walkForHooksJson(REPO_ROOT)) {
  const text = readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) {
    violations.push({
      file: relative(REPO_ROOT, file),
      line: 1,
      label: 'UTF-8 BOM forbidden (Codex reports line 1 column 1)',
      cmd: 'hooks.json starts with bytes EF BB BF',
      hint: 'Save hooks.json as UTF-8 without BOM before publishing the plugin.',
    });
    continue;
  }
  let json;
  try { json = JSON.parse(text); } catch (err) {
    violations.push({ file: relative(REPO_ROOT, file), line: 0, label: 'invalid JSON', cmd: err.message, hint: '' });
    continue;
  }

  // --- POSIX-only exemption check (#2132, hardened #2721) ---
  if (json._platform === 'posix') {
    const relFile = relative(REPO_ROOT, file);
    posixExempt.push(relFile);

    // Verify the Windows path (Node shim) exists alongside this hooks.json.
    // Convention: hooks.json lives in <plugin>/hooks/hooks.json
    //             shim lives in <plugin>/scripts/ruflo-hook.cjs
    const pluginDir = resolve(join(file, '..', '..'));
    const shimPath = join(pluginDir, 'scripts', 'ruflo-hook.cjs');
    if (!existsSync(shimPath)) {
      violations.push({
        file: relFile,
        line: 0,
        label: 'POSIX-exempt but Windows shim missing',
        cmd: `Expected ${relative(REPO_ROOT, shimPath)}`,
        hint: 'Create plugins/<name>/scripts/ruflo-hook.cjs (cross-platform Node port of ruflo-hook.sh). See #2132.',
      });
      posixWindowsPathMissing = true;
    } else if (json._legacy_unaudited_shim !== true) {
      // #2721 — a sibling .cjs existing proves nothing on its own: #2721
      // shipped with plugins/ruflo-cost-tracker/scripts/ruflo-hook.cjs
      // present on disk but referenced NOWHERE, while hooks.json still
      // hard-coded `/bin/bash -c '...'`. Require at least one command in
      // this hooks.json to actually name the shim file.
      //
      // `_legacy_unaudited_shim: true` is an explicit, reviewed escape
      // valve — NOT a way to quietly bypass this check. It exists only for
      // .claude-plugin/hooks/hooks.json and plugin/hooks/hooks.json (the
      // older, separately-published "claude-flow" plugin, distinct from
      // the ruflo-core/ruflo-cost-tracker plugins this file's #2721 fix
      // covers): those use a much larger jq/xargs-based hook set that was
      // NOT audited or fixed as part of #2721 and needs its own pass. Any
      // NEW posix-exempt file must not set this flag — it must actually
      // wire its shim.
      const referencesShim = Object.values(json?.hooks ?? {})
        .flat()
        .flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []))
        .some((h) => typeof h?.command === 'string' && h.command.includes('ruflo-hook.cjs'));
      if (!referencesShim) {
        violations.push({
          file: relFile,
          line: 0,
          label: 'POSIX-exempt but Windows shim exists unreferenced (#2721 shape)',
          cmd: `${relative(REPO_ROOT, shimPath)} is present but no command in this file names it`,
          hint: 'Point at least one hooks.json command at the .cjs shim (e.g. via a `node -e` bootstrap resolving CLAUDE_PLUGIN_ROOT), or drop the unused shim file.',
        });
        posixWindowsPathMissing = true;
      }
    }
    // Skip further pattern scanning for POSIX-exempt files
    continue;
  }

  // --- Strict cross-platform scan for non-exempt files ---
  const events = Array.isArray(json?.hooks) ? json.hooks : Object.values(json?.hooks ?? {}).flat();
  const flat = [];
  // hooks can be either:
  //   - { hooks: [ { matcher, hooks: [ { type, command } ] }, ... ] }   (Claude Code 1.x)
  //   - { hooks: { PostToolUse: [ ... ] } }                              (alt shape)
  for (const entry of events) {
    if (!entry) continue;
    if (Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        if (h?.command) flat.push({ matcher: entry.matcher ?? '', command: h.command });
      }
    } else if (entry.command) {
      flat.push({ matcher: '', command: entry.command });
    }
  }

  scanned.push({ file: relative(REPO_ROOT, file), entries: flat.length });

  for (const { matcher, command } of flat) {
    for (const { label, regex, hint } of BAD_PATTERNS) {
      if (regex.test(command)) {
        // Find approximate line number by searching the raw text
        const idx = text.indexOf(command);
        const line = idx < 0 ? 0 : text.slice(0, idx).split('\n').length;
        violations.push({
          file: relative(REPO_ROOT, file),
          line,
          matcher: matcher || '(no matcher)',
          label,
          cmd: command.length > 120 ? command.slice(0, 117) + '...' : command,
          hint,
        });
      }
    }
  }
}

console.log(`plugin-hooks cross-platform audit — scanned ${scanned.length} file(s), ${scanned.reduce((a, b) => a + b.entries, 0)} hook command(s)`);
for (const s of scanned) console.log(`  ${s.file}: ${s.entries} command(s)`);

if (posixExempt.length > 0) {
  console.log(`\nPOSIX-exempt files (${posixExempt.length}) — skipped cross-platform scan, Windows shim checked:`);
  for (const f of posixExempt) console.log(`  ${f}`);
}

if (violations.length === 0) {
  console.log('\n  ok: all plugin hook commands are cross-platform (no /bin/bash, no POSIX pipelines, no .sh scripts)');
  console.log('  ok: all POSIX-exempt files have a corresponding Windows Node shim');
  process.exit(0);
}

console.error(`\n${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`  x ${v.file}:${v.line}  [${v.matcher ?? ''}]  ${v.label}`);
  console.error(`     cmd: ${v.cmd}`);
  console.error(`     fix: ${v.hint}`);
}
console.error('\nReference: ruvnet/ruflo#2132 (plugin hooks broken on Windows).');
console.error('Cross-platform pattern: .claude/settings.json + .claude/helpers/hook-handler.cjs (node, no bash).');
console.error('POSIX-exempt pattern: add "_platform": "posix" to hooks.json + create scripts/ruflo-hook.cjs sibling.');
process.exit(1);
