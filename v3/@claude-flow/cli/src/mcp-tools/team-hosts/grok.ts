/**
 * Grok Build host (native spawn via spawn_subagent). The spawn plan comes
 * from the team bus store; this adapter reads the SubagentStop payload,
 * whose description is `<role>:<agent>@<team>`.
 */

import { readStopIdentity } from './identity.js';
import type { NativeHostAdapter } from './types.js';

export const grokAdapter: NativeHostAdapter = {
  id: 'grok',
  kind: 'native',
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    return readStopIdentity(
      payload,
      ['subagentName', 'agentName', 'agent', 'description', 'toolInput.description'],
      env.SUBAGENT_NAME,
    );
  },
};
