import type { RenderElement } from 'claude-code'

import { sinceOf } from '../data/safe'
import { ago, count, kv, rule, text, THEME, type Ctx } from './common'

const PLUGIN = 'ruflo-agentdb'
/** A status file older than this was written by a session that has ended. */
const STALE_MS = 6 * 3_600_000

/**
 * The "AgentDB mod" section of the Memory page (ADR-445): whether the ruflo-agentdb mod is installed, what it is set to (recall into prompts,
 * the secret guard, the source), and what it has done: memories attached, skipped, cached, timed out, dropped as unsafe, writes refused.
 * It reads the mod's own status file; it never calls the mod.
 */
export function agentdbModRows(ctx: Ctx): RenderElement[] {
  const snap = ctx.state.snapshot
  const mod = snap?.agentdbMod ?? null
  const installed = snap?.plugins.installed?.find(plugin => plugin.name === PLUGIN)
  // A status file that is a link or not a regular file is refused, and the section says so rather than "no session yet" (#3817).
  const refused = mod === null && snap !== null && snap !== undefined && (snap.reads.agentdbMod === 'not-regular' || snap.reads.agentdbMod === 'refused')
  const rows: RenderElement[] = [rule(ctx, 'AgentDB mod', mod === null ? (refused ? 'status file refused' : installed === undefined ? 'not installed' : 'no session yet') : mod.recall ? 'recall on' : 'recall off')]

  if (refused) {
    rows.push(text(ctx, ' The mod status file (.claude-flow/agentdb-mod/status.json) is a link or not a regular file, or could not be read: it is not shown. Replace it with a plain file.', { dimColor: true }))

    return rows
  }

  if (mod === null) {
    rows.push(
      text(ctx, installed === undefined ? ' Install ruflo-agentdb (0.4+): safe recall of memory into prompts and a guard that keeps secrets out of memory. /plugin' : ` ruflo-agentdb ${installed.version} is installed; it reports here once a session has started with it (restart Claude Code after an update).`, { dimColor: true }),
    )

    return rows
  }

  // A time from before 2000 or more than a day ahead is not believed: n/a, never "100020735d ago" or "0s ago".
  const writtenMs = sinceOf(mod.updatedMs, ctx.nowMs)
  const stale = writtenMs !== undefined && ctx.nowMs - writtenMs > STALE_MS
  rows.push(kv(ctx, 'recall', mod.recall ? `on · ${mod.source}${mod.tool !== null ? ` · via ${mod.tool}` : ''}` : 'off (a plugin option: attaches the best few memories to each prompt as retrieved data)', mod.recall ? THEME.ok : undefined))
  rows.push(kv(ctx, 'secret guard', mod.guard ? 'on · memory writes holding a key, token or password are refused' : 'off', mod.guard ? THEME.ok : THEME.warn))
  rows.push(kv(ctx, 'attached', `${count(mod.attached)} · ${count(mod.cached)} from cache · ${count(mod.skipped)} skipped · ${count(mod.timedOut)} timed out${mod.lastMs === null ? '' : ` · last ${mod.lastMs} ms`}`))
  rows.push(kv(ctx, 'refused', `${count(mod.dropped)} memories dropped as unsafe · ${count(mod.blocked)} writes blocked${mod.errors > 0 ? ` · ${count(mod.errors)} errors` : ''}`, mod.dropped + mod.blocked > 0 ? THEME.warn : undefined))
  rows.push(text(ctx, ` written ${writtenMs === undefined ? 'n/a' : ago(writtenMs, ctx.nowMs)}${stale ? ' (an earlier session)' : ''} · /agentdb-mod status|recall|scan|recent`, { dimColor: true }))

  for (const item of mod.recent) {
    rows.push(text(ctx, `  ◆ ${item.snippet.slice(0, Math.max(20, ctx.columns - 30))} [${item.source}${item.score === null ? '' : ` ${item.score.toFixed(2)}`}]`, { color: THEME.info }))
  }

  return rows
}
