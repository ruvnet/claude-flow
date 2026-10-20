import { Engine, type Outcome } from '../hooks/engine'
import { readOptions } from '../hooks/options'
import { isTaintSource, normalise, recvEv, spawnEv } from '../hooks/shapes'
import { ATTACKS } from './corpus/attacks'
import { BENIGN } from './corpus/benign'

export const ROOT = '/work'
export const DAY = 25 * 3_600_000
/** Built at run time so no secret-shaped literal sits in the source or the corpus. */
export const FAKE = { GHP: `ghp_${'a1B2'.repeat(10)}`, AWS: `AKIA${'Q7'.repeat(8)}` }

export type Item = { turn?: string; tool?: string; input?: unknown; taint?: boolean; spawn?: { type: string; perm?: string }; recv?: string; denied?: boolean }

/** `{{GHP}}` and `{{AWS}}` in a corpus line stand for the fake secrets above. */
export const subst = (text: string) => text.replace(/\{\{(GHP|AWS)\}\}/g, (_, k: 'GHP' | 'AWS') => FAKE[k])

export const corpus = (kind: 'benign' | 'attacks') => Object.entries(kind === 'benign' ? BENIGN : ATTACKS).map(([name, items]) => ({ name, items: JSON.parse(subst(JSON.stringify(items))) as Item[] }))

export function engine(mode: 'off' | 'learn' | 'notify' | 'enforce' = 'notify'): Engine {
  const e = new Engine(readOptions({ mode }))
  e.begin('s1', ROOT, 1_000_000)
  return e
}

/** Feed items into the engine as the hooks would; returns every outcome. */
export function feed(e: Engine, items: Item[], now: number): Outcome[] {
  const out: Outcome[] = []
  let t = now
  for (const it of items) {
    t += 1500
    if (it.turn !== undefined) e.newTurn(it.turn)
    else if (it.spawn) out.push(e.evaluate(spawnEv(it.spawn.type, it.spawn.perm, t), t, false))
    else if (it.recv !== undefined) {
      const hit = /ignore (?:all )?previous instructions|you are now/i.test(it.recv)
      if (hit) out.push(e.evaluate(recvEv(true, t), t, false))
    } else if (it.tool !== undefined) {
      out.push(e.evaluate(normalise(it.tool, it.input, ROOT, t), t, it.denied === true))
      if (isTaintSource(it.tool, it.input) || it.taint) e.tainted = true
    }
  }
  return out
}

/** A baseline taught by the benign corpus over three sessions more than a day apart. */
export function matureEngine(mode: 'notify' | 'enforce' = 'notify'): Engine {
  const e = engine('learn')
  const benign = corpus('benign')
  for (let s = 0; s < 3; s++) for (let pass = 0; pass < 2; pass++) {
    if (s > 0) e.begin(`s${s + 1}`, ROOT, 1_000_000 + s * DAY)
    for (const f of benign) feed(e, f.items, 1_000_000 + s * DAY)
  }
  e.baseline.firstSeenAt = 1_000_000
  e.setMode(mode)
  e.begin('s9', ROOT, 1_000_000 + 4 * DAY)
  e.baseline.sessions = 4
  return e
}
