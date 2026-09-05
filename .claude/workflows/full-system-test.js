export const meta = {
  name: 'full-system-test',
  description: 'Full system test — CLI build + test suite + runtime smoke + all plugin smoke contracts, run in parallel, with a synthesized pass/fail report',
  phases: [
    { title: 'Test', detail: 'parallel: build, unit tests, CLI runtime smoke, plugin contracts' },
    { title: 'Report', detail: 'synthesize a single green/red verdict' },
  ],
}

// args (optional): { skipTests?: boolean } — skip the (slow) vitest suite, run the rest
const skipTests = !!(args && args.skipTests)

const CLI = 'v3/@claude-flow/cli'

const DIM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'ok', 'summary'],
  properties: {
    dimension: { type: 'string' },
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    metrics: { type: 'object', additionalProperties: true },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

const DIMS = [
  {
    key: 'build', agentType: 'coder',
    prompt: `From the repo root, verify the CLI builds cleanly. Run: \`cd ${CLI} && npm run build\` (this runs tsc). Set ok=true ONLY if the build exits 0 with zero type errors. Put the type-error count in metrics.errors and the first few error lines in failures[]. dimension="build". Do NOT modify any files — read/run only.`,
  },
  {
    key: 'unit-tests', agentType: 'tester',
    prompt: `From the repo root, run the CLI automated test suite. In ${CLI}, read package.json "scripts" to find the test command (likely "vitest run" / "npm test"). Run the FULL suite non-interactively (e.g. \`cd ${CLI} && npx vitest run --reporter=dot\` or the package's test script). Put total/passed/failed/skipped in metrics and list notable failing test files in failures[]. ok=true ONLY if failed=0. If the suite is too large to finish in a reasonable time, run as much as you can, set metrics.truncated=true, and report the counts you got. dimension="unit-tests". Do NOT modify tests or source to make anything pass.`,
  },
  {
    key: 'cli-smoke', agentType: 'tester',
    prompt: `From the repo root, smoke-test the built CLI runtime. Ensure ${CLI} is built (if dist/ is missing, run \`npm run build\` there first). Find the entry from ${CLI}/package.json "bin", then run three commands via node and confirm each exits cleanly with sane output: (1) the version flag, (2) --help, (3) \`doctor\`. Record per-command ok in metrics (e.g. metrics.version, metrics.help, metrics.doctor) and put any crash/stack output in failures[]. ok=true if all three run without crashing. dimension="cli-smoke". Do NOT modify files.`,
  },
  {
    key: 'plugin-contracts', agentType: 'tester',
    prompt: `From the repo root, run EVERY plugin smoke contract: for each script matching the glob plugins/*/scripts/smoke.sh, run it with bash and read its trailing "N passed, M failed" line and exit code. Put metrics.totalPlugins, metrics.passing, metrics.failing. List each failing plugin as "<plugin>: M failed" in failures[]. ok=true ONLY if every plugin smoke exits 0. dimension="plugin-contracts". Do NOT modify files — read/run only.`,
  },
]

phase('Test')
const active = DIMS.filter((d) => !(skipTests && d.key === 'unit-tests'))
const results = (await parallel(
  active.map((d) => () =>
    agent(d.prompt, { label: `test:${d.key}`, phase: 'Test', schema: DIM_SCHEMA, agentType: d.agentType })
  )
)).filter(Boolean)

phase('Report')
const failed = results.filter((r) => !r.ok)
const summary = {
  green: failed.length === 0,
  passed: results.length - failed.length,
  total: results.length,
  skippedTests: skipTests,
  dimensions: results.map((r) => ({ dimension: r.dimension, ok: r.ok, summary: r.summary, metrics: r.metrics || {} })),
  failures: failed.flatMap((r) => (r.failures || []).map((f) => `[${r.dimension}] ${f}`)),
}
log(`Full system test: ${summary.passed}/${summary.total} dimensions green${summary.green ? ' — ALL PASS' : ''}`)
return summary
