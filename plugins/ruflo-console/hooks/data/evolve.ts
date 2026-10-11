/**
 * The self-evolution view's facts: what ruflo's governed-evolution stack wrote to disk, and readers for what its CLI
 * prints. Read against @claude-flow/cli 3.51.1's source:
 *
 * - `.claude-flow/flywheel-v1/transaction-state.json` (services/flywheel-transaction.ts): the ADR-322 flywheel's state,
 *   `{activeChampionRef, servingEpoch, ledgerHead, receiptStates{id: {status}}, commits[]}`; each commit links its
 *   `baselineRef` to the `candidateId` it promoted, so the commits are the champion's ancestry.
 * - `.claude-flow/flywheel-v1/receipts/<hex>.json` (services/flywheel-receipt.ts): `{payload, signature?}`, the payload
 *   naming `receiptId, candidateId, baselineRef, decision, issuedAt` and its `statistics`.
 * - `.claude-flow/flywheel/generation-N.json` and `served.json` (services/harness-flywheel-generations.ts): the older
 *   generations loop, each bundle naming its `parent` and, on a pass, `promotion.candidateManifestHash`.
 * - `.claude-flow/harness-active-policy.json` (config/harness-feedback-applier.ts): the champion served, with the
 *   `previous` pointer a rollback returns to and `rolledBack` once it has.
 * - `verification/<os>/manifest.md.json` (ADR-103): the signed witness manifest; only its header is read here.
 *
 * Same rules as ./parse: any shape tolerated, nothing guessed, every string cleaned. `.claude-flow/policy/state.json` is
 * never read (it reaches tens of MB); the policy ledger is asked of `ruflo policy status` when the person clicks.
 */
import { jsonAfter } from './cli'
import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { jsonObject, msOf, plain, recordOf, stringOf } from './parse'
import { countOf, measureOf } from './safe'

export const EVOLVE_FILES = {
  flywheel: '.claude-flow/flywheel-v1/transaction-state.json',
  receipts: '.claude-flow/flywheel-v1/receipts',
  generations: '.claude-flow/flywheel',
  served: '.claude-flow/flywheel/served.json',
  policy: '.claude-flow/harness-active-policy.json',
  rgi: '.rgi/runtime.db',
} as const

export const OSES = ['linux', 'macos', 'windows'] as const
export type Os = (typeof OSES)[number]

/** Each signed witness manifest by the OS it was generated on: a fixed path, never one the person types. */
export const MANIFEST_PATHS: Record<Os, string> = { linux: 'verification/linux/manifest.md.json', macos: 'verification/macos/manifest.md.json', windows: 'verification/windows/manifest.md.json' }

/** At most this many receipt files and generation bundles are read, newest first. */
export const MAX_RECEIPTS = 20
export const MAX_GENERATIONS = 12

export type Commit = { candidate: string; baseline?: string; receipt?: string; epoch?: number; atMs?: number; proposer?: string }
export type FlywheelFile = { champion?: string; served?: string; epoch?: number; head?: string; statuses: Record<string, string>; commits: Commit[] }
export type Receipt = { id: string; decision?: string; candidate?: string; baseline?: string; isSigned: boolean; atMs?: number; lift?: number; status?: string }
export type Generation = { generation: number; parent: string | null; candidate?: string; isPromoted: boolean; branch?: string; mutation?: string; cause?: string; atMs?: number }
export type Served = { champion?: string; fromGeneration?: number; atMs?: number }
export type ActivePolicy = { champion: string; previous?: string; isRolledBack: boolean; tier?: string; layer?: string; appliedAtMs?: number }
export type Manifest = { os: Os; path: string; issuedAtMs?: number; gitCommit?: string; branch?: string; fixes?: number; isSigned: boolean }

/** What the disk held when the view last read it; null fields are files that are not there (or not readable). */
export type EvolveFiles = {
  flywheel: FlywheelFile | null
  receipts: Receipt[] | null
  generations: Generation[] | null
  served: Served | null
  policy: ActivePolicy | null
  manifests: Manifest[]
  hasRgiDb: boolean
  readAtMs: number
}

