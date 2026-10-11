/**
 * `ruflo tui` — the ruflo console in a terminal of its own (ADR-489).
 *
 * Runs the same views the Claude Code mod (plugins/ruflo-console) draws, over a Node host instead of the mod host. Read-only in
 * this phase: Overview and Cost. The bundle is built from the plugin's source (scripts/build-tui.mjs) and loaded from this
 * CLI's OWN install only (never from the working directory: opening a repository must not run code that repository supplies).
 * No bundle, or no terminal, is a message and a clean exit, never a crash; ruflo stays operational without it.
 *
 *   npx ruflo tui                 # interactive, in a terminal
 *   npx ruflo tui --view cost     # start on the Cost page
 *   npx ruflo tui | cat           # not a terminal: one plain frame, then exit
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { ownPluginDirs } from '../plugins/own-install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VIEWS = ['overview', 'cost'] as const;

type TuiModule = { runTui: (options: Record<string, unknown>, io: Record<string, unknown>) => Promise<number>; isTuiView: (value: unknown) => boolean };

/** `<own install>/plugins/ruflo-console/dist/tui.mjs`, the first that exists. */
export function locateTuiBundle(startDir: string = __dirname): string | null {
  for (const dir of ownPluginDirs(startDir, 'ruflo-console', 'dist')) {
    const file = join(dir, 'tui.mjs');
    if (existsSync(file)) return file;
  }
  return null;
}

/** The running CLI's entry file, so the console's read-only probes run this CLI and never download another. */
function cliEntry(): string | undefined {
  const entry = join(__dirname, '..', '..', '..', 'bin', 'cli.js');
  return existsSync(entry) ? entry : undefined;
}

export const tuiCommand: Command = {
  name: 'tui',
  description: 'The ruflo console in your terminal (Overview and Cost, read-only). Same views as the Claude Code mod.',
  options: [{ name: 'view', description: `Page to open: ${VIEWS.join(' | ')}`, type: 'string' as const, default: 'overview' }],
  examples: [
    { command: 'npx ruflo tui', description: 'Open the console in this terminal' },
    { command: 'npx ruflo tui --view cost', description: 'Start on the Cost page' },
  ],
  async action(context: CommandContext): Promise<CommandResult> {
    const ctx = context as { args?: string[]; flags?: Record<string, unknown>; cwd?: string };
    const wanted = (ctx.flags?.view as string | undefined) ?? ctx.args?.find(arg => !arg.startsWith('-')) ?? 'overview';

    if (!(VIEWS as readonly string[]).includes(wanted)) {
      output.writeln(output.error(`tui: unknown view "${String(wanted).slice(0, 40)}". Use one of: ${VIEWS.join(', ')}`));
      return { success: false, exitCode: 2, data: { error: 'unknown-view' } };
    }

    const bundle = locateTuiBundle();
    if (bundle === null) {
      output.writeln(output.warning('tui: the terminal console is not available in this install (plugins/ruflo-console/dist/tui.mjs not found).'));
      output.writeln('From a ruflo checkout: node plugins/ruflo-console/scripts/build-tui.mjs');
      return { success: false, exitCode: 1, data: { error: 'bundle-missing' } };
    }

    let mod: TuiModule;
    try {
      mod = (await import(pathToFileURL(bundle).href)) as TuiModule;
    } catch (error) {
      output.writeln(output.error(`tui: could not load the console bundle: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}`));
      return { success: false, exitCode: 1, data: { error: 'bundle-load-failed' } };
    }

    const stop = new AbortController();
    const onSignal = () => stop.abort();
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);

    try {
      const code = await mod.runTui(
        { cwd: ctx.cwd ?? process.cwd(), view: wanted, ...(cliEntry() !== undefined && { cliEntry: cliEntry() }), ...(process.env.CLAUDE_CONFIG_DIR !== undefined && { configDir: process.env.CLAUDE_CONFIG_DIR }) },
        { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env, signal: stop.signal },
      );
      return { success: code === 0, exitCode: code };
    } finally {
      process.off('SIGTERM', onSignal);
      process.off('SIGHUP', onSignal);
    }
  },
};

export default tuiCommand;
