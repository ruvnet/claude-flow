/**
 * V3 CLI MetaHarness Command — ADR-150 deep integration entry point.
 *
 * Top-level dispatcher that delegates each subcommand to the matching
 * `plugins/ruflo-metaharness/scripts/<name>.mjs` via spawnSync. This is
 * the user-facing wrapper around the upstream `metaharness` / `harness`
 * CLIs.
 *
 * SUBCOMMANDS
 *   score         — 5-dim readiness scorecard
 *   genome        — 7-section categorical report
 *   mcp-scan      — static MCP security findings
 *   threat-model  — enterprise-grade threat model
 *   mint          — scaffold custom harness (DRY-RUN by default)
 *
 * Each subcommand is a thin subprocess invocation — the plugin scripts
 * own the actual logic. This command exists so users can run:
 *
 *   npx ruflo metaharness score
 *   npx ruflo metaharness mcp-scan --fail-on high
 *   npx ruflo metaharness mint --name foo --template vertical:coding
 *
 * instead of:
 *
 *   node plugins/ruflo-metaharness/scripts/score.mjs
 *
 * ADR-150 ARCHITECTURAL CONSTRAINT
 * --------------------------------
 * This command file MUST NOT statically import any `@metaharness/*`
 * package. The plugin scripts handle all metaharness invocation;
 * here we only spawn the local Node script (which then handles
 * `npx metaharness` + graceful degradation).
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Subcommand → plugin script filename
const SUBCOMMANDS: Record<string, string> = {
  score: 'score.mjs',
  genome: 'genome.mjs',
  'mcp-scan': 'mcp-scan.mjs',
  'threat-model': 'threat-model.mjs',
  // iter 7 — composite Phase-2 weekly audit worker
  'oia-audit': 'oia-audit.mjs',
  // iter 15 — diff two oia-audit records (drift detection)
  'audit-trend': 'audit-trend.mjs',
  // iter 16 — enumerate metaharness-audit records
  'audit-list': 'audit-list.mjs',
  // iter 36 — ADR-152 §3.1 weighted similarity between two harness fingerprints
  similarity: 'similarity.mjs',
  // iter 53 — one-command drift detection (compose audit-list + oia-audit + audit-trend)
  'drift-from-history': 'drift-from-history.mjs',
  mint: 'mint.mjs',
  // @metaharness/redblue@~0.1.4 — adversarial red/blue LLM testing
  // (init|run|patch|attack|report sub-subcommands handled by redblue.mjs)
  redblue: 'redblue.mjs',
  // metaharness@0.3.0 — upstream ADR-235 GEPA learning run ($0 dry-run
  // default; --run to spend; needs a metaharness repo checkout)
  learn: 'learn.mjs',
  // @metaharness/darwin@0.8.0 — GEPA library surface (genome ops; the
  // gepaOptimize loop itself stays library-only / behind evolve)
  gepa: 'gepa.mjs',
};

/**
 * Walk up from the current dirname to find the ruflo repo root that
 * contains plugins/ruflo-metaharness/. Handles three install layouts:
 *   1. ruflo dev tree   (cwd / ../plugins/...)
 *   2. ruflo wrapper    (ruflo/node_modules/@claude-flow/cli/...)
 *   3. npx              (npm-cache/__npx/... — fall back to cwd-scan)
 *
 * `requiredScript`, if provided, narrows the match: the returned dir must
 * contain BOTH `_harness.mjs` (proves it's a plugin-scripts dir) AND the
 * named script. This guards against the publish-artifact mirror at
 * `v3/@claude-flow/cli/plugins/ruflo-metaharness/scripts/` getting picked
 * over the source `plugins/ruflo-metaharness/scripts/` when the mirror
 * lags the source (the mirror is regenerated only at publish time by
 * `prepublishOnly`).
 */
