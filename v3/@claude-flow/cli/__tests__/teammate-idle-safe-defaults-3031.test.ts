import { describe, expect, it } from 'vitest';
import { generateSettings } from '../src/init/settings-generator.js';
import { mergeSettingsForUpgrade } from '../src/init/executor.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import { hooksCommand } from '../src/commands/hooks.js';

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

  it('migrates the former unsafe generated default to notify-only behavior', () => {
    const upgraded = agentTeams(mergeSettingsForUpgrade({
      claudeFlow: {
        agentTeams: {
          coordination: { autoAssignOnIdle: true },
          hooks: { teammateIdle: { autoAssign: true, checkTaskList: true } },
        },
      },
    }));

    expect(upgraded.coordination.autoAssignOnIdle).toBe(false);
    expect(upgraded.hooks.teammateIdle.autoAssign).toBe(false);
  });

  it('requires an explicit CLI opt-in before requesting auto-assignment', () => {
    const command = hooksCommand.subcommands?.find(({ name }) => name === 'teammate-idle');
    const option = command?.options?.find(({ name }) => name === 'auto-assign');

    expect(option?.default).toBe(false);
  });
});
