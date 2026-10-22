import { runCodexHook, hookFailure } from '../../../scripts/lib/codex-mod-runtime.mjs'
import { newStats, STATUS_PATH, statusText } from './status'
import { answer } from './command'
import { verdict, watched } from './guard'

runCodexHook({ name: 'ruflo-sparc', writers: ['memory_store', 'agentdb_hierarchical-store', 'agentdb_pattern-store'], verdict, newStats, statusPath: STATUS_PATH, answer,
  statusText: (stats, now) => statusText(stats, { guard: true }, now),
  count: (stats, tool, input, reason) => { const label = watched(tool, input); if (label !== undefined) { stats.checked++; stats.seen[label] = (stats.seen[label] ?? 0) + 1; if (reason !== undefined) { stats.blocked++; stats.lastReason = reason.slice(0, 160); } } },
}).catch(() => hookFailure('ruflo-sparc'))
