/**
 * Environment-name deny policy shared by every path that hands ruflo's own
 * environment to a child process:
 *
 *  - `buildWorkerEnvironment` (process.ts, this package) — the base-environment
 *    strip applied before spawning ANY headless worker or command host.
 *  - `passEnv` validation for custom command hosts
 *    (`@claude-flow/cli` `src/mcp-tools/team-hosts/command.ts`) — names a
 *    project's `.claude-flow/team-hosts.json` entry may re-add after the strip.
 *
 * #3513 review MAJOR A: these two used to keep separately maintained regexes.
 * `buildWorkerEnvironment`'s was narrower (it required a `_`-or-start anchor,
 * so `PGPASSWORD` slipped through) and didn't strip `CLAUDE_FLOW_*` generally
 * (only three exact names), so a trusted command host's *base* environment —
 * copied before `passEnv` is ever consulted — still received `PGPASSWORD`,
 * `DATABASE_URL`, `SSH_AUTH_SOCK`, `GITHUB_PAT`, `MYSQL_PWD`,
 * `SESSION_SECRET_X`, `MY_AUTH`, `SLACK_WEBHOOK_URL`, and every `CLAUDE_FLOW_*`
 * variable, regardless of what a host's `passEnv` would have refused. Both
 * call sites MUST import `isProtectedEnvName` from here rather than keep a
 * local copy — a name added to one and not the other is exactly this bug.
 */

/**
 * Bare substrings that make a name secret-shaped wherever they appear
 * (case-insensitive): `FOO_SECRET`, `SESSION_SECRET_X`, `MY_AUTH`,
 * `SSH_AUTH_SOCK`, `SLACK_WEBHOOK_URL`, `PGPASSWORD` all match one of these.
 */
const SENSITIVE_SUBSTRINGS = [
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
  'CREDENTIAL',
  'PRIVATE',
  'AUTH',
  'COOKIE',
  'SESSION',
  'WEBHOOK',
  'APIKEY',
] as const;

/**
 * Suffix-anchored tokens: the token must end the name and be preceded by
 * either the start of the string or an underscore, so `OPENAI_API_KEY` and
 * `MYSQL_PWD` and `GITHUB_PAT` and `DATABASE_URL` match but `MONKEY` and a
 * bare `PWD` (present-working-directory, not a secret) do not.
 */
const SUFFIX_TOKEN_RE = /(?:^|_)(?:KEY|PWD|PAT|URL)$/i;

/** Ruflo's own identity/policy variables: never something a child should see. */
const CLAUDE_FLOW_RE = /^CLAUDE_FLOW_/i;

/**
 * True when `name` must never reach a headless worker or command host's
 * environment: it looks like a secret, or it is one of Ruflo's own
 * identity/policy variables. `PWD` (present working directory) is the one
 * explicit exception — it is not a secret, and it would otherwise match the
 * `PWD` suffix token meant to catch `MYSQL_PWD`.
 */
export function isProtectedEnvName(name: string): boolean {
  if (name === 'PWD') return false;
  const upper = name.toUpperCase();
  if (SENSITIVE_SUBSTRINGS.some((s) => upper.includes(s))) return true;
  if (SUFFIX_TOKEN_RE.test(name)) return true;
  return CLAUDE_FLOW_RE.test(name);
}
