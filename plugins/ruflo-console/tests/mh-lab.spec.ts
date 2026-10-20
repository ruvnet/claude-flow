/**
 * The MetaHarness lab's pure parts under vitest: the catalog's invariants (fixed argv, what asks first, no promotion),
 * the output readers against what the CLI printed, and the audit keys the lab diffs. Run with
 *   npx vitest run plugins/ruflo-console/tests/mh-lab.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { PROBES, type AuditTrend } from '../hooks/data/cli'
import { auditKeys, LAB, LAB_MAX_LINES, labAnswer, labLines, labSpec, labWhy, PROMOTE_COMMAND } from '../hooks/mh-lab'
import { newState } from '../hooks/state'
import { CLI_OUT } from './fixtures/ruflo-run'

const auditsOf = (stdout: string) => PROBES.find(probe => probe.id === 'audits')?.parse(stdout) as AuditTrend | null

function withAudits(stdout: string) {
  const state = newState({})

  state.probes.set('audits', { value: auditsOf(stdout), okAtMs: 1, error: null, errorAtMs: null, isRunning: false })

  return state
}

describe('the lab catalog', () => {
  it('every entry has a unique mh- id, and no argv promotes, confirms a flywheel act, or reaches a shell', () => {
    const ids = LAB.map(entry => entry.id)
    const state = withAudits(CLI_OUT['mh-audit-list'] ?? '')

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('mh-'))).toBe(true)

    for (const entry of LAB) {
      const argv = labSpec(entry, state)?.args ?? []

      expect(argv, entry.id).not.toContain('promote')
      expect(argv.includes('flywheel') && argv.includes('--confirm'), entry.id).toBe(false)
      expect(argv.some(word => /^(sh|bash)$/.test(word)), entry.id).toBe(false)
    }

    expect(ids.some(id => /promote/.test(id))).toBe(false)
    expect(PROMOTE_COMMAND).toBe('ruflo metaharness flywheel promote <receipt-id> --public-key <approved-ed25519.pem> --confirm')
  })

  it('reads run at once; everything else asks first and says what it costs; what may spend says so', () => {
    const state = withAudits(CLI_OUT['mh-audit-list'] ?? '')

    for (const entry of LAB) {
      const spec = labSpec(entry, state)

      if (entry.types !== undefined) {
        expect(spec, entry.id).toBeNull()
        expect(labWhy(entry)).toContain(entry.types)
        continue
      }

      expect(spec?.lab).toBe(entry.id)
      expect(spec?.isReadOnly === true, entry.id).toBe(entry.cost === 'read')
      if (entry.cost !== 'read') expect(spec?.note, entry.id).toBeDefined()
      if (entry.cost === 'spends') expect(spec?.note, entry.id).toMatch(/COSTS MONEY|may call models/)
    }

    expect(labSpec(LAB.find(entry => entry.id === 'mh-redblue-real')!, state)?.args).toEqual(['metaharness', 'redblue', 'run', '--tests', '10', '--max-cost-usd', '3', '--format', 'json'])
    expect(labSpec(LAB.find(entry => entry.id === 'mh-redblue-mock')!, state)?.args).toContain('--mock-judge')
    expect(labSpec(LAB.find(entry => entry.id === 'mh-learn-plan')!, state)?.args).not.toContain('--run')
    expect(labSpec(LAB.find(entry => entry.id === 'mh-evolve-plan')!, state)?.args).not.toContain('--confirm')
  })

  it('audit-trend and similarity diff the newest two stored audits by key, and wait for two', () => {
    const trend = LAB.find(entry => entry.id === 'mh-trend')!
    const similarity = LAB.find(entry => entry.id === 'mh-similarity')!
    const state = withAudits(CLI_OUT['mh-audit-list'] ?? '')

    expect(auditKeys(state)).toEqual(['audit-2026-10-01T09-00-00-000Z', 'audit-2026-10-02T09-00-00-000Z'])
    expect(labSpec(trend, state)?.args).toEqual(['metaharness', 'audit-trend', '--baseline-key', 'audit-2026-10-01T09-00-00-000Z', '--current-key', 'audit-2026-10-02T09-00-00-000Z', '--format', 'json'])
    expect(labSpec(similarity, state)?.args.slice(2, 6)).toEqual(['--a-key', 'audit-2026-10-01T09-00-00-000Z', '--b-key', 'audit-2026-10-02T09-00-00-000Z'])
    expect(labSpec(trend, newState({}))).toBeNull()
    expect(labWhy(trend)).toMatch(/needs two stored audits/)
  })
})

describe('the audit probe', () => {
  it('reads audit-list rows as they are written: key, finishedAt, worst, oldest first', () => {
    expect(auditsOf(CLI_OUT['mh-audit-list'] ?? '')).toEqual({
      total: 2,
      points: [
        { atMs: Date.parse('2026-10-01T09:00:03.000Z'), worst: 'clean', key: 'audit-2026-10-01T09-00-00-000Z' },
        { atMs: Date.parse('2026-10-02T09:00:04.000Z'), worst: 'low', key: 'audit-2026-10-02T09-00-00-000Z' },
      ],
    })
  })
})

describe('the lab readers', () => {
  it('mcp-scan and threat-model: the worst, a count per severity, each finding, the access flags', () => {
    expect(labLines('mh-mcp-scan', CLI_OUT['mh-mcp-scan'] ?? '')).toEqual(['worst low · 1 finding', 'by severity: critical 0 · high 0 · medium 0 · low 1 · info 0', '[low] 12 unpinned dependency range(s)'])

    const threat = labLines('mh-threat', CLI_OUT['mh-threat'] ?? '')

    expect(threat[0]).toBe('worst low · verdict clean · 1 finding')
    expect(threat).toContain('secretsReachable no · networkAccess no · shellAccess no · fileWrite no · policyDefaultDeny yes · auditLog yes')
    expect(threat).toContain('tools allowed 25 · denied 3')
  })

  it('redblue: tests, failures and cost from a mock-judged run, each compromised family', () => {
    const lines = labLines('mh-redblue-mock', CLI_OUT['mh-redblue-mock'] ?? '')

    expect(lines[0]).toMatch(/^tests 10 · failures \d+ · critical \d+ · high \d+/)
    expect(lines[1]).toMatch(/^cost \$0\.000 · gates (passed|FAILED) · block production (yes|no)$/)
    expect(lines.some(line => line.startsWith('✗ '))).toBe(true)
  })

  it('gepa render: the size and source, then the prompt line by line', () => {
    const lines = labLines('mh-gepa-render', CLI_OUT['mh-gepa-render'] ?? '')

    expect(lines[0]).toBe('4280 chars from genome-promoted-cand6-edit-by-midpoint.json')
    expect(lines[1]).toMatch(/^You are an autonomous bug-fixing agent/)
    expect(lines.length).toBeLessThanOrEqual(LAB_MAX_LINES)
  })

  it('text output keeps its lines without banners; JSON without a reader is flattened; nothing printed says so', () => {
    const doctor = labLines('mh-doctor', CLI_OUT['mh-doctor'] ?? '')

    expect(doctor.some(line => line.startsWith('✓ MetaHarness (ADR-150)'))).toBe(true)
    expect(doctor.some(line => /\u001b|─────/.test(line))).toBe(false)
    expect(labLines('mh-learn-plan', '{\n  "status": "checkout-required",\n  "dryRun": true,\n  "durationMs": 26\n}\n')).toEqual(['status: checkout-required', 'dryRun: true'])
    expect(labLines('mh-receipts', '[]\n')).toEqual(['(none yet)'])
    expect(labLines('mh-bench-verify', '', 'bench: --suite path does not exist: .metaharness/bench/suite.json\n')).toEqual(['bench: --suite path does not exist: .metaharness/bench/suite.json'])
    expect(labLines('mh-genome', '')).toEqual(['mh-genome: printed nothing'])
    expect(labLines('mh-x', Array.from({ length: 90 }, (_, i) => `line ${i}`).join('\n'))).toHaveLength(LAB_MAX_LINES)
  })

  it('the headless answer is the newest lab result for that id, never an older one', () => {
    const state = newState({})

    state.lab.result = { id: 'mh-genome', label: 'genome', ok: true, exitCode: 0, lines: ['verdict: ready'], atMs: 100 }
    expect(labAnswer(state, 'mh-genome', 50)).toBe('✓ genome · exit 0\n  verdict: ready')
    expect(labAnswer(state, 'mh-genome', 150)).toBeNull()
    expect(labAnswer(state, 'mh-threat', 50)).toBeNull()
  })
})
