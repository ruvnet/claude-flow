/**
 * CASA authority envelope module (ADR-380 §3 / ADR-240 §4).
 *
 * Re-exports:
 *  - `schema.ts`  — the envelope's Zod schema + inferred type.
 *  - `compile.ts` — deterministic, rule-based intent -> envelope compiler.
 *  - `enforce.ts` — deterministic, LLM-free envelope enforcement.
 */

export { CasaEnvelopeSchema, type CasaEnvelope } from './schema.js';
export {
  compileIntentToEnvelope,
  type CasaTranslator,
  type CompileIntentOptions,
  DANGEROUS_SCOPES,
  DEFAULT_BUDGET_USD,
  DEFAULT_TTL_MINUTES,
} from './compile.js';
export { checkAuthorization, type AuthorizationResult } from './enforce.js';
