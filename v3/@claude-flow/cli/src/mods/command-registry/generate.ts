/**
 * ADR-406 P0/P1 — gather inputs (git history, packed npm contents, engine
 * probes) and produce the inventory report, engine report and catalog.
 *
 * Reads command sources; writes only the catalog and report files it is given.
 * External programs run through fixed argv with no shell (`execFileSync`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog, type CatalogOptions } from './catalog.js';
import { probeEngine, hooksFromValidations, type EngineReport, type Runner } from './engine-report.js';
import {
  CLI_TEMPLATE_COMMANDS_DIR,
  PROJECT_COMMANDS_DIR,
  collectInventory,
  scanModHooksFromSource,
  type ModCommandHook,
  type RawCommand,
} from './inventory.js';
import type { CommandCatalog } from './schema.js';

export const CATALOG_RELATIVE_PATH = 'v3/@claude-flow/cli/src/mods/command-registry/catalog.generated.json';
export const ENGINE_REPORT_RELATIVE_PATH = 'v3/@claude-flow/cli/src/mods/command-registry/engine-report.generated.json';
export const PROPOSED_NAMES = ['ruflo', 'ruflo-workbench', 'ruflo-console'] as const;

export const defaultRunner: Runner = (file, args, env) => {
  try {
    const stdout = execFileSync(file, [...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? null, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

/**
 * Last commit per repository-relative path, in one `git log` pass; dirty paths
 * are dropped (they read as `uncommitted`). `order` lists commits newest first.
 */
export function lastCommits(repoRoot: string, roots: readonly string[], run: Runner = defaultRunner): { byPath: Record<string, string>; order: string[]; dirty: Set<string> } {
  const log = run('git', ['-C', repoRoot, 'log', '--format=%x00%H', '--name-only', '--', ...roots], process.env);
  const byPath: Record<string, string> = {};
  const order: string[] = [];
  let current = '';
  for (const line of log.stdout.split('\n')) {
    if (line.startsWith('\u0000')) { current = line.slice(1).trim(); order.push(current); continue; }
    const path = line.trim();
    if (path && current && !(path in byPath)) byPath[path] = current;
  }
  const status = run('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=all', '--', ...roots], process.env);
  const dirty = new Set<string>();
  for (const line of status.stdout.split('\n')) {
    const path = line.slice(3).trim();
    if (path) { delete byPath[path]; dirty.add(path); }
  }
  return { byPath, order, dirty };
}

/**
 * The catalog's anchor: the newest commit that touched a file the catalog
 * actually inventories, so unrelated plugin commits do not make it stale.
 */
export function anchorCommit(paths: readonly string[], commits: ReturnType<typeof lastCommits>): string {
  if (paths.some((p) => commits.dirty.has(p) || !commits.byPath[p])) return 'uncommitted';
  const used = new Set(paths.map((p) => commits.byPath[p]));
  return commits.order.find((c) => used.has(c)) ?? 'uncommitted';
}

/** `npm pack --dry-run --json` file list for a package directory, made repository-relative. */
export function packedFiles(repoRoot: string, packageDir: string, run: Runner = defaultRunner): { name: string; files: string[] } | null {
  // The runner has no cwd; `npm pack <folder>` packs that folder's package.
  const out = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', join(repoRoot, packageDir)], process.env);
  if (out.status !== 0) return null;
  try {
    const parsed = JSON.parse(out.stdout.slice(out.stdout.indexOf('['))) as { name: string; files: { path: string }[] }[];
    const prefix = packageDir === '.' ? '' : `${packageDir.replace(/\/$/, '')}/`;
    return { name: parsed[0].name, files: parsed[0].files.map((f) => `${prefix}${f.path}`) };
  } catch {
    return null;
  }
}

export interface GenerateInput {
  readonly repoRoot: string;
  readonly engineExecutable: string | null;
  readonly run?: Runner;
  /** Skip `npm pack` (tests); shipped status is then not asserted. */
  readonly inspectPackages?: boolean;
}

