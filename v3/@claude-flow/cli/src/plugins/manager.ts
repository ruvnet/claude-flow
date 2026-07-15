/**
 * Plugin Manager
 * Handles actual plugin installation, persistence, and lifecycle
 * Bridges discovery service with file system persistence
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { checkEnableAgainstCeiling } from './permission-gate.js';
import { parsePluginMetadata } from './plugin-metadata.js';
import { readLocalPluginPackage } from './local-install.js';
import { ensurePluginDirectory, loadPluginManifest, savePluginManifest } from './manifest-store.js';
import type { InstalledPlugin, InstalledPluginsManifest, PluginManagerConfig } from './types.js';

export type { InstalledPlugin, InstalledPluginsManifest, PluginManagerConfig } from './types.js';

const execFileAsync = promisify(execFile);

// On Windows, `npm` is a shell script (no `.exe`) and `npm.cmd` is a batch
// wrapper. Since Node 18.20.2 / 20.12.2 (CVE-2024-27980) the runtime refuses
// to spawn `.cmd`/`.bat` files directly and throws `spawn EINVAL` — the only
// supported invocation is via a real `.exe` shell. We wrap every npm call
// through `cmd.exe /d /s /c npm <args>`, which keeps Node's safe array-form
// argument escaping intact and avoids both ENOENT and EINVAL.
const isWindows = process.platform === 'win32';

function runNpm(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  if (isWindows) {
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { timeout: timeoutMs });
  }
  return execFileAsync('npm', args, { timeout: timeoutMs });
}

/**
 * Validate npm package name to prevent shell injection (S-3)
 */
const VALID_PACKAGE_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9._\-^~>=<]+)?$/;
function validatePackageName(spec: string): void {
  if (!VALID_PACKAGE_RE.test(spec)) {
    throw new Error(`Invalid package name: ${spec}`);
  }
}

// ============================================================================
// Plugin Manager
// ============================================================================
// Types (InstalledPlugin, InstalledPluginsManifest, PluginManagerConfig) now
// live in ./types.ts and are re-exported above — moved out to keep this file
// under the repo's 500-line-per-file limit (v3/CLAUDE.md).

/**
 * Manages plugin installation, persistence, and lifecycle.
 *
 * Unlike the simulated version, this actually:
 * - Persists plugins to disk
 * - Downloads from npm
 * - Tracks enabled/disabled state
 * - Loads plugin modules
 */
export class PluginManager {
  private config: PluginManagerConfig;
  private manifest: InstalledPluginsManifest | null = null;

  constructor(baseDir: string = process.cwd()) {
    const pluginsDir = path.join(baseDir, '.claude-flow', 'plugins');
    this.config = {
      pluginsDir,
      manifestPath: path.join(pluginsDir, 'installed.json'),
    };
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Initialize the plugin manager, creating directories and loading manifest
   */
  async initialize(): Promise<void> {
    // Ensure plugins directory exists
    await this.ensureDirectory(this.config.pluginsDir);

    // Load or create manifest
    this.manifest = await this.loadManifest();
  }

  // Manifest I/O delegates to manifest-store.ts (kept this file under the
  // 500-line limit); these thin wrappers preserve the original private-method
  // call sites used throughout this class.
  private async ensureDirectory(dir: string): Promise<void> {
    return ensurePluginDirectory(dir);
  }

  private async loadManifest(): Promise<InstalledPluginsManifest> {
    return loadPluginManifest(this.config.manifestPath);
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) return;
    await savePluginManifest(this.config.manifestPath, this.manifest);
  }

  // =========================================================================
  // Installation
  // =========================================================================

  /**
   * Install a plugin from npm
   */
  async installFromNpm(
    packageName: string,
    version?: string
  ): Promise<{ success: boolean; error?: string; plugin?: InstalledPlugin }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const versionSpec = version ? `${packageName}@${version}` : packageName;

