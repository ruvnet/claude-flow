/**
 * A governed-evolution world in the shapes @claude-flow/cli 3.51.1 writes and prints: the flywheel-v1 state with two
 * promotions, three receipts (two promoted, one rejected) and one accepted receipt waiting, two generation bundles, the
 * active policy with its rollback pointer, a signed witness manifest, and what each CLI check printed. The empty-ledger
 * and policy outputs are as captured from a real run; the rest follow the source's field names.
 */
const ref = (c: string) => `sha256:${c.repeat(64)}`

export const GENESIS = `sha256:${'0'.repeat(64)}`
export const BASE = ref('b')
export const C1 = ref('c')
export const C2 = ref('d')
export const REJ = ref('e')
export const WAIT = ref('f')
export const R1 = ref('1')
export const R2 = ref('2')
export const R3 = ref('3')
export const R4 = ref('4')

const receipt = (receiptId: string, candidateId: string, baselineRef: string, decision: string, issuedAt: string, isSigned = true) =>
  JSON.stringify({
    payload: { schemaVersion: 'ruflo.flywheel-receipt/v1', receiptId, lineageId: 'lin-1', candidateId, baselineRef, decision, issuedAt, statistics: { relativeLift: decision === 'accepted' ? 0.042 : -0.01, significant: decision === 'accepted' } },
    ...(isSigned && { signature: { algorithm: 'ed25519', domain: 'ruflo/flywheel-receipt/v1', publicKeyPem: '-----BEGIN PUBLIC KEY-----', signatureBase64: 'c2lnbmF0dXJlLWJ5dGVzLWZvci10ZXN0aW5nLW9ubHk=' } }),
  })

export const EVOLVE_FILES: Record<string, string> = {
  '.claude-flow/flywheel-v1/transaction-state.json': JSON.stringify({
    version: 1,
    activeChampionRef: C2,
    ledgerHead: ref('9'),
    servingEpoch: 2,
    servedChampionRef: C2,
    receiptStates: { [R1]: { receiptId: R1, status: 'consumed' }, [R2]: { receiptId: R2, status: 'consumed' }, [R3]: { receiptId: R3, status: 'evaluated' }, [R4]: { receiptId: R4, status: 'evaluated' } },
    commits: [
      { commitId: 'c-1', receiptId: R1, sequence: 1, previousLedgerHead: GENESIS, baselineRef: BASE, candidateId: C1, servingEpoch: 1, proposer: 'local', promotedAt: '2026-09-30T10:00:00.000Z' },
      { commitId: 'c-2', receiptId: R2, sequence: 2, previousLedgerHead: ref('8'), baselineRef: C1, candidateId: C2, servingEpoch: 2, proposer: 'darwin', promotedAt: '2026-10-01T10:00:00.000Z' },
    ],
  }),
  [`.claude-flow/flywheel-v1/receipts/${'1'.repeat(64)}.json`]: receipt(R1, C1, BASE, 'accepted', '2026-09-30T09:00:00.000Z'),
  [`.claude-flow/flywheel-v1/receipts/${'2'.repeat(64)}.json`]: receipt(R2, C2, C1, 'accepted', '2026-10-01T09:00:00.000Z'),
  [`.claude-flow/flywheel-v1/receipts/${'3'.repeat(64)}.json`]: receipt(R3, REJ, C1, 'rejected', '2026-10-01T08:00:00.000Z', false),
  [`.claude-flow/flywheel-v1/receipts/${'4'.repeat(64)}.json`]: receipt(R4, WAIT, C2, 'accepted', '2026-10-02T08:00:00.000Z'),
  '.claude-flow/flywheel/generation-1.json': JSON.stringify({ generation: 1, parent: null, branch: 'main', kind: 'synthetic', createdAt: 1790000000000, promotion: { parentManifestHash: null, candidateManifestHash: 'a'.repeat(64), mutationClass: 'retrieval:alpha' }, regression: null }),
  '.claude-flow/flywheel/generation-2.json': JSON.stringify({ generation: 2, parent: 'a'.repeat(64), branch: 'main', kind: 'synthetic', createdAt: 1790100000000, promotion: null, regression: { candidateManifestHash: '7'.repeat(64), ancestor: 'a'.repeat(64), mutationClass: 'retrieval:multi', failureCause: 'holdout' } }),
  '.claude-flow/flywheel/served.json': JSON.stringify({ championHash: 'a'.repeat(64), config: { alpha: 0.3 }, servedAt: 1790050000000, fromGeneration: 1 }),
  '.claude-flow/harness-active-policy.json': JSON.stringify({ championId: 'sha256:6141a8ea990c5063b77e090ae8f37f9c539d8aa8f58dcceb30f3a82f97e57319', provenanceTier: 'oracle:test-exec', layer: 'framework/node-cli', appliedAt: 1783689629580, previous: 'sha256:5555aaaa990c5063b77e090ae8f37f9c539d8aa8f58dcceb30f3a82f97e57319', params: { alpha: 0.3 } }),
  'verification/linux/manifest.md.json': JSON.stringify({
    manifest: { schema: 'ruflo-witness/v1', issuedAt: '2026-10-02T15:54:52.530Z', gitCommit: '77a77a4527d543d19ed3f2af77f509b742326256', branch: 'release/3.51.1', os: 'linux', summary: { totalFixes: 117, verified: 117, missing: 0 }, fixes: [{ id: 'F1', desc: 'hooks_metrics persistence', file: 'v3/x.js', sha256: 'ab', marker: 'm', markerVerified: true }] },
    integrity: { manifestHashAlgo: 'sha256', manifestHash: 'ab', signatureAlgo: 'ed25519', publicKey: 'pk', signature: 'c2lnbmF0dXJlLWJ5dGVzLWZvci10ZXN0aW5nLW9ubHk=', seedDerivation: 'sha256(gitCommit:ruflo-witness/v1)' },
  }),
}

