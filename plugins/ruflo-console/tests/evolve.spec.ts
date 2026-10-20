/**
 * The Self-Evolution view's pure parts under vitest: the catalog's invariants (fixed argv, no promotion, the witness
 * only ever with --manifest), the file readers against an in-memory disk, the CLI readers against what the checks
 * print, the loop stages lighting from data only, and the lineage tree. Run with
 *   npx vitest run plugins/ruflo-console/tests/evolve.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ReaderFs } from '../hooks/data/files'
import { parseActivePolicy, parseLedger, parseManifest, parsePolicyLedger, parseWitness, readEvolve, refOf, shortRef } from '../hooks/data/evolve'
import { candidateReceipt, EVOLVE, evolveLines, evolveSpec, evolveWhy, gateRequest, repoPrompt } from '../hooks/evolve'
import { lineageOf, LOOP_ROWS, loopPicture, loopStagesOf } from '../hooks/gfx/evolve'
import { PROMOTE_COMMAND } from '../hooks/mh-lab'
import { newState } from '../hooks/state'
import { C1, C2, EVOLVE_FILES, EVOLVE_OUT, R4, WARN } from './fixtures/evolve'

/** An in-memory disk under /work, as the engine's fs calls answer it. */
function fsOf(files: Readonly<Record<string, string>>): ReaderFs {
  const all = new Map(Object.entries(files).map(([path, text]) => [`/work/${path}`, text]))

  return {
    read: async path => {
      const text = all.get(path)

      if (text === undefined) throw new Error('ENOENT')

      return text
    },
    stat: async path => {
      const text = all.get(path)

      if (text === undefined) throw new Error('ENOENT')

      return { mtimeMs: 1, size: text.length }
    },
    list: async dir => {
      const names = [...all.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1))

      if (names.length === 0) throw new Error('ENOENT')

      return names.map(name => ({ name, kind: 'file', mtimeMs: 1 }))
    },
  }
}

async function worldState(files: Readonly<Record<string, string>> = EVOLVE_FILES) {
  const state = newState({})

  state.cwd = '/work'
  state.evolve.files = await readEvolve(fsOf(files), state.cache, '/work', 1_000)

  return state
}

describe('the evolve catalog', () => {
  it('every id is evolve-*, unique; no argv promotes, resets, runs a candidate, rolls back or reaches a shell', async () => {
    const state = await worldState()
    const ids = EVOLVE.map(entry => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('evolve-'))).toBe(true)

    for (const entry of EVOLVE) {
      const argv = evolveSpec(entry, state)?.args ?? []

      expect(argv, entry.id).not.toContain('promote')
      expect(argv, entry.id).not.toContain('evidence-reset')
      expect(argv, entry.id).not.toContain('run')
      expect(argv, entry.id).not.toContain('--confirm')
      expect(argv.some(word => /^(sh|bash|mcp)$/.test(word)), entry.id).toBe(false)
      // `verify` without --manifest fetches from GitHub: never offered.
      if (argv[0] === 'verify') expect(argv.slice(1, 3), entry.id).toEqual(['--manifest', `verification/${entry.id.slice('evolve-witness-'.length)}/manifest.md.json`])
    }

    expect(PROMOTE_COMMAND).toContain('flywheel promote <receipt-id>')
  })

  it('reads run at once with one fixed argv; the gate check asks first and says what it appends', async () => {
    const state = await worldState()
    const spec = (id: string) => evolveSpec(EVOLVE.find(entry => entry.id === id)!, state)

    expect(spec('evolve-ledger')).toMatchObject({ args: ['metaharness', 'flywheel', 'status'], isReadOnly: true, lab: 'evolve-ledger' })
    expect(spec('evolve-receipts')?.args).toEqual(['metaharness', 'flywheel', 'receipts'])
    expect(spec('evolve-history')?.args).toEqual(['metaharness', 'flywheel', 'history'])
    expect(spec('evolve-policy')?.args).toEqual(['policy', 'status'])
    expect(spec('evolve-witness-linux')?.args).toEqual(['verify', '--manifest', 'verification/linux/manifest.md.json', '--json'])

    const gate = spec('evolve-gate')

    expect(gate?.isReadOnly).toBeUndefined()
    expect(gate?.note).toMatch(/appends one decision receipt .* promotes nothing/)
    expect(gate?.args.slice(0, 2)).toEqual(['policy', 'evaluate'])
    expect(JSON.parse(gate?.args[2] ?? '{}')).toEqual(gateRequest(R4))
    expect(gateRequest(R4)).toMatchObject({ identity: { id: 'ruflo-console', type: 'plugin' }, action: { type: 'metaharness.candidate.promote', resource: R4 } })
  })

  it('a witness entry with no manifest on disk cannot run and says why; the gate asks about no receipt when none waits', async () => {
    const state = await worldState({})
    const macos = EVOLVE.find(entry => entry.id === 'evolve-witness-macos')!

    expect(evolveSpec(macos, state)).toBeNull()
    expect(evolveWhy(macos)).toContain('without --manifest, ruflo verify fetches from GitHub')
    expect(candidateReceipt(state.evolve.files)).toBeUndefined()
    expect(JSON.parse(evolveSpec(EVOLVE.find(entry => entry.id === 'evolve-gate')!, state)?.args[2] ?? '{}').action.resource).toBeUndefined()
  })

  it('the repo prompt is read-only research, typed and never run', () => {
    expect(repoPrompt('autogenous')).toMatch(/^Read https:\/\/github\.com\/ruvnet\/autogenous with gh .* do not clone, build or run anything/)
    expect(repoPrompt('rgi')).toContain('https://github.com/ruvnet/rGi')
  })
})

