/**
 * Regression guard for #2677's stale-settings finding: every
 * `npx @claude-flow/cli@latest <subcommand>` in Claude settings has the same
 * cold-process cost, not only the historical `hooks` form.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { doctorCommand } from '../src/commands/doctor.js';
import { executeUpgrade } from '../src/init/executor.js';

type HealthCheck = { name: string; status: 'pass' | 'warn' | 'fail'; message: string };
type DoctorData = { results: HealthCheck[] };

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_HOME = process.env.HOME;
let workdir: string;

async function runStaleSettingsCheck(): Promise<HealthCheck> {
  const ctx = {
    flags: { component: 'stale-settings' },
    args: [],
    config: {},
  } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
  const result = await doctorCommand.action!(ctx);
  return (result.data as DoctorData).results[0];
}

function writeSettings(settings: unknown): void {
  mkdirSync(join(workdir, '.claude'), { recursive: true });
  writeFileSync(join(workdir, '.claude', 'settings.json'), JSON.stringify(settings));
}

describe('doctor #2677 — stale npx detection covers every subcommand', () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'doctor-2677-settings-'));
    process.chdir(workdir);
    // Keep the test isolated from a developer's real ~/.claude/settings.json.
    process.env.HOME = join(workdir, 'home');
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    rmSync(workdir, { recursive: true, force: true });
  });

  it.each(['memory store --namespace notifications', 'daemon start --quiet', 'swarm status'])(
    'fails on npx @latest %s',
    async (subcommand) => {
      writeSettings({
        hooks: {
          Notification: [{ hooks: [{ command: `npx @claude-flow/cli@latest ${subcommand}` }] }],
        },
      });
      const check = await runStaleSettingsCheck();
      expect(check.status).toBe('fail');
      expect(check.message).toContain('CRITICAL');
    },
  );

  it('does not flag the generated local helper command', async () => {
    writeSettings({
      statusLine: { command: 'node .claude/helpers/statusline.cjs' },
    });
    expect((await runStaleSettingsCheck()).status).toBe('pass');
  });

  it('upgrade removes sibling npx hooks and regenerates the statusline', async () => {
    writeSettings({
      statusLine: { command: 'npx @claude-flow/cli@latest memory retrieve --key status' },
      hooks: {
        Notification: [{
          hooks: [
            { command: 'npx @claude-flow/cli@latest memory store --namespace notifications' },
            { command: 'node custom-notification.cjs' },
          ],
        }],
        PreToolUse: [{
          hooks: [{ command: 'npx @claude-flow/cli@latest hooks pre-bash' }],
        }],
      },
    });

    const upgraded = await executeUpgrade(workdir, true);
    expect(upgraded.success).toBe(true);
    const settings = JSON.parse(readFileSync(join(workdir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.statusLine.command).toContain('.claude/helpers/statusline.cjs');
    const commands = Object.values(settings.hooks)
      .flatMap((groups: any) => groups.flatMap((group: any) => group.hooks ?? []))
      .map((hook: any) => hook.command)
      .filter(Boolean);
    expect(commands.some((command: string) => command.includes('@claude-flow/cli@latest'))).toBe(false);
    expect(commands).toContain('node custom-notification.cjs');
    expect(commands.some((command: string) => command.includes('hook-handler.cjs') && command.includes('pre-bash'))).toBe(true);
  });
});
