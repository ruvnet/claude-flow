// Worker for scripts/probe-mod-guards.mjs: loads one bundled guard, finds the tool/input shapes it actually bites on
// ("calibration"), then streams one result per probe to the parent. Runs in a worker thread so the parent can kill a hung regex.
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { ALL_SECRETS, BENIGN, SECRET_TYPES, evasionProbes, stressProbes } from './guard-probe-corpus.mjs'

const { bundle, tools, servers, extra, fast, skip, budgetMs, advisoryMs } = workerData
const done = new Set(skip)
const send = m => parentPort.postMessage(m)

const mod = await import(pathToFileURL(bundle).href)
const verdictFn = mod.guard?.verdict
if (typeof verdictFn !== 'function') {
  send({ type: 'fatal', error: 'guard.ts exports no verdict()' })
  process.exit(0)
}
const opts0 = (() => { try { return mod.options?.readOptions?.({}) ?? { guard: true } } catch { return { guard: true } } })()

const call = (tool, input) => {
  const stats = (() => { try { return mod.status?.newStats?.() ?? {} } catch { return {} } })()
  const t0 = performance.now()
  try {
    return { v: verdictFn(tool, input, { ...opts0 }, stats), ms: performance.now() - t0 }
  } catch (e) {
    return { err: `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 80)}`, ms: performance.now() - t0 }
  }
}
const refused = r => r.err === undefined && r.v !== undefined && r.v !== null && r.v !== 'pass' && r.v !== false

const FIELDS = ['value', 'content', 'text', 'message', 'command', 'script', 'args', 'data', 'description', 'query', 'prompt', 'body', 'url', 'title']
const NAMESPACES = [undefined, 'adr', 'docs', 'document', 'federation', 'patterns', 'pattern', 'market-data', 'learning', 'agent', 'goals', 'trading', 'cost-tracking', 'observability', 'migrations', 'rvf', 'sparc', 'tests', 'security', 'knowledge-graph', 'workflows', 'iot-devices', 'ddd-model', 'music']
const base = ns => ({ action: 'create', ...(ns === undefined ? {} : { namespace: ns, key: ns }) })
const superInput = (ns, p) => ({ ...base(ns), ...Object.fromEntries(FIELDS.map(f => [f, p])), input: Object.fromEntries(FIELDS.map(f => [f, p])) })
const carriers = ns => [
  ...FIELDS.map(f => ({ field: f, make: p => ({ ...base(ns), [f]: p }) })),
  ...['value', 'content', 'text', 'command'].map(f => ({ field: `input.${f}`, make: p => ({ ...base(ns), input: { [f]: p } }) })),
]

const forms = (() => {
  const out = []
  for (const t of tools) {
    out.push(t, `mcp__plugin_ruflo-core_ruflo__${t}`)
    for (const s of servers) out.push(`mcp__${s}__${t}`)
  }
  return [...new Set(out)]
})()

/** Every (tool, namespace, field) the guard refuses a secret on while letting benign text through. */
function calibrate() {
  const found = []
  const pool = [...forms.map(tool => ({ tool })), ...extra.map(e => ({ tool: e.tool, fixed: e }))]
  for (const { tool, fixed } of pool) {
    for (const ns of fixed ? [fixed.namespace] : NAMESPACES) {
      if (!refused(call(tool, superInput(ns, ALL_SECRETS)))) continue
      for (const c of carriers(ns)) {
        if (!refused(call(tool, c.make(ALL_SECRETS)))) continue
        if (BENIGN.some(b => refused(call(tool, c.make(b))))) continue
        const types = Object.keys(SECRET_TYPES).filter(t => refused(call(tool, c.make(SECRET_TYPES[t]()))))
        if (types.length > 0) found.push({ tool, ns, field: c.field, types, make: c.make })
      }
    }
  }
  return found
}

const pairs = calibrate()
const bareOf = t => (t.startsWith('mcp__') ? t.slice(t.lastIndexOf('__') + 2) : t)
const chosen = []
for (const p of pairs) if (chosen.length < 3 && !chosen.some(c => bareOf(c.tool) === bareOf(p.tool))) chosen.push(p)
const describe = p => `${bareOf(p.tool)}${p.ns ? `[${p.ns}]` : ''}.${p.field}`

