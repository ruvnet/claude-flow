/**
 * The `ruos` status segment text (ADR-405), derived from the plugin's own
 * `.claude-flow/ruos/hosts.json` snapshot. Pure: no `$`, so it is tested
 * directly. Text is untrusted on both sides; ruflo-mods also sanitises.
 */

export const HOSTS_PATH = '.claude-flow/ruos/hosts.json'
/** ruflo-mods renders at most 48 characters per segment. */
export const SEGMENT_MAX = 48

type Host = { name?: unknown; agents?: unknown }

/** Control and bidi-override characters never reach the status line. */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '').trim()

/**
 * `ruOS 2 agents · Work Desktop` (+N more hosts), or null when no ruflo
 * agent is placed on a ruOS desktop (null clears the segment).
 */
export function segmentText(hostsJson: string | undefined): string | null {
  if (!hostsJson) return null
  let hosts: Host[]
  try {
    const parsed = JSON.parse(hostsJson) as { hosts?: unknown }
    hosts = Array.isArray(parsed.hosts) ? (parsed.hosts as Host[]).slice(0, 200) : []
  } catch {
    return null
  }
  const busy = hosts
    .map(h => ({ name: typeof h.name === 'string' ? clean(h.name) : '', agents: Array.isArray(h.agents) ? h.agents.length : 0 }))
    .filter(h => h.agents > 0)
  if (busy.length === 0) return null
  const total = busy.reduce((n, h) => n + h.agents, 0)
  const head = `ruOS ${total} agent${total === 1 ? '' : 's'} · ${busy[0]?.name || 'desktop'}`
  const text = busy.length > 1 ? `${head} +${busy.length - 1}` : head
  return text.length > SEGMENT_MAX ? `${text.slice(0, SEGMENT_MAX - 1)}…` : text
}
