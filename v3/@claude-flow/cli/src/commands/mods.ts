/**
 * `ruflo mods` — opt into running ruflo as a Claude Code mod (ADR-404,
 * Claude Code function hooks, early access).
 *
 * install/uninstall edit settings files and record what they added;
 * status/doctor report what can be known from outside a session; sync-policy
 * rewrites the policy projection the mod's tool check reads. Classic hooks
 * are never removed: they stay the default and the fallback.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { directoryMarketplace, MARKETPLACE_NAME, type MarketplaceEntry, type Scope } from '../mods/install.js';
import { probeMods, type Finding } from '../mods/probe.js';
import { applyMods, removeMods } from '../mods/apply.js';

/**
 * `--source local` / `--marketplace-path <dir>`: a ruflo checkout as a
 * directory marketplace (dogfooding). It must be a ruflo marketplace.
 */
function localMarketplace(dir: string): MarketplaceEntry | string {
  const catalog = join(resolve(dir), '.claude-plugin', 'marketplace.json');
  if (!existsSync(catalog)) return `${dir} has no .claude-plugin/marketplace.json`;
  try {
    if ((JSON.parse(readFileSync(catalog, 'utf8')) as { name?: unknown }).name !== MARKETPLACE_NAME) return `${catalog} is not the ${MARKETPLACE_NAME} marketplace`;
  } catch {
    return `${catalog} is not JSON`;
  }
  return directoryMarketplace(dir);
}

function projectRoot(ctx: CommandContext): string {
  return (ctx.flags.projectRoot as string | undefined) ?? (ctx.flags['project-root'] as string | undefined) ?? ctx.cwd ?? process.cwd();
}

function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    const mark = f.status === 'pass' ? output.success('✓') : f.status === 'warn' ? output.warning('!') : output.error('✗');
    output.writeln(`${mark} ${f.name}: ${f.message}`);
    if (f.fix && f.status !== 'pass') output.writeln(output.dim(`    fix: ${f.fix}`));
  }
}

const rootOption = { name: 'project-root', description: 'Project root (default: current directory)', type: 'string' as const };

