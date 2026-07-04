/**
 * V3 CLI `memory distill` Command Family (ADR-174 Milestone 2)
 *
 * CLI surface over the frozen M1 service (`../services/memory-distillation.js`
 * — `runDistillation` / `defaultMemoryDbPath`). This file does not implement
 * any distillation logic itself; it only resolves flags/config/presets into
 * `DistillOptions`, calls the service, and formats the report.
 *
 *   memory distill run     — run (or dry-run) a distillation pass
 *   memory distill status  — read-only report on the target tables + cursor
 *   memory distill config  — print the effective resolved config as JSON
 *
 * Design notes:
 *  - `--judge fable` requires `--budget-usd > 0` (ADR-172 cost-bounded advisor
 *    gate). This is enforced here, client-side, as a fail-fast — the service
 *    itself also refuses (`skipped: 'judge:fable requires ...'`) but failing
 *    fast in the CLI gives a clearer, non-zero-exit error.
 *  - `--aggressive` / `--conservative` are preset bundles (ADR-174 param
 *    table). Precedence, low to high: built-in defaults < `--config` file <
 *    preset < explicit `--batch-size`/`--dedup-distance` flags.
 *  - `status` opens the DB read-only via the same "variable-specifier"
 *    optional-import pattern used by `../memory/graph-edge-writer.ts` so the
 *    TypeScript compiler never statically requires `better-sqlite3` types,
 *    and degrades gracefully (no throw) when the DB, tables, or the native
 *    module are absent.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  runDistillation,
  defaultMemoryDbPath,
  type DistillOptions,
  type DistillReport,
} from '../services/memory-distillation.js';

// ============================================================================
// Shared config resolution (run + config subcommands)
// ============================================================================

export interface DistillCliConfig {
  dryRun: boolean;
  namespaces?: string[];
  batchSize: number;
  dedupDistance: number;
  maxEntries?: number;
  sinceRowid?: number;
  budgetUsd: number;
  judge: 'structural' | 'fable';
}

const DEFAULT_CONFIG: DistillCliConfig = {
  dryRun: false,
  batchSize: 200,
  dedupDistance: 0.2, // ADR-174 M4-tuned platform default (~37% fewer patterns, retrieval-neutral)
  budgetUsd: 0,
  judge: 'structural',
};

// ADR-174 preset bundles — distinct extremes around the 0.2 tuned default.
const AGGRESSIVE_PRESET = { dedupDistance: 0.3, batchSize: 500 };   // more clustering → fewer, coarser patterns
const CONSERVATIVE_PRESET = { dedupDistance: 0.1, batchSize: 100 }; // less clustering → more, granular patterns

const DB_OPTION = {
  name: 'db',
  description: 'Path to the memory DB (default: cwd/.swarm/memory.db)',
  type: 'string' as const,
};

type ResolveResult = { ok: true; config: DistillCliConfig } | { ok: false; error: string };

/**
 * Resolve the effective distill config from: built-in defaults, an optional
 * `--config <path>` JSON file, an `--aggressive`/`--conservative` preset, and
 * finally explicit CLI flags (highest precedence).
 */
