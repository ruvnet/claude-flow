/** Project Anatole's status file (ADR-453 section 8); written by ruflo-protector, read here as a courtesy. */
export const PROTECTOR_STATUS = '.claude-flow/protector-mod/status.json'

const MODES: ReadonlySet<string> = new Set(['off', 'learn', 'notify', 'enforce'])
export const MAX_BYTES = 64 * 1024
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 999_999) : undefined)

/**
 * The one `protector:` row of `/ruflo-mods`, or undefined when the file is absent, foreign or malformed. Only the mode (an enum) and
 * counts are shown: no text from the file reaches the report. The file is reported by the mod and not authenticated; it never decides anything.
 */
export function protectorLine(text: string): string | undefined {
  if (text.length > MAX_BYTES) return undefined
  try {
    const o = JSON.parse(text) as { schemaVersion?: unknown; name?: unknown; mode?: unknown; blocked?: unknown; alerts?: { open?: unknown }; degraded?: unknown }
    if (o.schemaVersion !== 1 || o.name !== 'protector' || typeof o.mode !== 'string' || !MODES.has(o.mode)) return undefined
    const open = count(o.alerts?.open)
    const blocked = count(o.blocked)
    if (open === undefined || blocked === undefined) return undefined
    return `  protector:   Project Anatole ${o.mode} · ${open} open alert${open === 1 ? '' : 's'} · ${blocked} blocked${o.degraded ? ' · degraded' : ''} (reported by the mod, unauthenticated)`
  } catch {
    return undefined
  }
}