const installSub: Command = {
  name: 'install',
  description: 'Enable the ruflo mod plugins (ruflo-mods, ruflo-swarm, ruflo-console) for this project; classic hooks stay as fallback',
  options: [
    rootOption,
    { name: 'scope', description: 'local (.claude/settings.local.json, default) | project (.claude/settings.json)', type: 'string', default: 'local' },
    { name: 'dry-run', description: 'Show the settings that would be written and the claude commands that would run', type: 'boolean', default: false },
    { name: 'plugin-install', description: 'Refresh the ruflo marketplace and run `claude plugin install` (--no-plugin-install to only write settings)', type: 'boolean', default: true },
    { name: 'strict', description: 'Exit 1 when a required plugin could not be made loadable', type: 'boolean', default: false },
    { name: 'source', description: 'github (ruvnet/ruflo, default) | local (a ruflo checkout as a directory marketplace: plugins load live from it)', type: 'string', default: 'github' },
    { name: 'marketplace-path', description: 'With --source local: the ruflo checkout (default: the project root)', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const scope = (ctx.flags.scope as string | undefined) ?? 'local';
    if (scope !== 'local' && scope !== 'project') {
      output.printError(`--scope must be local or project, got ${scope}`);
      return { success: false, exitCode: 1 };
    }
    const source = (ctx.flags.source as string | undefined) ?? 'github';
    const path = (ctx.flags.marketplacePath ?? ctx.flags['marketplace-path']) as string | undefined;
    if (source !== 'github' && source !== 'local') {
      output.printError(`--source must be github or local, got ${source}`);
      return { success: false, exitCode: 1 };
    }
    let marketplace: MarketplaceEntry | undefined;
    if (source === 'local' || path) {
      const local = localMarketplace(path ?? projectRoot(ctx));
      if (typeof local === 'string') {
        output.printError(`--source local: ${local}`);
        return { success: false, exitCode: 1 };
      }
      marketplace = local;
    }
    const result = await applyMods(projectRoot(ctx), {
      scope: scope as Scope,
      marketplace,
      dryRun: ctx.flags.dryRun === true || ctx.flags['dry-run'] === true,
      pluginInstall: ctx.flags.pluginInstall !== false && ctx.flags['plugin-install'] !== false,
    });
    if (result.install.dryRun) return { success: true, data: result };
    if (result.resolvable) output.writeln('Restart Claude Code, then run /ruflo in a session to open the console (/ruflo mods shows what the mod owns). Check with: ruflo mods doctor');
    const data = { ...result.install, resolvable: result.resolvable };
    return result.resolvable || ctx.flags.strict !== true ? { success: true, data } : { success: false, exitCode: 1, data };
  },
};

const uninstallSub: Command = {
  name: 'uninstall',
  description: 'Remove what `ruflo mods install` added, and claude plugin uninstall what it installed (classic hooks take every event back)',
  options: [rootOption, { name: 'dry-run', description: 'Show what would be removed', type: 'boolean', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const result = await removeMods(projectRoot(ctx), { dryRun: ctx.flags.dryRun === true || ctx.flags['dry-run'] === true });
    if (!result.removed) {
      output.printWarning('No install record (.claude-flow/mods/install.json): nothing ruflo added to remove.');
      return { success: true, data: result };
    }
    output.printSuccess(`${result.dryRun ? 'Would remove' : 'Removed'} what ruflo mods added from ${result.settingsFiles.join(', ')}`);
    if (result.uninstalled.length) output.writeln(`claude plugin uninstall: ${result.uninstalled.join(', ')}`);
    return { success: result.failed.length === 0, exitCode: result.failed.length ? 1 : 0, data: result };
  },
};

/** The doctor's exit gate: a failure always fails; with --strict a warning does too. */
export function hasFailureOrStrictWarning(findings: readonly Finding[], strict: boolean): boolean {
  return findings.some((f) => f.status === 'fail' || (strict && f.status === 'warn'));
}

function findingsCommand(name: 'status' | 'doctor', description: string): Command {
  return {
    name,
    description,
    options: [
      rootOption,
      { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
      ...(name === 'doctor' ? [{ name: 'strict', description: 'Exit 1 on a warning too (a mod that is not fully loaded is a failure for a CI gate)', type: 'boolean' as const, default: false }] : []),
    ],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const findings = probeMods({ projectRoot: projectRoot(ctx) });
      if (ctx.flags.json) output.printJson(findings);
      else printFindings(findings);
      const strict = name === 'doctor' && ctx.flags.strict === true;
      const failed = hasFailureOrStrictWarning(findings, strict);
      if (failed && !ctx.flags.json) {
        const first = findings.find((f) => f.status === 'fail') ?? findings.find((f) => f.status === 'warn');
        output.writeln(output.error(`doctor: ${findings.filter((f) => f.status === 'fail').length} failure(s), ${findings.filter((f) => f.status === 'warn').length} warning(s)${first?.fix ? `; start with: ${first.fix}` : ''}`));
      }
      // status reports (exit 0); doctor gates on a failure, and with --strict on a warning.
      return name === 'doctor' && failed ? { success: false, exitCode: 1, data: findings } : { success: true, data: findings };
    },
  };
}

async function syncPolicy(root: string, quiet: boolean): Promise<boolean> {
  try {
    const { loadPolicyState } = await import('../services/policy-runtime.js');
    const { syncPolicyProjection } = await import('../mods/policy-projection.js');
    const result = syncPolicyProjection(root, loadPolicyState(root));
    if (!quiet || result.action !== 'unchanged') output.writeln(`policy projection: ${result.action} (${result.path})`);
    return true;
  } catch (error) {
    output.printWarning(`policy projection not synced: ${(error as Error).message}`);
    return false;
  }
}

const syncPolicySub: Command = {
  name: 'sync-policy',
  description: 'Rewrite the Claude Code policy projection from .claude-flow/policy/state.json',
  options: [rootOption],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const ok = await syncPolicy(projectRoot(ctx), false);
    return { success: ok, exitCode: ok ? 0 : 1 };
  },
};

const statusSub = findingsCommand('status', 'Show whether the mod is enabled, can load, and what it owns');

export const modsCommand: Command = {
  name: 'mods',
  description: 'Run ruflo as a Claude Code mod (function hooks, early access, ADR-404)',
  subcommands: [
    installSub,
    uninstallSub,
    statusSub,
    findingsCommand('doctor', 'Check the mod path; exits 1 on a failure (--strict: on a warning too)'),
    syncPolicySub,
  ],
  examples: [
    { command: 'ruflo mods install', description: 'Enable the mod plugins for this checkout (settings.local.json) and install them with claude' },
    { command: 'ruflo mods install --scope project', description: 'Same, in the committed settings.json (what ruflo init does)' },
    { command: 'ruflo mods install --no-plugin-install', description: 'Only write settings; run no claude command' },
    { command: 'ruflo mods install --source local', description: 'Dogfood: load the mods live from this ruflo checkout (directory marketplace)' },
    { command: 'ruflo mods doctor', description: 'Marketplace fresh? Plugins loadable? Function hooks on? Refused by policy? Each problem prints a one-line fix' },
    { command: 'ruflo mods doctor --strict', description: 'Same, and exit 1 when anything is not fully working (for CI)' },
    { command: 'ruflo mods uninstall', description: 'Remove only what install added' },
  ],
  action: statusSub.action,
};

export default modsCommand;
