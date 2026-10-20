import type { RenderElement } from 'claude-code'

import { alertsOf } from '../data/alerts'
import type { MemoryStats } from '../data/cli'
import type { StartId } from '../starts'
import { brainStatusOf, BRAIN_REPO, statusLine as groundingLine } from '../grounding'
import { settingsOf } from '../settings'
import { controlRows, isControlActive } from './control'
import { optimizerRows } from './optimizer'
import { uniqueAgents } from '../data/swarm-status'
import { attentionOverviewRows } from './sessions'
import { onDisk, swarmFacts } from './swarm'
import { ago, button, col, count, kv, live, row, picture, rule, sourceLine, starts, text, THEME, type Ctx } from './common'

/** Each subsystem in one line: what it is, from where, as of when. Nothing on this view is estimated. */
export function overviewView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const snap = state.snapshot
  const version = live<string>(state.probes.get('version'))
  const memory = live<MemoryStats>(state.probes.get('memory'))
  const daemon = snap?.daemon ?? null
  const helpers = snap?.helpers ?? null
  const ruflo = state.ruflo.snapshot
  const loaded = state.mods.filter(mod => mod.isLoaded).length
  const refused = state.mods.length - loaded
  const swarm = snap?.swarm ?? null
  const rows: RenderElement[] = [...(isControlActive(ctx) ? [...controlRows(ctx), ...optimizerRows(ctx)] : [...optimizerRows(ctx), ...controlRows(ctx)]), rule(ctx, 'Subsystems', snap?.isRufloProject === false ? 'not a ruflo project' : '')]

  rows.push(kv(ctx, 'ruflo CLI', version !== null ? `v${version} (${state.options.cli})` : sourceLine(state.probes.get('version'), nowMs, 'n/a').text))
  rows.push(
    kv(
      ctx,
      'project',
      snap === null ? 'reading…' : snap.isRufloProject ? `ruflo state in ${state.cwd.split('/').slice(-2).join('/')}` : 'n/a — no .claude-flow here (see Get going below)',
      snap?.isRufloProject === true ? THEME.ok : undefined,
    ),
  )
  rows.push(
    kv(
      ctx,
      'daemon',
      daemon === null
        ? 'n/a — no daemon-state.json'
        : `${daemon.running ? 'running' : 'stopped'} per daemon-state.json (written ${ago(daemon.savedAtMs, nowMs)}) · ${daemon.workers.length} workers · ${count(daemon.workers.reduce((n, w) => n + w.runs, 0))} runs`,
      daemon?.running === true ? THEME.ok : undefined,
    ),
  )
  const mcp = state.rufloTools

  rows.push(
    kv(
      ctx,
      'MCP',
      mcp === null ? 'n/a' : mcp.tools > 0 ? `${mcp.servers.length} ruflo server${mcp.servers.length === 1 ? '' : 's'} connected (${mcp.servers.join(', ')}) · ${mcp.tools} tools callable now` : 'no ruflo MCP server connected in this session',
      mcp !== null && mcp.tools > 0 ? THEME.ok : undefined,
    ),
  )
  const brain = brainStatusOf(state)
  const groundingPrefs = settingsOf(state).ai

  rows.push(kv(ctx, 'Grounding', groundingLine(brain), brain === 'on' ? THEME.ok : undefined))

  if (brain === 'not-installed' && groundingPrefs.groundingHint && !groundingPrefs.groundingDismissed) {
    rows.push(text(ctx, `Optional: RuvNet Brain (third-party) can ground ruvnet-stack answers: ${BRAIN_REPO}. The console never installs it.`, { dimColor: true }))
    rows.push(row(ctx, [button(ctx, 'grounding-dismiss', 'Dismiss this hint', () => ctx.act.settings.ai({ groundingDismissed: true }))], 'grounding-dismiss-row'))
  }

  rows.push(kv(ctx, 'memory DB', memory !== null ? `${count(memory.total)} entries · ${count(memory.vectors)} vectors · ${memory.backend}${memory.storage !== undefined ? ` · ${memory.storage}` : ''}` : sourceLine(state.probes.get('memory'), nowMs, 'n/a').text))
  rows.push(
    kv(
      ctx,
      'helpers',
      helpers === null
        ? 'n/a — no .claude/helpers/helpers.manifest.json'
        : `manifest v${helpers.version} · ${helpers.files.length} files · ${helpers.isSigned ? `signed (${helpers.algorithm ?? 'unknown'})` : 'UNSIGNED'} · signature not checked here (ruflo verify)`,
      helpers !== null && !helpers.isSigned ? THEME.warn : undefined,
    ),
  )
  rows.push(
    kv(
      ctx,
      'ruflo-mods',
      ruflo !== null ? `seated · policy ${ruflo.policy} · routed ${ruflo.routed} · tightened ${ruflo.tightened} · owns ${ruflo.owned.join('+') || 'nothing'}` : 'not seated — classic hooks handle every event',
      ruflo !== null ? THEME.ok : undefined,
    ),
  )
  rows.push(kv(ctx, 'function hooks', `on (this mod runs) · mods seen since it loaded: ${loaded} loaded, ${refused} refused`, refused > 0 ? THEME.warn : THEME.ok))
  const modsSeen = snap?.mods?.rows ?? []
  const modsBlocked = modsSeen.filter(mod => mod.blocked > 0).length

  rows.push(kv(ctx, 'mods reporting', modsSeen.length === 0 ? 'none yet' : `${modsSeen.length}${modsBlocked > 0 ? ` · ${modsBlocked} blocked something` : ''}`, modsBlocked > 0 ? THEME.warn : undefined))
  rows.push(...attentionOverviewRows(ctx))
  rows.push(row(ctx, [button(ctx, 'overview-mods', 'The Room: Mods', () => ctx.act.view('room'))], 'overview-mods-row'))
  // The swarm's own count, never the agent store's: the store holds every agent ever spawned, so a 0-agent swarm once read "259 agents".
  const facts = swarm === null ? null : swarmFacts(swarm, nowMs, snap?.agents ?? [])
  const stored = uniqueAgents(snap?.agents ?? []).length

  rows.push(kv(ctx, 'swarm', swarm === null || facts === null ? 'n/a — no swarm on disk' : `${swarm.id} · ${swarm.topology} · ${swarm.status} · ${facts.text}${stored > 0 ? ` · ${onDisk(stored)}` : ''}`, facts?.isStale === true ? THEME.warn : undefined))

  // What is missing here, each with the button that adds it, most basic first.
  const missing: StartId[] = []

  if (snap !== null && !snap.isRufloProject) missing.push('init')
  if (snap?.isRufloProject === true && snap.daemon?.running !== true) missing.push('daemon')
  if (snap?.isRufloProject === true && swarm === null) missing.push('swarm')
  if (snap?.isRufloProject === true && snap.hive === null) missing.push('hive')
  if (missing.length > 0) {
    rows.push(rule(ctx, 'Get going', 'one click each: it asks, shows the command, then runs it'))
    rows.push(starts(ctx, snap?.isRufloProject === true ? 'Not running yet in this project:' : 'No ruflo state in this project.', missing))
  }

  const alerts = alertsOf(state, nowMs, state.loadedAtMs)

  rows.push(rule(ctx, 'Health', alerts.length === 0 ? 'no alerts' : `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`))

  for (const alert of alerts.slice(0, 5)) {
    rows.push(text(ctx, `${alert.level === 'bad' ? '✖' : alert.level === 'warn' ? '▲' : '●'} ${alert.text} — ${alert.fix}`, { color: alert.level === 'bad' ? THEME.bad : alert.level === 'warn' ? THEME.warn : THEME.info }))
  }

  if (alerts.length > 5) rows.push(text(ctx, `+${alerts.length - 5} more · approvals (q) lists what needs a decision`, { dimColor: true }))

  rows.push(rule(ctx, 'Activity', 'measured'))
  rows.push(picture(ctx, 'activity', `tool calls/5s: ${state.activity.slice(-12).join(' ') || 'none yet'}`))
  rows.push(text(ctx, 'tool calls the console saw (5 s buckets) and ruflo files changed between reads; the glow is decoration', { dimColor: true }))

  return col(ctx, rows, 'overview')
}