    try {
      // Check if already installed
      if (this.manifest!.plugins[packageName]) {
        return {
          success: false,
          error: `Plugin ${packageName} is already installed. Use upgrade to update.`,
        };
      }

      // Install to local plugins directory
      const installDir = path.join(this.config.pluginsDir, 'node_modules');
      await this.ensureDirectory(installDir);

      // Validate package name to prevent injection (S-3)
      validatePackageName(versionSpec);

      // Use npm to install (array form prevents shell injection)
      console.log(`[PluginManager] Installing ${versionSpec}...`);

      await runNpm(['install', '--prefix', this.config.pluginsDir, versionSpec], 120000);

      // Get installed version + claude-flow metadata (commands/hooks/
      // permissionManifest — ADR-320 Part B P3, parsed via plugin-metadata.ts)
      const packageJsonPath = path.join(installDir, packageName, 'package.json');
      let installedVersion = version || 'latest';
      let { commands, hooks, permissionManifest } = parsePluginMetadata({});

      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        installedVersion = pkg.version;
        ({ commands, hooks, permissionManifest } = parsePluginMetadata(pkg));
      }

      // Create plugin entry
      const plugin: InstalledPlugin = {
        name: packageName,
        version: installedVersion,
        installedAt: new Date().toISOString(),
        enabled: true,
        source: 'npm',
        path: path.join(installDir, packageName),
        commands,
        hooks,
        permissionManifest,
      };

      // Save to manifest
      this.manifest!.plugins[packageName] = plugin;
      await this.saveManifest();

      console.log(`[PluginManager] Installed ${packageName}@${installedVersion}`);

