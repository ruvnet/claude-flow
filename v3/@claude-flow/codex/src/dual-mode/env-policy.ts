/**
 * Environment-name deny policies for children that inherit ruflo's environment.
 *
 * Command hosts (`ruflo team run`, and `passEnv` in
 * `@claude-flow/cli` `src/mcp-tools/team-hosts/command.ts`) use
 * `isProtectedEnvName`. #3513 MAJOR A: those two paths used to keep separate
 * regexes, and the base-environment strip was the narrower one, so a trusted
 * command host still received `PGPASSWORD`, `DATABASE_URL`, `SSH_AUTH_SOCK`,
 * `GITHUB_PAT`, `MYSQL_PWD`, `SESSION_SECRET_X`, `MY_AUTH`,
 * `SLACK_WEBHOOK_URL`, and every `CLAUDE_FLOW_*` name. Both of those call
 * sites import this function. A name added to one and not the other is that
 * bug again.
 *
 * Dual-mode orchestrator workers are ruflo's own children, not an untrusted
 * command host. They keep `isOrchestratorProtectedEnvName`, the rule `main`
 * used before this PR (#3513 round 4): drop secret-shaped suffixes and the
 * policy/identity `CLAUDE_FLOW_*` names, and leave base URLs and the rest of
 * `CLAUDE_FLOW_*` in place. Applying the command-host list there makes a
 * worker that talks through `ANTHROPIC_BASE_URL` or `OLLAMA_BASE_URL` call
 * the default endpoint instead.
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
 * True when `name` must never reach a command host: it looks like a secret,
 * or it is one of Ruflo's own variables. `PWD` (present working directory)
 * is the one explicit exception — it is not a secret, and it would otherwise
 * match the `PWD` suffix token meant to catch `MYSQL_PWD`.
 */
export function isProtectedEnvName(name: string): boolean {
  if (name === 'PWD') return false;
  const upper = name.toUpperCase();
  if (SENSITIVE_SUBSTRINGS.some((s) => upper.includes(s))) return true;
  if (SUFFIX_TOKEN_RE.test(name)) return true;
  return CLAUDE_FLOW_RE.test(name);
}

/**
 * The dual-mode orchestrator's deny rule from `main`, kept verbatim so a
 * worker still receives gateway base URLs and non-policy `CLAUDE_FLOW_*`
 * settings. Secret-shaped suffixes and the policy/identity names stay out.
 */
const ORCHESTRATOR_SENSITIVE_RE = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/i;

export function isOrchestratorProtectedEnvName(name: string): boolean {
  return ORCHESTRATOR_SENSITIVE_RE.test(name)
    || name.startsWith('CLAUDE_FLOW_POLICY_')
    || name === 'CLAUDE_FLOW_PRINCIPAL_ID'
    || name === 'CLAUDE_FLOW_MCP_INVOCATION_TOKEN'
    || name === 'CLAUDE_FLOW_MCP_CALLER_PUBKEY';
}
