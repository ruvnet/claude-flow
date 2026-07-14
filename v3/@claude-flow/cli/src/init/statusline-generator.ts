/**
 * Statusline Configuration Generator (Optimized)
 * Creates fast, reliable statusline for V3 progress display
 *
 * Performance:
 * - Single combined git execSync call (not 8+ separate ones)
 * - process.memoryUsage() instead of ps aux
 * - No recursive test file content reading
 * - Shared settings cache
 * - Strict 2s timeouts on all shell calls
 */

import type { InitOptions } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname_sg = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the running CLI's own version — same createRequire/walk-up
 * approach as helper-refresh.ts's getInstalledCliVersion(), duplicated
 * here rather than imported. helper-refresh.ts pulls in the `semver`
 * package at module scope (for autoRefreshHelpersIfStale()'s version
 * comparison, unrelated to this) — ES module imports load a module's
 * ENTIRE top-level regardless of which export is used, so importing just
 * getInstalledCliVersion from there still requires `semver` to be resolvable.
 * Confirmed live: the CI smoke job that loads this generator via a minimal
 * "smoke deps" install (no full `npm install`) failed with
 * ERR_MODULE_NOT_FOUND('semver') the moment this file gained that import,
 * even though this function itself never touches semver. Keeping this
 * generator's own dependency footprint to bare Node builtins avoids
 * dragging every future helper-refresh.ts dependency into every context
 * that merely wants to render a statusline script.
 */
function getInstalledCliVersionLocal(): string {
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(esmRequire.resolve('@claude-flow/cli/package.json'), 'utf-8'));
    return String(pkg.version || '0.0.0');
  } catch {
    let dir = __dirname_sg;
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg && pkg.name === '@claude-flow/cli') return String(pkg.version || '0.0.0');
      } catch { /* no package.json here, or unreadable — keep climbing */ }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return '0.0.0';
  }
}

/**
 * Generate optimized statusline script
 * Output format:
 * ▊ RuFlo V3.6 ● user  │  ⎇ branch  │  Opus 4.7
 * ─────────────────────────────────────────────────────
 * 🏗️  DDD Domains    [●●○○○]  2/5    ⚡ HNSW 150x
 * 🤖 Swarm  ◉ [ 5/15]  👥 2    🪝 10/17    🟢 CVE 3/3    💾 4MB    🧠  63%
 * 🔧 Architecture    ADRs ●71%  │  DDD ● 13%  │  Security ●CLEAN
 * 📊 AgentDB    Vectors ●3104⚡  │  Size 216KB  │  Tests ●6 (~24 cases)  │  MCP ●1/1
 */
export function generateStatuslineScript(options: InitOptions): string {
  const maxAgents = options.runtime.maxAgents;
  // Resolved reliably HERE (inside the actual running CLI process, via
  // getInstalledCliVersion()'s createRequire/findPackageRoot resolution) —
  // never wrong at generation time. Baked in as getPkgVersion()'s fallback
  // so a pure-npx render (no persistent local install: no marketplace
  // checkout, no project node_modules, nothing under a global prefix — npx
  // only ever installs into its own ephemeral, unpredictably-hashed
  // ~/.npm/_npx/<hash>/ directory, which none of getPkgVersion()'s
  // candidate paths can find) shows the real version instead of the
  // previous hardcoded "3.6" placeholder. getPkgVersion()'s own runtime
  // candidate scan still wins over this baked-in value when it finds
  // something newer (e.g. a later `npm update` in the same project).
  const bakedVersion = getInstalledCliVersionLocal();

  // #2679 fix: read the committed .claude/helpers/statusline.cjs as the
  // single source of truth instead of maintaining a 1000-line template
  // string inline. Prior to this fix, the inline template drifted from
  // the deployed helper (v3.29.0 UX improvements — whole-row-clickable
  // OSC 8, (domain) suffix, ellipsis, bright-white command, 300s cache
  // TTL, windowsHide on subprocess spawns — all shipped in the helper
  // but the generator kept its older shape). Now: read the helper +
  // substitute two known values (maxAgents, bakedVersion).
  //
  // Walk-up finds the CLI package root (whether we're at src/init/ in
  // tests or dist/src/init/ in installed use). Same shape as
  // getInstalledCliVersionLocal() above — reuse the pattern for the
  // same reason it exists there.
  let helperContent: string | null = null;
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgJsonPath = esmRequire.resolve('@claude-flow/cli/package.json');
    const helperPath = path.join(path.dirname(pkgJsonPath), '.claude', 'helpers', 'statusline.cjs');
    helperContent = fs.readFileSync(helperPath, 'utf-8');
  } catch {
    let dir = __dirname_sg;
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg && pkg.name === '@claude-flow/cli') {
          const candidate = path.join(dir, '.claude', 'helpers', 'statusline.cjs');
          if (fs.existsSync(candidate)) { helperContent = fs.readFileSync(candidate, 'utf-8'); break; }
        }
      } catch { /* keep climbing */ }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (helperContent === null) {
    throw new Error(
      'statusline-generator: could not locate .claude/helpers/statusline.cjs '
      + 'relative to @claude-flow/cli. This is a packaging bug — the helper '
      + 'must ship with the CLI (see package.json files entry for .claude).'
    );
  }

  // Two known interpolation points — both single-line, both idempotent
  // string replacements. If a future edit to the helper renames either
  // token, this replace() is a no-op and the fallback default (15,
  // whatever the helper hard-codes) ships. Add a paired test in
  // statusline-cost-display.test.ts before changing either token.
  helperContent = helperContent.replace(/maxAgents: \d+,/, `maxAgents: ${maxAgents},`);
  // Only overwrite the helper's baked version if OURS resolves higher.
  // Otherwise the substitution could DOWNGRADE (test environments where
  // esmRequire.resolve happens to hit an older node_modules install would
  // clobber a fresh committed helper). Naive lexicographic compare — works
  // for canonical semver strings with same-width digit parts, which is
  // reliable at this stage of the version space.
  const helperVerMatch = helperContent.match(/let ver = "([^"]+)";/);
  const helperVer = helperVerMatch ? helperVerMatch[1] : '';
  if (!helperVer || bakedVersion > helperVer) {
    helperContent = helperContent.replace(/let ver = "[^"]+";/, `let ver = ${JSON.stringify(bakedVersion)};`);
  }

  return helperContent;
}

/**
 * Generate statusline hook for shell integration
 */
export function generateStatuslineHook(options: InitOptions): string {
  if (!options.statusline.enabled) {
    return '#!/bin/bash\n# Statusline disabled\n';
  }

  return `#!/bin/bash
# RuFlo V3 Statusline Hook
# Source this in your .bashrc/.zshrc for terminal statusline

# Function to get statusline
claude_flow_statusline() {
  local statusline_script="\${CLAUDE_FLOW_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# Bash: Add to PS1
# export PS1='$(claude_flow_statusline) \\n\\$ '

# Zsh: Add to RPROMPT
# export RPROMPT='$(claude_flow_statusline)'

# Claude Code: Add to .claude/settings.json
# "statusLine": {
#   "type": "command",
#   "command": "node .claude/helpers/statusline.cjs 2>/dev/null"
#   "when": "test -f .claude/helpers/statusline.cjs"
# }
`;
}
