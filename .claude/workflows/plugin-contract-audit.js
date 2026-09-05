export const meta = {
  name: 'plugin-contract-audit',
  description: 'Run every ruflo plugin smoke contract, fan diagnosis agents out over the failures, and report a punch list',
  phases: [
    { title: 'Sweep', detail: 'run all plugins/*/scripts/smoke.sh, collect pass/fail' },
    { title: 'Diagnose', detail: 'one agent per failing plugin — root cause + minimal fix' },
    { title: 'Report', detail: 'assemble the audit summary' },
  ],
}

// args (all optional):
//   string                       → only audit plugins whose name contains this substring
//   { filter?: string,           → same substring filter
//     diagnose?: boolean }        → set false to skip the Diagnose phase (sweep only)
const opts = typeof args === 'string' ? { filter: args } : (args || {})
const FILTER = opts.filter || ''
const DIAGNOSE = opts.diagnose !== false

const SWEEP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['plugin', 'passed', 'failed'],
        properties: {
          plugin: { type: 'string' },
          passed: { type: 'integer' },
          failed: { type: 'integer' },
          exitCode: { type: 'integer' },
          failingChecks: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const DIAGNOSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['plugin', 'rootCause', 'proposedFix', 'confident'],
  properties: {
    plugin: { type: 'string' },
    rootCause: { type: 'string' },
    proposedFix: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    confident: { type: 'boolean' },
  },
}

phase('Sweep')
const filterClause = FILTER
  ? `Only audit plugins whose directory name contains "${FILTER}". `
  : ''
const sweep = await agent(
  `From the repo root, audit every ruflo plugin's smoke contract. ${filterClause}For each script matching the glob plugins/*/scripts/smoke.sh, run it with bash and capture its output and exit code. Each smoke script prints a trailing "N passed, M failed" line.
For every plugin report: plugin (the directory name under plugins/), passed (integer), failed (integer), exitCode (integer), and failingChecks (the "→ ..." lines that printed FAIL, verbatim, empty array if none).
Do NOT modify any files — this is read/run only. Return every audited plugin via the schema, not just the failing ones.`,
  { label: 'sweep:all-smokes', phase: 'Sweep', schema: SWEEP_SCHEMA, agentType: 'tester' }
)

const results = (sweep?.results || []).filter((r) => !FILTER || r.plugin.includes(FILTER))
const failures = results.filter((r) => r.failed > 0 || (r.exitCode && r.exitCode !== 0))
log(`Sweep: ${results.length} plugins audited, ${failures.length} failing`)

let diagnoses = []
if (DIAGNOSE && failures.length) {
  phase('Diagnose')
  diagnoses = (await parallel(
    failures.map((f) => () =>
      agent(
        `Plugin "${f.plugin}" fails its smoke contract (plugins/${f.plugin}/scripts/smoke.sh): ${f.failed} check(s) failed. Failing checks:\n${(f.failingChecks || []).join('\n') || '(not captured — re-run the smoke script to see them)'}\n\nRead plugins/${f.plugin}/scripts/smoke.sh and the plugin files it inspects (plugin.json, README.md, skills, agents, commands, docs/adrs). Determine the ROOT CAUSE of each failing check and propose a MINIMAL fix. Distinguish a stale assertion in smoke.sh (the contract drifted from reality) from a genuine plugin defect. Do NOT edit anything — report only, via the schema, with confident=true only if the root cause is unambiguous.`,
        { label: `diagnose:${f.plugin}`, phase: 'Diagnose', schema: DIAGNOSIS_SCHEMA, agentType: 'code-analyzer' }
      )
    )
  )).filter(Boolean)
  log(`Diagnose: ${diagnoses.length}/${failures.length} diagnosed`)
}

phase('Report')
const summary = {
  audited: results.length,
  passing: results.length - failures.length,
  failing: failures.length,
  failingPlugins: failures.map((f) => ({ plugin: f.plugin, failed: f.failed })),
  diagnoses,
}
log(`Report: ${summary.passing}/${summary.audited} plugins pass their contract`)
return summary
