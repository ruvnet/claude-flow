/**
 * Plugin Permission Gate (ADR-320 Part B, Phase P4)
 *
 * Load-time enforcement of the permission ceiling declared via
 * `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS`. Extracted into its own module (rather
 * than inlined in `manager.ts`) both because the ceiling-parsing +
 * comparison logic is a cohesive, independently testable unit, and because
 * `manager.ts` is at the repo's 500-line-per-file ceiling (v3/CLAUDE.md) —
 * see that file for the corresponding size reduction.
 *
 * ---------------------------------------------------------------------
 * SCOPE — deliberately re-scoped down from the ADR's literal text
 * ---------------------------------------------------------------------
 * ADR-320 Part B describes enforcement at two points:
 *   1. Load time — refuse to load a plugin whose manifest exceeds a
 *      configurable ceiling.
 *   2. Invocation time — wrap every filesystem/network/hook-registration/
 *      subprocess call the plugin makes and check it against the plugin's
 *      own manifest on every call, not just once at load.
 *
 * `manager.ts` never actually loads or executes a plugin's code anywhere in
 * this repo today. `enable()` only flips a persisted `enabled` boolean on a
 * JSON manifest entry and logs an aspirational
 * `[SECURITY] Plugin loaded without sandboxing: ...` warning — there is no
 * dynamic `require()`/`import()` of plugin code, and therefore no
 * capability-invocation call sites to wrap. Building a real plugin
 * code-loader (so there is something to wrap) is a materially larger effort
 * than "P4" and is explicitly out of scope here — it would need its own
 * design (module isolation, capability shims for `fs`/`http`/`child_process`,
 * etc.) rather than being a natural extension of this manifest-comparison
 * logic.
 *
 * This module therefore implements enforcement point (1) only — a LOAD-TIME
 * GATE. Enforcement point (2), per-capability invocation-time checking, is
 * deferred until a plugin-code-loader exists in this repo. That is a
 * follow-up, not a numbered phase of this ADR.
 *
 * Backwards compatibility: when `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` is
 * unset, {@link parsePermissionCeiling} returns `undefined` and
 * {@link checkEnableAgainstCeiling} always allows — matching the same
 * opt-in-strictness rollout shape as `CLAUDE_FLOW_STRICT_PUBLISH`
 * (ADR-320 §Backwards compatibility).
 *
 * P5: strict-mode-default flip in v4.0, see ADR-320 §Integration plan
 */

import {
  validatePermissionManifest,
  type PluginPermissionManifest,
} from './manifest/permission-manifest.js';

/**
 * Wildcard sentinel used by `LEGACY_MAXIMAL_GRANT` (`'*'`/`'**'`), meaning
 * "no restriction" for that capability list.
 */
function isWildcard(pattern: string): boolean {
  return pattern === '*' || pattern === '**';
}

/**
 * Whether the ceiling's glob/host list permits a single requested entry.
 *
 * NOTE: this is an intentionally simple check — a literal match or a
 * wildcard sentinel on the ceiling side — not true glob-subsumption (e.g. a
 * ceiling of `src/**` does not currently recognize a requested `src/a.ts` as
 * covered unless the plugin also declared the identical pattern). That's a
 * reasonable P4 scope: it fails safe (denies) on patterns it can't prove are
 * covered, rather than risking a false "allowed". Real glob-subsumption is a
 * future enhancement, not required to close the ADR's load-time gap.
 */
function ceilingAllowsEntry(ceilingList: string[], requested: string): boolean {
  return ceilingList.some((allowed) => isWildcard(allowed) || allowed === requested);
}

/** Whether every entry in `requested` is covered by `ceilingList`. */
function listExceedsCeiling(ceilingList: string[], requested: string[]): boolean {
  return requested.some((entry) => !ceilingAllowsEntry(ceilingList, entry));
}

export type PermissionCapability =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network'
  | 'hooks'
  | 'memoryNamespaces'
  | 'subprocess';

export interface PermissionCeilingViolation {
  readonly capability: PermissionCapability;
  readonly reason: string;
}

/**
 * Pure comparison: does `requested` ask for anything `ceiling` does not
 * permit? Returns the list of violations (empty = compliant).
 */