/** What each check printed (stdout); the CLI writes its [WARN] banner to stderr. */
export const EVOLVE_OUT = {
  /** `metaharness flywheel status` on a fresh project, as captured. */
  statusEmpty: `{\n  "state": {\n    "version": 1,\n    "activeChampionRef": null,\n    "ledgerHead": "${GENESIS}",\n    "servingEpoch": 0,\n    "receiptStates": {},\n    "commits": []\n  },\n  "ledger": {\n    "valid": true,\n    "errors": [],\n    "commits": 0,\n    "head": "${GENESIS}"\n  }\n}\n`,
  statusBroken: JSON.stringify({ state: { activeChampionRef: C2, servingEpoch: 2, receiptStates: {} }, ledger: { valid: false, errors: ['commit 2: parent mismatch'], commits: 2, head: ref('9') } }, null, 2),
  receipts: JSON.stringify([{ receiptId: R1, anchorRef: null, candidateId: C1, baselineRef: BASE, decision: 'accepted', signed: true, issuedAt: '2026-09-30T09:00:00.000Z', state: { receiptId: R1, status: 'consumed' } }, { receiptId: R3, candidateId: REJ, baselineRef: C1, decision: 'rejected', signed: false, state: null }], null, 2),
  history: JSON.stringify({ ledgerHead: ref('9'), commits: [{ receiptId: R1, baselineRef: BASE, candidateId: C1, servingEpoch: 1, proposer: 'local' }] }, null, 2),
  historyEmpty: `{\n  "ledgerHead": "${GENESIS}",\n  "commits": []\n}\n`,
  /** `policy status`, as captured. */
  policy: '{\n  "version": 1,\n  "mode": "legacy",\n  "migratedFrom": "pre-ADR-324; capabilities=agentdb.rvf",\n  "rules": 0,\n  "budgets": 0,\n  "approvals": 0,\n  "receipts": 8,\n  "ledger": {\n    "valid": true,\n    "length": 8\n  }\n}\n',
  gate: JSON.stringify({ requestId: 'req-1', outcome: 'allowed', enforcedOutcome: 'allowed', mode: 'legacy', reason: 'legacy-default-allow', matchedRules: [], obligations: [], receiptId: 'pr-1' }, null, 2),
  verify: JSON.stringify(
    {
      ok: true,
      manifest: { schema: 'ruflo-witness/v1' },
      signature: { manifestHashOk: true, publicKeyReproducible: true, signatureValid: true },
      results: [
        { id: 'F1', desc: 'hooks_metrics persistence', file: 'v3/x.js', status: 'pass', sha256Match: true, markerPresent: true },
        { id: 'F9', desc: 'session_list dual-shape', file: 'v3/y.js', status: 'missing', sha256Match: false, markerPresent: false },
      ],
      summary: { pass: 116, drift: 0, regressed: 0, missing: 1 },
    },
    null,
    2,
  ),
}

export const WARN = '\u001b[33m\u001b[1m[WARN]\u001b[0m Skipped helper auto-refresh — .LOCKED marker present\n'
