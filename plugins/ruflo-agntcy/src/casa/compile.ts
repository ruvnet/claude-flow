/**
 * Deterministic, rule-based CASA intent compiler (ADR-380 §3 / ADR-240 §4).
 *
 * Translates a free-text `objective` into a bounded {@link CasaEnvelope}
 * using a small, static keyword/pattern table — no network calls, no LLM,
 * no nondeterministic judgment of any kind. This is intentionally a first,
 * honest pass: it is conservative (deny-by-default for the three dangerous
 * scopes) and only grants a scope when the objective contains language
 * that plausibly names it.
 *
 * ADR-380 §3 explicitly allows a future *translation* step to use an LLM
 * ("that's MetaHarness's job") — this module exposes that as the optional
 * `translator` parameter below, but never invokes one itself. Wiring an
 * LLM-based translator in here would violate the ADR's load-bearing
 * invariant just as much as putting one in `enforce.ts` would, since a
 * translator that silently widens `allow`/narrows `deny` at compile time
 * has the same practical effect as bypassing enforcement. Callers who add
 * an LLM-based translator remain responsible for treating its output as
 * untrusted and re-validating it against {@link CasaEnvelopeSchema}, which
 * this function already does for its own deterministic output.
 */

import { CasaEnvelopeSchema, type CasaEnvelope } from './schema.js';

/** Default envelope lifetime, in minutes, when `opts.defaultTtlMinutes` is omitted. */
export const DEFAULT_TTL_MINUTES = 60;

/** Default budget, in USD, when `opts.defaultBudgetUsd` is omitted. */
export const DEFAULT_BUDGET_USD = 5;

/**
 * Scopes that are ALWAYS denied unless the objective explicitly names the
 * activity that scope corresponds to. These mirror the ADR-380 §3 example
 * envelope's deny list verbatim.
 */
export const DANGEROUS_SCOPES = ['git.push', 'secret.export', 'deployment.create'] as const;

/**
 * One entry in the keyword/pattern table: if `pattern` matches the
 * objective, every scope in `allow` is granted. Patterns are matched
 * case-insensitively against the raw objective string; order does not
 * affect the result (all matching rules contribute, deduplicated).
 */
interface CompileRule {
  readonly pattern: RegExp;
  readonly allow: readonly string[];
}

/**
 * The keyword table. Kept small and explicit on purpose — this is a
 * first, honest pass, not an attempt to cover every possible phrasing.
 * Extend by adding rows, not by adding branching logic.
 */
const RULE_TABLE: readonly CompileRule[] = [
  // Safe, read-only activity.
  { pattern: /\b(review|reading|reads?|audit(?:ing)?|inspect(?:ing)?|analy[sz](?:e|ing|is)|scan(?:ning)?|check(?:ing)?)\b/i, allow: ['repository.read'] },
  // Test execution.
  { pattern: /\btest(?:s|ing)?\b/i, allow: ['tests.execute'] },
  // "Security" review language implies both reading the repo and running
  // its test/verification suite (mirrors the ADR-380 §3 worked example:
  // "review repository security" -> ["repository.read", "tests.execute"]).
  { pattern: /\bsecurity\b/i, allow: ['repository.read', 'tests.execute'] },
  // Explicit git push language — otherwise git.push stays denied by default.
  // Bare "push"/"pushing" only counts when it co-occurs with a git-object
  // noun (commit/branch/repo/code) or the literal "git push"; this keeps
  // "push notification", "push back on ...", "push through this fix" from
  // false-permissively granting git.push (found in adversarial review).
  {
    pattern:
      /\bgit\s+push\b|\bpush(?:ing)?\b(?=[\s\S]*\b(?:commits?|branch(?:es)?|repo(?:sitory)?|code)\b)/i,
    allow: ['git.push'],
  },
  // Explicit deploy/publish/release language — otherwise deployment.create
  // stays denied. Bare "deploy"/"publish"/"release" only count when they
  // co-occur with a deployment-target noun (service/app/version/
  // production/prod/staging/package/build/artifact/image) or a version
  // number (e.g. "v2.0"); this keeps "release notes", "publish a blog
  // post", "new release of the dependency" from false-permissively
  // granting deployment.create (found in adversarial review).
  {
    pattern:
      /\b(?:deploy(?:ment|ing|s)?|publish(?:ing)?|release(?:s|d|ing)?)\b(?=[\s\S]*\b(?:service|app(?:lication)?|version|production|prod|staging|package|build|artifact|image)\b|[\s\S]*\bv?\d+(?:\.\d+)+\b)/i,
    allow: ['deployment.create'],
  },
  // Explicit secret-export language — otherwise secret.export stays denied.
  { pattern: /\b(export(?:ing)?\s+secrets?|secrets?\s+export|export\s+credentials?)\b/i, allow: ['secret.export'] },
];

