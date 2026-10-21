/**
 * ADR-406 P0 — engine capability report.
 *
 * Every probe runs a fixed argv through an injected runner (never a shell),
 * with `CLAUDE_CONFIG_DIR` pointed at an isolated directory so the probe
 * never reads or writes the person's real `~/.claude`. Anything that could
 * not be observed is reported as `unknown` with the reason, never assumed.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCommandHook } from './inventory.js';

export type Runner = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => { status: number | null; stdout: string; stderr: string };

export interface PluginValidation {
  readonly plugin: string;
  readonly passed: boolean | 'unknown';
  readonly commandHooks: readonly string[];
  readonly hostCalls: readonly string[];
  /** A `command.run{command=?}` matcher: names chosen at run time, which only the source scan can list. */
  readonly dynamicCommandHook?: true;
  readonly reason?: string;
}

export interface EngineReport {
  readonly schemaVersion: 1;
  readonly engine: { readonly executable: string | null; readonly version: string | null; readonly binarySha256: string | null };
  readonly typeGeneration: 'none-in-engine-cli' | 'unknown';
  readonly vendoredTypes: readonly { readonly path: string; readonly sha256: string }[];
  readonly validations: readonly PluginValidation[];
  readonly affordances: { readonly promptFill: boolean | 'unknown'; readonly processRun: boolean | 'unknown' };
  readonly collisions: readonly { readonly name: string; readonly builtin: boolean | 'unknown'; readonly repoCommand: boolean; readonly verdict: 'free' | 'taken' | 'unknown' }[];
  readonly limits: readonly string[];
}

/** Parse `claude plugin validate` text: hooks and `$.` calls the static scanner found. */
export function parseValidateOutput(plugin: string, status: number | null, text: string): PluginValidation {
  // Per-file lines read `<file> hooks: ...` and `<file> calls: ...`; a mod can
  // span several files, so collect across every such line, not the first.
  const lines = text.split('\n');
  const hooksText = lines.filter((l) => /\.(?:ts|js) hooks:\s/.test(l)).join('\n');
  const callsText = lines.filter((l) => /\.(?:ts|js) calls:\s/.test(l)).join('\n');
  // `command=a|b` is one matcher on two names; `command=?` is computed at run time, so it names nothing.
  const commandHooks = [...new Set([...hooksText.matchAll(/command\.run\{command=([^}]+)\}/g)]
    .flatMap((m) => m[1].split('|'))
    .filter((name) => name !== '?'))].sort();
  const dynamicCommandHook = /command\.run\{command=\?\}/.test(hooksText);
  const hostCalls = [...new Set([...callsText.matchAll(/\$\.([a-zA-Z]+\.[a-zA-Z]+)/g)].map((m) => m[1]))].sort();
  const passed = /Validation passed/.test(text) && status === 0;
  return { plugin, passed, commandHooks, hostCalls, ...(dynamicCommandHook ? { dynamicCommandHook: true as const } : {}), ...(passed ? {} : { reason: text.trim().split('\n').slice(-3).join(' | ').slice(0, 300) }) };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function vendoredTypes(repoRoot: string): { path: string; sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  const pluginsRoot = join(repoRoot, 'plugins');
  if (!existsSync(pluginsRoot)) return out;
  for (const plugin of readdirSync(pluginsRoot).sort()) {
    const dir = join(pluginsRoot, plugin, 'types');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith('.d.ts')) out.push({ path: `plugins/${plugin}/types/${name}`, sha256: sha256File(join(dir, name)) });
    }
  }
  return out;
}

/** Plugins that are function-hook mods (have `hooks/register.ts`). */
export function modPlugins(repoRoot: string): string[] {
  const root = join(repoRoot, 'plugins');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((p) => existsSync(join(root, p, 'hooks', 'register.ts'))).sort();
}

export interface EngineProbeInput {
  readonly repoRoot: string;
  readonly executable: string | null;
  readonly isolatedConfigDir: string;
  readonly run: Runner;
  /** Names to check for collisions, e.g. `ruflo`, `ruflo-workbench`. */
  readonly proposedNames: readonly string[];
  /** Every name the repository already exposes (legacy + mod names). */
  readonly existingNames: ReadonlySet<string>;
}

/**
 * A builtin slash command is compiled into the engine binary as `name:"<cmd>"`
 * (checked: `compact` and `clear` match, unrelated words do not). Absence of
 * the literal is evidence a name is not a builtin, not proof.
 */
function builtinPresence(binary: Buffer | null, name: string): boolean | 'unknown' {
  if (!binary) return 'unknown';
  return binary.includes(Buffer.from(`name:"${name}"`));
}

export function probeEngine(input: EngineProbeInput): EngineReport {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: input.isolatedConfigDir };
  const limits: string[] = [];
  let version: string | null = null;
  let binary: Buffer | null = null;
  let resolved: string | null = null;
  if (input.executable && existsSync(input.executable)) {
    resolved = realpathSync(input.executable);
    const v = input.run(input.executable, ['--version'], env);
    version = v.status === 0 ? v.stdout.trim().split('\n')[0] : null;
    try { binary = readFileSync(resolved); } catch { limits.push('engine binary unreadable; builtin collision check unknown'); }
  } else {
    limits.push('engine executable not found; validation and collision checks are unknown');
  }
  const validations: PluginValidation[] = modPlugins(input.repoRoot).map((plugin) => {
    if (!input.executable || version === null) return { plugin, passed: 'unknown', commandHooks: [], hostCalls: [], reason: 'engine unavailable' };
    const r = input.run(input.executable, ['plugin', 'validate', join(input.repoRoot, 'plugins', plugin)], env);
    return parseValidateOutput(plugin, r.status, `${r.stdout}\n${r.stderr}`);
  });
  // Seen in a validated plugin = the scanner accepts it; not seen = unknown,
  // because no plugin here may have tried it.
  const has = (call: string): boolean | 'unknown' =>
    validations.some((v) => v.passed === true && v.hostCalls.includes(call)) ? true : 'unknown';
  limits.push('a static validate scan proves an affordance is accepted by the scanner, not that it behaves as expected at runtime');
  limits.push('builtin detection searches the engine binary for name:"<cmd>"; absence is evidence, not proof');
  return {
    schemaVersion: 1,
    engine: { executable: resolved, version, binarySha256: binary ? createHash('sha256').update(binary).digest('hex') : null },
    typeGeneration: version ? 'none-in-engine-cli' : 'unknown',
    vendoredTypes: vendoredTypes(input.repoRoot),
    validations,
    affordances: { promptFill: has('prompt.fill'), processRun: has('process.run') },
    collisions: input.proposedNames.map((name) => {
      const builtin = builtinPresence(binary, name);
      const repoCommand = input.existingNames.has(name);
      const verdict = builtin === 'unknown' ? 'unknown' : builtin || repoCommand ? 'taken' : 'free';
      return { name, builtin, repoCommand, verdict };
    }),
    limits,
  };
}

/** Engine-observed command hooks, in the inventory's `ModCommandHook` shape. */
export function hooksFromValidations(validations: readonly PluginValidation[]): ModCommandHook[] {
  return validations.flatMap((v) => v.commandHooks.map((command) => ({
    plugin: v.plugin,
    command,
    sourcePath: `plugins/${v.plugin}/hooks/register.ts`,
  })));
}