      return { success: true, plugin };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PluginManager] Failed to install ${packageName}:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Install a plugin from a local path
   */
  async installFromLocal(
    sourcePath: string
  ): Promise<{ success: boolean; error?: string; plugin?: InstalledPlugin }> {
    if (!this.manifest) {
      await this.initialize();
    }

    try {
      // Read + validate package.json, build the InstalledPlugin entry
      // (link to local path, don't copy) — see local-install.ts.
      const read = readLocalPluginPackage(sourcePath);
      if (!read.success || !read.plugin) {
        return { success: false, error: read.error };
      }

      const plugin = read.plugin;
      if (this.manifest!.plugins[plugin.name]) {
        return {
          success: false,
          error: `Plugin ${plugin.name} is already installed`,
        };
      }

      this.manifest!.plugins[plugin.name] = plugin;
      await this.saveManifest();

      console.log(`[PluginManager] Installed local plugin ${plugin.name}@${plugin.version}`);

      return { success: true, plugin };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PluginManager] Failed to install from local:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // =========================================================================
  // Uninstallation
  // =========================================================================

  /**
   * Uninstall a plugin
   */
  async uninstall(
    packageName: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const plugin = this.manifest!.plugins[packageName];
    if (!plugin) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    try {
      // For npm-installed plugins, remove from node_modules
      if (plugin.source === 'npm') {
        validatePackageName(packageName);
        await runNpm(['uninstall', '--prefix', this.config.pluginsDir, packageName], 60000);
      }

      // Remove from manifest
      delete this.manifest!.plugins[packageName];
      await this.saveManifest();

      console.log(`[PluginManager] Uninstalled ${packageName}`);

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PluginManager] Failed to uninstall ${packageName}:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // =========================================================================
  // Enable/Disable
  // =========================================================================

  /**
   * Enable a plugin
   */
  async enable(packageName: string): Promise<{ success: boolean; error?: string }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const plugin = this.manifest!.plugins[packageName];
    if (!plugin) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    // ADR-320 Part B (P4): load-time permission-ceiling gate. No-op when
    // CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS is unset (see permission-gate.ts).
    // NOTE — scope: this is the LOAD-TIME check only. The ADR also describes
    // per-capability invocation-time enforcement (wrapping every filesystem/
    // network/hook/subprocess call), which this repo cannot implement yet:
    // there is no plugin-code-loader anywhere that actually executes a
    // plugin's code, so there is no call site to wrap. Deferred to a
    // follow-up once a loader exists — see permission-gate.ts file header.
    const gate = checkEnableAgainstCeiling(plugin.permissionManifest);
    if (!gate.allowed) {
      console.error(`[SECURITY] Refusing to enable ${packageName}: ${gate.reason}`);
      return { success: false, error: gate.reason };
    }

    // HIGH-04: Warn about unsandboxed plugin execution
    console.warn(`[SECURITY] Plugin loaded without sandboxing: ${packageName}. Plugins run with full process access.`);

    plugin.enabled = true;
    await this.saveManifest();

    return { success: true };
  }

  /**
   * Disable a plugin
   */
  async disable(packageName: string): Promise<{ success: boolean; error?: string }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const plugin = this.manifest!.plugins[packageName];
    if (!plugin) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    plugin.enabled = false;
    await this.saveManifest();

    return { success: true };
  }

  /**
   * Toggle a plugin's enabled state
   */
  async toggle(packageName: string): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const plugin = this.manifest!.plugins[packageName];
    if (!plugin) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    plugin.enabled = !plugin.enabled;
    await this.saveManifest();

    return { success: true, enabled: plugin.enabled };
  }

  // =========================================================================
  // Query
  // =========================================================================

  /**
   * Get all installed plugins
   */
  async getInstalled(): Promise<InstalledPlugin[]> {
    if (!this.manifest) {
      await this.initialize();
    }

    return Object.values(this.manifest!.plugins);
  }

  /**
   * Get enabled plugins
   */
  async getEnabled(): Promise<InstalledPlugin[]> {
    const all = await this.getInstalled();
    return all.filter(p => p.enabled);
  }

  /**
   * Check if a plugin is installed
   */
  async isInstalled(packageName: string): Promise<boolean> {
    if (!this.manifest) {
      await this.initialize();
    }

    return packageName in this.manifest!.plugins;
  }

  /**
   * Get a specific installed plugin
   */
  async getPlugin(packageName: string): Promise<InstalledPlugin | undefined> {
    if (!this.manifest) {
      await this.initialize();
    }

    return this.manifest!.plugins[packageName];
  }

  // =========================================================================
  // Upgrade
  // =========================================================================

  /**
   * Upgrade a plugin to a new version
   */
  async upgrade(
    packageName: string,
    version?: string
  ): Promise<{ success: boolean; error?: string; plugin?: InstalledPlugin }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const existing = this.manifest!.plugins[packageName];
    if (!existing) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    if (existing.source !== 'npm') {
      return { success: false, error: 'Can only upgrade npm-installed plugins' };
    }

    try {
      const versionSpec = version ? `${packageName}@${version}` : `${packageName}@latest`;

      // Validate package name to prevent injection (S-3)
      validatePackageName(versionSpec);

      // Reinstall with new version (array form prevents shell injection)
      await runNpm(['install', '--prefix', this.config.pluginsDir, versionSpec], 120000);

      // Update manifest
      const installDir = path.join(this.config.pluginsDir, 'node_modules');
      const packageJsonPath = path.join(installDir, packageName, 'package.json');

      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        existing.version = pkg.version;
        existing.commands = pkg['claude-flow']?.commands || existing.commands;
        existing.hooks = pkg['claude-flow']?.hooks || existing.hooks;
      }

      await this.saveManifest();

      console.log(`[PluginManager] Upgraded ${packageName} to ${existing.version}`);

      return { success: true, plugin: existing };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  // =========================================================================
  // Config
  // =========================================================================

  /**
   * Update plugin config
   */
  async setConfig(
    packageName: string,
    config: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.manifest) {
      await this.initialize();
    }

    const plugin = this.manifest!.plugins[packageName];
    if (!plugin) {
      return { success: false, error: `Plugin ${packageName} is not installed` };
    }

    plugin.config = { ...plugin.config, ...config };
    await this.saveManifest();

    return { success: true };
  }

  /**
   * Get plugins directory path
   */
  getPluginsDir(): string {
    return this.config.pluginsDir;
  }

  /**
   * Get manifest path
   */
  getManifestPath(): string {
    return this.config.manifestPath;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultManager: PluginManager | null = null;

export function getPluginManager(baseDir?: string): PluginManager {
  if (!defaultManager) {
    defaultManager = new PluginManager(baseDir);
  } else if (baseDir && defaultManager.getPluginsDir() !== path.join(baseDir, '.claude-flow', 'plugins')) {
    console.warn(`[PluginManager] Warning: getPluginManager called with different baseDir. Using existing instance. Call resetPluginManager() first to change.`);
  }
  return defaultManager;
}

export function resetPluginManager(): void {
  defaultManager = null;
}
