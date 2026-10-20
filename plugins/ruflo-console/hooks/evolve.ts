/**
 * The Self-Evolution view's work: the governed-evolution loop as ruflo records it, and the checks a person can run on
 * it. Every entry is a fixed argv checked against the CLI's dispatchers (commands/metaharness.ts dispatchFlywheel,
 * commands/policy.ts, commands/verify.ts). The reads are $0 and local and run at once; the one write (asking the policy
 * gate about a promotion) asks first and says what it appends. CLI verbs are used, never `mcp exec`, which appends a
 * receipt to the policy ledger on every call.
 *
 * Authority (ADR-322): the flywheel, Darwin and MetaHarness propose and evaluate; they cannot promote themselves. There
 * is no promote, evidence-reset or rollback entry here: the view shows the promotion command and the person runs it.
 * Candidate runs (`flywheel run`) live in the MetaHarness lab, which this view links to rather than repeats.
 */
import type { ActionSpec } from './actions'
import { MANIFEST_PATHS, OSES, parseGate, parseLedger, parsePolicyLedger, parseWitness, readEvolve, shortRef, type EvolveFiles, type Os } from './data/evolve'
import { jsonAfter } from './data/cli'
import type { ReadCache } from './data/files'
import { plain, recordOf } from './data/parse'
import type { Host } from './host'
import { labLines, LAB_MAX_LINES, PROMOTE_COMMAND } from './mh-lab'
import type { State } from './state'

export type EvolveCost = 'read' | 'writes'

export type EvolveEntry = {
  id: string
  name: string
  about: string
  label: string
  cost: EvolveCost
  args: (state: State) => readonly string[] | null
  why?: string
  note?: string
  timeoutMs?: number
}

const FLY = ['metaharness', 'flywheel'] as const

/** The request `policy evaluate` is asked: the promote action the CLI's promote would put to the gate, as this console. */
export function gateRequest(receiptId?: string): Record<string, unknown> {
  return { identity: { id: 'ruflo-console', type: 'plugin' }, action: { type: 'metaharness.candidate.promote', ...(receiptId !== undefined && { resource: receiptId }), environment: 'production', destructive: true } }
}

/** The newest accepted receipt still waiting to be promoted: what a promotion would be asked about. */
export function candidateReceipt(files: EvolveFiles | null): string | undefined {
  return files?.receipts?.find(receipt => receipt.decision === 'accepted' && (receipt.status === undefined || receipt.status === 'evaluated'))?.id
}

const manifestOf = (state: State, os: Os) => state.evolve.files?.manifests.find(manifest => manifest.os === os)

const witnessEntry = (os: Os): EvolveEntry => ({
  id: `evolve-witness-${os}`,
  name: `WITNESS ${os.toUpperCase()}`,
  about: `check the signed ${os} manifest against the installed CLI`,
  label: `verify the signed ${os} witness manifest (ruflo verify --manifest, local)`,
  cost: 'read',
  args: state => (manifestOf(state, os) === undefined ? null : ['verify', '--manifest', MANIFEST_PATHS[os], '--json']),
  why: `no ${MANIFEST_PATHS[os]} in this project (without --manifest, ruflo verify fetches from GitHub: not offered)`,
  timeoutMs: 180_000,
})

export const EVOLVE: readonly EvolveEntry[] = [
  { id: 'evolve-ledger', name: 'LEDGER', about: 'verify the flywheel ledger: hash chain, parents, champion pointer', label: 'verify the flywheel ledger (metaharness flywheel status)', cost: 'read', args: () => [...FLY, 'status'] },
  { id: 'evolve-receipts', name: 'RECEIPTS', about: 'every evaluation receipt: decision, signed, state', label: 'list flywheel receipts and their verdicts', cost: 'read', args: () => [...FLY, 'receipts'] },
  { id: 'evolve-history', name: 'PROMOTIONS', about: 'every promotion commit: baseline → candidate, epoch', label: 'list flywheel promotion commits (the champion lineage)', cost: 'read', args: () => [...FLY, 'history'] },
  { id: 'evolve-policy', name: 'POLICY', about: 'the ADR-324 engine: mode, rules, receipts, ledger valid', label: 'policy status: mode, rules and whether its ledger verifies', cost: 'read', args: () => ['policy', 'status'], note: '$0, local: a read; a first run may record the ledger trust anchor (.claude-flow/policy, ~/.config/ruflo/policy-trust)' },
  ...OSES.map(witnessEntry),
  {
    id: 'evolve-gate',
    name: 'GATE CHECK',
    about: 'would the policy gate allow a promotion now? decides nothing',
    label: 'ask the policy gate about a promotion (policy evaluate, promotes nothing)',
    cost: 'writes',
    args: state => ['policy', 'evaluate', JSON.stringify(gateRequest(candidateReceipt(state.evolve.files)))],
    note: '$0, local: appends one decision receipt to .claude-flow/policy/state.json; promotes nothing',
  },
]