function locatePluginScripts(requiredScript?: string): string | null {
  const candidates: string[] = [];
  // Up from the cli dist dir
  let p = resolve(__dirname);
  for (let i = 0; i < 8; i++) {
    candidates.push(join(p, 'plugins', 'ruflo-metaharness', 'scripts'));
    candidates.push(join(p, '..', 'plugins', 'ruflo-metaharness', 'scripts'));
    p = dirname(p);
  }
  // Also try from cwd (covers the "npx ruflo" case where the user is
  // sitting in their own repo and `npx ruflo metaharness score` should
  // score THAT repo using the LOCAL plugin if present).
  const cwd = process.cwd();
  candidates.push(join(cwd, 'plugins', 'ruflo-metaharness', 'scripts'));
  candidates.push(join(cwd, 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness', 'scripts'));

  for (const c of candidates) {
    if (!existsSync(join(c, '_harness.mjs'))) continue;
    if (requiredScript && !existsSync(join(c, requiredScript))) continue;
    return c;
  }
  return null;
}

function dispatchPluginScript(scriptDir: string, scriptName: string, extraArgs: string[]): CommandResult {
  const scriptPath = join(scriptDir, scriptName);
  const r = spawnSync('node', [scriptPath, ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
    timeout: 5 * 60 * 1000,
  });
  return {
    success: (r.status ?? 0) === 0,
    exitCode: r.status ?? 1,
    data: { scriptPath, args: extraArgs },
  };
}

export const metaharnessCommand: Command = {
  name: 'metaharness',
  description:
    'MetaHarness integration (ADR-150) — score / genome / mcp-scan / threat-model / mint. Subprocess-invoked plugin skills with graceful degradation.',
  options: [
    {
      name: 'subcommand',
      // iter 73 — list reflects all dispatchable subcommands (was
      // stale at the iter-3 list of 5). Keep this synced with the
      // SUBCOMMANDS map above.
      description: 'One of: score | genome | mcp-scan | threat-model | oia-audit | audit-list | audit-trend | similarity | drift-from-history | mint | redblue | learn | gepa',
      type: 'string' as const,
    },
  ],
  async action(context: CommandContext): Promise<CommandResult> {
    const args = (context as { args?: string[] }).args || [];
    const subcommand = args[0];
    const positionalRest = args.slice(1);

    // iter 42 — round-trip parsed flags back into argv so the
    // subprocess receives them. Without this the CLI parser consumes
    // `--a foo` into `flags.a` and the script sees an empty argv,
    // emitting a graceful-but-wrong "missing arg" payload (the iter-36
    // bug surfaced during iter-42 dispatcher round-trip testing).
    const ctxFlags = (context as { flags?: Record<string, unknown> }).flags || {};
    const reconstructedFlags: string[] = [];
    const SKIP_KEYS = new Set([
      '_',           // parser's positional bucket
      'config',      // global CLI flag (--config <path>); consumed before dispatch
      'verbose', 'v',
      'quiet', 'q',
      'help', 'h',
    ]);
    // Parser normalizes kebab-case → camelCase (--per-dimension → perDimension).
    // Plugin scripts expect kebab-case at argv, so we re-kebab here.
    const toKebab = (s: string): string =>
      s.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
    for (const [key, value] of Object.entries(ctxFlags)) {
      if (SKIP_KEYS.has(key)) continue;
      if (value === undefined || value === null) continue;
      // Always use --kebab even for single-char keys: similarity.mjs
      // matches literal `--a` / `--b` via argv loop, not via a parser.
      // Reconstructing as short-form (`-a`) would silently misroute.
      const flag = `--${toKebab(key)}`;
      if (typeof value === 'boolean') {
        if (value === true) reconstructedFlags.push(flag);
        // false → omit (--no-X handled by users invoking explicit --no- form)
      } else if (Array.isArray(value)) {
        for (const v of value) reconstructedFlags.push(flag, String(v));
      } else {
        reconstructedFlags.push(flag, String(value));
      }
    }
    const subArgs = [...positionalRest, ...reconstructedFlags];

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
      output.writeln(output.bold('npx ruflo metaharness <subcommand> [options]'));
      output.writeln('');
      output.writeln('Subcommands:');
      output.writeln('  score         5-dimension harness readiness scorecard');
      output.writeln('  genome        7-section categorical readiness report');
      output.writeln('  mcp-scan      static security scan of declared MCP surface');
      output.writeln('  threat-model  enterprise-grade threat model');
      output.writeln('  oia-audit     composite weekly audit (oia + threat + mcp) → memory');
      output.writeln('  audit-list    enumerate timestamped audit records');
      output.writeln('  audit-trend   diff two audit records (drift detection)');
      output.writeln('  similarity    ADR-152 — weighted similarity between two harness fingerprints');
      output.writeln('  drift-from-history  iter 53 — diff current state against most recent audit (1-command drift)');
      output.writeln('  mint          scaffold a custom harness (dry-run by default)');
      output.writeln('  redblue       adversarial red/blue LLM testing (init|run|patch|attack|report)');
      output.writeln('');
      output.writeln('Each subcommand accepts --format json|table and --help.');
      output.writeln('');
      output.writeln(output.dim('ADR-150 — runs as subprocess; graceful degradation if metaharness is not installed.'));
      return { success: true, exitCode: 0, data: { subcommand: null } };
    }

    if (!SUBCOMMANDS[subcommand]) {
      output.writeln(output.error(`Unknown subcommand: ${subcommand}`));
      output.writeln(`Valid: ${Object.keys(SUBCOMMANDS).join(', ')}`);
      return { success: false, exitCode: 2, data: { subcommand } };
    }

    const scriptDir = locatePluginScripts(SUBCOMMANDS[subcommand]);
    if (!scriptDir) {
      output.writeln(
        output.warning(
          'metaharness: plugins/ruflo-metaharness/scripts/ not found. Install ruflo with `npm i ruflo` or run from the ruflo repo.'
        )
      );
      output.writeln(
        output.dim('(ADR-150 graceful degradation: this command is a thin delegator over the plugin; the plugin must be present.)')
      );
      // Exit 0 — this is "feature not available", not a runtime failure.
      return { success: true, exitCode: 0, data: { degraded: true, reason: 'plugin-not-found' } };
    }

    return dispatchPluginScript(scriptDir, SUBCOMMANDS[subcommand], subArgs);
  },
};

export default metaharnessCommand;