export interface GenerateResult {
  readonly inventory: readonly RawCommand[];
  readonly catalog: CommandCatalog;
  readonly engine: EngineReport;
  readonly modHookSource: 'engine-validate' | 'source-scan';
  readonly packages: readonly string[];
}

export function generate(input: GenerateInput): GenerateResult {
  const run = input.run ?? defaultRunner;
  const configDir = mkdtempSync(join(tmpdir(), 'ruflo-engine-probe-'));
  try {
    const roots = [PROJECT_COMMANDS_DIR, CLI_TEMPLATE_COMMANDS_DIR, 'plugins'].filter((r) => existsSync(join(input.repoRoot, r)));
    const packed: Record<string, string[]> = {};
    if (input.inspectPackages !== false) {
      for (const dir of ['v3/@claude-flow/cli', '.', 'ruflo']) {
        if (!existsSync(join(input.repoRoot, dir, 'package.json'))) continue;
        const p = packedFiles(input.repoRoot, dir, run);
        if (p) packed[p.name] = p.files;
      }
    }
    // First pass without hooks to know every existing name for collisions.
    const sourceHooks = scanModHooksFromSource(input.repoRoot);
    const preliminary = collectInventory({ repoRoot: input.repoRoot, modHooks: sourceHooks });
    const engine = probeEngine({
      repoRoot: input.repoRoot,
      executable: input.engineExecutable,
      isolatedConfigDir: configDir,
      run,
      proposedNames: PROPOSED_NAMES,
      existingNames: new Set(preliminary.map((r) => r.key)),
    });
    // The engine confirms which command hooks exist; the source scan knows which
    // file declares each. Prefer the declaring file so the catalog is the same
    // whether or not an engine was available to confirm it.
    const engineHooks: ModCommandHook[] = hooksFromValidations(engine.validations)
      .map((h) => sourceHooks.find((s) => s.plugin === h.plugin && s.command === h.command) ?? h);
    // A plugin whose matcher the engine reports as `?` names its commands only in source: keep those.
    const dynamicPlugins = new Set(engine.validations.filter((v) => v.dynamicCommandHook).map((v) => v.plugin));
    for (const s of sourceHooks) {
      if (dynamicPlugins.has(s.plugin) && !engineHooks.some((h) => h.plugin === s.plugin && h.command === s.command)) engineHooks.push(s);
    }
    const useEngine = engine.validations.length > 0 && engine.validations.every((v) => v.passed === true);
    const inventory = collectInventory({
      repoRoot: input.repoRoot,
      packedFiles: Object.keys(packed).length ? packed : undefined,
      modHooks: useEngine ? engineHooks : sourceHooks,
    });
    const commits = lastCommits(input.repoRoot, roots, run);
    const options: CatalogOptions = {
      commits: commits.byPath,
      packageContentsInspected: Object.keys(packed).length > 0,
      sourceCommit: anchorCommit([...new Set(inventory.map((r) => r.source.sourcePath))], commits),
    };
    return {
      inventory,
      catalog: buildCatalog(inventory, options),
      engine,
      modHookSource: useEngine ? 'engine-validate' : 'source-scan',
      packages: Object.keys(packed).sort(),
    };
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

/** Counts for the P0 exit gate: every inventoried command is classified. */
export function summarize(result: GenerateResult): Record<string, number | string> {
  const byStatus: Record<string, number> = {};
  const byDisposition: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const e of result.catalog.entries) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    byDisposition[e.definition.disposition] = (byDisposition[e.definition.disposition] ?? 0) + 1;
    for (const s of e.sources) byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;
  }
  return {
    occurrences: result.inventory.length,
    entries: result.catalog.entries.length,
    divergent: result.catalog.entries.filter((e) => e.divergent).length,
    modHookSource: result.modHookSource,
    packages: result.packages.join(',') || 'none',
    ...Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [`status.${k}`, v])),
    ...Object.fromEntries(Object.entries(byDisposition).map(([k, v]) => [`disposition.${k}`, v])),
    ...Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [`channel.${k}`, v])),
  };
}
