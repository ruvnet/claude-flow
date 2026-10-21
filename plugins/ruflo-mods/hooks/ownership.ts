/**
 * Which classic hook-handler events this mod takes over, so no event fires
 * twice (ADR-404, "One owner per event").
 *
 * The mod owns an event when no classic hook for it is configured, or when the
 * configured hook-handler.cjs honours the handshake: the mod sets
 * `RUFLO_MODS_OWNS` in the process environment, every settings hook started
 * after inherits it, and hook-handler.cjs returns early for an event named
 * there. A helper too old to know the handshake would run anyway, so the mod
 * stands down for that event and the classic hook keeps it.
 *
 * Only side-effect events are ever owned. `pre-bash` is a guard: the mod's
 * `tool.check` and the classic hook both refuse the same commands, a second
 * refusal changes nothing, and a forged handshake must never switch a guard
 * off. Session restore and end stay classic (intelligence init/consolidate
 * need Node).
 */

export const OWNABLE = ['route', 'post-edit'] as const
export type Ownable = (typeof OWNABLE)[number]

/** The marker hook-handler.cjs carries when it honours the handshake. */
export const HANDSHAKE_MARKER = 'RUFLO_MODS_OWNS'

type HookEntry = { readonly command?: unknown }
type HookGroup = { readonly hooks?: readonly HookEntry[] }

/** Which classic event and hook-handler subcommand carries each ownable. */
const CLASSIC: Record<Ownable, { readonly event: string; readonly subcommand: string }> = {
  route: { event: 'UserPromptSubmit', subcommand: 'route' },
  'post-edit': { event: 'PostToolUse', subcommand: 'post-edit' },
}

function commandsOf(settings: unknown, event: string): string[] {
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks
  const groups = hooks?.[event]
  if (!Array.isArray(groups)) return []
  return (groups as HookGroup[]).flatMap(g =>
    Array.isArray(g?.hooks) ? g.hooks.map(h => h?.command).filter((c): c is string => typeof c === 'string') : [],
  )
}

/** Whether settings run hook-handler.cjs with this subcommand on this event. */
export function classicConfigured(settings: unknown, ownable: Ownable): boolean {
  const { event, subcommand } = CLASSIC[ownable]
  // `.cjs route`, `.cjs" route` (POSIX) and `.cjs\" route` (Windows cmd /c).
  const word = new RegExp(`hook-handler\\.c?js\\\\?["']?\\s+${subcommand}(?![\\w-])`)
  return commandsOf(settings, event).some(c => word.test(c))
}

/**
 * Whether settings run the CLI's own `hooks route` / `hooks post-edit` on this event: the form `ruflo init` wrote before
 * hook-handler.cjs (e.g. `npx claude-flow@v3alpha hooks route --task "$PROMPT"`). That command never reads the handshake,
 * so the mod must stand down for it whatever the helper does.
 */
export function legacyCliConfigured(settings: unknown, ownable: Ownable): boolean {
  const { event, subcommand } = CLASSIC[ownable]
  const word = new RegExp(`(?:^|[\\s/"'])(?:@claude-flow/cli|claude-flow|ruflo)(?:@[\\w.-]+)?["']?\\s+hooks\\s+${subcommand}(?![\\w-])`)
  return commandsOf(settings, event).some(c => word.test(c))
}

/**
 * The events the mod owns this session.
 *
 * @param settings the merged settings (`$.settings.read()`)
 * @param helperHonours whether the hook-handler.cjs the hooks run carries the marker
 */
export function ownedEvents(settings: unknown, helperHonours: boolean): Ownable[] {
  return OWNABLE.filter(o => !legacyCliConfigured(settings, o) && (!classicConfigured(settings, o) || helperHonours))
}
