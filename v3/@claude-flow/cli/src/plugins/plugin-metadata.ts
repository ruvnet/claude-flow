/**
 * Plugin package.json metadata parsing.
 *
 * Extracted out of `manager.ts` (kept under the repo's 500-line-per-file
 * limit — v3/CLAUDE.md) and de-duplicated: `installFromNpm` and
 * `installFromLocal` both parsed the same `package.json['claude-flow']`
 * block into `commands`/`hooks`/`permissionManifest` fields; this is the one
 * place that now does it, so the ADR-320 Part B (P3) `permissionManifest`
 * parsing has a single home shared by both install paths.
 */

import {
  validatePermissionManifest,
  type PluginPermissionManifest,
} from './manifest/permission-manifest.js';

export interface ParsedPluginMetadata {
  commands: string[];
  hooks: string[];
  permissionManifest: PluginPermissionManifest;
}

/**
 * Parse the `claude-flow` metadata block of an installed plugin's
 * `package.json` into the fields `manager.ts` persists onto
 * `InstalledPlugin`. `pkg` is untrusted (arbitrary JSON from an installed
 * npm/local package), so every field fails safe when absent or malformed —
 * same defensive posture as `validatePermissionManifest` itself.
 */
export function parsePluginMetadata(pkg: Record<string, unknown>): ParsedPluginMetadata {
  const meta = (pkg?.['claude-flow'] ?? undefined) as
    | { commands?: unknown; hooks?: unknown; permissions?: unknown }
    | undefined;

  return {
    commands: Array.isArray(meta?.commands) ? (meta!.commands as string[]) : [],
    hooks: Array.isArray(meta?.hooks) ? (meta!.hooks as string[]) : [],
    permissionManifest: validatePermissionManifest(meta?.permissions),
  };
}