export function resolveDistillConfig(ctx: CommandContext): ResolveResult {
  let cfg: DistillCliConfig = { ...DEFAULT_CONFIG };

  const configPath = ctx.flags.config as string | undefined;
  if (configPath) {
    try {
      const raw = fs.readFileSync(path.resolve(configPath), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cfg = { ...cfg, ...parsed };
      }
    } catch (error) {
      return { ok: false, error: `Failed to load --config ${configPath}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const aggressive = ctx.flags.aggressive === true;
  const conservative = ctx.flags.conservative === true;
  if (aggressive && conservative) {
    return { ok: false, error: '--aggressive and --conservative are mutually exclusive' };
  }
  if (aggressive) cfg = { ...cfg, ...AGGRESSIVE_PRESET };
  if (conservative) cfg = { ...cfg, ...CONSERVATIVE_PRESET };

  // Explicit CLI flags win over the config file and presets.
  if (ctx.flags.dryRun === true) cfg.dryRun = true;
  if (typeof ctx.flags.namespace === 'string' && ctx.flags.namespace.length > 0) {
    cfg.namespaces = ctx.flags.namespace.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (ctx.flags.batchSize !== undefined) cfg.batchSize = Number(ctx.flags.batchSize);
  if (ctx.flags.dedupDistance !== undefined) cfg.dedupDistance = Number(ctx.flags.dedupDistance);
  if (ctx.flags.maxEntries !== undefined) cfg.maxEntries = Number(ctx.flags.maxEntries);
  if (ctx.flags.since !== undefined) cfg.sinceRowid = Number(ctx.flags.since);
  if (ctx.flags.budgetUsd !== undefined) cfg.budgetUsd = Number(ctx.flags.budgetUsd);
  if (ctx.flags.judge !== undefined) {
    if (ctx.flags.judge !== 'structural' && ctx.flags.judge !== 'fable') {
      return { ok: false, error: `--judge must be 'structural' or 'fable' (got '${String(ctx.flags.judge)}')` };
    }
    cfg.judge = ctx.flags.judge;
  }

  return { ok: true, config: cfg };
}

function resolveDbPath(ctx: CommandContext): string {
  return (ctx.flags.db as string) || defaultMemoryDbPath(ctx.cwd || process.cwd());
}

// ============================================================================
// `memory distill run`
// ============================================================================

const runCommand: Command = {
  name: 'run',
  description: 'Distill memory_entries into episodes/reasoning_patterns/pattern_embeddings/causal_edges (ADR-174)',
  options: [
    { name: 'dry-run', description: 'Report counts, write nothing', type: 'boolean', default: false },
    { name: 'namespace', description: 'Comma-separated namespace scope (default: all embedded namespaces)', type: 'string' },
    { name: 'batch-size', description: 'Rows per transaction (default 200)', type: 'number', default: 200 },
    { name: 'dedup-distance', description: 'Cosine distance for pattern clustering (default 0.12)', type: 'number', default: 0.12 },
    { name: 'max-entries', description: 'Per-invocation work cap (default unbounded)', type: 'number' },
    { name: 'since', description: 'Override the incremental cursor and rescan from this rowid', type: 'number' },
    { name: 'budget-usd', description: '$0 by default; >0 required to unlock --judge fable (ADR-172)', type: 'number', default: 0 },
    { name: 'judge', description: "'structural' (default, $0) or 'fable' (requires --budget-usd > 0)", type: 'string', default: 'structural', choices: ['structural', 'fable'] },
    { name: 'aggressive', description: 'Preset: dedup-distance 0.2, batch-size 500', type: 'boolean' },
    { name: 'conservative', description: 'Preset: dedup-distance 0.08, batch-size 100', type: 'boolean' },
    { name: 'config', description: 'Load options from a JSON config file (see: memory distill config)', type: 'string' },
    { ...DB_OPTION },
    { name: 'verbose', short: 'v', description: 'Verbose service logging', type: 'boolean' },
  ],
  examples: [
    { command: 'claude-flow memory distill run --dry-run', description: 'Preview counts without writing anything' },
    { command: 'claude-flow memory distill run --namespace feedback,commands', description: 'Scope the run to specific namespaces' },
    { command: 'claude-flow memory distill run --aggressive', description: 'Larger batches, looser dedup clustering' },
    { command: 'claude-flow memory distill run --judge fable --budget-usd 2', description: 'Opt into the cost-bounded Fable judge (ADR-172)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const resolved = resolveDistillConfig(ctx);
    if (!resolved.ok) {
      output.printError(resolved.error);
      return { success: false, exitCode: 1 };
    }
    const config = resolved.config;

    // Fail-fast ADR-172 gate: the Fable judge is cost-bounded and opt-in only.
    if (config.judge === 'fable' && !(config.budgetUsd > 0)) {
      output.printError(
        '--judge fable requires --budget-usd > 0 (ADR-172 cost-bounded advisor path). ' +
        'Refusing to run the LLM judge against a $0 budget.',
      );
      return { success: false, exitCode: 1 };
    }

    const dbPath = resolveDbPath(ctx);

    output.writeln();
    output.writeln(output.bold('Memory Distillation (ADR-174)'));
    output.writeln(output.dim('─'.repeat(55)));
    if (config.dryRun) output.writeln(output.warning('DRY RUN — no writes will be made'));

    const spinner = output.createSpinner({ text: 'Distilling memory_entries...', spinner: 'dots' });
    spinner.start();

    const distillOptions: DistillOptions = {
      dbPath,
      namespaces: config.namespaces,
      batchSize: config.batchSize,
      maxEntries: config.maxEntries,
      dedupDistance: config.dedupDistance,
      dryRun: config.dryRun,
      judge: config.judge,
      sinceRowid: config.sinceRowid,
      verbose: ctx.flags.verbose === true,
    };

    let report: DistillReport;
    try {
      report = await runDistillation(distillOptions);
    } catch (error) {
      spinner.fail('Distillation failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }

    if (report.skipped) {
      spinner.succeed('Distillation skipped');
      output.writeln(output.warning(`skipped: ${report.skipped}`));
      return { success: true, data: { dbPath, config, report } };
    }

    spinner.succeed(config.dryRun ? 'Dry-run complete' : 'Distillation complete');
    output.writeln();

    output.printTable({
      columns: [
        { key: 'metric', header: 'Metric', width: 24 },
        { key: 'value', header: 'Value', width: 20 },
      ],
      data: [
        { metric: 'Processed', value: String(report.processed) },
        { metric: 'Episodes', value: String(report.episodes) },
        { metric: 'Patterns', value: String(report.patterns) },
        { metric: 'Pattern Embeddings', value: String(report.patternEmbeddings) },
        { metric: 'Causal Edges', value: String(report.causalEdges) },
        { metric: 'Promoted (ADR-171)', value: String(report.promoted) },
        { metric: 'Namespaces', value: report.namespaces.join(', ') || '(none)' },
        { metric: 'Spend', value: `$${report.spendUsd.toFixed(4)}` },
        { metric: 'Dry Run', value: report.dryRun ? 'yes' : 'no' },
      ],
    });

    const provenanceEntries = Object.entries(report.byProvenance);
    if (provenanceEntries.length > 0) {
      output.writeln();
      output.writeln(output.bold('By Provenance'));
      output.printList(provenanceEntries.map(([tier, count]) => `${output.highlight(tier)}: ${count}`));
    }

    return { success: true, data: { dbPath, config, report } };
  },
};

// ============================================================================
// `memory distill status`
// ============================================================================

const statusCommand: Command = {
  name: 'status',
  description: 'Read-only report: target table row counts, per-namespace distill_state cursor, promoted vs proxy breakdown',
  options: [{ ...DB_OPTION }],
  examples: [
    { command: 'claude-flow memory distill status', description: 'Show distillation state for the default DB' },
    { command: 'claude-flow memory distill status --db ./copy.db', description: 'Inspect a specific DB copy' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dbPath = resolveDbPath(ctx);

    output.writeln();
    output.writeln(output.bold('Memory Distillation Status'));
    output.writeln(output.dim('─'.repeat(55)));

    if (!fs.existsSync(dbPath)) {
      output.writeln(output.warning(`No memory DB found at ${dbPath}`));
      return { success: true, data: { available: false, dbPath, reason: 'no-db' } };
    }

    // Optional native dep — hidden behind a variable specifier so the
    // compiler never statically requires `better-sqlite3` types (same
    // pattern as ../memory/graph-edge-writer.ts).
    let Database: any;
    try {
      const mod: string = 'better-sqlite3';
      Database = (await import(mod)).default;
    } catch {
      output.writeln(output.warning('better-sqlite3 native module unavailable — cannot read distillation state.'));
      return { success: true, data: { available: false, dbPath, reason: 'better-sqlite3 unavailable' } };
    }

    let db: any;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (error) {
      output.printError(`Failed to open ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
      return { success: true, data: { available: false, dbPath, reason: 'open-failed' } };
    }

    try {
      const tableExists = (name: string): boolean =>
        (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(name)?.c ?? 0) > 0;

      const targetTables = ['episodes', 'reasoning_patterns', 'pattern_embeddings', 'causal_edges'];
      const presence: Record<string, boolean> = {};
      for (const t of [...targetTables, 'distill_state']) presence[t] = tableExists(t);

      const counts: Record<string, number> = {};
      for (const t of targetTables) {
        counts[t] = presence[t] ? (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c ?? 0) : 0;
      }

      let cursors: Array<{ namespace: string; lastRowid: number; lastRunAt: number | null }> = [];
      if (presence.distill_state) {
        cursors = db.prepare(
          'SELECT namespace AS namespace, last_rowid AS lastRowid, last_run_at AS lastRunAt FROM distill_state ORDER BY namespace',
        ).all();
      }

      let promoted = 0;
      let proxy = 0;
      if (presence.reasoning_patterns) {
        promoted = db.prepare(
          "SELECT COUNT(*) AS c FROM reasoning_patterns WHERE json_extract(metadata,'$.promoted')=1",
        ).get()?.c ?? 0;
        proxy = db.prepare(
          "SELECT COUNT(*) AS c FROM reasoning_patterns WHERE json_extract(metadata,'$.provenance')='proxy:structural'",
        ).get()?.c ?? 0;
      }

      db.close();

      output.printTable({
        columns: [
          { key: 'table', header: 'Table', width: 22 },
          { key: 'rows', header: 'Rows', width: 10 },
        ],
        data: targetTables.map((t) => ({ table: t, rows: String(counts[t]) })),
      });

      output.writeln();
      output.writeln(output.bold('Promote gate (ADR-171)'));
      output.writeln(
        `  promoted: ${promoted}   proxy (never promoted): ${proxy}   total patterns: ${counts.reasoning_patterns}`,
      );

      if (cursors.length > 0) {
        output.writeln();
        output.writeln(output.bold('distill_state cursor'));
        output.printTable({
          columns: [
            { key: 'namespace', header: 'Namespace', width: 20 },
            { key: 'lastRowid', header: 'Last Rowid', width: 12 },
            { key: 'lastRunAt', header: 'Last Run', width: 26 },
          ],
          data: cursors.map((c) => ({
            namespace: c.namespace,
            lastRowid: String(c.lastRowid),
            lastRunAt: c.lastRunAt ? new Date(c.lastRunAt).toISOString() : 'never',
          })),
        });
      } else {
        output.writeln();
        output.writeln(output.dim('No distill_state cursor rows yet (run `memory distill run` first).'));
      }

      if (!presence.reasoning_patterns) {
        output.writeln();
        output.writeln(output.dim('Target tables not present — agentdb schema not initialised, or distillation never run.'));
      }

      return {
        success: true,
        data: { available: true, dbPath, counts, cursors, promoted, proxy, tablesPresent: presence },
      };
    } catch (error) {
      try { db?.close(); } catch { /* best-effort */ }
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: true, data: { available: false, dbPath, reason: 'error' } };
    }
  },
};

