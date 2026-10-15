/**
 * #3376: `embeddings init` reported success after skipping the model download.
 *
 * `getEmbeddings()` (commands/embeddings.ts) dynamic-imports the optional
 * `@claude-flow/embeddings` package and returns null when it is absent — which
 * is every plain `npm i -g ruflo`, because that package is not declared in the
 * CLI's package.json at all. The `else` branch of `if (embeddings)` slept 500ms
 * faking download progress, printed a dimmed "(Skipped — …)" note onto the
 * spinner's tail, and then fell through to the success path: a settings table
 * asserting the model and 384 dimensions, `.claude-flow/embeddings.json`
 * recording a `modelPath` that contains no model, and exit 0.
 *
 * That matters because `embeddings init --download` is the command
 * `memory/embedding-policy.ts` names in its `[no-stub]` error — the documented
 * repair for broken embeddings reported success and changed nothing.
 *
 * These tests drive the command actions in-process (same shape as
 * proxy-config-command.test.ts) because the observable contract is the
 * CommandResult the dispatcher turns into an exit code: index.ts does
 * `if (result && !result.success) process.exit(result.exitCode || 1)`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Command, CommandContext } from '../src/types.js';

// These tests describe what happens when the optional embeddings package is
// NOT resolvable. That is the state of this workspace (it is not a dependency
// of @claude-flow/cli), but assert it rather than assume it: if someone ever
// adds the package, these tests must skip rather than pass for a wrong reason.
function embeddingsPackagePresent(): boolean {
  try {
    createRequire(import.meta.url).resolve('@claude-flow/embeddings');
    return true;
  } catch {
    return false;
  }
}

const SKIP = embeddingsPackagePresent();

let initCmd: Command;
let modelsCmd: Command;
let warnings: string[];
let lines: string[];
let tableRows: Array<Record<string, string>>;
let savedCwd: string;
let workdir: string;

beforeAll(async () => {
  const { embeddingsCommand } = await import('../src/commands/embeddings.js');
  const init = embeddingsCommand.subcommands?.find((c) => c.name === 'init');
  const models = embeddingsCommand.subcommands?.find((c) => c.name === 'models');
  if (!init || !models) throw new Error('embeddings init/models subcommand not found');
  initCmd = init;
  modelsCmd = models;
});

beforeEach(async () => {
  savedCwd = process.cwd();
  // realpath: on macOS os.tmpdir() is /var/... but process.cwd() reports the
  // resolved /private/var/..., and the command records process.cwd().
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-3376-')));
  // `embeddings init` resolves .claude-flow against process.cwd(), not ctx.cwd.
  process.chdir(workdir);

  warnings = [];
  lines = [];
  tableRows = [];
  const { output } = await import('../src/output.js');
  vi.spyOn(output, 'printWarning').mockImplementation((m: string) => { warnings.push(m); });
  // Spinner.stop()/succeed()/fail() render through the formatter's writeln,
  // so this captures the headline the user sees where the spinner was.
  vi.spyOn(output, 'writeln').mockImplementation((t = '') => { lines.push(t); });
  vi.spyOn(output, 'printTable').mockImplementation((o: { data: Array<Record<string, string>> }) => {
    tableRows.push(...o.data);
  });
  // Keep the suite's own output readable; these carry no assertions.
  vi.spyOn(output, 'printInfo').mockImplementation(() => {});
  vi.spyOn(output, 'printBox').mockImplementation(() => {});
  vi.spyOn(output, 'printList').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(savedCwd);
  fs.rmSync(workdir, { recursive: true, force: true });
});

function ctx(flags: Record<string, unknown> = {}): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(workdir, '.claude-flow', 'embeddings.json'), 'utf-8'));
}

describe.skipIf(SKIP)('#3376 embeddings init does not report success for a skipped download', () => {
  it('fails with exit code 1 when the download was requested and did not happen', async () => {
    const result = await initCmd.action!(ctx());

    // Pre-fix: success: true, no exitCode — the dispatcher exited 0.
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('warns prominently instead of dimming the skip onto the spinner line', async () => {
    await initCmd.action!(ctx());

    // Pre-fix the only disclosure was output.writeln(output.dim(...)), so
    // printWarning was never called at all.
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('\n')).toContain('@claude-flow/embeddings is not installed');
  });

  it('does not claim the subsystem was initialized', async () => {
    await initCmd.action!(ctx());

    // Pre-fix the spinner succeeded with exactly this, contradicting the
    // dimmed skip note printed one line above it.
    expect(lines.join('\n')).not.toContain('Embedding subsystem initialized');
    expect(lines.join('\n')).toContain('NOT downloaded');
  });

  it('marks the model as not downloaded in the settings table', async () => {
    await initCmd.action!(ctx());

    // Pre-fix the table listed Model / Dimension / Model Path with no
    // indication that the path was empty.
    const status = tableRows.find((r) => r.setting === 'Model Status');
    expect(status?.value).toEqual(expect.stringContaining('NOT downloaded'));
  });

  it('records modelDownloaded: false rather than asserting a model is present', async () => {
    await initCmd.action!(ctx());

    const config = readConfig();
    // Pre-fix: the key did not exist and the config asserted the model path
    // unconditionally.
    expect(config.modelDownloaded).toBe(false);
    expect(config.modelSkipReason).toContain('@claude-flow/embeddings');

    // Nothing was actually downloaded — the directory the config points at is
    // empty. This is the fact the old config contradicted.
    expect(fs.readdirSync(path.join(workdir, '.claude-flow', 'models'))).toHaveLength(0);
  });

  it('keeps the existing config shape so older readers still work', async () => {
    await initCmd.action!(ctx());

    const config = readConfig();
    // Every key mcp-tools/embeddings-tools.ts's EmbeddingsConfig reads is
    // still present and unchanged in meaning; the new keys are additive.
    expect(config.model).toBe('all-MiniLM-L6-v2');
    expect(config.modelPath).toBe(path.join(workdir, '.claude-flow', 'models'));
    expect(config.dimension).toBe(384);
    expect(config.cacheSize).toBe(256);
    expect(config.hyperbolic).toMatchObject({ enabled: true, curvature: -1 });
    expect(config.neural).toMatchObject({ enabled: true });
    expect(typeof config.initialized).toBe('string');
  });

  it('still succeeds with --no-download, because no download was asked for', async () => {
    const result = await initCmd.action!(ctx({ download: false }));

    // Configuring hyperbolic settings without a model is a legitimate use;
    // only a download that was requested and skipped is a failure.
    expect(result.success).toBe(true);
    const config = readConfig();
    expect(config.modelDownloaded).toBe(false);
    expect(config.modelSkipReason).toContain('--no-download');
  });

  it('does not sleep 500ms faking download progress', async () => {
    const started = Date.now();
    await initCmd.action!(ctx());
    const elapsed = Date.now() - started;

    // Pre-fix this path always cost at least the hardcoded
    // `await new Promise(r => setTimeout(r, 500))`. The real work here is a
    // mkdir and a small JSON write (single-digit ms), so 300ms is ~15x
    // headroom over the actual cost while staying well under the 500ms floor
    // the removed sleep imposed. This is the one timing-based assertion here.
    expect(elapsed).toBeLessThan(300);
  });
});

describe.skipIf(SKIP)('#3376 embeddings models --download reports the same skip honestly', () => {
  it('fails with exit code 1 and does not sleep 500ms', async () => {
    const started = Date.now();
    const result = await modelsCmd.action!(ctx({ download: 'all-MiniLM-L6-v2' }));
    const elapsed = Date.now() - started;

    // Pre-fix: spinner.succeed('Download skipped — …') after a 500ms sleep,
    // then `return { success: true }`.
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(warnings.join('\n')).toContain('was not downloaded');
    expect(elapsed).toBeLessThan(300);
  });
});
