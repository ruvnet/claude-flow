/**
 * Plugin Manager
 * Handles actual plugin installation, persistence, and lifecycle
 * Bridges discovery service with file system persistence
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  evaluatePluginTrust,
  parseSha256Checksum,
  readDeclaredTrust,
  sha256Hex,
  shouldRunInstallScripts,
  type TrustDecision,
} from './trust-policy.js';

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

/**
 * Apply the #3557 trust policy to a plugin's package.json: record its declared
 * trust and permissions, and withhold hooks/commands the policy doesn't allow.
 */
function applyTrustPolicy(
  pkg: Record<string, unknown>,
  opts: PluginInstallOptions,
): Pick<InstalledPlugin, 'commands' | 'hooks' | 'trustLevel' | 'permissions' | 'withheld'> & { decision: TrustDecision } {
  const block = (pkg['claude-flow'] ?? {}) as { commands?: unknown; hooks?: unknown };
  const commands = Array.isArray(block.commands) ? (block.commands as string[]) : [];
  const hooks = Array.isArray(block.hooks) ? (block.hooks as string[]) : [];
  const declared = readDeclaredTrust(pkg);
  const permissions = [...new Set([...(opts.registryPermissions ?? []), ...declared.permissions])];
  const trustLevel = opts.registryTrustLevel ?? declared.trustLevel;
  const decision = evaluatePluginTrust(
    { trustLevel: declared.trustLevel, permissions },
    { verify: opts.verify !== false, trust: opts.trust === true, registryTrustLevel: opts.registryTrustLevel },
  );
  if (decision.allowed) {
    return { commands, hooks, trustLevel, permissions, decision };
  }
  return {
    commands: [],
    hooks: [],
    trustLevel,
    permissions,
    withheld: { hooks, commands, reasons: decision.reasons },
    decision,
  };
}

// ============================================================================
// Types
// ============================================================================

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
  /** Declared (or registry-assigned) trust level, recorded at install time. */
  trustLevel?: string;
  /** Declared permissions, recorded at install time so they can be enforced. */
  permissions?: string[];
  /** How the install was verified. */
  verification?: 'checksum' | 'npm-integrity' | 'policy' | 'skipped';
  /** Whether npm lifecycle scripts ran during install (false = `--ignore-scripts`). */
  scriptsRun?: boolean;
  /** Hooks/commands the plugin declared but that were not registered, and why. */
  withheld?: { hooks: string[]; commands: string[]; reasons: string[] };
}

/** Options for {@link PluginManager.installFromLocal} / {@link PluginManager.installFromNpm}. */
export interface PluginInstallOptions {
  /** `--verify` (default true). */
  verify?: boolean;
  /** `--trust` (default false). */
  trust?: boolean;
  /** Registry checksum (`sha256:<hex>`) the downloaded tarball must match. */
  expectedChecksum?: string;
  /** Trust level from the registry entry, when the plugin was found there. */
  registryTrustLevel?: string;
  /** Permissions from the registry entry, merged with the package's own declaration. */
  registryPermissions?: string[];
}

export interface PluginInstallResult {
  success: boolean;
  error?: string;
  plugin?: InstalledPlugin;
  decision?: TrustDecision;
  warnings?: string[];
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

// ============================================================================
// Plugin Manager
// ============================================================================

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