// ============================================================================
// `memory distill config`
// ============================================================================

const configCommand: Command = {
  name: 'config',
  description: 'Print the effective distill config (defaults + --config file + preset + explicit flags) as JSON',
  options: [
    { name: 'config', description: 'Load options from a JSON config file', type: 'string' },
    { name: 'aggressive', description: 'Preset: dedup-distance 0.2, batch-size 500', type: 'boolean' },
    { name: 'conservative', description: 'Preset: dedup-distance 0.08, batch-size 100', type: 'boolean' },
    { name: 'namespace', description: 'Comma-separated namespace scope', type: 'string' },
    { name: 'batch-size', description: 'Rows per transaction', type: 'number' },
    { name: 'dedup-distance', description: 'Cosine distance for pattern clustering', type: 'number' },
    { name: 'max-entries', description: 'Per-invocation work cap', type: 'number' },
    { name: 'since', description: 'Override incremental cursor start (rowid)', type: 'number' },
    { name: 'budget-usd', description: '$0 by default', type: 'number' },
    { name: 'judge', description: "'structural' | 'fable'", type: 'string' },
    { ...DB_OPTION },
  ],
  examples: [
    { command: 'claude-flow memory distill config', description: 'Print the platform-default config' },
    { command: 'claude-flow memory distill config --aggressive', description: 'Print the effective config with the aggressive preset applied' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const resolved = resolveDistillConfig(ctx);
    if (!resolved.ok) {
      output.printError(resolved.error);
      return { success: false, exitCode: 1 };
    }
    const dbPath = resolveDbPath(ctx);
    const payload = { dbPath, ...resolved.config };
    output.writeln(JSON.stringify(payload, null, 2));
    return { success: true, data: payload };
  },
};

// ============================================================================
// `memory distill` (parent)
// ============================================================================

export const distillCommand: Command = {
  name: 'distill',
  description: 'Memory distillation (ADR-174): mine memory_entries into reasoning_patterns/episodes/causal_edges',
  subcommands: [runCommand, statusCommand, configCommand],
  examples: [
    { command: 'claude-flow memory distill run --dry-run', description: 'Preview a distillation pass' },
    { command: 'claude-flow memory distill status', description: 'Show distilled table counts + cursor' },
    { command: 'claude-flow memory distill config --conservative', description: 'Print the effective conservative-preset config' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Memory Distillation (ADR-174)'));
    output.writeln('Usage: claude-flow memory distill <run|status|config> [options]');
    output.writeln();
    output.printList([
      `${output.highlight('run')}     - Distill memory_entries into the structured intelligence tables`,
      `${output.highlight('status')}  - Report target table counts, cursor, and promote-gate breakdown`,
      `${output.highlight('config')}  - Print the effective resolved config as JSON`,
    ]);
    return { success: true };
  },
};

export default distillCommand;
