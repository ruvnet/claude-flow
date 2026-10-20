/**
 * Claude Code host (native spawn via the Task tool). Back-compat path; the
 * spawn plan comes from the team bus store.
 */

import { readStopIdentity } from './identity.js';
import type { NativeHostAdapter } from './types.js';

export const claudeAdapter: NativeHostAdapter = {
  id: 'claude',
  kind: 'native',
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    return readStopIdentity(
      payload,
      ['subagentName', 'agentName', 'agent', 'agent_type', 'description', 'toolInput.description'],
      env.SUBAGENT_NAME,
    );
  },
};