describe('the file readers', () => {
  it('reads the flywheel state, receipts newest first with their status, generations, served, policy and manifest', async () => {
    const files = (await worldState()).evolve.files!

    expect(files.flywheel).toMatchObject({ champion: C2, epoch: 2, commits: [{ candidate: C1, epoch: 1 }, { candidate: C2, epoch: 2, proposer: 'darwin' }] })
    expect(files.receipts).toHaveLength(4)
    expect(files.receipts?.find(receipt => receipt.id === R4)).toMatchObject({ decision: 'accepted', status: 'evaluated', isSigned: true, lift: 0.042 })
    expect(files.receipts?.filter(receipt => !receipt.isSigned)).toHaveLength(1)
    expect(files.generations?.map(generation => generation.generation)).toEqual([1, 2])
    expect(files.generations?.[1]).toMatchObject({ isPromoted: false, cause: 'holdout', parent: 'a'.repeat(64) })
    expect(files.served).toMatchObject({ champion: 'a'.repeat(64), fromGeneration: 1 })
    expect(files.policy).toMatchObject({ isRolledBack: false, previous: expect.stringMatching(/^sha256:5555/) })
    expect(files.manifests).toEqual([expect.objectContaining({ os: 'linux', isSigned: true, fixes: 117, gitCommit: '77a77a4527d…' })])
    expect(files.hasRgiDb).toBe(false)
  })

  it('a project with none of the files reads null everywhere, nothing invented', async () => {
    const files = (await worldState({})).evolve.files!

    expect(files).toMatchObject({ flywheel: null, receipts: null, generations: null, served: null, policy: null, manifests: [], hasRgiDb: false })
  })

  it('refs: only hex content refs pass; genesis reads as such', () => {
    expect(refOf('sha256:../../etc')).toBeUndefined()
    expect(refOf(`sha256:${'a'.repeat(64)}`)).toBeDefined()
    expect(shortRef(`sha256:${'0'.repeat(64)}`)).toBe('genesis')
    expect(shortRef(C1)).toBe('cccccccc')
    expect(parseActivePolicy('{"championId":"x","rolledBack":true}')?.isRolledBack).toBe(true)
    expect(parseManifest('{"manifest":{}}', 'linux')?.isSigned).toBe(false)
  })
})

