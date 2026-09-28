/**
 * Grok Build host init (ADR-402).
 *
 * Mirrors `init --codex`: writes project-scoped `.grok/` surface + team bus scripts
 * so any repo can run Ruflo Agent Teams under Grok without Claude SendMessage.
 *
 * Writes outside the project only with `statusLine: true` (`--grok-statusline`):
 * the status row lives in the user's ~/.grok/config.toml, which is parsed and
 * merged with a real TOML parser, never blindly appended to.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as TOML from '@iarna/toml';

export interface GrokInitOptions {
  targetDir: string;
  force?: boolean;
  /** Also write docs/grok/README.md operator guide */
  docs?: boolean;
  /** Install the status row into the user's ~/.grok/config.toml (opt-in). */
  statusLine?: boolean;
  /** Report what would be written; write nothing. */
  dryRun?: boolean;
  /** Home directory for the user-level status row (tests). */
  homeDir?: string;
}

export type GrokUserConfigAction =
  | 'not-requested'
  | 'created'
  | 'merged'
  | 'already-set'
  | 'snippet'
  | 'would-write';

export interface GrokUserConfigResult {
  action: GrokUserConfigAction;
  /** ~/.grok/config.toml */
  path: string;
  /** TOML to paste when init did not write it */
  snippet: string;
  reason?: string;
}

export interface GrokMcpLaunch {
  command: string;
  args: string[];
  /** published: pinned to this CLI's npm version; checkout: this local build */
  source: 'published' | 'checkout';
  version: string;
}

export interface GrokInitResult {
  success: boolean;
  dryRun: boolean;
  /** Files written (or, in a dry run, that would be written) */
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
  mcp: GrokMcpLaunch;
  userConfig: GrokUserConfigResult;
}

function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../..'), // dist/src/init → package root
    path.resolve(here, '../..'), // src/init → package root
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'templates', 'grok', 'config.toml'))) {
      return c;
    }
  }
  return candidates[0];
}

/** templates/grok inside the installed @claude-flow/cli package. */
export function grokTemplatesRoot(): string {
  return path.join(packageRoot(), 'templates', 'grok');
}

function packageVersion(root: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * How the project .grok/config.toml starts the Ruflo MCP server.
 *
 * The team_* tools ship in the same release as `init --grok`, so the server is
 * pinned to the version that is running this init — never `@latest`, which can
 * be an older release without them. Running from a source checkout (not under
 * node_modules) points at that checkout's CLI, since its version may not be
 * published yet.
 */
export function rufloMcpLaunch(root: string = packageRoot()): GrokMcpLaunch {
  const version = packageVersion(root);
  const published = root.split(path.sep).includes('node_modules');
  if (!published) {
    return {
      command: 'node',
      args: [path.join(root, 'bin', 'cli.js'), 'mcp', 'start'],
      source: 'checkout',
      version,
    };
  }
  const npxArgs = ['-y', `ruflo@${version}`, 'mcp', 'start'];
  return process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...npxArgs], source: 'published', version }
    : { command: 'npx', args: npxArgs, source: 'published', version };
}

/** A TOML basic string. JSON escaping is a valid subset (\\, \", \uXXXX). */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Fill the template placeholders. Every inserted value is escaped as a TOML
 * string, so a Windows path such as C:\Users\x stays valid TOML.
 */
export function materializeGrokConfig(template: string, launch: GrokMcpLaunch, home: string): string {
  const homeInString = tomlString(home.replace(/[\\/]+$/, '')).slice(1, -1);
  return template
    .replaceAll('{{RUFLO_MCP_COMMAND}}', tomlString(launch.command))
    .replaceAll('{{RUFLO_MCP_ARGS}}', `[${launch.args.map(tomlString).join(', ')}]`)
    .replaceAll('{{HOME}}/', `${homeInString}/`);
}

// ---------------------------------------------------------------------------
// User-level status row (~/.grok/config.toml [ui.status_line])
// ---------------------------------------------------------------------------

/** Where the opt-in status row script is installed: a stable absolute path. */
export function grokStatusScriptPath(home: string): string {
  return path.join(home, '.grok', 'ruflo', 'host-statusline.mjs');
}

