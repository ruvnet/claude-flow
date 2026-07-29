import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STATE_FILE,
  validateConfiguredTaskSources,
  validateTaskSources,
} from '../src/autopilot-state.js';
import { autopilotCommand } from '../src/commands/autopilot.js';
import { CommandParser } from '../src/parser.js';

describe('autopilot task-source validation', () => {
  it('keeps recovery defaults for absent persisted state', () => {
    expect(validateTaskSources(undefined)).toEqual([
      'team-tasks',
      'swarm-tasks',
      'file-checklist',
    ]);
  });

  it('rejects an unsupported explicit source instead of enabling defaults', () => {
    expect(validateConfiguredTaskSources(['issues'])).toEqual({
      valid: false,
      invalidSources: ['issues'],
      reason: 'Unsupported task source(s): issues',
    });
  });

  it('rejects a mixed configuration instead of silently dropping invalid entries', () => {
    expect(validateConfiguredTaskSources(['swarm-tasks', 'issues'])).toEqual({
      valid: false,
      invalidSources: ['issues'],
      reason: 'Unsupported task source(s): issues',
    });
  });

  it('normalizes and deduplicates valid explicit sources', () => {
    expect(validateConfiguredTaskSources([' swarm-tasks ', 'file-checklist', 'swarm-tasks'])).toEqual({
      valid: true,
      sources: ['swarm-tasks', 'file-checklist'],
    });
  });

  it('rejects an empty explicit source list', () => {
    expect(validateConfiguredTaskSources([])).toMatchObject({
      valid: false,
      reason: 'At least one task source is required',
    });
  });

  it('rejects the parser-normalized CLI flag without persisting fallback defaults', async () => {
    const parser = new CommandParser();
    parser.registerCommand(autopilotCommand);
    const parsed = parser.parse(['autopilot', 'config', '--task-sources', 'issues']);
    expect(parsed.flags.taskSources).toBe('issues');

    const config = autopilotCommand.subcommands?.find(command => command.name === 'config');
    expect(config?.action).toBeDefined();

    const projectRoot = mkdtempSync(join(tmpdir(), 'ruflo-autopilot-invalid-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      const result = await config!.action!({
        args: parsed.positional,
        flags: parsed.flags,
        cwd: projectRoot,
        interactive: false,
      });
      expect(result).toMatchObject({ success: false, exitCode: 1 });
      expect(existsSync(STATE_FILE)).toBe(false);
    } finally {
      process.chdir(previousCwd);
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists valid parser-normalized sources and max-iterations', async () => {
    const parser = new CommandParser();
    parser.registerCommand(autopilotCommand);
    const parsed = parser.parse([
      'autopilot',
      'config',
      '--task-sources',
      'swarm-tasks,file-checklist',
      '--max-iterations',
      '77',
    ]);
    expect(parsed.flags).toMatchObject({
      taskSources: 'swarm-tasks,file-checklist',
      maxIterations: 77,
    });

    const config = autopilotCommand.subcommands?.find(command => command.name === 'config');
    const projectRoot = mkdtempSync(join(tmpdir(), 'ruflo-autopilot-valid-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      const result = await config!.action!({
        args: parsed.positional,
        flags: parsed.flags,
        cwd: projectRoot,
        interactive: false,
      });
      expect(result).toMatchObject({ success: true });
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      expect(state.taskSources).toEqual(['swarm-tasks', 'file-checklist']);
      expect(state.maxIterations).toBe(77);
    } finally {
      process.chdir(previousCwd);
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
