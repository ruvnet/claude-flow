/**
 * The autopilot's upkeep passes (ADR-466): adaptation under the gate, and journal rotation. Split from ap-live.ts to keep it under the
 * file limit; both are given the store and the host, and append through the caller's write chain.
 */
import type { Host } from './host'
import type { Store } from './ap-live'
import { checkNoLinks } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import { writeVia } from './data/write-via'
import { evaluate, lastHash, outcomesOf, promote, propose, reviewTrials, tunablesFrom, verifyReceipts } from './data/ap-adapt'
import type { Envelope } from './data/ap-envelope'
import { encodeLine, JOURNAL_FILE, type JournalEvent } from './data/ap-journal'
import { snapshotEvents } from './data/ap-loop'
import { setPin } from './ap-pin-live'

/** Propose, replay-evaluate, and promote under the gate; then revert any trial that did worse. At most one receipt a pass. */
export async function adaptPass(store: Store, host: Host, env: Envelope, nowMs: number, append: (events: JournalEvent[]) => Promise<boolean>): Promise<void> {
  if (!verifyReceipts(store.loop.receipts).ok) return

  const outcomes = outcomesOf(store.loop.steps)
  const current = tunablesFrom(store.loop.receipts, env)
  const prev = lastHash(store.loop.receipts)
  const reverts = reviewTrials(store.loop.receipts, outcomes)
  const candidate = reverts[0] ?? propose(outcomes, current, env, store.loop.receipts).find(p => evaluate(p, outcomes, current).verdict === 'supported')

  if (candidate === undefined) return

  const verdict = reverts[0] === undefined ? evaluate(candidate, outcomes, current) : { verdict: 'supported' as const, evidence: 'the trial did worse than the setting it replaced' }
  const result = promote(candidate, verdict, current, env, prev, nowMs)

  if (result.ok) await append([{ t: 'adapt', at: nowMs, receipt: result.receipt }])
}

/** Archives the journal and starts a new one from its snapshot, so weeks of running stay readable. The old file is kept beside it. */
export async function rotate(store: Store, host: Host, cwd: string, nowMs: number): Promise<void> {
  const path = `${cwd.replace(/\/+$/, '')}/${JOURNAL_FILE}`
  const archive = `${path}.${new Date(nowMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

  // Inside the write chain, so a stop or pause pressed meanwhile lands before the snapshot is taken and cannot be lost to the replace.
  const job = store.chain.then(async () => {
    const lines = snapshotEvents(store.loop).map(encodeLine).join('')

    if (lines === '') return

    // The archive must be a new name with no link on the way: a pre-made link there would make the no-clobber copy skip and the old journal be lost.
    const clear = await checkNoLinks(host.fs, archive, { cwd: cwd }).catch(() => ({ ok: false as const }))
    const copied = clear.ok ? await writeVia(await writeFlavorReady(), host, { kind: 'copy-no-clobber', from: path, path: archive, timeoutMs: 30_000 }).catch(() => ({ exitCode: 1 })) : { exitCode: 1 }
    const saved = (await host.fs.stat(archive).catch(() => undefined)) !== undefined

    if (copied.exitCode !== 0 || !saved) return

    const pin = store.pin

    store.isPinPending = true

    try {
      if (pin !== null) await setPin(store, host, cwd, { ...pin, starts: 1 })

      const wrote = await writeVia(await writeFlavorReady(), host, { kind: 'replace', path, text: lines, hasDir: true }).catch(() => ({ exitCode: 1 }))

      if (wrote.exitCode !== 0 && pin !== null) await setPin(store, host, cwd, pin)
    } finally {
      store.isPinPending = false
    }
  })

  store.chain = job.catch(() => undefined)
  await store.chain
}