export type Ledger = { isValid: boolean; commits: number; head?: string; errors: string[]; atMs: number }
export type Witness = { os: Os; isOk: boolean; isSignatureValid: boolean; pass: number; drift: number; regressed: number; missing: number; atMs: number }
export type PolicyLedger = { mode: string; rules: number; approvals: number; receipts: number; isValid: boolean; atMs: number }
export type GateDecision = { outcome: string; enforced: string; mode: string; reason: string; atMs: number }

/** The evolve view between renders: the files as read, and what the CLI answered when the person asked. */
export type EvolveState = {
  files: EvolveFiles | null
  isReading: boolean
  ledger: Ledger | null
  witness: Partial<Record<Os, Witness>>
  policyLedger: PolicyLedger | null
  gate: GateDecision | null
}

export const emptyEvolve = (): EvolveState => ({ files: null, isReading: false, ledger: null, witness: {}, policyLedger: null, gate: null })

const REF = /^(sha256:)?[0-9a-f]{8,64}$/

/** A content ref (`sha256:<hex>` or bare hex) as written, or undefined: only such strings are drawn as lineage nodes. */
export const refOf = (value: unknown): string | undefined => (typeof value === 'string' && REF.test(value) ? value : undefined)

/** A ref as a person reads it: the first eight hex digits. The genesis head reads as such. */
export function shortRef(ref: string | undefined): string {
  if (ref === undefined) return 'n/a'

  const hex = ref.replace(/^sha256:/, '')

  return /^0+$/.test(hex) ? 'genesis' : hex.slice(0, 8)
}

export function parseFlywheel(text: string | null): FlywheelFile | null {
  const value = jsonObject(text)

  if (value === null) return null

  const statuses: Record<string, string> = {}

  for (const [id, entry] of Object.entries(recordOf(value.receiptStates) ?? {}).slice(0, 500)) {
    const status = stringOf(recordOf(entry)?.status, 16)

    if (refOf(id) !== undefined && status !== undefined) statuses[id] = status
  }

  const commits = (Array.isArray(value.commits) ? value.commits : []).slice(-200).flatMap(entry => {
    const commit = recordOf(entry)
    const candidate = refOf(commit?.candidateId)

    if (commit === null || candidate === undefined) return []

    const baseline = refOf(commit.baselineRef)
    const receipt = refOf(commit.receiptId)
    const epoch = countOf(commit.servingEpoch)
    const atMs = msOf(commit.promotedAt)
    const proposer = stringOf(commit.proposer, 20)

    return [{ candidate, ...(baseline !== undefined && { baseline }), ...(receipt !== undefined && { receipt }), ...(epoch !== undefined && { epoch }), ...(atMs !== undefined && { atMs }), ...(proposer !== undefined && { proposer }) }]
  })
  const champion = refOf(value.activeChampionRef)
  const served = refOf(value.servedChampionRef)
  const epoch = countOf(value.servingEpoch)
  const head = refOf(value.ledgerHead)

  return { statuses, commits, ...(champion !== undefined && { champion }), ...(served !== undefined && { served }), ...(epoch !== undefined && { epoch }), ...(head !== undefined && { head }) }
}

/** One receipt file: its payload's identity and decision, and whether a signature is attached (not whether it holds). */
export function parseReceipt(text: string | null): Receipt | null {
  const value = jsonObject(text)
  const payload = recordOf(value?.payload)
  const id = refOf(payload?.receiptId)

  if (value === null || payload === null || id === undefined) return null

  const decision = stringOf(payload.decision, 16)
  const candidate = refOf(payload.candidateId)
  const baseline = refOf(payload.baselineRef)
  const atMs = msOf(payload.issuedAt)
  const lift = measureOf(recordOf(payload.statistics)?.relativeLift)
  const signature = recordOf(value.signature)

  return {
    id,
    isSigned: typeof signature?.signatureBase64 === 'string' && signature.signatureBase64.length > 20,
    ...(decision !== undefined && { decision }),
    ...(candidate !== undefined && { candidate }),
    ...(baseline !== undefined && { baseline }),
    ...(atMs !== undefined && { atMs }),
    ...(lift !== undefined && { lift }),
  }
}

