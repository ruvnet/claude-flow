/**
 * The static keyword router, in-process.
 *
 * A hooks module may import nothing outside its plugin folder, so this is a
 * copy of `.claude/helpers/router.cjs` (TASK_PATTERNS, word-boundary
 * matching, first match wins). It is not a fork: the parity test in
 * `v3/@claude-flow/cli/__tests__/mods/route-parity.test.ts` fails CI when the
 * table or the matching drifts from router.cjs.
 *
 * The one deliberate difference is #3567: a prompt nothing matched says so
 * (`matched: false`, `reason: "no-match-default"`) and carries the
 * NO_MATCH_CONFIDENCE prior that `hooks_route` uses, never a real match's.
 */

export type RouteResult = {
  readonly agent: string
  readonly confidence: number
  readonly matched: boolean
  readonly reason: string
}

/** A real keyword match's heuristic prior (router.cjs, #2257). */
export const MATCH_CONFIDENCE = 0.6

/** `NO_MATCH_CONFIDENCE` in cli/src/mcp-tools/hooks-tools.ts (#3567). */
export const NO_MATCH_CONFIDENCE = 0.3

export const TASK_PATTERNS: ReadonlyArray<{ readonly tokens: readonly string[]; readonly agent: string }> = [
  { tokens: ['implement', 'create', 'build', 'add', 'write code', 'refactor', 'debug'], agent: 'coder' },
  { tokens: ['test', 'tests', 'testing', 'spec', 'specs', 'coverage', 'unit test', 'integration test'], agent: 'tester' },
  { tokens: ['review', 'audit', 'check', 'validate', 'security'], agent: 'reviewer' },
  { tokens: ['research', 'find', 'search', 'documentation', 'explore'], agent: 'researcher' },
  { tokens: ['design', 'architect', 'architecture', 'structure', 'plan'], agent: 'architect' },
  { tokens: ['api', 'endpoint', 'server', 'backend', 'database'], agent: 'backend-dev' },
  { tokens: ['ui', 'frontend', 'component', 'react', 'css', 'style'], agent: 'frontend-dev' },
  { tokens: ['deploy', 'docker', 'ci', 'cd', 'ci/cd', 'pipeline', 'infrastructure', 'devops'], agent: 'devops' },
]

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** router.cjs `buildPattern`: phrases literal, single tokens `\b`-anchored. */
export function buildPattern(tokens: readonly string[]): RegExp {
  const alternatives = tokens.map(tok => {
    const escaped = escapeRegex(tok.toLowerCase())
    return /\s|\//.test(tok) ? escaped : `\\b${escaped}\\b`
  })
  return new RegExp(`(?:${alternatives.join('|')})`, 'i')
}

// Compiled once per module load: the hot path is one regex test per entry.
const COMPILED = TASK_PATTERNS.map(entry => ({
  agent: entry.agent,
  reason: `Matched keyword(s) from: ${entry.tokens.join('|')}`,
  regex: buildPattern(entry.tokens),
}))

/**
 * Routes a task description to an agent type.
 *
 * @param task the prompt text; anything else routes as no-match
 */
export function routeTask(task: unknown): RouteResult {
  const text = typeof task === 'string' ? task.toLowerCase() : ''

  for (const entry of COMPILED) {
    if (entry.regex.test(text)) {
      return { agent: entry.agent, confidence: MATCH_CONFIDENCE, matched: true, reason: entry.reason }
    }
  }

  return {
    agent: 'coder',
    confidence: NO_MATCH_CONFIDENCE,
    matched: false,
    reason: 'no-match-default',
  }
}