  private async ensureDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async loadManifest(): Promise<InstalledPluginsManifest> {
    try {
      if (fs.existsSync(this.config.manifestPath)) {
        const content = fs.readFileSync(this.config.manifestPath, 'utf-8');
        return JSON.parse(content) as InstalledPluginsManifest;
      }
    } catch (error) {
      console.warn('[PluginManager] Failed to load manifest, creating new one');
    }

    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      plugins: {},
    };
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) return;

    this.manifest.lastUpdated = new Date().toISOString();

    await this.ensureDirectory(path.dirname(this.config.manifestPath));
    fs.writeFileSync(
      this.config.manifestPath,
      JSON.stringify(this.manifest, null, 2),
      'utf-8'
    );
  }

  // =========================================================================
  // Installation
  // =========================================================================

  /**
   * Install a plugin from npm
   */
  async installFromNpm(
    packageName: string,
    version?: string,
    opts: PluginInstallOptions = {},
  ): Promise<PluginInstallResult> {
    if (!this.manifest) {
      await this.initialize();
    }

    const versionSpec = version ? `${packageName}@${version}` : packageName;
    const verify = opts.verify !== false;
    const warnings: string[] = [];
    let tmpDir: string | undefined;

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

      // #3557: with --verify, a registry checksum must match the tarball we
      // install. Pack first, hash that exact file, then install from it, so the
      // bytes that were checked are the bytes that get installed.
      let installTarget = versionSpec;
      let verification: InstalledPlugin['verification'] = verify ? 'npm-integrity' : 'skipped';
      const expected = verify ? parseSha256Checksum(opts.expectedChecksum) : null;
      if (expected) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-plugin-verify-'));
        const packed = await runNpm(['pack', versionSpec, '--pack-destination', tmpDir, '--json', '--ignore-scripts'], 120000);
        const info = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
        const filename = info[0]?.filename;
        if (!filename) throw new Error(`npm pack returned no tarball for ${versionSpec}`);
        const tarball = path.join(tmpDir, path.basename(filename));
        const actual = sha256Hex(fs.readFileSync(tarball));
        if (actual !== expected) {
          return {
            success: false,
            error:
              `Checksum mismatch for ${versionSpec}: registry expects sha256:${expected}, ` +
              `downloaded tarball is sha256:${actual}. Refusing to install (--verify).`,
          };
        }
        installTarget = tarball;
        verification = 'checksum';
      } else if (verify && opts.expectedChecksum) {
        warnings.push(
          `Registry checksum "${opts.expectedChecksum}" is not a verifiable sha256 digest; ` +
          `relying on npm's own registry integrity check.`,
        );
      }

      // Use npm to install (array form prevents shell injection)
      console.log(`[PluginManager] Installing ${versionSpec}...`);

      // #3557 follow-up: lifecycle scripts run before the package's own trust
      // declaration can be read, so untrusted installs skip them entirely.
      const scriptsRun = shouldRunInstallScripts(opts);
      const installArgs = ['install', '--prefix', this.config.pluginsDir, installTarget];
      if (!scriptsRun) {
        installArgs.push('--ignore-scripts');
        warnings.push(
          `Install scripts were skipped for ${packageName} (--ignore-scripts): it is not registry-vouched and --trust was not given. ` +
          `Reinstall with --trust to run them.`,
        );
      }
      await runNpm(installArgs, 120000);

      // Get installed version
      const packageJsonPath = path.join(installDir, packageName, 'package.json');
      let installedVersion = version || 'latest';
      let pkg: Record<string, unknown> = {};

      if (fs.existsSync(packageJsonPath)) {
        pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        installedVersion = String(pkg.version ?? installedVersion);
      }

      const trusted = applyTrustPolicy(pkg, opts);

      // Create plugin entry
      const plugin: InstalledPlugin = {
        name: packageName,
        version: installedVersion,
        installedAt: new Date().toISOString(),
        enabled: true,
        source: 'npm',
        path: path.join(installDir, packageName),
        commands: trusted.commands,
        hooks: trusted.hooks,
        trustLevel: trusted.trustLevel,
        permissions: trusted.permissions,
        verification,
        scriptsRun,
        ...(trusted.withheld ? { withheld: trusted.withheld } : {}),
      };

      // Save to manifest
      this.manifest!.plugins[packageName] = plugin;
      await this.saveManifest();

      console.log(`[PluginManager] Installed ${packageName}@${installedVersion}`);

      return { success: true, plugin, decision: trusted.decision, warnings };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PluginManager] Failed to install ${packageName}:`, errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Install a plugin from a local path
   */
  async installFromLocal(
    sourcePath: string,
    opts: PluginInstallOptions = {},
  ): Promise<PluginInstallResult> {
    if (!this.manifest) {
      await this.initialize();
    }

    try {
      const absolutePath = path.resolve(sourcePath);

      if (!fs.existsSync(absolutePath)) {
        return { success: false, error: `Path does not exist: ${absolutePath}` };
      }

      // Read package.json
      const packageJsonPath = path.join(absolutePath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return { success: false, error: 'No package.json found at path' };
      }

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const packageName = pkg.name;

      // Check if already installed
      if (this.manifest!.plugins[packageName]) {
        return {
          success: false,
          error: `Plugin ${packageName} is already installed`,
        };
      }

      // #3557: record declared trust/permissions; withhold hooks and commands
      // the policy doesn't allow without --trust. A local path has no registry
      // entry to vouch for it, so the plugin's own declaration decides.
      const trusted = applyTrustPolicy(pkg, { verify: opts.verify, trust: opts.trust });

      // Create plugin entry (link to local path, don't copy)
      const plugin: InstalledPlugin = {
        name: packageName,
        version: pkg.version,
        installedAt: new Date().toISOString(),
        enabled: true,
        source: 'local',
        path: absolutePath,
        commands: trusted.commands,
        hooks: trusted.hooks,
        trustLevel: trusted.trustLevel,
        permissions: trusted.permissions,
        verification: opts.verify === false ? 'skipped' : 'policy',
        // A local install links the path; it never runs npm or package scripts.
        scriptsRun: false,
        ...(trusted.withheld ? { withheld: trusted.withheld } : {}),
      };

      // Save to manifest
      this.manifest!.plugins[packageName] = plugin;
      await this.saveManifest();

      console.log(`[PluginManager] Installed local plugin ${packageName}@${pkg.version}`);

      return { success: true, plugin, decision: trusted.decision };
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
    version?: string,
    opts: Pick<PluginInstallOptions, 'verify' | 'trust'> = {},
  ): Promise<{ success: boolean; error?: string; plugin?: InstalledPlugin; decision?: TrustDecision; warnings?: string[] }> {
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

      // Reinstall with new version (array form prevents shell injection).
      // #3557: the new version's lifecycle scripts run only with an explicit
      // --trust for this upgrade. A recorded scriptsRun:true from an earlier
      // install is not enough: it may come from registry vouching that was
      // never verified, and the new version's scripts were never reviewed.
      const warnings: string[] = [];
      const scriptsRun = opts.trust === true;
      const upgradeArgs = ['install', '--prefix', this.config.pluginsDir, versionSpec];
      if (!scriptsRun) {
        upgradeArgs.push('--ignore-scripts');
        warnings.push(
          `Install scripts were skipped for ${packageName} (--ignore-scripts). Upgrade with --trust to run them.`,
        );
      }
      await runNpm(upgradeArgs, 120000);

      // Update manifest
      const installDir = path.join(this.config.pluginsDir, 'node_modules');
      const packageJsonPath = path.join(installDir, packageName, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return { success: false, error: `Upgraded package.json not found for ${packageName}` };
      }
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;

      // #3557: re-run the trust policy on the NEW version's declaration, so
      // hooks and commands withheld at install (or newly declared, or newly
      // needing elevated permissions) are not registered without --trust.
      const trusted = applyTrustPolicy(pkg, { verify: opts.verify, trust: opts.trust });
      existing.version = String(pkg.version ?? existing.version);
      existing.commands = trusted.commands;
      existing.hooks = trusted.hooks;
      existing.trustLevel = trusted.trustLevel;
      existing.permissions = trusted.permissions;
      existing.verification = opts.verify === false ? 'skipped' : 'npm-integrity';
      existing.scriptsRun = scriptsRun;
      if (trusted.withheld) {
        existing.withheld = trusted.withheld;
      } else {
        delete existing.withheld;
      }

      await this.saveManifest();

      console.log(`[PluginManager] Upgraded ${packageName} to ${existing.version}`);

      return { success: true, plugin: existing, decision: trusted.decision, warnings };
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
