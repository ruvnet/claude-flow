import { runCodexHook, hookFailure } from '../../../scripts/lib/codex-mod-runtime.mjs'
import { newStats, STATUS_PATH, statusText } from './status'
import { answer } from './command'
import { verdict } from './guard'

runCodexHook({ name: 'ruflo-ddd', writers: ['memory_store', 'agentdb_hierarchical-store'], verdict, newStats, statusPath: STATUS_PATH, answer,
  statusText: (stats, now) => statusText(stats, true, now),
  count: (stats, tool, input, reason) => { if (reason !== undefined) stats.blocked++; },
}).catch(() => hookFailure('ruflo-ddd'))
