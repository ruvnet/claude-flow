/**
 * Config File Manager
 * Shared JSON config file persistence with atomic writes and Zod validation
 */

import * as fs from 'fs';
import * as path from 'path';

/** Config file search paths in priority order */
const CONFIG_FILENAMES = [
  'claude-flow.config.json',
  '.claude-flow/config.json',
];

/** Default config values */
const DEFAULT_CONFIG: Record<string, unknown> = {
  version: '3.5',
  agents: {
    defaultType: 'coder',
    autoSpawn: false,
    maxConcurrent: 8,
    timeout: 300000,
    providers: [],
  },
  swarm: {
    topology: 'hierarchical',
    maxAgents: 8,
    autoScale: false,
    coordinationStrategy: 'leader',
    healthCheckInterval: 30000,
  },
  memory: {
    backend: 'hybrid',
    persistPath: './data/memory',
    cacheSize: 1000,
    enableHNSW: true,
    vectorDimension: 384,
  },
  mcp: {
    serverHost: 'localhost',
    serverPort: 3000,
    autoStart: false,
    transportType: 'stdio',
    tools: [],
  },
  cli: {
    colorOutput: true,
    interactive: true,
    verbosity: 'normal',
    outputFormat: 'text',
    progressStyle: 'spinner',
  },
  hooks: {
    enabled: true,
    autoExecute: true,
    hooks: [],
  },
};

export class ConfigFileManager {
  private configCwd: string | null = null;
  private configPath: string | null = null;
  private config: Record<string, unknown> | null = null;

  /** Find config file in search paths starting from cwd */
  findConfig(cwd: string): string | null {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.resolve(cwd, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    // Check env var
    const envPath = process.env.CLAUDE_FLOW_CONFIG;
    if (envPath && fs.existsSync(envPath)) {
      return path.resolve(envPath);
    }
    return null;
  }

  /** Load config from file, returns null if not found */
  load(cwd: string): Record<string, unknown> | null {
    this.selectProject(cwd);
    this.configPath = this.findConfig(cwd);
    if (!this.configPath) {
      this.config = null;
      return null;
    }
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Config file must contain a JSON object');
      }
      this.config = parsed as Record<string, unknown>;
      return this.config;
    } catch (error) {
      this.config = null;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.configPath = null;
        return null;
      }
      // A parse/read failure is not a missing config. In particular, set()
      // must never replace a recoverable file with fallback defaults.
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config ${this.configPath}: ${detail}`);
    }
  }

  /** Get the current config, loading if needed */
  getConfig(cwd: string): Record<string, unknown> {
    this.selectProject(cwd);
    if (this.config === null) {
      this.load(cwd);
    }
    return this.config ?? structuredClone(DEFAULT_CONFIG);
  }

  /** Get a nested config value by dot-separated key */
  get(cwd: string, key: string): unknown {
    const config = this.getConfig(cwd);
    return Object.hasOwn(config, key) ? config[key] : getNestedValue(config, key);
  }

  /** Set a nested config value by dot-separated key */
  set(cwd: string, key: string, value: unknown): void {
    // Reject the entire path before touching cached config or disk.
    if (key.split('.').some(part => part === '__proto__' || part === 'constructor' || part === 'prototype')) {
      throw new Error(`Unsafe configuration key: ${key}`);
    }
    this.selectProject(cwd);
    // A targeted update must not persist unrelated defaults (notably the
    // default memory path, which would relocate an existing memory store).
    const config = this.config ?? this.load(cwd) ?? {};
    if (Object.hasOwn(config, key)) {
      config[key] = value;
    } else {
      setNestedValue(config, key, value);
    }
    this.config = config;
    const targetPath = this.configPath ?? path.resolve(cwd, CONFIG_FILENAMES[0]);
    this.writeAtomic(targetPath, config);
    this.configPath = targetPath;
  }

  /** Create a new config file with defaults */
  create(cwd: string, overrides?: Record<string, unknown>, force?: boolean): string {
    const targetPath = path.resolve(cwd, CONFIG_FILENAMES[0]);
    if (fs.existsSync(targetPath) && !force) {
      throw new Error(`Config file already exists: ${targetPath}. Use --force to overwrite.`);
    }
    const config = { ...structuredClone(DEFAULT_CONFIG), ...overrides };
    this.writeAtomic(targetPath, config);
    this.selectProject(cwd);
    this.config = config;
    this.configPath = targetPath;
    return targetPath;
  }

  /** Reset all configuration or only the selected section to defaults. */
  reset(cwd: string, section = 'all'): string {
    if (!['agents', 'swarm', 'memory', 'mcp', 'providers', 'all'].includes(section)) {
      throw new Error(`Unknown configuration section: ${section}`);
    }
    this.selectProject(cwd);
    const targetPath = this.findConfig(cwd) ?? path.resolve(cwd, CONFIG_FILENAMES[0]);
    const config = section === 'all'
      ? structuredClone(DEFAULT_CONFIG)
      : structuredClone(this.load(cwd) ?? {});
    if (section === 'providers') {
      // Provider defaults are supplied by the provider command, so remove
      // only the persisted override, as a whole reset already does.
      delete config.providers;
    } else if (section !== 'all') {
      config[section] = structuredClone(DEFAULT_CONFIG[section]);
    }
    if (section !== 'all') {
      for (const key of Object.keys(config)) {
        if (key.startsWith(`${section}.`)) delete config[key];
      }
    }
    this.writeAtomic(targetPath, config);
    this.config = config;
    this.configPath = targetPath;
    return targetPath;
  }

  /** Export config to a specific path */
  exportTo(cwd: string, exportPath: string): void {
    const config = this.getConfig(cwd);
    const resolved = path.resolve(cwd, exportPath);
    this.writeAtomic(resolved, config);
  }

  /** Import config from a specific path */
  importFrom(cwd: string, importPath: string): void {
    const resolved = path.resolve(cwd, importPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Import file not found: ${resolved}`);
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    let imported: Record<string, unknown>;
    try {
      imported = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in import file: ${resolved}`);
    }
    if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
      throw new Error('Import file must contain a JSON object');
    }
    this.selectProject(cwd);
    const targetPath = this.findConfig(cwd) ?? path.resolve(cwd, CONFIG_FILENAMES[0]);
    this.writeAtomic(targetPath, imported);
    this.config = imported;
    this.configPath = targetPath;
  }

  /** Get the path to the current config file */
  getConfigPath(): string | null {
    return this.configPath;
  }

  /** Get default config */
  getDefaults(): Record<string, unknown> {
    return structuredClone(DEFAULT_CONFIG);
  }

  /** Cached values and file paths belong to one resolved project directory. */
  private selectProject(cwd: string): void {
    const resolved = path.resolve(cwd);
    if (this.configCwd !== resolved) {
      this.configCwd = resolved;
      this.config = null;
      this.configPath = null;
    }
  }

  /** Atomic write: write to .tmp then rename */
  private writeAtomic(filePath: string, data: Record<string, unknown>): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmpPath, filePath);
  }
}

/** Get a nested value by dot-separated key */
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object' || !Object.hasOwn(current, part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value by dot-separated key */
function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!Object.hasOwn(current, part) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Parse a string value to the appropriate type */
export function parseConfigValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object') return parsed;
  } catch { /* not JSON, use as string */ }
  return value;
}

/** Singleton instance */
export const configManager = new ConfigFileManager();
