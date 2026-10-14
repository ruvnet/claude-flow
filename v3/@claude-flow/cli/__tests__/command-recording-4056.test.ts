/**
 * #4056 — the PostToolUse Bash hook stored every command in full as
 * `commands/cmd-<ts>`: 27k rows / 285 MB on one project, full command text
 * (which can carry tokens), and no off switch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  commandRecordingDisabled,
  redactCommandForStorage,
  MAX_RECORDED_COMMAND_CHARS,
} from '../src/services/command-recording.js';

describe('commandRecordingDisabled', () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-rec-4056-')); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('is on by default', () => {
    expect(commandRecordingDisabled({}, cwd)).toBe(false);
  });

  it.each(['0', 'false', 'off', 'no', 'FALSE'])('CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=%s turns it off', v => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }, cwd)).toBe(true);
  });

  it.each(['1', 'true', 'on'])('CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=%s leaves it on', v => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }, cwd)).toBe(false);
  });

  it('honours CLAUDE_FLOW_HOOKS_ENABLED=false (written into generated settings but never read before)', () => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_ENABLED: 'false' }, cwd)).toBe(true);
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_ENABLED: 'true' }, cwd)).toBe(false);
  });

  it('honours hooks.recordCommands=false in claude-flow.config.json', () => {
    fs.writeFileSync(path.join(cwd, 'claude-flow.config.json'), JSON.stringify({ hooks: { recordCommands: false } }));
    expect(commandRecordingDisabled({}, cwd)).toBe(true);
  });

  it('honours hooks.recordCommands=false in .claude-flow/config.json', () => {
    fs.mkdirSync(path.join(cwd, '.claude-flow'));
    fs.writeFileSync(path.join(cwd, '.claude-flow', 'config.json'), JSON.stringify({ hooks: { recordCommands: false } }));
    expect(commandRecordingDisabled({}, cwd)).toBe(true);
  });

  it('a malformed config file does not turn recording off or throw', () => {
    fs.writeFileSync(path.join(cwd, 'claude-flow.config.json'), '{ not json');
    expect(commandRecordingDisabled({}, cwd)).toBe(false);
  });
});

describe('redactCommandForStorage', () => {
  const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const OAI = 'sk-' + 'proj-abcdefghijklmnopqrstuvwxyz0123456789';

  it('leaves an ordinary command alone', () => {
    expect(redactCommandForStorage('npm test -- --run src/foo.test.ts')).toBe('npm test -- --run src/foo.test.ts');
  });

  it.each([
    ['curl -H "Authorization: Bearer abc123def456ghi789" https://x.test', 'abc123def456ghi789'],
    ['curl -H "authorization: Basic dXNlcjpwYXNz" https://x.test', 'dXNlcjpwYXNz'],
    ['tool --password=hunter2hunter2 run', 'hunter2hunter2'],
    ['tool --token abcdef0123456789 run', 'abcdef0123456789'],
    ['tool --api-key "sekrit-value-123" run', 'sekrit-value-123'],
    ['NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123 npm publish', 'npm_abcdefghijklmnopqrstuvwxyz0123'],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    [`git clone https://${GH}@github.com/o/r.git`, GH],
    [`curl -s https://api.openai.com -d x -H "x-key: ${OAI}"`, OAI],
    ['psql postgres://admin:s3cretpass@db.internal/app', 's3cretpass'],
  ])('redacts the secret in: %s', (cmd, secret) => {
    const out = redactCommandForStorage(cmd);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('keeps the command name and flags so history is still useful', () => {
    const out = redactCommandForStorage('curl -H "Authorization: Bearer abc123def456ghi789" https://x.test/api');
    expect(out).toContain('curl');
    expect(out).toContain('https://x.test/api');
  });

  it('truncates a very long command and says so', () => {
    const out = redactCommandForStorage('echo ' + 'a'.repeat(MAX_RECORDED_COMMAND_CHARS * 3));
    expect(out.length).toBeLessThanOrEqual(MAX_RECORDED_COMMAND_CHARS + 32);
    expect(out).toMatch(/truncated/);
  });

  it('is linear on hostile input (no catastrophic backtracking)', () => {
    for (const hostile of [
      'x'.repeat(200_000),
      '--password '.repeat(20_000),
      'A=b '.repeat(50_000),
      'Authorization: '.repeat(20_000),
      '://'.repeat(60_000),
    ]) {
      const t0 = Date.now();
      redactCommandForStorage(hostile);
      expect(Date.now() - t0).toBeLessThan(500);
    }
  });
});