/** `node "<abs path>"` — no shell builtins, and never a repo-relative script. */
export function grokStatusLineCommand(home: string): string {
  return `node "${grokStatusScriptPath(home)}"`;
}

export function grokStatusLineSnippet(home: string): string {
  return TOML.stringify({
    ui: { status_line: { type: 'command', command: grokStatusLineCommand(home) } },
  } as TOML.JsonMap);
}

type MergeOutcome =
  | { kind: 'write'; text: string }
  | { kind: 'already-set'; ours: boolean }
  | { kind: 'unsafe'; reason: string };

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

function statusLineOf(doc: TOML.JsonMap): unknown {
  const ui = doc.ui;
  return ui && typeof ui === 'object' && !Array.isArray(ui) ? (ui as TOML.JsonMap).status_line : undefined;
}

/**
 * Add the status row to an existing user config without disturbing it.
 *
 * Any existing `ui.status_line` — header, `[ ui.status_line ]`,
 * `[ui."status_line"]`, dotted keys, or an inline table — is detected by
 * parsing, and left alone. Otherwise the block is appended and the result is
 * re-parsed: it is written only if it parses, carries exactly our status row,
 * and every other value is unchanged. Anything else (unparseable file, `ui`
 * as an inline table, …) falls back to printing the snippet.
 */
export function mergeGrokStatusLine(existing: string, home: string): MergeOutcome {
  let before: TOML.JsonMap;
  try {
    before = TOML.parse(existing);
  } catch (e) {
    return { kind: 'unsafe', reason: `could not parse it as TOML (${(e as Error).message.split('\n')[0]})` };
  }
  const current = statusLineOf(before);
  if (current !== undefined) {
    const command = current && typeof current === 'object' ? (current as TOML.JsonMap).command : undefined;
    return { kind: 'already-set', ours: command === grokStatusLineCommand(home) };
  }

  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const text = `${existing}${sep}\n# Ruflo loaded-status row (added by ruflo init --grok --grok-statusline)\n${grokStatusLineSnippet(home)}`;
  let after: TOML.JsonMap;
  try {
    after = TOML.parse(text);
  } catch (e) {
    return { kind: 'unsafe', reason: `appending [ui.status_line] would not parse (${(e as Error).message.split('\n')[0]})` };
  }
  const added = statusLineOf(after) as TOML.JsonMap | undefined;
  if (!added || added.type !== 'command' || added.command !== grokStatusLineCommand(home)) {
    return { kind: 'unsafe', reason: 'the merged file did not contain the expected status row' };
  }
  const ui = after.ui as TOML.JsonMap;
  delete ui.status_line;
  if (before.ui === undefined && Object.keys(ui).length === 0) delete after.ui;
  if (stableJson(after) !== stableJson(before)) {
    return { kind: 'unsafe', reason: 'the merge would change other settings' };
  }
  return { kind: 'write', text };
}

function writeFileAtomic(file: string, text: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf-8', mode: mode ?? 0o600 });
  fs.renameSync(tmp, file);
}

