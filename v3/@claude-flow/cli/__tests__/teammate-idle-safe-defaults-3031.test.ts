import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

type AgentTeamsSettings = {
  coordination: { autoAssignOnIdle: boolean };
  hooks: { teammateIdle: { autoAssign: boolean; checkTaskList: boolean } };
};

function agentTeams(settings: object): AgentTeamsSettings {
  return (settings as {
    claudeFlow: { agentTeams: AgentTeamsSettings };
  }).claudeFlow.agentTeams;
}

describe('#3031 teammate-idle assignment authority', () => {
  it('keeps generated idle assignment disabled by default', () => {
    const generated = agentTeams(generateSettings(DEFAULT_INIT_OPTIONS));

    expect(generated.coordination.autoAssignOnIdle).toBe(false);
    expect(generated.hooks.teammateIdle.autoAssign).toBe(false);
    expect(generated.hooks.teammateIdle.checkTaskList).toBe(true);
  });

  it('migrates the former upgrade defaults to notify-only behavior', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/init/executor.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/autoAssignOnIdle:\s*false/);
    expect(source).toMatch(/teammateIdle:\s*\{\s*enabled:\s*true,\s*autoAssign:\s*false/);
  });

  it('requires an explicit CLI opt-in before requesting auto-assignment', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/commands/hooks.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/name:\s*'auto-assign'[\s\S]*?default:\s*false/);
    expect(source).toContain('ctx.flags.autoAssign === true');
  });
});
