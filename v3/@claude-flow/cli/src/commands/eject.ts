/**
 * V3 CLI Eject Command — ADR-150 Phase-2 differentiator.
 *
 * Lifts the calling ruflo/claude-flow project into a renamed standalone
 * harness using `metaharness --from-existing <dir>`. Attribution to
 * ruflo is preserved via the upstream's `<!-- ruflo-attribution-block -->`
 * convention.
 *
 *   npx ruflo eject --name my-harness                  # dry-run plan
 *   npx ruflo eject --name my-harness --confirm        # actually eject
 *   npx ruflo eject --name my-harness --target /abs/out --confirm
 *
 * SAFETY GATES (load-bearing)
 *   1. Dry-run by default. `--confirm` required for any disk write.
 *   2. `--target` MUST resolve OUTSIDE the calling repo root. Default
 *      is `/tmp/ruflo-eject-<ts>-<name>/`. Writing to the calling repo
 *      is refused with exit 2 — protects the user from `cwd: $ruflo`
 *      eject accidents.
 *   3. Refuses existing target dirs (no overwrites).
 *   4. Subprocess + 10-minute hard timeout. No library import; no
 *      static `@metaharness/*` dependency.
 *
 * ADR-150 ARCHITECTURAL CONSTRAINT
 *   When metaharness is unavailable (offline, no network), the command
 *   exits 0 with a structured "feature not available" message. Ruflo
 *   continues to function — rule #3 (graceful degradation).
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { tmpdir } from 'os';

interface EjectOptions {
  name: string | null;
  target: string | null;
  confirm: boolean;
  format: 'table' | 'json';
}

function parseArgs(args: string[]): EjectOptions {
  const o: EjectOptions = { name: null, target: null, confirm: false, format: 'table' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name') o.name = args[++i] || null;
    else if (a === '--target') o.target = args[++i] || null;
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--format') o.format = (args[++i] || 'table') as 'table' | 'json';
  }
  return o;
}

function runEject(targetDir: string, name: string): { exitCode: number; stderr: string; degraded?: boolean } {
  const r = spawnSync(
    'npx',
    ['-y', 'metaharness@latest', '--from-existing', process.cwd(), '--name', name, '--target', targetDir, '--yes'],
    {
      stdio: 'inherit',
      env: process.env,
      timeout: 10 * 60 * 1000,
      shell: process.platform === 'win32',
    }
  );
  const stderr = '';  // stdio: inherit — captured by terminal not by us
  if (r.status === null) {
    return { exitCode: 124, stderr: 'subprocess timed out after 10 minutes', degraded: false };
  }
  if (r.error && /ENOENT|spawn/.test(String(r.error.message || ''))) {
    return { exitCode: 127, stderr: 'metaharness binary unavailable', degraded: true };
  }
  return { exitCode: r.status, stderr };
}

export const ejectCommand: Command = {
  name: 'eject',
  description:
    'Lift the calling ruflo project into a renamed standalone harness via metaharness --from-existing (ADR-150 Phase 2). Dry-run by default; --confirm required to write.',
  options: [
    {
      name: 'name',
      description: 'Name for the ejected harness (required)',
      type: 'string' as const,
      required: false,
    },
    {
      name: 'target',
      description: 'Absolute output dir (default: /tmp/ruflo-eject-<ts>-<name>/); refused if inside the calling repo',
      type: 'string' as const,
    },
    {
      name: 'confirm',
      description: 'Actually write the eject. Without this flag the command prints a dry-run plan and exits.',
      type: 'boolean' as const,
      default: false,
    },
    {
      name: 'format',
      description: 'Output format: table | json',
      type: 'string' as const,
      default: 'table',
    },
  ],
  examples: [
    { command: 'npx ruflo eject --name my-harness', description: 'Dry-run; prints what would happen' },
    {
      command: 'npx ruflo eject --name my-harness --confirm',
      description: 'Eject to /tmp/ruflo-eject-<ts>-my-harness/',
    },
    {
      command: 'npx ruflo eject --name my-harness --target /abs/out --confirm',
      description: 'Eject to a specific dir (must be outside the calling repo)',
    },
  ],
  async action(context: CommandContext): Promise<CommandResult> {
    // iter 128 — flags declared on the Command get parsed by the CLI parser
    // and land in context.flags (NOT context.options or context.args).
    // Fall back to parseArgs(context.args) for programmatic invocations
    // where the parser wasn't used (e.g. unit tests).
    const ctx = context as { args?: string[]; flags?: Record<string, unknown> };
    const parsedArgs = parseArgs(ctx.args || []);
    const flagName = ctx.flags?.name as string | undefined;
    const flagTarget = ctx.flags?.target as string | undefined;
    const flagConfirm = ctx.flags?.confirm as boolean | undefined;
    const flagFormat = ctx.flags?.format as 'table' | 'json' | undefined;
    const opts: EjectOptions = {
      name: flagName || parsedArgs.name,
      target: flagTarget || parsedArgs.target,
      confirm: typeof flagConfirm === 'boolean' ? flagConfirm : parsedArgs.confirm,
      format: (flagFormat || parsedArgs.format) as 'table' | 'json',
    };

    if (!opts.name) {
      output.writeln(output.error('eject: --name is required'));
      output.writeln('');
      output.writeln('Example: npx ruflo eject --name my-harness');
      return { success: false, exitCode: 2, data: { error: 'name-required' } };
    }

    // Safety: resolve target, refuse calling-repo paths.
    const repoRoot = resolvePath(process.cwd());
    const target = opts.target
      ? resolvePath(opts.target)
      : resolvePath(tmpdir(), `ruflo-eject-${Date.now()}-${opts.name}`);
    if (target === repoRoot || target.startsWith(repoRoot + '/')) {
      output.writeln(output.error(`eject: refusing to write to ${target}`));
      output.writeln(output.error(`This is inside the calling repo (${repoRoot}). Pick a --target OUTSIDE the repo.`));
      return { success: false, exitCode: 2, data: { error: 'target-inside-repo', target, repoRoot } };
    }
    if (existsSync(target)) {
      output.writeln(output.error(`eject: target ${target} already exists — refusing to overwrite`));
      return { success: false, exitCode: 2, data: { error: 'target-exists', target } };
    }

    const plan = {
      name: opts.name,
      sourceRepo: repoRoot,
      target,
      confirm: opts.confirm,
      command: `npx -y metaharness@latest --from-existing ${repoRoot} --name ${opts.name} --target ${target} --yes`,
    };

    if (!opts.confirm) {
      if (opts.format === 'json') {
        output.writeln(JSON.stringify({ ...plan, dryRun: true }, null, 2));
      } else {
        output.writeln(output.bold('# ruflo eject (dry-run)'));
        output.writeln('');
        output.writeln(`name:       ${plan.name}`);
        output.writeln(`sourceRepo: ${plan.sourceRepo}`);
        output.writeln(`target:     ${plan.target}`);
        output.writeln('');
        output.writeln(output.dim('Would execute:'));
        output.writeln(output.dim(`  ${plan.command}`));
        output.writeln('');
        output.writeln('Re-run with --confirm to actually eject.');
      }
      return { success: true, exitCode: 0, data: { ...plan, dryRun: true } };
    }

    // Actually run.
    output.writeln(output.bold('# ruflo eject — running'));
    output.writeln('');
    output.writeln(`Ejecting ${repoRoot} → ${target} as "${opts.name}"...`);
    output.writeln('');
    const r = runEject(target, opts.name);
    if (r.degraded) {
      output.writeln(output.warning('eject: metaharness binary unavailable — feature degraded'));
      output.writeln(output.dim('(ADR-150 graceful degradation: ruflo runs without it; install with `npm i -D metaharness`.)'));
      return { success: true, exitCode: 0, data: { ...plan, degraded: true, reason: 'metaharness-not-available' } };
    }
    if (r.exitCode !== 0) {
      output.writeln(output.error(`eject: metaharness exited ${r.exitCode}`));
      if (r.stderr) output.writeln(output.dim(r.stderr.slice(0, 400)));
      return { success: false, exitCode: r.exitCode, data: { ...plan, exitCode: r.exitCode } };
    }
    output.writeln('');
    output.writeln(output.bold(`✓ Ejected to ${target}`));
    output.writeln('');
    output.writeln(output.dim('Next steps:'));
    output.writeln(output.dim(`  cd ${target}`));
    output.writeln(output.dim('  npm install'));
    output.writeln(output.dim('  npx harness doctor'));
    return { success: true, exitCode: 0, data: { ...plan, ejected: true } };
  },
};

export default ejectCommand;