function wireGrokUserStatusLine(
  home: string,
  dryRun: boolean,
  created: string[],
  errors: string[],
): GrokUserConfigResult {
  const dest = path.join(home, '.grok', 'config.toml');
  const snippet = grokStatusLineSnippet(home);
  const script = grokStatusScriptPath(home);
  const result = (action: GrokUserConfigAction, reason?: string): GrokUserConfigResult => ({
    action,
    path: dest,
    snippet,
    reason,
  });

  let existing: string | null = null;
  try {
    existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : null;
  } catch (e) {
    return result('snippet', `could not read ${dest}: ${(e as Error).message}`);
  }
  const outcome: MergeOutcome = existing === null
    ? { kind: 'write', text: `# Ruflo loaded-status row (added by ruflo init --grok --grok-statusline)\n${snippet}` }
    : mergeGrokStatusLine(existing, home);
  if (outcome.kind === 'unsafe') return result('snippet', `${dest}: ${outcome.reason}`);

  if (outcome.kind === 'already-set' && !outcome.ours) {
    return result('already-set', `${dest} already has its own [ui.status_line]; left it and did not install the Ruflo script`);
  }
  // Ours, or about to be ours: install/refresh the script it runs.
  const needsConfig = outcome.kind === 'write';
  if (dryRun) {
    created.push(script);
    if (needsConfig) created.push(dest);
    return result(needsConfig ? 'would-write' : 'already-set');
  }
  try {
    const src = path.join(grokTemplatesRoot(), 'scripts', 'host-statusline.mjs');
    writeFileAtomic(script, fs.readFileSync(src, 'utf-8'), 0o755);
    created.push(script);
    if (!needsConfig) return result('already-set');
    writeFileAtomic(dest, outcome.text);
    created.push(dest);
    return result(existing === null ? 'created' : 'merged');
  } catch (e) {
    errors.push(`${dest}: ${(e as Error).message}`);
    return result('snippet', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

interface CopyContext {
  force: boolean;
  dryRun: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
}

function writeProjectFile(ctx: CopyContext, dest: string, write: () => void): void {
  try {
    if (fs.existsSync(dest) && !ctx.force) {
      ctx.skipped.push(dest);
      return;
    }
    if (!ctx.dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      write();
    }
    ctx.created.push(dest);
  } catch (e) {
    ctx.errors.push(`${dest}: ${(e as Error).message}`);
  }
}

function copyFile(ctx: CopyContext, src: string, dest: string): void {
  writeProjectFile(ctx, dest, () => {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, fs.statSync(src).mode);
  });
}

function walkCopy(ctx: CopyContext, srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) {
    ctx.errors.push(`Template directory missing: ${srcDir}`);
    return;
  }
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) walkCopy(ctx, src, dest);
    else copyFile(ctx, src, dest);
  }
}

/**
 * Initialize Grok host surface in targetDir.
 */
export function executeGrokInit(options: GrokInitOptions): GrokInitResult {
  const { targetDir, force = false, docs = true, statusLine = false, dryRun = false } = options;
  const home = options.homeDir || os.homedir();
  const ctx: CopyContext = { force, dryRun, created: [], skipped: [], errors: [] };
  const tpl = grokTemplatesRoot();
  const mcp = rufloMcpLaunch();
  const userConfig: GrokUserConfigResult = {
    action: 'not-requested',
    path: path.join(home, '.grok', 'config.toml'),
    snippet: grokStatusLineSnippet(home),
  };
  const done = (): GrokInitResult => ({
    success: ctx.errors.length === 0,
    dryRun,
    filesCreated: ctx.created,
    filesSkipped: ctx.skipped,
    errors: ctx.errors,
    mcp,
    userConfig,
  });

  if (!fs.existsSync(path.join(tpl, 'config.toml'))) {
    ctx.errors.push(
      `Grok templates not found at ${tpl}. Reinstall @claude-flow/cli or run from a monorepo checkout that includes templates/grok.`,
    );
    return done();
  }

  // .grok/config.toml — placeholders filled, then checked with a TOML parser
  const config = materializeGrokConfig(fs.readFileSync(path.join(tpl, 'config.toml'), 'utf-8'), mcp, home);
  try {
    TOML.parse(config);
  } catch (e) {
    ctx.errors.push(`.grok/config.toml would not be valid TOML: ${(e as Error).message.split('\n')[0]}`);
    return done();
  }
  writeProjectFile(ctx, path.join(targetDir, '.grok', 'config.toml'), () =>
    fs.writeFileSync(path.join(targetDir, '.grok', 'config.toml'), config, 'utf-8'),
  );

  for (const dir of ['rules', 'agents', 'hooks', 'skills']) {
    walkCopy(ctx, path.join(tpl, dir), path.join(targetDir, '.grok', dir));
  }
  // scripts/ team bus (project-local CLI + SubagentStop adapter + status row)
  walkCopy(ctx, path.join(tpl, 'scripts'), path.join(targetDir, 'scripts'));
  if (docs) {
    walkCopy(ctx, path.join(tpl, 'docs'), path.join(targetDir, 'docs', 'grok'));
  }

  if (statusLine) {
    Object.assign(userConfig, wireGrokUserStatusLine(home, dryRun, ctx.created, ctx.errors));
  }
  return done();
}
