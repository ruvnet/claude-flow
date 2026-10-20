/**
 * Keyword routers must match whole words, not substrings.
 *
 * Observed live: "sync and review latest issues" routed to `tester` at 0.8
 * because the pattern `test|spec|coverage|unit test|integration` was compiled
 * with `new RegExp(pattern, 'i')` and no word boundaries — "la-TEST" matched.
 * The same class of bug made `ui` match "build"/"guide"/"quick", `ci`/`cd`
 * match "decide"/"special", `add` match "address".
 *
 * #2257 already anchored the generated router (helpers-generator.ts), but:
 *   - the repo-root `.claude/helpers/router.cjs` still carried the substring
 *     version, and
 *   - `suggestAgentsForTask()` in mcp-tools/hooks-tools.ts (used by
 *     hooks_pre-task, and as the keyword fallback of hooks_route and
 *     hooks_explain) used `taskLower.includes(keyword)` — `'test'` matched
 *     "latest" at 0.95 confidence, `'auth'` matched "author", `'fix'`
 *     matched "prefix", `'api'` matched "capital".
 *
 * Every copy is driven through the same table here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

// hooks-tools pulls optional native / memory modules at call time only; the
// keyword matcher is pure, so no mocks are needed beyond silencing init logs.
vi.spyOn(console, 'log').mockImplementation(() => {});

import { generateAgentRouter } from '../src/init/helpers-generator.js';
import { NO_MATCH_CONFIDENCE, suggestAgentsForTask } from '../src/mcp-tools/hooks-tools.js';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));

type RouteResult = { agent: string; confidence: number; reason: string };
type Router = { routeTask: (task: string) => RouteResult };

// Load router source as CommonJS from a temp dir. The in-repo .js snapshots
// live under a "type": "module" package, so they cannot be require()d in place;
// user projects load them as CJS via hook-handler.cjs.
function loadRouterSource(source: string): Router {
  const dir = mkdtempSync(join(tmpdir(), 'router-wb-'));
  const file = join(dir, 'router.cjs');
  writeFileSync(file, source);
  try {
    return require(file) as Router;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ROUTERS: Array<[string, () => Router]> = [
  ['generated (helpers-generator.ts)', () => loadRouterSource(generateAgentRouter())],
  ['repo-root .claude/helpers/router.cjs', () => loadRouterSource(readFileSync(join(here, '../../../../.claude/helpers/router.cjs'), 'utf8'))],
  ['cli .claude/helpers/router.cjs', () => loadRouterSource(readFileSync(join(here, '../.claude/helpers/router.cjs'), 'utf8'))],
  ['mcp .claude/helpers/router.js', () => loadRouterSource(readFileSync(join(here, '../../mcp/.claude/helpers/router.js'), 'utf8'))],
];

// [task, expected] — expected is an agent, `{ not: agent }`, or `{ oneOf: [...] }`.
type Expect = string | 'default' | { not: string } | { oneOf: string[] };
const HELPER_CASES: Array<[string, Expect]> = [
  // Negatives — the live bugs
  ['sync and review latest issues', { not: 'tester' }],
  ['sync and review latest issues', 'reviewer'],
  ['can we integrate into ruflo', { not: 'tester' }],
  ['guide me through the quick setup', { not: 'frontend-dev' }],
  ['decide on the approach', { not: 'devops' }],
  ['a special case in the parser', { not: 'devops' }],
  ['address the bug', 'default'], // 'add' must not match "address"
  ['write specifications for the parser', { not: 'tester' }],
  // Positives — real intent still matches
  ['write unit tests for auth', 'tester'],
  ['add integration tests for the api', { oneOf: ['coder', 'tester'] }],
  ['improve test coverage', 'tester'],
  ['testing the login flow', 'tester'],
  ['build the UI component', { oneOf: ['coder', 'frontend-dev'] }],
  ['style the react component', 'frontend-dev'],
  ['set up ci pipeline', 'devops'],
  ['add JWT support', 'coder'],
];

function check(r: RouteResult, want: Expect): boolean {
  const actual = r.agent;
  if (want === 'default') return r.confidence < 0.5;
  if (typeof want === 'string') return actual === want;
  if ('not' in want) return actual !== want.not;
  return want.oneOf.includes(actual);
}

describe.each(ROUTERS)('helper router word boundaries: %s', (_name, load) => {
  const router = load();

  it.each(HELPER_CASES)('%s → %j', (task, want) => {
    const r = router.routeTask(task);
    expect(check(r, want), `${task} routed to ${r.agent} (${r.reason})`).toBe(true);
  });

  it('never reports the old 0.8 "learned" confidence for a keyword hit', () => {
    expect(router.routeTask('write unit tests for auth').confidence).toBeLessThan(0.8);
  });
});

describe('hooks-tools suggestAgentsForTask word boundaries', () => {
  const DEFAULT = ['coder', 'researcher', 'tester'];

  it.each([
    'sync and review latest issues', // 'test' in "latest"
    'update the author field', //       'auth' in "author"
    'strip the prefix', //              'fix' in "prefix"
    'capitalize the heading', //        'api' in "capitalize"
  ])('"%s" falls through to the default instead of a substring hit', (task) => {
    const r = suggestAgentsForTask(task);
    expect(r.agents).toEqual(DEFAULT);
    // #3567: the fall-through is an explicit no-match, not a 0.7 "match".
    expect(r.matched).toBe(false);
    expect(r.confidence).toBe(NO_MATCH_CONFIDENCE);
  });

  it.each([
    ['write unit tests for the parser', 'tester'],
    ['testing the login flow', 'tester'],
    ['fix the crash on startup', 'coder'],
    ['fixes for the parser', 'coder'],
    ['add auth to the gateway', 'security-architect'],
    ['document the api', 'architect'],
    ['set up ci/cd', 'devops'],
    ['deploying to staging', 'devops'],
  ])('"%s" still routes to %s', (task, first) => {
    expect(suggestAgentsForTask(task).agents[0]).toBe(first);
  });
});
