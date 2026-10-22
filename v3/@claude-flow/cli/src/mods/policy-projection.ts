/**
 * The policy projection the ruflo mod reads (ADR-404).
 *
 * A hooks module may read at most 4 MiB and cannot import @claude-flow/security,
 * while `.claude-flow/policy/state.json` carries the whole receipt ledger
 * (tens of MB on a busy project). So every policy state write also writes a
 * small file holding only what the mod's `tool.check` needs: the mode and the
 * rules that name a `claude-code.` action explicitly. Legacy mode, or no such
 * rule, removes the file, and the mod then adds no policy of its own.
 *
 * The projection never authorizes anything: the mod only tightens Claude
 * Code's own verdict with it, so a deleted or stale projection returns to the
 * no-mod baseline and can never loosen a call. It is not a ledger and holds
 * no receipts; issue #3602 (the ledger anchor) is untouched by it.
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PolicyRule, PolicyState } from '@claude-flow/security';

export const PROJECTION_RELATIVE = join('.claude-flow', 'policy', 'claude-code.json');
export const CLAUDE_CODE_ACTION_PREFIX = 'claude-code.';

export interface PolicyProjection {
  version: 1;
  mode: PolicyState['mode'];
  generatedAt: number;
  rules: PolicyRule[];
}

/** Whether a rule names Claude Code tool calls explicitly (never via `*` or no actions). */
export function targetsClaudeCode(rule: Pick<PolicyRule, 'actions'>): boolean {
  return Array.isArray(rule.actions) && rule.actions.some((a) => typeof a === 'string' && a.startsWith(CLAUDE_CODE_ACTION_PREFIX));
}

/** The projection of a state, or null when there is nothing to project. */
export function projectionOf(state: Pick<PolicyState, 'mode' | 'rules'>, now = Date.now()): PolicyProjection | null {
  if (state.mode === 'legacy') return null;
  const rules = (Array.isArray(state.rules) ? state.rules : []).filter(targetsClaudeCode).map((rule) => ({
    id: rule.id,
    effect: rule.effect,
    actions: [...rule.actions],
    ...(rule.enabled !== undefined ? { enabled: rule.enabled } : {}),
    ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
    ...(rule.resources ? { resources: [...rule.resources] } : {}),
    ...(rule.principals ? { principals: [...rule.principals] } : {}),
    ...(rule.identityTypes ? { identityTypes: [...rule.identityTypes] } : {}),
    ...(rule.roles ? { roles: [...rule.roles] } : {}),
    ...(rule.environments ? { environments: [...rule.environments] } : {}),
    ...(rule.constraints ? { constraints: { ...rule.constraints } } : {}),
  }));
  if (rules.length === 0) return null;
  return { version: 1, mode: state.mode, generatedAt: now, rules };
}

export type ProjectionSync = { action: 'written' | 'removed' | 'unchanged'; path: string };

/**
 * Writes (atomically, owner-only) or removes the projection for a state.
 * Throws on I/O failure; policy-runtime calls it after the state is safely
 * written and keeps the state write's own result whatever happens here.
 */
export function syncPolicyProjection(projectRoot: string, state: Pick<PolicyState, 'mode' | 'rules'>): ProjectionSync {
  const path = join(resolve(projectRoot), PROJECTION_RELATIVE);
  const projection = projectionOf(state);
  if (!projection) {
    if (!existsSync(path)) return { action: 'unchanged', path };
    unlinkSync(path);
    return { action: 'removed', path };
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(projection, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  return { action: 'written', path };
}
