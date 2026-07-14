/**
 * `ruflo spinner` — manage ruflo verbs in Claude Code's spinnerVerbs
 * settings (ADR-318).
 *
 * Claude Code exposes `spinnerVerbs.mode` + `spinnerVerbs.verbs[]` in
 * ~/.claude/settings.json. This command appends a curated ruflo pool to
 * that array, tagged with a zero-width joiner marker so `disable` can
 * strip only ruflo verbs without touching user-authored ones.
 *
 * NEVER replaces — always appends (see ADR-318 §Guarantees). Always backs
 * up ~/.claude/settings.json before write.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { hasConsent, recordConsent, revokeConsent } from '../funnel/consent.js';

// Zero-width joiner triple — invisible in every terminal that renders it,
// takes zero display cells, and is exceedingly unlikely to appear in a
// user-authored verb. Used to tag ruflo-managed entries so `disable`
// removes ONLY ours.
const RUFLO_MARKER = '‍‍‍';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// v0 baked pool (see ADR-318 for the v1 remote-served plan). Mix of neutral
// and Cognitum-tagged verbs, all validated (some word ends in -ing, ≤ 30 chars).
//
// Ratio target: ~15% Cognitum-tagged, ~85% neutral — sponsor is visible but
// doesn't dominate. With append mode + ~50 Claude Code default verbs, this
// gives roughly a 40% chance any spin is a ruflo verb, and ~6% of ALL spins
// show a Cognitum-tagged verb.
const RUFLO_VERB_POOL_V0 = [
  // Memory & retrieval (7)
  'Consulting the memory graph',
  'Warming the HNSW index',
  'Recalling similar patterns',
  'Searching semantic memory',
  'Reranking with MMR',
  'Traversing knowledge graph',
  'Loading trajectory context',
  // Optimization (6)
  'Optimizing your prompt',
  'Sharpening the plan',
  'Compacting the context',
  'Distilling the trajectory',
  'Reducing token spend',
  'Compressing the working set',
  // Learning & intelligence (6)
  'Learning from the trajectory',
  'Training the router',
  'Judging past verdicts',
  'Consolidating memories',
  'Reasoning through the graph',
  'Predicting the next step',
  // Security & audit (4)
  'Auditing for CVEs',
  'Scanning dependencies',
  'Verifying signatures',
  'Guarding against injection',
  // Agents & swarm (4)
  'Spawning subagents',
  'Coordinating the swarm',
  'Reaching consensus',
  'Balancing the workload',
  // Workflow (4)
  'Routing to the best model',
  'Warming background workers',
  'Analyzing the diff',
  'Sharpening the review',
  // Cognitum-tagged (6)
  'Consulting Cognitum',
  'Checking Cognitum credits',
  'Routing via Cognitum',
  'Fetching a Cognitum tip',
  'Warming Cognitum cache',
  'Weighing Cognitum options',
];

// Reject anything that violates the ADR-318 §Guarantees ingest rules.
function isValidVerb(v: string): boolean {
  if (typeof v !== 'string') return false;
  const stripped = v.replace(RUFLO_MARKER, '');
  if (stripped.length === 0 || stripped.length > 30) return false;
  // Claude Code's spinnerVerbs takes present participles. Traditionally
  // one word ("Thinking"), but multi-word phrases work too as long as
  // some word ends in "-ing". Was `/ing$/i.test(stripped)` which required
  // the whole STRING end in "ing" — that rejected every multi-word verb
  // in the pool ("Optimizing your prompt" ends in "prompt", not "ing").
  const words = stripped.split(/\s+/).filter(Boolean);
  if (!words.some(w => /ing$/i.test(w))) return false;
  // Per-code-point iteration (not regex) — a naive `/[…]/` char class
  // parsed as raw UTF-8 bytes matches bytes INSIDE multi-byte sequences
  // of legit emoji. Today's pool is pure ASCII so the old regex worked
  // by accident; this is the defensive fix ahead of any future emoji verb.
  // Same pattern as commands/announcements.ts.
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20) return false;
    if (cp === 0x7f) return false;
    if (cp >= 0x80 && cp <= 0x9f) return false;
    if (cp >= 0x202a && cp <= 0x202e) return false;
    if (cp >= 0x2066 && cp <= 0x2069) return false;
  }
  if (/https?:\/\//i.test(stripped)) return false;
  return true;
}

function markVerb(v: string): string {
  return v + RUFLO_MARKER;
}

function isRufloVerb(v: string): boolean {
  return typeof v === 'string' && v.includes(RUFLO_MARKER);
}

interface SpinnerVerbsBlock {
  mode?: 'append' | 'replace';
  verbs?: string[];
}
interface SettingsShape {
  spinnerVerbs?: SpinnerVerbsBlock;
  [k: string]: unknown;
}

function readSettings(): { data: SettingsShape; raw: string | null } {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: {}, raw: null };
  }
}

function backupSettings(raw: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = SETTINGS_PATH + '.bak-' + ts;
  fs.writeFileSync(backupPath, raw, 'utf-8');
  return backupPath;
}

function findMostRecentBackup(): string | null {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    const base = path.basename(SETTINGS_PATH);
    const entries = fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.bak-'))
      .sort()
      .reverse();
    return entries.length > 0 ? path.join(dir, entries[0]) : null;
  } catch { return null; }
}

function writeSettings(data: SettingsShape): void {
  // Ensure the .claude directory exists (fresh install case).
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  // Atomic write: write to sibling temp file, rename over.
  const tmp = SETTINGS_PATH + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

const enableSub: Command = {
  name: 'enable',
  description: "Add ruflo's curated verb pool to Claude Code's spinner rotation",
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const validVerbs = RUFLO_VERB_POOL_V0.filter(isValidVerb);
    if (validVerbs.length === 0) {
      output.printError('Verb pool is empty after validation — refusing to write nothing.');
      return { success: false };
    }
    // Disclosure moment (per ADR-318 §Full mix). Print the pool including
    // Cognitum-tagged entries so the user sees what they're opting in to.
    output.writeln('The following verbs will be appended to Claude Code\'s spinner rotation:');
    output.writeln('');
    for (const v of validVerbs) output.writeln('  • ' + v);
    output.writeln('');
    output.writeln('Some verbs mention Cognitum, Ruflo\'s sponsor. This is opt-in and reversible via');
    output.writeln("`ruflo spinner disable`. Claude Code's default verbs are preserved (append-only).");
    if (!ctx.flags.yes) {
      output.writeln('');
      output.printWarning('Re-run with --yes to confirm.');
      return { success: false, data: { previewedVerbs: validVerbs.length } };
    }

    // Read current settings, back up, merge.
    const { data, raw } = readSettings();
    let backupPath: string | null = null;
    if (raw) backupPath = backupSettings(raw);

    const currentBlock: SpinnerVerbsBlock = data.spinnerVerbs ?? {};
    if (currentBlock.mode === 'replace') {
      output.printError(
        'settings.json has spinnerVerbs.mode = "replace" — refusing to append (would silently be inert). ' +
        'Either change your mode to "append" manually and re-run, or accept ruflo\'s pool as your entire set via manual edit.'
      );
      return { success: false, data: { currentMode: 'replace' } };
    }
    const currentVerbs = Array.isArray(currentBlock.verbs) ? currentBlock.verbs : [];
    // Strip any prior ruflo entries so re-running enable is idempotent
    // instead of duplicating our pool every time.
    const preservedUserVerbs = currentVerbs.filter(v => !isRufloVerb(v));
    const newVerbs = validVerbs.map(markVerb);
    data.spinnerVerbs = {
      mode: 'append',
      verbs: [...preservedUserVerbs, ...newVerbs],
    };
    writeSettings(data);
    recordConsent('spinner-verbs', true, 'cli-spinner-enable');

    output.printSuccess(`Enabled — appended ${newVerbs.length} verbs to spinnerVerbs.`);
    if (backupPath) output.writeln(`Backup: ${backupPath}`);
    return {
      success: true,
      data: {
        appended: newVerbs.length,
        preservedUserVerbs: preservedUserVerbs.length,
        backup: backupPath,
      },
    };
  },
};

const disableSub: Command = {
  name: 'disable',
  description: 'Remove ruflo verbs from Claude Code\'s spinner rotation (user-authored verbs preserved)',
  action: async (): Promise<CommandResult> => {
    const { data, raw } = readSettings();
    if (!raw || !data.spinnerVerbs?.verbs?.length) {
      revokeConsent('spinner-verbs', 'cli-spinner-disable');
      output.writeln('Nothing to disable — no spinnerVerbs block found in settings.json.');
      return { success: true, data: { removed: 0 } };
    }
    const backupPath = backupSettings(raw);
    const before = data.spinnerVerbs.verbs.length;
    data.spinnerVerbs.verbs = data.spinnerVerbs.verbs.filter(v => !isRufloVerb(v));
    const after = data.spinnerVerbs.verbs.length;
    // If we removed everything and the block is now empty, drop the block
    // entirely so Claude Code falls straight back to its defaults.
    if (data.spinnerVerbs.verbs.length === 0) delete data.spinnerVerbs;
    writeSettings(data);
    revokeConsent('spinner-verbs', 'cli-spinner-disable');
    output.printSuccess(`Disabled — removed ${before - after} ruflo verbs (kept ${after} user-authored).`);
    output.writeln(`Backup: ${backupPath}`);
    return { success: true, data: { removed: before - after, kept: after, backup: backupPath } };
  },
};

const listSub: Command = {
  name: 'list',
  description: 'Show ruflo\'s verb pool and which verbs are currently installed',
  options: [
    { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { data } = readSettings();
    const installed = data.spinnerVerbs?.verbs ?? [];
    const installedRuflo = installed.filter(isRufloVerb).map(v => v.replace(RUFLO_MARKER, ''));
    const installedUser = installed.filter(v => !isRufloVerb(v));
    const pool = RUFLO_VERB_POOL_V0.filter(isValidVerb);
    const summary = {
      consent: hasConsent('spinner-verbs') ? 'granted' : 'not-granted',
      mode: data.spinnerVerbs?.mode ?? '(none)',
      pool_available: pool,
      installed_ruflo: installedRuflo,
      installed_user_authored: installedUser,
    };
    if (ctx.flags.json) {
      output.printJson(summary);
    } else {
      output.writeln(`Consent: ${summary.consent}`);
      output.writeln(`spinnerVerbs.mode in settings.json: ${summary.mode}`);
      output.writeln('');
      output.writeln(`Ruflo pool (${pool.length} verbs, available):`);
      for (const v of pool) output.writeln('  • ' + v);
      output.writeln('');
      output.writeln(`Currently installed ruflo verbs (${installedRuflo.length}):`);
      if (installedRuflo.length === 0) output.writeln('  (none — run `ruflo spinner enable --yes` to install)');
      else for (const v of installedRuflo) output.writeln('  • ' + v);
      output.writeln('');
      output.writeln(`User-authored verbs (${installedUser.length}, untouched by ruflo):`);
      for (const v of installedUser) output.writeln('  • ' + v);
    }
    return { success: true, data: summary };
  },
};

const resetSub: Command = {
  name: 'reset',
  description: 'Restore the most recent settings.json backup (destructive)',
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const backup = findMostRecentBackup();
    if (!backup) {
      output.printWarning('No settings.json backup found — nothing to restore.');
      return { success: false };
    }
    if (!ctx.flags.yes) {
      output.writeln(`Would restore: ${backup}`);
      output.writeln(`Over:          ${SETTINGS_PATH}`);
      output.writeln('');
      output.printWarning('Re-run with --yes to confirm.');
      return { success: false, data: { wouldRestore: backup } };
    }
    // Backup the CURRENT file too before overwriting, so reset is itself reversible.
    const { raw } = readSettings();
    if (raw) backupSettings(raw);
    fs.copyFileSync(backup, SETTINGS_PATH);
    revokeConsent('spinner-verbs', 'cli-spinner-reset');
    output.printSuccess(`Restored settings.json from ${backup}`);
    return { success: true, data: { restoredFrom: backup } };
  },
};

export const spinnerCommand: Command = {
  name: 'spinner',
  description: 'Manage ruflo verbs in Claude Code\'s spinnerVerbs rotation (ADR-318)',
  subcommands: [enableSub, disableSub, listSub, resetSub],
  examples: [
    { command: 'ruflo spinner list', description: 'Show the ruflo pool + what\'s currently installed' },
    { command: 'ruflo spinner enable --yes', description: 'Append ruflo\'s verb pool to settings.json' },
    { command: 'ruflo spinner disable', description: 'Remove ruflo verbs, keep user-authored ones' },
    { command: 'ruflo spinner reset --yes', description: 'Restore the most recent settings.json backup' },
  ],
  action: listSub.action,
};

export default spinnerCommand;