/** Extension point for a future translator (see module doc). Never called internally. */
export type CasaTranslator = (objective: string) => Partial<CasaEnvelope>;

export interface CompileIntentOptions {
  /** Overrides {@link DEFAULT_BUDGET_USD}. Must be positive if provided. */
  defaultBudgetUsd?: number;
  /** Overrides {@link DEFAULT_TTL_MINUTES}. Must be positive if provided. */
  defaultTtlMinutes?: number;
  /**
   * Optional, caller-supplied translator invoked AFTER the deterministic
   * rule table runs. Its `allow`/`deny` are unioned into the deterministic
   * result (never used to silently narrow `deny` for a dangerous scope
   * out from under the rule table); `budget_usd`/`expires_at`/`objective`,
   * if returned, override the defaults. This is the designated seam for a
   * future LLM-based compiler — `compileIntentToEnvelope` itself never
   * calls an LLM or makes a network request.
   */
  translator?: CasaTranslator;
  /** Clock override for tests. Defaults to `Date.now()`. */
  now?: () => Date;
}

function dedupeSorted(scopes: Iterable<string>): string[] {
  return Array.from(new Set(scopes)).sort();
}

/**
 * Compile a free-text objective into a bounded CASA authority envelope.
 *
 * Pure, deterministic rule application over {@link RULE_TABLE}:
 *  1. Start with `deny = [...DANGEROUS_SCOPES]`, `allow = []`.
 *  2. For every rule whose pattern matches `objective`, union its `allow`
 *     scopes into the result.
 *  3. Any dangerous scope that ended up in `allow` (because the objective
 *     explicitly named it) is removed from `deny` — a scope can never be
 *     load-bearingly present in both lists in this compiler's output,
 *     since `enforce.ts` treats `deny` as authoritative over `allow`.
 *  4. If a `translator` was supplied, its output is merged in (union for
 *     `allow`/`deny`, override for scalars) and the merged result is
 *     re-validated against {@link CasaEnvelopeSchema} — a misbehaving
 *     translator cannot produce a structurally invalid envelope.
 */
export function compileIntentToEnvelope(
  objective: string,
  opts: CompileIntentOptions = {},
): CasaEnvelope {
  const now = (opts.now ?? (() => new Date()))();
  const ttlMinutes = opts.defaultTtlMinutes ?? DEFAULT_TTL_MINUTES;
  const budgetUsd = opts.defaultBudgetUsd ?? DEFAULT_BUDGET_USD;

  const allowSet = new Set<string>();
  for (const rule of RULE_TABLE) {
    if (rule.pattern.test(objective)) {
      for (const scope of rule.allow) {
        allowSet.add(scope);
      }
    }
  }

  const denySet = new Set<string>(DANGEROUS_SCOPES);
  for (const scope of allowSet) {
    denySet.delete(scope);
  }

  let allow = dedupeSorted(allowSet);
  let deny = dedupeSorted(denySet);
  let objectiveOut = objective;
  let budgetOut = budgetUsd;
  let expiresAtOut = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();

  if (opts.translator) {
    const patch = opts.translator(objective);
    if (patch.allow) {
      allow = dedupeSorted([...allow, ...patch.allow]);
      // Anything the translator explicitly allows must not remain denied.
      deny = deny.filter((scope) => !allow.includes(scope));
    }
    if (patch.deny) {
      deny = dedupeSorted([...deny, ...patch.deny]);
    }
    if (patch.objective !== undefined) objectiveOut = patch.objective;
    if (patch.budget_usd !== undefined) budgetOut = patch.budget_usd;
    if (patch.expires_at !== undefined) expiresAtOut = patch.expires_at;
  }

  const candidate: CasaEnvelope = {
    objective: objectiveOut,
    allow,
    deny,
    budget_usd: budgetOut,
    expires_at: expiresAtOut,
  };

  // Re-validate: guarantees the compiler (and any translator patch) can
  // never hand back a structurally invalid envelope to a caller.
  return CasaEnvelopeSchema.parse(candidate);
}
