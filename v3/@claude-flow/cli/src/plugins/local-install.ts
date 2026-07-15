/**
 * Local-path plugin install helper.
 *
 * Extracted out of `manager.ts` (kept under the repo's 500-line-per-file
 * limit — v3/CLAUDE.md): reads and validates a local plugin directory's
 * `package.json` into an `InstalledPlugin` entry, without touching
 * `PluginManager`'s manifest or persistence — that stays the caller's job
 * (`PluginManager.installFromLocal` decides whether the resulting plugin
 * name collides with an already-installed one, then persists it).
 */

import * as fs from 'fs';
import * as path from 'path';
import { parsePluginMetadata } from './plugin-metadata.js';
import type { InstalledPlugin } from './types.js';

export interface LocalPluginReadResult {
  success: boolean;
  error?: string;
  plugin?: InstalledPlugin;
}

/** Read a local plugin directory's `package.json` into an `InstalledPlugin`. */
export function readLocalPluginPackage(sourcePath: string): LocalPluginReadResult {
  const absolutePath = path.resolve(sourcePath);

  if (!fs.existsSync(absolutePath)) {
    return { success: false, error: `Path does not exist: ${absolutePath}` };
  }

  const packageJsonPath = path.join(absolutePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { success: false, error: 'No package.json found at path' };
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  const plugin: InstalledPlugin = {
    name: pkg.name,
    version: pkg.version,
    installedAt: new Date().toISOString(),
    enabled: true,
    source: 'local',
    path: absolutePath,
    ...parsePluginMetadata(pkg),
  };

  return { success: true, plugin };
}
