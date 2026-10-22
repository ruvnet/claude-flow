// @ts-check
/**
 * Input validation at the plugin boundary (ADR-405 §Security).
 *
 * Every id that reaches a remote command is checked against a strict
 * allow-list pattern here, and every desktop reference is resolved against
 * the caller's OWN desktop list — never passed through as given.
 */
import { RuosError } from './types.mjs';

/** fleet registry id — 32 lowercase hex */
export const DESKTOP_ID_RE = /^[0-9a-f]{32}$/;
/** Fly machine id — 14 lowercase hex */
export const FLY_ID_RE = /^[0-9a-f]{14}$/;
/** run id — also embedded in remote paths, so no separators beyond '-' */
export const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{5,62}$/;
/** agent id / type — subset of ruflo's validateIdentifier charset */
export const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const SSH_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
export const FLY_APP_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MODELS = /** @type {const} */ (['haiku', 'sonnet', 'opus']);

export const MAX_PROMPT_BYTES = 64 * 1024;

/**
 * @param {unknown} v
 * @param {RegExp} re
 * @param {string} label
 * @returns {string}
 */
export function assertMatch(v, re, label) {
  if (typeof v !== 'string' || !re.test(v)) {
    throw new RuosError('invalid-input', `${label} is invalid`);
  }
  return v;
}

/** @param {unknown} v */
export const assertRunId = (v) => assertMatch(v, RUN_ID_RE, 'runId');
/** @param {unknown} v */
export const assertAgentId = (v) => assertMatch(v, AGENT_ID_RE, 'agentId');

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {string} label
 * @returns {number}
 */
export function assertInt(v, min, max, label) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new RuosError('invalid-input', `${label} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

/**
 * @param {unknown} v
 * @returns {'haiku'|'sonnet'|'opus'|undefined}
 */
export function assertModel(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'string' && /** @type {readonly string[]} */ (MODELS).includes(v)) {
    return /** @type {'haiku'|'sonnet'|'opus'} */ (v);
  }
  throw new RuosError('invalid-input', `model must be one of ${MODELS.join(', ')}`);
}

/**
 * A budget cap is printed into the remote command, so it is reduced to a
 * canonical decimal string here (no exponent, no sign, two decimals max).
 * @param {unknown} v
 * @returns {number|undefined}
 */
export function assertBudget(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' && /^\d{1,4}(\.\d{1,2})?$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1000) {
    throw new RuosError('invalid-input', 'maxBudgetUsd must be a number in (0, 1000]');
  }
  return Math.round(n * 100) / 100;
}

/**
 * Prompt text never enters a command line verbatim (it is base64-encoded by
 * the builder), but it is still bounded and must be valid text.
 * @param {unknown} v
 * @returns {string}
 */
export function assertPrompt(v) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new RuosError('invalid-input', 'prompt must be a non-empty string');
  }
  if (Buffer.byteLength(v, 'utf8') > MAX_PROMPT_BYTES) {
    throw new RuosError('invalid-input', `prompt exceeds ${MAX_PROMPT_BYTES} bytes`);
  }
  if (v.includes('\0')) throw new RuosError('invalid-input', 'prompt contains NUL');
  return v;
}

/**
 * Resolve a user-supplied desktop reference (registry id, Fly id, name or
 * display name) against the caller's own desktops. Anything not in that
 * list is refused — this is what keeps a typo, a stale id or a forged id
 * from ever reaching a transport.
 * @param {import('./types.mjs').Desktop[]} owned
 * @param {unknown} ref
 * @returns {import('./types.mjs').Desktop}
 */
export function resolveDesktop(owned, ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 128) {
    throw new RuosError('invalid-input', 'desktop reference is invalid');
  }
  const byId = owned.filter((d) => d.id === ref || (d.flyMachineId !== null && d.flyMachineId === ref));
  if (byId.length === 1) return byId[0];
  const byName = owned.filter((d) => d.name === ref || d.displayName === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new RuosError('ambiguous', `desktop name matches ${byName.length} desktops; use its machine id`);
  }
  throw new RuosError('not-owned', 'desktop is not in your desktop_status list');
}

/**
 * A fresh per-command marker nonce (64 random bits, 16 hex chars).
 * @param {(n: number) => Buffer} randomBytes
 */
export function newNonce(randomBytes) {
  return randomBytes(8).toString('hex');
}

/**
 * A path-safe run id with 128 random bits; also the jobs-API idempotency key.
 * @param {(n: number) => Buffer} randomBytes
 * @returns {string}
 */
export function newRunId(randomBytes) {
  return `r-${randomBytes(16).toString('hex')}`;
}
