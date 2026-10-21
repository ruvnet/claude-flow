/**
 * `ruflo tui` — the ruflo console in a terminal of its own (ADR-489).
 *
 * Runs the same views the Claude Code mod (plugins/ruflo-console) draws, over a Node host instead of the mod host. Read-only in
 * the pages: Overview, Cost, Swarm, Events and Missions are read-only; AI (key 6) asks Codex (read-only, the pinned 0.162.0) or OpenRouter
 * (https, openrouter.ai or a convoTargets host), and every question shows a card first. The bundle is built from the plugin's source (scripts/build-tui.mjs) and loaded from this
 * CLI's OWN install only (never from the working directory: opening a repository must not run code that repository supplies).
 * No bundle is a message and exit 1, never a crash; ruflo stays operational without it. Without a terminal (a pipe, CI) the live view cannot run:
 * a one-line hint and exit 2, unless --plain asks for one frame as plain text and exit 0 (ADR-489 decision E).
 *
 *   npx ruflo tui                 # interactive, in a terminal (mouse on: click a page in the bar, scroll with the wheel)
 *   npx ruflo tui --no-mouse      # keyboard only, if SGR mouse reporting fights your terminal's text selection
 *   npx ruflo tui --view swarm    # start on the Swarm page (keys 1-6 or o c s e m a switch pages)
 *   npx ruflo tui --plain | head  # one plain frame, exit 0 (scripts, CI)
 *   npx ruflo tui | cat           # not a terminal and no --plain: a hint on stderr, exit 2
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { ownPluginDirs } from '../plugins/own-install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VIEWS = ['overview', 'cost', 'swarm', 'events', 'missions', 'ai'] as const;

type TuiModule = { runTui: (options: Record<string, unknown>, io: Record<string, unknown>) => Promise<number>; isTuiView: (value: unknown) => boolean; isPage?: (value: unknown) => boolean };

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

/** The look and motion flags: `--look bbs|orbital|plain` (default bbs, as in the console), `--fps N` (0-30, default 8; 0 draws pictures still), `--no-anim`, `--no-pictures`. A bad value is ignored, never passed on. */
export function lookFlags(flags: Record<string, unknown> | undefined): { look?: string; fps?: number; anim?: boolean; pictures?: boolean; boot?: boolean; mouse?: boolean } {
  const look = flags?.look;
  const fps = flags?.fps;
  const number = typeof fps === 'number' ? fps : typeof fps === 'string' && /^\d{1,2}$/.test(fps) ? Number(fps) : undefined;

  return {
    ...(look === 'bbs' || look === 'orbital' || look === 'plain' ? { look } : {}),
    ...(number !== undefined && Number.isFinite(number) && number >= 0 && number <= 30 ? { fps: Math.floor(number) } : {}),
    ...(flags?.anim === false ? { anim: false } : {}),
    ...(flags?.pictures === false ? { pictures: false } : {}),
    ...(flags?.boot === true ? { boot: true } : {}),
    // Mouse defaults ON at the CLI layer (the runTui library itself still defaults off, unchanged for other
    // callers/tests): only --no-mouse turns it off. The CLI must say so explicitly either way rather than
    // omit the key, since (unlike anim/pictures) the CLI's default disagrees with the library's own default.
    ...{ mouse: flags?.mouse !== false },
  };
}

/** The AI page's settings from the flags (and one environment variable for the endpoint list). Absent flags leave the defaults; a bad number is ignored, never passed on. */
export function aiPage(flags: Record<string, unknown> | undefined): { model?: string; maxSpendUsd?: number; convoTargets?: string } {
  const model = typeof flags?.model === 'string' && flags.model !== '' ? flags.model : undefined;
  const cap = flags?.maxSpendUsd ?? flags?.['max-spend-usd'];
  const maxSpendUsd = typeof cap === 'number' && Number.isFinite(cap) && cap >= 0 ? cap : typeof cap === 'string' && /^\d+(\.\d+)?$/.test(cap) ? Number(cap) : undefined;
  const targets = flags?.convoTargets ?? flags?.['convo-targets'] ?? process.env.RUFLO_TUI_CONVO_TARGETS;

  return { ...(model !== undefined && { model }), ...(maxSpendUsd !== undefined && { maxSpendUsd }), ...(typeof targets === 'string' && targets !== '' && { convoTargets: targets.slice(0, 2000) }) };
}