export function parseGeneration(text: string | null): Generation | null {
  const value = jsonObject(text)
  const generation = countOf(value?.generation)

  if (value === null || generation === undefined) return null

  const promotion = recordOf(value.promotion)
  const regression = recordOf(value.regression)
  const candidate = refOf(promotion?.candidateManifestHash ?? regression?.candidateManifestHash)
  const branch = stringOf(value.branch, 24)
  const mutation = stringOf(promotion?.mutationClass ?? regression?.mutationClass ?? value.mutationClass, 40)
  const cause = stringOf(regression?.failureCause, 16)
  const atMs = msOf(value.createdAt)

  return {
    generation,
    parent: refOf(value.parent) ?? null,
    isPromoted: promotion !== null,
    ...(candidate !== undefined && { candidate }),
    ...(branch !== undefined && { branch }),
    ...(mutation !== undefined && { mutation }),
    ...(cause !== undefined && { cause }),
    ...(atMs !== undefined && { atMs }),
  }
}

export function parseServed(text: string | null): Served | null {
  const value = jsonObject(text)

  if (value === null) return null

  const champion = refOf(value.championHash)
  const fromGeneration = countOf(value.fromGeneration)
  const atMs = msOf(value.servedAt)

  return { ...(champion !== undefined && { champion }), ...(fromGeneration !== undefined && { fromGeneration }), ...(atMs !== undefined && { atMs }) }
}

/** The active policy with the rollback pointer facts.ts leaves out: `previous`, and `rolledBack` once it was used. */
export function parseActivePolicy(text: string | null): ActivePolicy | null {
  const value = jsonObject(text)
  const champion = stringOf(value?.championId, 90)

  if (value === null || champion === undefined) return null

  const previous = stringOf(value.previous, 90)
  const tier = stringOf(value.provenanceTier, 40)
  const layer = stringOf(value.layer, 40)
  const appliedAtMs = msOf(value.appliedAt)

  return { champion, isRolledBack: value.rolledBack === true, ...(previous !== undefined && { previous }), ...(tier !== undefined && { tier }), ...(layer !== undefined && { layer }), ...(appliedAtMs !== undefined && { appliedAtMs }) }
}

/** A witness manifest's header: when, from which commit, how many fixes, and whether it carries a signature. */
export function parseManifest(text: string | null, os: Os): Manifest | null {
  const value = jsonObject(text)
  const manifest = recordOf(value?.manifest)

  if (value === null || manifest === null) return null

  const integrity = recordOf(value.integrity)
  const issuedAtMs = msOf(manifest.issuedAt)
  const gitCommit = stringOf(manifest.gitCommit, 12)
  const branch = stringOf(manifest.branch, 40)
  const fixes = countOf(recordOf(manifest.summary)?.totalFixes) ?? (Array.isArray(manifest.fixes) ? manifest.fixes.length : undefined)

  return {
    os,
    path: MANIFEST_PATHS[os],
    isSigned: typeof integrity?.signature === 'string' && integrity.signature.length > 20,
    ...(issuedAtMs !== undefined && { issuedAtMs }),
    ...(gitCommit !== undefined && { gitCommit }),
    ...(branch !== undefined && { branch }),
    ...(fixes !== undefined && { fixes }),
  }
}