/** The promotion command, shown and never run (ADR-322: a policy act, a person's): the lab's, so both say the same. */
export { PROMOTE_COMMAND }

export const REPOS = {
  autogenous: 'https://github.com/ruvnet/autogenous',
  rgi: 'https://github.com/ruvnet/rGi',
} as const

/** What ▸ ask types into the AI terminal for a repo: read-only research, the person adds the question and sends it. */
export const repoPrompt = (repo: keyof typeof REPOS): string =>
  `Read ${REPOS[repo]} with gh (README, docs, ADRs), read-only: do not clone, build or run anything. How does it relate to this project's ruflo flywheel (ADR-322 receipts in .claude-flow/flywheel-v1)? `

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What one entry printed, as lines worth reading, keeping the parsed answer where the board draws it. */
export function evolveLines(state: State, id: string, stdout: string, stderr: string, atMs: number): string[] {
  const evolve = state.evolve
  const value = jsonAfter(stdout)
  const lines = ((): string[] => {
    if (id === 'evolve-ledger') {
      const ledger = parseLedger(stdout, atMs)
      const flywheel = recordOf(recordOf(value)?.state)

      if (ledger === null) return []
      evolve.ledger = ledger

      return [
        `ledger ${ledger.isValid ? 'VALID' : 'INVALID'} · ${count(ledger.commits, 'commit')} · head ${shortRef(ledger.head)}`,
        ...ledger.errors.map(error => `✗ ${error}`),
        `champion ${shortRef(typeof flywheel?.activeChampionRef === 'string' ? flywheel.activeChampionRef : undefined)} · serving epoch ${String(flywheel?.servingEpoch ?? 'n/a')} · ${count(Object.keys(recordOf(flywheel?.receiptStates) ?? {}).length, 'receipt')} registered`,
      ]
    }

    if (id === 'evolve-receipts' && Array.isArray(value)) {
      if (value.length === 0) return ['no receipts yet: ▸ FLYWHEEL RUN in the MetaHarness lab evaluates candidates into receipts']

      return value.slice(0, 30).flatMap(entry => {
        const row = recordOf(entry)
        const state = recordOf(row?.state)

        return row === null ? [] : [`${shortRef(String(row.receiptId ?? ''))} · ${plain(String(row.decision ?? 'n/a'), 12)} · ${row.signed === true ? 'signed' : 'UNSIGNED'} · ${plain(String(state?.status ?? 'unregistered'), 12)} · candidate ${shortRef(String(row.candidateId ?? ''))}`]
      })
    }

    if (id === 'evolve-history') {
      const commits = recordOf(value)?.commits

      if (!Array.isArray(commits)) return []
      if (commits.length === 0) return ['no promotions yet: the ledger is at genesis']

      return commits.slice(-30).flatMap(entry => {
        const commit = recordOf(entry)

        return commit === null ? [] : [`epoch ${String(commit.servingEpoch ?? '?')} · ${shortRef(String(commit.baselineRef ?? ''))} → ${shortRef(String(commit.candidateId ?? ''))} · receipt ${shortRef(String(commit.receiptId ?? ''))} · ${plain(String(commit.proposer ?? ''), 16)}`]
      })
    }

    if (id === 'evolve-policy') {
      const policy = parsePolicyLedger(stdout, atMs)

      if (policy === null) return []
      evolve.policyLedger = policy

      return [`mode ${policy.mode} · ${count(policy.rules, 'rule')} · ${count(policy.approvals, 'approval')} · ${count(policy.receipts, 'receipt')}`, `decision ledger ${policy.isValid ? 'verifies' : 'DOES NOT VERIFY'}`]
    }

    if (id === 'evolve-gate') {
      const gate = parseGate(stdout, atMs)

      if (gate === null) return []
      evolve.gate = gate

      return [`outcome ${gate.outcome} · enforced ${gate.enforced} · mode ${gate.mode}`, ...(gate.reason !== '' ? [`reason: ${gate.reason}`] : []), 'nothing was promoted: this asked the gate only']
    }

    const os = OSES.find(candidate => id === `evolve-witness-${candidate}`)

    if (os !== undefined) {
      const witness = parseWitness(stdout, os, atMs)

      if (witness === null) return []
      evolve.witness[os] = witness

      const failing = (Array.isArray(recordOf(value)?.results) ? (recordOf(value)?.results as unknown[]) : []).map(recordOf).filter(row => row !== null && row.status !== 'pass')

      return [
        `signature ${witness.isSignatureValid ? 'valid (hash, key and signature check)' : 'DOES NOT VERIFY'} · overall ${witness.isOk ? 'ok' : 'NOT OK'}`,
        `${witness.pass} pass · ${witness.drift} drift · ${witness.regressed} regressed · ${witness.missing} missing, against the installed CLI`,
        ...failing.slice(0, 20).map(row => `[${plain(String(row?.status ?? ''), 10)}] ${plain(String(row?.id ?? ''), 8)} ${plain(String(row?.desc ?? ''), 60)} · ${plain(String(row?.file ?? ''), 80)}`),
      ]
    }

    return []
  })()

  return lines.length > 0 ? lines.slice(0, LAB_MAX_LINES).map(line => plain(line, 160)) : labLines(id, stdout, stderr)
}

