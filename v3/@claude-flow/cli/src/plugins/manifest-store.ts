/**
 * Installed-plugins manifest persistence (read/write `installed.json`).
 *
 * Extracted out of `manager.ts` (kept under the repo's 500-line-per-file
 * limit — v3/CLAUDE.md) — pure I/O helpers parameterized by path rather than
 * `PluginManager` instance state, so `PluginManager` just delegates.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InstalledPluginsManifest } from './types.js';

export async function ensurePluginDirectory(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function loadPluginManifest(manifestPath: string): Promise<InstalledPluginsManifest> {
  try {
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as InstalledPluginsManifest;
    }
  } catch {
    console.warn('[PluginManager] Failed to load manifest, creating new one');
  }

  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    plugins: {},
  };
}

export async function savePluginManifest(
  manifestPath: string,
  manifest: InstalledPluginsManifest
): Promise<void> {
  manifest.lastUpdated = new Date().toISOString();
  await ensurePluginDirectory(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
