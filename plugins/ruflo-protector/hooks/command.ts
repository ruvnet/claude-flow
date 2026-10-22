import { maturity } from './baseline'
import type { Engine } from './engine'
import { asMode, MODES } from './options'
import { ruleById, RULES } from './rules'
import { hitsOf } from './rules'
import type { Ctx } from './rules'

const HELP = [
  '/protector status', '/protector list', '/protector rule <id> <off|notify|block>', '/protector mode <off|learn|notify|enforce>', '/protector run', '/protector replay',
  '/protector alerts [n]', '/protector ack <id>', '/protector unack <id>', '/protector allow <fp>', '/protector reset-baseline',
].join('\n')

export type Effects = { readonly persist: () => void; readonly now: number; readonly scan: () => string[] }

const line = (n: number, s: string) => `${s}${n === 1 ? '' : 's'}`

/** `/protector` is answered locally and takes no model turn; every verb in the ADR table lives here. */
export function answer(args: string, e: Engine, fx: Effects): string {
  const [verb = '', a = '', b = ''] = args.trim().split(/\s+/)

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const s = e.status()
    const m = maturity(e.baseline, fx.now)
    const c = s.alertCounts
    return [
      `Project Anatole · mode ${e.mode}${e.mode === 'learn' ? ' (says nothing, only learns)' : ''}${s.degraded ? ` · DEGRADED: ${s.degraded}` : ''}`,
      `baseline: ${m.mature ? 'mature' : `learning ${m.pct}%`} · ${e.baseline.events} events · ${e.baseline.sessions} ${line(e.baseline.sessions, 'session')}`,
      `alerts: ${c.open} open (critical ${c.critical}, high ${c.high}, medium ${c.medium}) of ${c.total} · blocked ${s.blocked}${s.suppressed ? ` · ${s.suppressed} held back by the rate limit` : ''}`,
      `rules: ${s.ruleCounts.total} (block ${s.ruleCounts.block}, notify ${s.ruleCounts.notify}, off ${s.ruleCounts.off}) · calls seen ${s.calls}`,
    ].join('\n')
  }

  if (verb === 'list') {
    return e.rows().map(r => `${r.rule.id}  ${r.rule.severity.padEnd(8)} ${r.mode.padEnd(6)} hits ${String(r.hits).padStart(3)} acked ${String(r.acked).padStart(3)}%  ${r.rule.owasp.join(',')}  ${r.rule.summary}${r.demoted ? '  [auto-demoted to notify]' : r.changed ? '  [changed from default]' : ''}`).join('\n')
  }

  if (verb === 'rule') {
    const id = a.toUpperCase()
    if (!ruleById(id) || !(b === 'off' || b === 'notify' || b === 'block')) return 'usage: /protector rule <PR-001..PR-013> <off|notify|block>'
    e.setRule(id, b)
    fx.persist()
    return `${id} is now ${b}${b === 'block' ? ' (it only denies in enforce mode)' : ''}.`
  }

  if (verb === 'mode') {
    const m = asMode(a)
    if (!m) return `usage: /protector mode <${MODES.join('|')}>`
    e.setMode(m)
    fx.persist()
    return `mode is now ${m}${m === 'enforce' ? '. Rules marked block will deny; everything else still only notifies. Try /protector replay first.' : ''}`
  }

  if (verb === 'alerts') {
    const n = Math.max(1, Math.min(50, Number(a) || 10))
    const rows = e.alerts.slice(-n).reverse()
    return rows.length ? rows.map(x => `${x.id}  ${x.state.padEnd(7)} ${x.severity.padEnd(8)} ${x.rule}  ${x.action}${x.count && x.count > 1 ? ` x${x.count}` : ''}  fp ${x.fp}  ${x.summary}`).join('\n') : 'No alerts.'
  }

  if (verb === 'ack' || verb === 'unack') {
    if (a === '') return `usage: /protector ${verb} <alert id>`
    const r = verb === 'ack' ? e.ack(a, fx.now) : e.unack(a)
    if (r === 'ok') fx.persist()
    return r === 'ok' ? (verb === 'ack' ? `${a} marked as a false positive; its fingerprint is allowed and the baseline learned it.` : `${a} reopened.`) : `No alert ${a}.`
  }

  if (verb === 'allow') {
    if (!/^[0-9a-f]{12}$/.test(a)) return 'usage: /protector allow <12-hex fingerprint> (it is in the alert and in the block reason)'
    e.addAllow(a, e.alerts.find(x => x.fp === a)?.rule ?? '', fx.now, 'allowed')
    fx.persist()
    return `${a} is allowed: that exact (rule, command head, host or area) no longer alerts or blocks.`
  }

  if (verb === 'reset-baseline') {
    e.resetBaseline()
    fx.persist()
    return 'Baseline forgotten. Project Anatole is learning again (rules still apply in notify and enforce).'
  }

  if (verb === 'run') {
    const found = fx.scan()
    return found.length ? `Configuration findings (${found.length}):\n${found.map(f => `- ${f}`).join('\n')}` : 'Configuration scan: nothing found in .claude/settings*.json.'
  }

  if (verb === 'replay') return replay(e, fx.now)

  return `Unknown: ${verb}\n${HELP}`
}

/** Re-score the recorded event ring against the current rules and baseline; says what would fire in notify and in enforce. */
function replay(e: Engine, now: number): string {
  const mature = maturity(e.baseline, now).mature
  let notify = 0
  let enforce = 0
  const by = new Map<string, number>()
  e.ring.forEach((ev, i) => {
    const c: Ctx = { baseline: e.baseline, mature, credRead: e.ring.slice(Math.max(0, i - 20), i + 1).some(x => x.flags.includes('cred-read')), promptWords: new Set(), calls1m: 0, spawns1m: 0 }
    const hits = hitsOf(ev, c).filter(r => e.modeOf(r) !== 'off')
    if (hits.length === 0) return
    notify++
    if (hits.some(r => e.modeOf(r) === 'block')) enforce++
    for (const r of hits) by.set(r.id, (by.get(r.id) ?? 0) + 1)
  })
  const detail = RULES.filter(r => by.has(r.id)).map(r => `${r.id} x${by.get(r.id)}`).join(', ')
  return `Replay of ${e.ring.length} recorded events (${mature ? 'mature' : 'immature'} baseline): ${notify} would notify, ${enforce} would be blocked in enforce${detail ? ` (${detail})` : ''}.`
}