/** The spec for an entry: a read runs at once, the write asks; null when it cannot run now. */
export function evolveSpec(entry: EvolveEntry, state: State): ActionSpec | null {
  const args = entry.args(state)

  if (args === null) return null

  return {
    label: entry.label,
    args,
    expect: entry.cost === 'read' ? 'its output on the Self-Evolution board' : `its decision on the board; ${entry.note ?? ''}`,
    lab: entry.id,
    lines: (stdout, stderr) => evolveLines(state, entry.id, stdout, stderr, Date.now()),
    ...(entry.cost === 'read' && { isReadOnly: true }),
    ...(entry.note !== undefined && { note: entry.note }),
    ...(entry.timeoutMs !== undefined && { timeoutMs: entry.timeoutMs }),
  }
}

export const evolveWhy = (entry: EvolveEntry): string => entry.why ?? 'it cannot run now'

const reading = new WeakMap<State, Promise<void>>()
/** The view's own read cache: shared with the disk pass, its files would count as state writes there. */
const caches = new WeakMap<State, ReadCache>()

/** Reads the evolution files again (opening the view, r, ▸ reread); a read already running is joined. */
export function loadEvolve(state: State, host: Host): Promise<void> {
  const held = reading.get(state)

  if (held !== undefined) return held

  state.evolve.isReading = true
  host.invalidate()

  const cache = caches.get(state) ?? new Map()

  caches.set(state, cache)

  const run = readEvolve(host.fs, cache, state.cwd, Date.now())
    .then(files => {
      state.evolve.files = files
    })
    .catch(() => undefined)
    .finally(() => {
      state.evolve.isReading = false
      reading.delete(state)
      host.invalidate()
    })

  reading.set(state, run)

  return run
}

export type EvolveActions = {
  reread: () => void
  /** Types a read-only research prompt about the repo into the AI terminal (claude): nothing runs until it is sent. */
  ask: (repo: keyof typeof REPOS) => void
}

export function evolveActions(state: State, host: Host, load: (text: string) => void): EvolveActions {
  return {
    reread: () => void loadEvolve(state, host),
    ask: repo => load(repoPrompt(repo)),
  }
}
