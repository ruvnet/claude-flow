import type { RenderElement } from 'claude-code'

import { isStale, NO_MODS, type ModRow } from '../data/mods'
import { plain } from '../data/parse'
import { isoOf } from '../data/safe'
import { roomOf } from '../room'
import { ago, clip, count, row, rule, text, THEME, type Ctx } from './common'

const SHOWN = 12

const REASON_WORDS: Record<string, string> = { 'secret': 'a secret or credential', 'destructive': 'a destructive command', 'path': 'a file path outside what is allowed', 'network': 'a network call', 'policy': 'a policy rule', 'other': 'a rule of its own' }

/** The detail block for one mod: every field its status file reported, as plain capped text; fields it did not report say so. */
export function modDetail(ctx: Ctx, mod: ModRow): RenderElement[] {
  const stale = isStale(mod, ctx.nowMs)
  const when = (ms: number | null | undefined) => (ms === null || ms === undefined ? 'not reported' : `${ago(ms, ctx.nowMs)} (${isoOf(ms)})`)
  const line = (label: string, value: string, color?: string) => text(ctx, `     ${label.padEnd(13)}${plain(value, Math.max(20, ctx.columns - 22))}`, color === undefined ? { dimColor: true } : { color })

  return [
    line('guards', mod.summary ?? 'no summary reported by this mod'),
    line('guard', mod.guard === null ? 'not reported' : mod.guard ? 'on' : 'off'),
    line('calls', mod.calls === null ? 'not reported' : count(mod.calls)),
    line('blocked', count(mod.blocked), mod.blocked > 0 ? THEME.warn : undefined),
    line('last refusal', mod.lastDenied === undefined ? (mod.blocked > 0 ? 'class not reported' : 'none') : `${mod.lastDenied}: it asked for ${REASON_WORDS[mod.lastDenied] ?? 'a rule of its own'}`),
    line('version', mod.modVersion ?? 'not reported'),
    line('session began', when(mod.startedMs)),
    line('last wrote', `${when(mod.updatedMs)}${stale ? ' · stale: an earlier session' : ''}`),
    line('file age', mod.fileMs === undefined ? 'not reported' : ago(mod.fileMs, ctx.nowMs)),
  ]
}

/**
 * The "Mods" section (ADR-446): one line per per-plugin mod that has written `.claude-flow/<short>-mod/status.json`: guard on or off, calls, blocked,
 * when it last wrote, a marker when that was an earlier session. Any mod that has blocked something leads. It reads the files; it never calls a mod.
 */
export function modsRows(ctx: Ctx): RenderElement[] {
  const { rows, refused, truncated } = ctx.state.snapshot?.mods ?? NO_MODS
  const open = roomOf(ctx.state).mod
  const blocked = rows.filter(mod => mod.blocked > 0).length
  const out: RenderElement[] = [rule(ctx, 'Mods', rows.length === 0 ? 'none reporting' : `${rows.length} reporting${blocked > 0 ? ` · ${blocked} blocked something` : ''}`)]

  if (rows.length === 0) {
    out.push(text(ctx, ' No mod has written a status file in this project yet. Each plugin mod reports here once a session has started with it.', { dimColor: true }))
  }

  for (const [i, mod] of rows.slice(0, SHOWN).entries()) {
    const stale = isStale(mod, ctx.nowMs)

    const isOpen = open === mod.name

    out.push(
      row(
        ctx,
        [
          ctx.kit.Button({ key: `mod-open-${mod.name}`, label: ` ${isOpen ? '▾' : '▸'} ${clip(mod.name, 22).padEnd(22)}`, plain: true, onPress: () => ctx.act.room.mod(mod.name) }),
          ctx.kit.Text({ color: mod.guard === true ? THEME.ok : undefined, dimColor: mod.guard !== true, children: ` guard ${mod.guard === null ? '–' : mod.guard ? 'on ' : 'off'}` }),
          ctx.kit.Text({ children: ` · calls ${mod.calls === null ? '–' : count(mod.calls)}` }),
          ctx.kit.Text({ color: mod.blocked > 0 ? THEME.warn : undefined, dimColor: mod.blocked === 0, children: ` · blocked ${count(mod.blocked)}` }),
          ctx.kit.Text({ dimColor: true, children: ` · ${mod.updatedMs === null ? 'never written' : ago(mod.updatedMs, ctx.nowMs)}${stale ? ' · stale (an earlier session)' : ''}` }),
        ],
        `mod-${i}-${mod.name}`,
      ),
    )

    if (isOpen) out.push(...modDetail(ctx, mod))
  }

  if (rows.length > SHOWN) out.push(text(ctx, ` +${rows.length - SHOWN} more mods reporting`, { dimColor: true }))
  if (truncated) out.push(text(ctx, ' more mod folders than the 60 the console reads; the rest are not shown', { dimColor: true }))
  if (refused > 0) out.push(text(ctx, ` ${refused} status file${refused === 1 ? '' : 's'} not shown: an unknown shape, too large, or unreadable`, { color: THEME.warn }))

  return out
}