// Timing/crash targets: the calibrated shapes (one field each, so a legitimate linear scan is not multiplied), else every
// (tool, namespace) pair with the payload in every field at once.
const timing = pairs.length > 0
  ? pairs.slice(0, 24).map(p => ({ tool: p.tool, ns: p.ns, make: p.make }))
  : [...new Set(forms)].flatMap(tool => NAMESPACES.map(ns => ({ tool, ns, make: x => superInput(ns, x) })))
send({ type: 'meta', calibrated: pairs.length, chosen: chosen.map(c => ({ at: describe(c), types: c.types })), timingTargets: timing.length })

const big = fast ? 64 * 1024 : 1024 * 1024
const reps = 3
const record = (probe, status, ms, note) => send({ type: 'result', id: probe.id, cls: probe.cls, tier: probe.tier, status, ms: Math.round(ms * 100) / 100, note })
const begin = probe => send({ type: 'start', id: probe.id })

for (const probe of evasionProbes(big)) {
  if (done.has(probe.id)) continue
  begin(probe)
  if (chosen.length === 0) { record(probe, 'skip', 0, 'no secret surface found'); continue }
  const failures = []
  let worst = 0
  for (const c of chosen) {
    const payload = probe.build(SECRET_TYPES[c.types[0]]())
    const r = call(c.tool, c.make(payload))
    worst = Math.max(worst, r.ms)
    if (r.err) failures.push(`${describe(c)} threw ${r.err}`)
    else if (!refused(r)) failures.push(`${describe(c)} let ${c.types[0]} through`)
  }
  record(probe, failures.length === 0 ? 'pass' : probe.tier === 'advisory' ? 'info' : 'fail', worst, failures.join('; '))
}

for (const probe of stressProbes(big)) {
  if (done.has(probe.id)) continue
  begin(probe)
  const payload = probe.build()
  let worst = 0
  const bad = []
  const slow = []
  for (const t of timing) {
    const input = t.make(payload)
    const label = `${bareOf(t.tool)}${t.ns ? `[${t.ns}]` : ''}`
    const median = inp => {
      const ms = []
      for (let i = 0; i < reps; i++) {
        const r = call(t.tool, inp)
        if (r.err) return { err: r.err, ms: r.ms }
        ms.push(r.ms)
      }
      return { ms: ms.sort((x, y) => x - y)[1] }
    }
    const m = median(input)
    if (m.err) { bad.push(`${label} threw ${m.err}`); worst = Math.max(worst, m.ms); if (bad.length >= 3) break; continue }
    worst = Math.max(worst, m.ms)
    if (m.ms > budgetMs) bad.push(`${label} ${m.ms.toFixed(0)}ms (median of ${reps}, hang gate ${budgetMs}ms)`)
    else if (m.ms > advisoryMs) {
      const base = median(t.make('a')).ms
      slow.push(`${label} ${m.ms.toFixed(0)}ms${m.ms > 50 * base ? ` slow-relative (>50x the ${base.toFixed(2)}ms trivial call)` : ''}`)
    }
    if (bad.length >= 3 || slow.length >= 3) break // three offenders prove the point; do not sweep every shape of a guard that is slow everywhere
  }
  record(probe, bad.length === 0 ? 'pass' : 'fail', worst, bad.length ? [...new Set(bad)].slice(0, 3).join('; ') : slow.length ? `advisory slow: ${[...new Set(slow)].slice(0, 2).join('; ')}` : undefined)
}

// Benign look-alikes must pass on every calibrated shape.
{
  const probe = { id: 'benign-lookalikes', cls: 'benign', tier: 'must' }
  begin(probe)
  if (chosen.length === 0) record(probe, 'skip', 0, 'no secret surface found')
  else {
    const bad = []
    let worst = 0
    for (const c of pairs.slice(0, 12)) {
      BENIGN.forEach((b, i) => {
        const r = call(c.tool, c.make(b))
        worst = Math.max(worst, r.ms)
        if (r.err || refused(r)) bad.push(`#${i} on ${describe(c)}`)
      })
    }
    record(probe, bad.length === 0 ? 'pass' : 'fail', worst, bad.slice(0, 3).join('; '))
  }
}
send({ type: 'done' })
