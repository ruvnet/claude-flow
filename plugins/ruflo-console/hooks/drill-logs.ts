import { plain } from './data/parse'
import type { Host } from './host'
import { CLI_PREFIXES, type State } from './state'

/** Reads an agent's last log lines for the drill-down (through the ruflo CLI, 30 s at most) and redraws when they arrive; a stale answer for another agent is dropped. */
export function readDrillLogs(state: State, host: Host, agentId: string, args: readonly string[]): void {
  void host
    .run([...CLI_PREFIXES[state.options.cli], ...args], 30_000)
    .then(result => {
      if (state.drill.agentId === agentId) state.drill = { agentId, logs: result.stdout.split('\n').map(line => plain(line, 160)).filter(Boolean).slice(-12), logsAtMs: Date.now() }
    })
    .catch(() => undefined)
    .finally(() => host.invalidate())
}