export const tuiCommand: Command = {
  name: 'tui',
  description: 'The ruflo console in your terminal: Overview, Cost, Swarm, Events, Missions (read-only) and an AI page that asks Codex or OpenRouter, each question after a card.',
  options: [
    { name: 'view', description: `Page to open: ${VIEWS.join(' | ')}, or any console view (menu, federation, settings, ...): 0 opens the menu and : goes to a page by name`, type: 'string' as const, default: 'overview' },
    { name: 'ai', description: 'The AI page (ask Codex read-only or OpenRouter, each question after a confirm card). --no-ai turns it off', type: 'boolean' as const, default: true },
    { name: 'model', description: 'OpenRouter model for this session (default openrouter/auto)', type: 'string' as const },
    { name: 'max-spend-usd', description: 'Stop sending to OpenRouter once the provider-reported spend reaches this (default 0.5)', type: 'number' as const },
    { name: 'convo-targets', description: 'Extra OpenAI-compatible endpoints, the console convoTargets syntax: endpoint:<name>=<https-base-url>|<KEY_ENV>|<model>;... (a key is named by its environment variable). Also RUFLO_TUI_CONVO_TARGETS', type: 'string' as const },
    { name: 'look', description: 'The console look: bbs (default, as in Claude Code) | orbital | plain. Key t cycles them', type: 'string' as const },
    { name: 'fps', description: 'Frames per second for moving pictures, 0-30 (default 8; 0 draws every picture still)', type: 'number' as const },
    { name: 'anim', description: 'Animate the pictures. --no-anim draws them still', type: 'boolean' as const, default: true },
    { name: 'pictures', description: 'Draw the pictures of the console (title art, swarm graph, gauges). --no-pictures shows their words only', type: 'boolean' as const, default: true },
    { name: 'mouse', description: 'Read mouse reports: click a page in the bar, scroll with the wheel (every action also has a key). On by default; --no-mouse turns it off if SGR reporting fights your terminal\'s text selection', type: 'boolean' as const, default: true },
    { name: 'boot', description: 'Play the look\'s start-up screen first (as the console\'s boot setting)', type: 'boolean' as const, default: false },
    { name: 'plain', description: 'Print one frame as plain text and exit 0 (scripts and CI). Without it, a non-terminal gets a hint and exit 2', type: 'boolean' as const, default: false },
  ],
  examples: [
    { command: 'npx ruflo tui', description: 'Open the console in this terminal (mouse on: click a page in the bar, scroll with the wheel)' },
    { command: 'npx ruflo tui --no-mouse', description: 'Keyboard only, if SGR mouse reporting fights your terminal\'s text selection' },
    { command: 'npx ruflo tui --view swarm', description: 'Start on the Swarm page (keys 1-6 switch pages, tab cycles, q quits)' },
    { command: 'npx ruflo tui --view ai --model openai/gpt-4o-mini --max-spend-usd 0.1', description: 'The AI page on a cheap OpenRouter model, stopping at $0.10 reported (key in $OPENROUTER_API_KEY, never shown)' },
    { command: 'npx ruflo tui --plain | head -40', description: 'One plain frame, exit 0: for scripts and CI (no terminal needed)' },
  ],
  async action(context: CommandContext): Promise<CommandResult> {
    const ctx = context as { args?: string[]; flags?: Record<string, unknown>; cwd?: string };
    const wanted = (ctx.flags?.view as string | undefined) ?? ctx.args?.find(arg => !arg.startsWith('-')) ?? 'overview';

    // The six pages are known here; any other console view (menu, federation, settings, …) is checked against the bundle's own list once it is loaded.
    const isKnown = (VIEWS as readonly string[]).includes(wanted);

    if (!isKnown && !/^[a-z]{2,16}$/.test(wanted)) {
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

    if (!isKnown && mod.isPage?.(wanted) !== true) {
      output.writeln(output.error(`tui: unknown view "${String(wanted).slice(0, 40)}". Use one of: ${VIEWS.join(', ')}, or any console view such as menu, federation, settings`));
      return { success: false, exitCode: 2, data: { error: 'unknown-view' } };
    }

    const stop = new AbortController();
    const onSignal = () => stop.abort();
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);

    try {
      const code = await mod.runTui(
        { cwd: ctx.cwd ?? process.cwd(), view: wanted, ...lookFlags(ctx.flags), ...(ctx.flags?.plain === true && { plain: true }), ...(ctx.flags?.ai !== false && { aiPage: aiPage(ctx.flags) }), ...(cliEntry() !== undefined && { cliEntry: cliEntry() }), ...(process.env.CLAUDE_CONFIG_DIR !== undefined && { configDir: process.env.CLAUDE_CONFIG_DIR }) },
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
