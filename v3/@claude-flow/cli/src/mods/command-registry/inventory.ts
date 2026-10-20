/**
 * ADR-406 P0 — command inventory.
 *
 * Scans every place a Ruflo slash command can come from and records, per
 * occurrence, its source path, delivery channel, package, digest, the
 * invocation spelling the engine exposes, and its runtime binding. It reads
 * only; nothing here writes a command file.
 *
 * Spelling rules recorded here were checked against Claude Code 2.1.287 in a
 * live session (see the engine report): project commands in a subfolder are
 * `<dir>:<name>` (`sparc:architect`, `agents:README`), plugin commands are
 * `<plugin>:<name>` (`ruflo-swarm:swarm`), and a mod's `$.command.register`
 * name is used verbatim (`ruflo-swarm-status`).
 *
 * The loader exposes every `.md` file in a commands folder, including READMEs
 * and compliance reports (`agents:README`, `analysis:COMMAND_COMPLIANCE_REPORT`
 * appear in the session command list). Those are inventoried as documentation,
 * not hidden and not counted as executable workflows.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DeliveryChannel, InventorySource } from './schema.js';

/** Mirror of `COMMANDS_MAP` in `src/init/executor.ts`; a parity test keeps them equal. */
export const INIT_COMMAND_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  core: ['claude-flow-help.md', 'claude-flow-swarm.md', 'claude-flow-memory.md'],
  analysis: ['analysis'],
  automation: ['automation'],
  github: ['github'],
  hooks: ['hooks'],
  monitoring: ['monitoring'],
  optimization: ['optimization'],
  sparc: ['sparc'],
  agents: ['agents'],
  coordination: ['coordination'],
  hiveMind: ['hive-mind'],
  memory: ['memory'],
  swarm: ['swarm'],
  workflows: ['workflows'],
  pair: ['pair'],
  training: ['training'],
  streamChain: ['stream-chain'],
  truth: ['truth'],
  verify: ['verify'],
});

export const PROJECT_COMMANDS_DIR = '.claude/commands';
export const CLI_TEMPLATE_COMMANDS_DIR = 'v3/@claude-flow/cli/.claude/commands';
export const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

/** One occurrence of a command in one delivery channel. */
export interface RawCommand {
  readonly key: string; // invocation spelling; occurrences sharing it merge into one entry
  readonly ownerPlugin: string;
  readonly content?: string; // Markdown body, for prompt classification
  readonly source: InventorySource;
}

/** A mod `command.run` hook as the engine's static scan reports it. */
export interface ModCommandHook {
  readonly plugin: string;
  readonly command: string;
  readonly sourcePath: string;
}