export function findCeilingViolations(
  requested: PluginPermissionManifest,
  ceiling: PluginPermissionManifest
): PermissionCeilingViolation[] {
  const violations: PermissionCeilingViolation[] = [];

  if (listExceedsCeiling(ceiling.filesystem.read, requested.filesystem.read)) {
    violations.push({
      capability: 'filesystem.read',
      reason: `filesystem read access [${requested.filesystem.read.join(', ')}] exceeds the configured ceiling [${ceiling.filesystem.read.join(', ') || 'none'}]`,
    });
  }
  if (listExceedsCeiling(ceiling.filesystem.write, requested.filesystem.write)) {
    violations.push({
      capability: 'filesystem.write',
      reason: `filesystem write access [${requested.filesystem.write.join(', ')}] exceeds the configured ceiling [${ceiling.filesystem.write.join(', ') || 'none'}]`,
    });
  }
  if (listExceedsCeiling(ceiling.network.allowedHosts, requested.network.allowedHosts)) {
    violations.push({
      capability: 'network',
      reason: `network access to [${requested.network.allowedHosts.join(', ')}] exceeds the configured ceiling [${ceiling.network.allowedHosts.join(', ') || 'none'}]`,
    });
  }
  if (listExceedsCeiling(ceiling.hooks, requested.hooks)) {
    violations.push({
      capability: 'hooks',
      reason: `hook registration [${requested.hooks.join(', ')}] exceeds the configured ceiling [${ceiling.hooks.join(', ') || 'none'}]`,
    });
  }
  if (listExceedsCeiling(ceiling.memoryNamespaces, requested.memoryNamespaces)) {
    violations.push({
      capability: 'memoryNamespaces',
      reason: `memory namespace access [${requested.memoryNamespaces.join(', ')}] exceeds the configured ceiling [${ceiling.memoryNamespaces.join(', ') || 'none'}]`,
    });
  }
  if (requested.subprocess && !ceiling.subprocess) {
    violations.push({
      capability: 'subprocess',
      reason: 'requests subprocess/shell-out access, which the configured ceiling disallows',
    });
  }

  return violations;
}

/**
 * Parse `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` into a ceiling manifest.
 *
 * - Unset / empty -> `undefined` ("no ceiling configured" — the load-time
 *   gate is disabled and every plugin may enable, matching every other
 *   flag's opt-in rollout pattern in this codebase).
 * - Set -> parsed as JSON and normalized through the same
 *   `validatePermissionManifest` P3 already built, so the ceiling shape and
 *   the manifest shape share one schema and one fail-safe path. Malformed
 *   JSON logs a warning and falls back to the most-restrictive ceiling
 *   (deny all elevated capabilities) rather than silently disabling the
 *   gate.
 */
export function parsePermissionCeiling(
  env: NodeJS.ProcessEnv = process.env
): PluginPermissionManifest | undefined {
  const raw = env.CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  try {
    return validatePermissionManifest(JSON.parse(raw));
  } catch {
    console.warn(
      '[PluginManager] CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS is set but is not valid JSON; ' +
        'falling back to the most-restrictive ceiling (denies all elevated capabilities).'
    );
    return validatePermissionManifest({});
  }
}

export type EnableGateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Load-time gate (ADR-320 Part B, P4): decide whether a plugin's declared
 * permission manifest may be enabled under the configured ceiling.
 *
 * `requested` is `undefined` for plugins installed before P3 tracked a
 * `permissionManifest` at all; that's treated the same way
 * `validatePermissionManifest` treats an absent manifest (the legacy
 * maximal grant), so once a ceiling IS configured, legacy plugins are
 * subject to it too — matching ADR-320 §Backwards compatibility's "until
 * `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` is set to a strict ceiling" wording.
 */
export function checkEnableAgainstCeiling(
  requested: PluginPermissionManifest | undefined,
  env: NodeJS.ProcessEnv = process.env
): EnableGateResult {
  const ceiling = parsePermissionCeiling(env);
  if (!ceiling) {
    return { allowed: true };
  }

  const manifest = requested ?? validatePermissionManifest(undefined);
  const violations = findCeilingViolations(manifest, ceiling);
  if (violations.length === 0) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      `permission manifest exceeds the configured CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS ceiling: ` +
      violations.map((v) => v.reason).join('; '),
  };
}
