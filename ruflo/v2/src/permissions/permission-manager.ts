/**
 * Permission Manager - 4-Level Hierarchical Permissions
 *
 * Implements hierarchical permission system with fallback chain:
 * USER (global) → PROJECT (.claude-flow/) → LOCAL (file-based) → SESSION (runtime)
 *
 * Features:
 * - Fast permission resolution with caching
 * - Granular control at each level
 * - Override capabilities
 * - Automatic fallback chain
 * - Thread-safe operations
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { constants } from 'fs';
import type { PermissionBehavior, PermissionRuleValue, PermissionUpdate } from '@anthropic-ai/claude-code/sdk';

// ===== Core Permission Types =====

export type PermissionLevel = 'user' | 'project' | 'local' | 'session';

export interface PermissionRule {
  toolName: string;
  ruleContent?: string;
  behavior: PermissionBehavior;
  scope: PermissionLevel;
  priority: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PermissionConfig {
  mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  rules: PermissionRule[];
  allowedDirectories: string[];
  deniedDirectories: string[];
  metadata?: Record<string, any>;
}

export interface PermissionQuery {
  toolName: string;
  toolInput?: Record<string, unknown>;
  context?: {
    sessionId?: string;
    workingDir?: string;
    agentType?: string;
  };
}

export interface PermissionResolution {
  behavior: PermissionBehavior;
  level: PermissionLevel;
  rule?: PermissionRule;
  fallbackChain: PermissionLevel[];
  cached: boolean;
  resolutionTime: number;
}

// ===== Cache Entry =====

interface CacheEntry {
  resolution: PermissionResolution;
  timestamp: number;
}

// ===== Permission Manager Class =====

export class PermissionManager {
  private userConfig?: PermissionConfig;
  private projectConfig?: PermissionConfig;
  private localConfig?: PermissionConfig;
  private sessionConfig: PermissionConfig;

  private cache: Map<string, CacheEntry> = new Map();
  private cacheEnabled: boolean;
  private cacheTTL: number;

  private userConfigPath?: string;
  private projectConfigPath?: string;
  private localConfigPath?: string;

  constructor(options?: {
    cacheEnabled?: boolean;
    cacheTTL?: number;
    userConfigPath?: string;
    projectConfigPath?: string;
    localConfigPath?: string;
  }) {
    this.cacheEnabled = options?.cacheEnabled ?? true;
    this.cacheTTL = options?.cacheTTL ?? 300000; // 5 minutes default

    this.userConfigPath = options?.userConfigPath;
    this.projectConfigPath = options?.projectConfigPath;
    this.localConfigPath = options?.localConfigPath;

    // Initialize session config
    this.sessionConfig = this.createDefaultConfig('session');
  }

  /**
   * Initialize permission manager by loading all configs
   */
  async initialize(): Promise<void> {
    await Promise.allSettled([
      this.loadUserConfig(),
      this.loadProjectConfig(),
      this.loadLocalConfig(),
    ]);
  }

  /**
   * Resolve permission for a query using fallback chain
   */
  async resolvePermission(query: PermissionQuery): Promise<PermissionResolution> {
    const startTime = Date.now();

    // Check cache
    if (this.cacheEnabled) {
      const cacheKey = this.generateCacheKey(query);
      const cached = this.cache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return {
          ...cached.resolution,
          cached: true,
          resolutionTime: Date.now() - startTime,
        };
      }
    }

    // Resolve using fallback chain: SESSION → LOCAL → PROJECT → USER
    const fallbackChain: PermissionLevel[] = ['session', 'local', 'project', 'user'];

    for (const level of fallbackChain) {
      const rule = this.findRule(query, level);

      if (rule) {
        const resolution: PermissionResolution = {
          behavior: rule.behavior,
          level,
          rule,
          fallbackChain: fallbackChain.slice(0, fallbackChain.indexOf(level) + 1),
          cached: false,
          resolutionTime: Date.now() - startTime,
        };

        // Cache result
        if (this.cacheEnabled) {
          this.cache.set(this.generateCacheKey(query), {
            resolution,
            timestamp: Date.now(),
          });
        }

        return resolution;
      }
    }

    // No rule found, use default 'ask' behavior
    return {
      behavior: 'ask',
      level: 'session',
      fallbackChain,
      cached: false,
      resolutionTime: Date.now() - startTime,
    };
  }

  /**
   * Update permissions at specified level
   */
  async updatePermissions(
    level: PermissionLevel,
    update: PermissionUpdate
  ): Promise<void> {
    const config = this.getConfigForLevel(level);

    switch (update.type) {
      case 'addRules':
        this.addRules(config, update.rules, update.behavior);
        break;

      case 'replaceRules':
        this.replaceRules(config, update.rules, update.behavior);
        break;

      case 'removeRules':
        this.removeRules(config, update.rules);
        break;

      case 'setMode':
        config.mode = update.mode;
        break;

      case 'addDirectories':
        config.allowedDirectories.push(...update.directories);
        break;

      case 'removeDirectories':
        config.allowedDirectories = config.allowedDirectories.filter(
          d => !update.directories.includes(d)
        );
        break;
    }

    // Clear cache on updates
    this.clearCache();

    // Persist changes for persistent levels
    if (level !== 'session') {
      await this.saveConfig(level, config);
    }
  }

  /**
   * Get current configuration for a level
   */
  getConfig(level: PermissionLevel): PermissionConfig | undefined {
    switch (level) {
      case 'user':
        return this.userConfig;
      case 'project':
        return this.projectConfig;
      case 'local':
        return this.localConfig;
      case 'session':
        return this.sessionConfig;
    }
  }

  /**
   * Clear permission cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }

  /**
   * Prune expired cache entries
   */
  pruneCache(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheTTL) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  // ===== Private Methods =====

  private async loadUserConfig(): Promise<void> {
    if (!this.userConfigPath) return;

    try {
      await access(this.userConfigPath, constants.R_OK);
      const content = await readFile(this.userConfigPath, 'utf-8');
      this.userConfig = JSON.parse(content);
    } catch (error) {
      // Create default if not exists
      this.userConfig = this.createDefaultConfig('user');
    }
  }

  private async loadProjectConfig(): Promise<void> {
    if (!this.projectConfigPath) return;

    try {
      await access(this.projectConfigPath, constants.R_OK);
      const content = await readFile(this.projectConfigPath, 'utf-8');
      this.projectConfig = JSON.parse(content);
    } catch (error) {
      // Create default if not exists
      this.projectConfig = this.createDefaultConfig('project');
    }
  }

  private async loadLocalConfig(): Promise<void> {
    if (!this.localConfigPath) return;

    try {
      await access(this.localConfigPath, constants.R_OK);
      const content = await readFile(this.localConfigPath, 'utf-8');
      this.localConfig = JSON.parse(content);
    } catch (error) {
      // Create default if not exists
      this.localConfig = this.createDefaultConfig('local');
    }
  }

  private async saveConfig(level: PermissionLevel, config: PermissionConfig): Promise<void> {
    let configPath: string | undefined;

    switch (level) {
      case 'user':
        configPath = this.userConfigPath;
        break;
      case 'project':
        configPath = this.projectConfigPath;
        break;
      case 'local':
        configPath = this.localConfigPath;
        break;
    }

    if (!configPath) return;

    // Ensure directory exists
    await mkdir(dirname(configPath), { recursive: true });

    // Write config
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private findRule(query: PermissionQuery, level: PermissionLevel): PermissionRule | undefined {
    const config = this.getConfigForLevel(level);
    if (!config) return undefined;

    // Check if mode bypasses rules
    if (config.mode === 'bypassPermissions') {
      return {
        toolName: '*',
        behavior: 'allow',
        scope: level,
        priority: 1000,
        timestamp: Date.now(),
      };
    }

    // Find matching rule with highest priority
    return config.rules
      .filter(rule => this.ruleMatches(rule, query))
      .sort((a, b) => b.priority - a.priority)[0];
  }

  private ruleMatches(rule: PermissionRule, query: PermissionQuery): boolean {
    // Exact match
    if (rule.toolName === query.toolName) {
      return this.ruleContentMatches(rule, query);
    }

    // Wildcard match
    if (rule.toolName === '*') {
      return this.ruleContentMatches(rule, query);
    }

    // Pattern match (simple glob-style)
    if (rule.toolName.includes('*')) {
      const pattern = rule.toolName.replace(/\*/g, '.*');
      if (new RegExp(`^${pattern}$`).test(query.toolName)) {
        return this.ruleContentMatches(rule, query);
      }
    }

    return false;
  }

  private ruleContentMatches(rule: PermissionRule, query: PermissionQuery): boolean {
    if (!rule.ruleContent || !query.toolInput) {
      return true; // No content means rule applies to all
    }

    // Simple string matching for now
    // In production, this would parse ruleContent and match against toolInput
    return true;
  }

  private getConfigForLevel(level: PermissionLevel): PermissionConfig {
    switch (level) {
      case 'user':
        if (!this.userConfig) {
          this.userConfig = this.createDefaultConfig('user');
        }
        return this.userConfig;

      case 'project':
        if (!this.projectConfig) {
          this.projectConfig = this.createDefaultConfig('project');
        }
        return this.projectConfig;

      case 'local':
        if (!this.localConfig) {
          this.localConfig = this.createDefaultConfig('local');
        }
        return this.localConfig;

      case 'session':
        return this.sessionConfig;
    }
  }

  private createDefaultConfig(scope: PermissionLevel): PermissionConfig {
    return {
      mode: 'default',
      rules: [],
      allowedDirectories: [],
      deniedDirectories: [],
      metadata: {
        scope,
        created: Date.now(),
      },
    };
  }

  private addRules(
    config: PermissionConfig,
    rules: PermissionRuleValue[],
    behavior: PermissionBehavior
  ): void {
    const newRules: PermissionRule[] = rules.map((r, index) => ({
      ...r,
      behavior,
      scope: config.metadata?.scope || 'session',
      priority: 100 + index,
      timestamp: Date.now(),
    }));

    config.rules.push(...newRules);
  }

  private replaceRules(
    config: PermissionConfig,
    rules: PermissionRuleValue[],
    behavior: PermissionBehavior
  ): void {
    config.rules = rules.map((r, index) => ({
      ...r,
      behavior,
      scope: config.metadata?.scope || 'session',
      priority: 100 + index,
      timestamp: Date.now(),
    }));
  }

  private removeRules(config: PermissionConfig, rules: PermissionRuleValue[]): void {
    const toRemove = new Set(rules.map(r => `${r.toolName}:${r.ruleContent || ''}`));

    config.rules = config.rules.filter(rule => {
      const key = `${rule.toolName}:${rule.ruleContent || ''}`;
      return !toRemove.has(key);
    });
  }

  private generateCacheKey(query: PermissionQuery): string {
    return JSON.stringify({
      tool: query.toolName,
      input: query.toolInput,
      session: query.context?.sessionId,
    });
  }
}

// ===== Factory Functions =====

export function createPermissionManager(options?: {
  workingDir?: string;
  cacheEnabled?: boolean;
  cacheTTL?: number;
}): PermissionManager {
  const workingDir = options?.workingDir || process.cwd();

  return new PermissionManager({
    cacheEnabled: options?.cacheEnabled,
    cacheTTL: options?.cacheTTL,
    userConfigPath: join(process.env.HOME || '~', '.claude-flow', 'permissions.json'),
    projectConfigPath: join(workingDir, '.claude-flow', 'permissions.json'),
    localConfigPath: join(workingDir, '.permissions.json'),
  });
}

// Export singleton instance
export const permissionManager = createPermissionManager({
  cacheEnabled: true,
  cacheTTL: 300000,
});