export interface InventoryInput {
  readonly repoRoot: string;
  /** Repository-relative packed file lists per npm package (from `npm pack --dry-run --json`). */
  readonly packedFiles?: Readonly<Record<string, readonly string[]>>;
  /** Mod command hooks; from `claude plugin validate` when available, else a source scan. */
  readonly modHooks?: readonly ModCommandHook[];
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** `sparc/architect.md` -> `sparc:architect`. */
export function projectInvocation(relativeToCommandsDir: string): string {
  return toPosix(relativeToCommandsDir).replace(/\.md$/, '').split('/').join(':');
}

function initCategoryFor(relativeToCommandsDir: string): string | undefined {
  const top = toPosix(relativeToCommandsDir).split('/')[0];
  for (const [category, entries] of Object.entries(INIT_COMMAND_CATEGORIES)) {
    if (entries.includes(top)) return category;
  }
  return undefined;
}

function shippedIn(repoPath: string, packedFiles: InventoryInput['packedFiles']): string[] {
  if (!packedFiles) return [];
  return Object.entries(packedFiles)
    .filter(([, files]) => files.includes(repoPath))
    .map(([name]) => name)
    .sort();
}

function scanCommandsDir(
  input: InventoryInput,
  commandsDir: string,
  channel: DeliveryChannel,
  pkg: string,
  ownerPlugin: string,
  prefix?: string,
): RawCommand[] {
  const absolute = join(input.repoRoot, commandsDir);
  return listMarkdown(absolute).map((file) => {
    const relToDir = toPosix(relative(absolute, file));
    const repoPath = toPosix(relative(input.repoRoot, file));
    const content = readFileSync(file, 'utf8');
    const invocation = prefix ? `${prefix}:${projectInvocation(relToDir)}` : projectInvocation(relToDir);
    return {
      key: invocation,
      ownerPlugin,
      content,
      source: {
        channel,
        package: pkg,
        sourcePath: repoPath,
        digest: `sha256:${sha256Hex(content)}`,
        observedInvocation: `/${invocation}`,
        binding: 'markdown-loader',
        ...(channel === 'cli-init-template' && initCategoryFor(relToDir)
          ? { initCategory: initCategoryFor(relToDir) }
          : {}),
        shippedIn: shippedIn(repoPath, input.packedFiles),
      },
    };
  });
}

interface MarketplacePlugin { name: string; source: string }

export function readMarketplace(repoRoot: string): MarketplacePlugin[] {
  const file = join(repoRoot, MARKETPLACE_MANIFEST);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { plugins?: unknown };
  if (!Array.isArray(parsed.plugins)) return [];
  return parsed.plugins
    .filter((p): p is MarketplacePlugin =>
      !!p && typeof (p as MarketplacePlugin).name === 'string' && typeof (p as MarketplacePlugin).source === 'string')
    .map((p) => ({ name: p.name, source: toPosix(p.source).replace(/^\.\//, '').replace(/\/$/, '') }));
}

/** Plugin command folders: marketplace-listed sources, then any other `plugins/<p>/commands`. */
function scanPlugins(input: InventoryInput): RawCommand[] {
  const out: RawCommand[] = [];
  const listed = new Set<string>();
  for (const plugin of readMarketplace(input.repoRoot)) {
    const dir = `${plugin.source}/commands`;
    listed.add(dir);
    out.push(...scanCommandsDir(input, dir, 'marketplace-plugin', `${plugin.name}@ruflo`, plugin.name, plugin.name));
  }
  const pluginsRoot = join(input.repoRoot, 'plugins');
  if (!existsSync(pluginsRoot)) return out;
  for (const name of readdirSync(pluginsRoot).sort()) {
    const dir = `plugins/${name}/commands`;
    if (listed.has(dir) || !existsSync(join(input.repoRoot, dir))) continue;
    out.push(...scanCommandsDir(input, dir, 'source-plugin', `plugins/${name}`, name, name));
  }
  return out;
}

/**
 * Mod hooks. A `command.run` hook on a name that a Markdown command of the
 * same plugin already exposes is middleware on that workflow, not a new
 * command; any other name is a mod registration.
 */
function scanModHooks(input: InventoryInput, markdown: readonly RawCommand[]): RawCommand[] {
  const markdownKeys = new Set(markdown.map((m) => m.key));
  return (input.modHooks ?? []).map((hook) => {
    const middleware = markdownKeys.has(hook.command);
    const file = join(input.repoRoot, hook.sourcePath);
    const digest = existsSync(file) ? sha256Hex(readFileSync(file)) : sha256Hex(hook.command);
    return {
      key: hook.command,
      ownerPlugin: hook.plugin,
      source: {
        channel: 'mod-registration' as const,
        package: `${hook.plugin}@ruflo`,
        sourcePath: hook.sourcePath,
        digest: `sha256:${digest}`,
        observedInvocation: `/${hook.command}`,
        binding: middleware ? 'mod-middleware-on-markdown' as const : 'mod-register' as const,
        shippedIn: [],
      },
    };
  });
}

/**
 * Static fallback for mod hooks when the engine is not available: the
 * `command.run` matchers written in each plugin's hooks sources. The engine
 * report replaces this with `claude plugin validate` output when it can run.
 */
export function scanModHooksFromSource(repoRoot: string): ModCommandHook[] {
  const pluginsRoot = join(repoRoot, 'plugins');
  if (!existsSync(pluginsRoot)) return [];
  const hooks: ModCommandHook[] = [];
  for (const plugin of readdirSync(pluginsRoot).sort()) {
    const hooksDir = join(pluginsRoot, plugin, 'hooks');
    if (!existsSync(join(hooksDir, 'register.ts'))) continue;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.ts')) continue;
        const text = readFileSync(full, 'utf8');
        const seen = new Set<string>();
        for (const m of text.matchAll(/command\.run'\s*,\s*\{\s*command:\s*'([a-z0-9._:-]+)'/gi)) seen.add(m[1]);
        for (const m of text.matchAll(/\.register(?:Command)?\(\{\s*name:\s*'([a-z0-9._:-]+)'/gi)) seen.add(m[1]);
        for (const m of text.matchAll(/\{\s*name:\s*'(ruflo-[a-z0-9-]+)'\s*,\s*description:/gi)) seen.add(m[1]);
        for (const command of [...seen].sort()) {
          hooks.push({ plugin, command, sourcePath: toPosix(relative(repoRoot, full)) });
        }
      }
    };
    walk(hooksDir);
  }
  // One hook per (plugin, command): a name both registered and matched is one command.
  const unique = new Map<string, ModCommandHook>();
  for (const hook of hooks) {
    const key = `${hook.plugin}\u0000${hook.command}`;
    if (!unique.has(key)) unique.set(key, hook);
  }
  return [...unique.values()];
}

/** Everything the repository and its packages expose as a slash command. */
export function collectInventory(input: InventoryInput): RawCommand[] {
  const markdown = [
    ...scanCommandsDir(input, PROJECT_COMMANDS_DIR, 'repo-project-commands', 'claude-flow', 'project'),
    ...scanCommandsDir(input, CLI_TEMPLATE_COMMANDS_DIR, 'cli-init-template', '@claude-flow/cli', 'project'),
    ...scanPlugins(input),
  ];
  return [...markdown, ...scanModHooks(input, markdown)];
}
