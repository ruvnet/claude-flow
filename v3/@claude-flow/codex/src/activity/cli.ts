import { Command, InvalidArgumentError } from 'commander';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { emitKeypressEvents, type Key } from 'node:readline';
import { ActivityViewer } from './viewer.js';
import { sanitize } from './sanitize.js';

export function createActivityCommand(): Command {
  return new Command('activity')
    .description('Inspect helpers from an existing Codex session (read-only)')
    .requiredOption('--session-file <file>', 'Parent CLI rollout JSONL file')
    .requiredOption('--sessions-dir <directory>', 'Directory containing parent and helper rollouts')
    .option('--agent <id>', 'Open a particular helper thread ID')
    .option('--once', 'Print one bounded snapshot and exit (no interactive terminal needed)')
    .option('--interval <seconds>', 'Refresh interval, 0.2 to 60 seconds', interval, 2)
    .action(async (options: { sessionFile: string; sessionsDir: string; agent?: string; once?: boolean; interval: number }) => {
      try {
        const root = await realpath(path.resolve(options.sessionsDir));
        // Canonicalize the directory only. A selected file through a symlink is rejected.
        const file = path.resolve(root, path.relative(path.resolve(options.sessionsDir), path.resolve(options.sessionFile)));
        const viewer = new ActivityViewer(root, file);
        await viewer.refresh();
        if (viewer.list.error) throw new Error(viewer.list.error);
        if (options.agent) {
          if (!viewer.list.helpers.some(item => item.id === options.agent)) throw new Error('Agent is not an attributable helper of this session.');
          viewer.selected = options.agent;
          viewer.detail = true;
          await viewer.refresh();
        }
        if (options.once) console.log(viewer.render(100, 200));
        else await runTerminal(viewer, options.interval * 1000);
      } catch (error) {
        console.error(`Activity viewer: ${sanitize(error instanceof Error ? error.message : 'Unable to read session.', 300)}`);
        process.exitCode = 1;
      }
    });
}

function interval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.2 || parsed > 60) throw new InvalidArgumentError('Choose 0.2 to 60 seconds.');
  return parsed;
}

async function runTerminal(viewer: ActivityViewer, intervalMs: number): Promise<void> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY) throw new Error('Use --once when input or output is not a terminal.');
  const wasRaw = input.isRaw;
  let stopped = false;
  let busy = false;
  let finish: () => void = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  const draw = (): void => {
    if (!stopped) output.write(`\x1b[H\x1b[2J${viewer.render(output.columns || 80, output.rows || 24)}`);
  };
  const close = (): void => { stopped = true; finish(); };
  const update = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try { await viewer.refresh(); draw(); }
    catch { close(); process.exitCode = 1; }
    finally { busy = false; }
  };
  const keypress = (text: string, key: Key): void => {
    if (key?.name === 'q' || key?.ctrl && key.name === 'c') { close(); return; }
    viewer.key(text === 'G' ? 'G' : key?.name ?? text);
    draw();
    if (key?.name === 'return') void update();
  };
  emitKeypressEvents(input);
  const timer = setInterval(() => { void update(); }, intervalMs);
  try {
    input.setRawMode(true);
    input.resume();
    input.on('keypress', keypress);
    output.on('resize', draw);
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
    output.write('\x1b[?1049h\x1b[?25l');
    draw();
    await done;
  } finally {
    stopped = true;
    clearInterval(timer);
    input.off('keypress', keypress);
    output.off('resize', draw);
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
    input.setRawMode(wasRaw);
    // This command owns stdin. A resumed stream would keep Node alive after q.
    input.pause();
    output.write('\x1b[?25h\x1b[?1049l');
  }
}