/** Reads every evolution file under `cwd`; nothing here rejects, and a file that is not there reads as null. */
export async function readEvolve(fs: ReaderFs, cache: ReadCache, cwd: string, nowMs: number): Promise<EvolveFiles> {
  const read = async (path: string) => {
    const result = await readBounded(fs, cache, under(cwd, path))

    return result.text
  }
  const newest = async (dir: string, pattern: RegExp, max: number, order: (name: string) => number) => {
    const entries = await fs.list(under(cwd, dir)).catch(() => null)

    if (entries === null) return null

    return entries
      .filter(entry => pattern.test(entry.name))
      .sort((a, b) => order(b.name) - order(a.name) || (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
      .slice(0, max)
      .map(entry => `${dir}/${entry.name}`)
  }
  const [flywheelText, receiptPaths, generationPaths, servedText, policyText, manifestTexts, hasRgiDb] = await Promise.all([
    read(EVOLVE_FILES.flywheel),
    newest(EVOLVE_FILES.receipts, /^[0-9a-f]{64}\.json$/, MAX_RECEIPTS, () => 0),
    newest(EVOLVE_FILES.generations, /^generation-\d{1,6}\.json$/, MAX_GENERATIONS, name => Number(/\d+/.exec(name)?.[0] ?? 0)),
    read(EVOLVE_FILES.served),
    read(EVOLVE_FILES.policy),
    Promise.all(OSES.map(os => read(MANIFEST_PATHS[os]))),
    fs.stat(under(cwd, EVOLVE_FILES.rgi)).then(() => true, () => false),
  ])
  const flywheel = parseFlywheel(flywheelText)
  const receipts = receiptPaths === null ? null : (await Promise.all(receiptPaths.map(path => read(path).then(parseReceipt)))).flatMap(receipt => (receipt === null ? [] : [{ ...receipt, ...(flywheel?.statuses[receipt.id] !== undefined && { status: flywheel.statuses[receipt.id] }) }]))
  const generations = generationPaths === null ? null : (await Promise.all(generationPaths.map(path => read(path).then(parseGeneration)))).flatMap(generation => (generation === null ? [] : [generation]))

  return {
    flywheel,
    receipts,
    generations: generations?.sort((a, b) => a.generation - b.generation) ?? null,
    served: parseServed(servedText),
    policy: parseActivePolicy(policyText),
    manifests: OSES.flatMap((os, i) => parseManifest(manifestTexts[i] ?? null, os) ?? []),
    hasRgiDb,
    readAtMs: nowMs,
  }
}

/** A count from the CLI's JSON: whole, non-negative and capped, else 0 (#3822). */
const count = (value: unknown): number => countOf(value) ?? 0

/** `metaharness flywheel status`: `{state, ledger: {valid, errors, commits, head}}`, its ledger as checked. */
export function parseLedger(stdout: string, atMs: number): Ledger | null {
  const ledger = recordOf(recordOf(jsonAfter(stdout))?.ledger)

  if (ledger === null || typeof ledger.valid !== 'boolean') return null

  const head = refOf(ledger.head)

  return { isValid: ledger.valid, commits: count(ledger.commits), errors: (Array.isArray(ledger.errors) ? ledger.errors : []).slice(0, 5).map(error => plain(error, 140)), atMs, ...(head !== undefined && { head }) }
}

/** `verify --manifest <path> --json`: the signature checks and the per-fix tally against the installed CLI. */
export function parseWitness(stdout: string, os: Os, atMs: number): Witness | null {
  const value = recordOf(jsonAfter(stdout))
  const summary = recordOf(value?.summary)
  const signature = recordOf(value?.signature)

  if (value === null || summary === null) return null

  return {
    os,
    isOk: value.ok === true,
    isSignatureValid: signature?.manifestHashOk === true && signature.publicKeyReproducible === true && signature.signatureValid === true,
    pass: count(summary.pass),
    drift: count(summary.drift),
    regressed: count(summary.regressed),
    missing: count(summary.missing),
    atMs,
  }
}

/** `policy status`: the ADR-324 engine's mode, its counts, and whether its decision ledger verifies. */
export function parsePolicyLedger(stdout: string, atMs: number): PolicyLedger | null {
  const value = recordOf(jsonAfter(stdout))
  const ledger = recordOf(value?.ledger)

  if (value === null || ledger === null) return null

  return { mode: stringOf(value.mode, 12) ?? 'n/a', rules: count(value.rules), approvals: count(value.approvals), receipts: count(value.receipts), isValid: ledger.valid === true, atMs }
}

/** `policy evaluate`: the decision the gate reached, as enforced in the current mode. */
export function parseGate(stdout: string, atMs: number): GateDecision | null {
  const value = recordOf(jsonAfter(stdout))
  const outcome = stringOf(value?.outcome, 24)

  if (value === null || outcome === undefined) return null

  return { outcome, enforced: stringOf(value.enforcedOutcome, 24) ?? outcome, mode: stringOf(value.mode, 12) ?? 'n/a', reason: stringOf(value.reason, 160) ?? '', atMs }
}
