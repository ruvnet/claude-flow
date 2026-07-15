/**
 * Plugin Manager — shared types
 *
 * Extracted out of `manager.ts` to keep that file under the repo's
 * 500-line-per-file limit (v3/CLAUDE.md) while wiring in ADR-320 P4's
 * load-time permission-ceiling gate. Re-exported from `manager.ts` so
 * existing `import { type InstalledPlugin } from '.../plugins/manager.js'`
 * call sites keep working unchanged.
 */

import type { PluginPermissionManifest } from './manifest/permission-manifest.js';

export interface InstalledPlugin {
  name: string;
  version: string;
  installedAt: string;
  enabled: boolean;
  source: 'npm' | 'local' | 'ipfs';
  path?: string;
  commands?: string[];
  hooks?: string[];
  config?: Record<string, unknown>;
  // ADR-320 Part B (P3): validated + normalized capability manifest read from
  // `package.json['claude-flow'].permissions` at install time. Absent when a
  // plugin predates this system, in which case it defaults to the legacy
  // maximal grant — see `manifest/permission-manifest.ts`.
  // P5: strict-mode-default flip in v4.0, see ADR-320 §Integration plan
  permissionManifest?: PluginPermissionManifest;
}

export interface InstalledPluginsManifest {
  version: '1.0.0';
  lastUpdated: string;
  plugins: Record<string, InstalledPlugin>;
}

export interface PluginManagerConfig {
  pluginsDir: string;
  manifestPath: string;
}