describe('the CLI readers', () => {
  it('flywheel status: valid at genesis, and an invalid ledger with its errors', () => {
    expect(parseLedger(EVOLVE_OUT.statusEmpty, 5)).toEqual({ isValid: true, commits: 0, head: `sha256:${'0'.repeat(64)}`, errors: [], atMs: 5 })
    expect(parseLedger(EVOLVE_OUT.statusBroken, 5)).toMatchObject({ isValid: false, commits: 2, errors: ['commit 2: parent mismatch'] })
    expect(parseLedger(WARN, 5)).toBeNull()
  })

  it('verify --json, policy status: the signature checks and tallies; mode, counts, ledger', () => {
    expect(parseWitness(EVOLVE_OUT.verify, 'linux', 5)).toEqual({ os: 'linux', isOk: true, isSignatureValid: true, pass: 116, drift: 0, regressed: 0, missing: 1, atMs: 5 })
    expect(parsePolicyLedger(EVOLVE_OUT.policy, 5)).toEqual({ mode: 'legacy', rules: 0, approvals: 0, receipts: 8, isValid: true, atMs: 5 })
  })

  it('result lines: each check reads as a sentence and keeps its answer for the board', () => {
    const state = newState({})

    expect(evolveLines(state, 'evolve-ledger', EVOLVE_OUT.statusEmpty, WARN, 9)).toEqual(['ledger VALID · 0 commits · head genesis', 'champion n/a · serving epoch 0 · 0 receipts registered'])
    expect(state.evolve.ledger?.isValid).toBe(true)
    expect(evolveLines(state, 'evolve-receipts', '[]\n', '', 9)[0]).toMatch(/^no receipts yet/)
    expect(evolveLines(state, 'evolve-receipts', EVOLVE_OUT.receipts, '', 9)).toEqual(['11111111 · accepted · signed · consumed · candidate cccccccc', '33333333 · rejected · UNSIGNED · unregistered · candidate eeeeeeee'])
    expect(evolveLines(state, 'evolve-history', EVOLVE_OUT.historyEmpty, '', 9)).toEqual(['no promotions yet: the ledger is at genesis'])
    expect(evolveLines(state, 'evolve-history', EVOLVE_OUT.history, '', 9)[0]).toBe('epoch 1 · bbbbbbbb → cccccccc · receipt 11111111 · local')
    expect(evolveLines(state, 'evolve-witness-linux', EVOLVE_OUT.verify, '', 9)).toEqual([
      'signature valid (hash, key and signature check) · overall ok',
      '116 pass · 0 drift · 0 regressed · 1 missing, against the installed CLI',
      '[missing] F9 session_list dual-shape · v3/y.js',
    ])
    expect(evolveLines(state, 'evolve-gate', EVOLVE_OUT.gate, '', 9)[0]).toBe('outcome allowed · enforced allowed · mode legacy')
    expect(state.evolve.gate?.enforced).toBe('allowed')
    expect(evolveLines(state, 'evolve-policy', '', 'error: unknown command\n', 9)).toEqual(['error: unknown command'])
  })
})

describe('the loop and the lineage', () => {
  it('stages read n/a until there is data; VERIFY lights only after the ledger check ran', async () => {
    const blank = newState({})

    expect(loopStagesOf(blank.evolve).every(stage => stage.mark === 'na')).toBe(true)

    const state = await worldState()
    const before = loopStagesOf(state.evolve)

    expect(before.map(stage => stage.mark)).toEqual(['lit', 'lit', 'lit', 'na', 'lit', 'dark'])
    expect(before.find(stage => stage.name === 'PROMOTE')?.value).toBe('3 · ep 2')
    expect(before.find(stage => stage.name === 'REVERSE')?.value).toBe('armed')

    state.evolve.ledger = { isValid: false, commits: 2, errors: ['x'], atMs: 1 }
    expect(loopStagesOf(state.evolve).find(stage => stage.name === 'VERIFY')).toMatchObject({ mark: 'bad', value: 'INVALID' })

    const empty = await worldState({})

    expect(loopStagesOf(empty.evolve).map(stage => stage.mark)).toEqual(['na', 'na', 'na', 'na', 'na', 'na'])
  })

  it('the picture is the size asked for, and names each stage', async () => {
    const grid = loopPicture(loopStagesOf((await worldState()).evolve), 96, 0)
    const row = (y: number) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')

    expect([grid.columns, grid.rows]).toEqual([96, LOOP_ROWS])
    expect(row(1)).toMatch(/OBSERVE.*PROPOSE.*EVALUATE.*VERIFY.*PROMOTE.*REVERSE/)
  })

  it('the flywheel lineage: baseline → C1 → C2 champion, a rejected branch off C1, a waiting one off C2; generations mark the served one', async () => {
    const { flywheel, generations } = lineageOf((await worldState()).evolve.files)

    expect(flywheel.map(row => `${row.prefix}${row.kind}:${shortRef(row.ref)}`)).toEqual(['root:bbbbbbbb', '└─promoted:cccccccc', '  ├─rejected:eeeeeeee', '  └─champion:dddddddd', '    └─pending:ffffffff'])
    expect(generations.map(row => `${row.prefix}${row.kind}`)).toEqual(['root', '└─champion', '  └─rejected'])
    expect(lineageOf(null)).toEqual({ flywheel: [], generations: [] })
  })
})
