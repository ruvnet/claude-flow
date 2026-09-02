/**
 * Plugin Store Types
 * Decentralized plugin marketplace using IPFS
 * Extends the pattern store architecture for plugins
 */

import type { TrustLevel } from '../../transfer/types.js';

/**
 * Plugin entry in the registry
 */
export interface PluginEntry {
  // Identity
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;

  // Storage
  cid: string;
  size: number;
  checksum: string;

  // Metadata
  author: PluginAuthor;
  license: string;
  categories: string[];
  tags: string[];
  keywords: string[];

  // Stats
  downloads: number;
  rating: number;
  ratingCount: number;
  lastUpdated: string;
  createdAt: string;

  // Requirements
  minClaudeFlowVersion: string;
  maxClaudeFlowVersion?: string;
  dependencies: PluginDependency[];
  peerDependencies?: PluginDependency[];

  // Plugin-specific
  type: PluginType;
  hooks: string[];
  commands: string[];
  permissions: PluginPermission[];
  exports: string[];

  // Verification
  verified: boolean;
  trustLevel: TrustLevel;
  signature?: string;
  publicKey?: string;

  // Security
  securityAudit?: SecurityAudit;
  knownVulnerabilities?: string[];
}

/**
 * Plugin types
 */
export type PluginType =
  | 'agent'      // Adds new agent types
  | 'hook'       // Adds new hooks
  | 'command'    // Adds CLI commands
  | 'provider'   // Adds AI providers
  | 'integration'// External integrations
  | 'theme'      // UI themes
  | 'core'       // Core functionality extensions
  | 'hybrid';    // Multiple types

/**
 * Plugin dependency
 */
export interface PluginDependency {
  name: string;
  version: string;
  optional?: boolean;
}

/**
 * Plugin permissions
 */
export type PluginPermission =
  | 'network'      // Network access
  | 'filesystem'   // File system access
  | 'execute'      // Execute external commands
  | 'memory'       // Access memory system
  | 'agents'       // Spawn/manage agents
  | 'credentials'  // Access credentials
  | 'config'       // Modify configuration
  | 'hooks'        // Register hooks
  | 'privileged';  // Full system access

/**
 * Security audit info
 */
export interface SecurityAudit {
  auditor: string;
  auditDate: string;
  auditVersion: string;
  passed: boolean;
  issues: SecurityIssue[];
  reportCid?: string;
}

/**
 * Security issue
 */
export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  resolved: boolean;
  resolvedVersion?: string;
}

/**
 * Plugin author info
 */
export interface PluginAuthor {
  id: string;
  displayName?: string;
  email?: string;
  website?: string;
  publicKey?: string;
  verified: boolean;
  plugins: number;
  totalDownloads: number;
  reputation: number;
}

/**
 * Plugin category
 */
export interface PluginCategory {
  id: string;
  name: string;
  description: string;
  pluginCount: number;
  icon?: string;
  subcategories?: PluginCategory[];
}

/**
 * Decentralized plugin registry
 * Stored on IPFS with IPNS pointer for updates
 */
export interface PluginRegistry {
  // Registry metadata
  version: string;
  type: 'plugins';
  updatedAt: string;
  ipnsName: string;
  previousCid?: string;

  // Content
  plugins: PluginEntry[];
  categories: PluginCategory[];
  authors: PluginAuthor[];

  // Stats
  totalPlugins: number;
  totalDownloads: number;
  totalAuthors: number;

  // Featured/promoted
  featured: string[];
  trending: string[];
  newest: string[];
  official: string[];

  // Verification
  registrySignature?: string;
  registryPublicKey?: string;

  // Compatibility matrix
  compatibilityMatrix: CompatibilityEntry[];
}

/**
 * Compatibility entry
 */
export interface CompatibilityEntry {
  pluginId: string;
  pluginVersion: string;
  claudeFlowVersions: string[];
  tested: boolean;
  notes?: string;
}

/**
 * Search query options for plugins
 */
export interface PluginSearchOptions {
  query?: string;
  category?: string;
  type?: PluginType;
  tags?: string[];
  author?: string;
  minRating?: number;
  minDownloads?: number;
  verified?: boolean;
  trustLevel?: TrustLevel;
  permissions?: PluginPermission[];
  hasSecurityAudit?: boolean;
  sortBy?: 'downloads' | 'rating' | 'newest' | 'name' | 'reputation';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Search result
 */
export interface PluginSearchResult {
  plugins: PluginEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: PluginSearchOptions;
}

/**
 * Publish options for plugins
 */
export interface PluginPublishOptions {
  name: string;
  displayName: string;
  description: string;
  version: string;
  categories: string[];
  tags: string[];
  license: string;
  type: PluginType;
  hooks?: string[];
  commands?: string[];
  permissions: PluginPermission[];
  dependencies?: PluginDependency[];
  privateKeyPath?: string;
  requestAudit?: boolean;
}

/**
 * Publish result
 */
export interface PluginPublishResult {
  success: boolean;
  pluginId: string;
  cid: string;
  registryCid: string;
  gatewayUrl: string;
  message: string;
  auditRequestId?: string;
}

/**
 * Download options for plugins
 */
export interface PluginDownloadOptions {
  output?: string;
  verify?: boolean;
  install?: boolean;
  global?: boolean;
  skipDependencies?: boolean;
}

/**
 * Download result
 */
export interface PluginDownloadResult {
  success: boolean;
  plugin: PluginEntry;
  outputPath?: string;
  installed?: boolean;
  verified: boolean;
  size: number;
  dependenciesInstalled?: string[];
}

/**
 * Known plugin registries (bootstrap nodes)
 */
export interface KnownPluginRegistry {
  name: string;
  description: string;
  ipnsName: string;
  gateway: string;
  publicKey: string;
  trusted: boolean;
  official: boolean;
}

/**
 * Plugin store configuration
 */
export interface PluginStoreConfig {
  // Registry discovery
  registries: KnownPluginRegistry[];
  defaultRegistry: string;

  // IPFS settings
  gateway: string;
  timeout: number;

  // Cache settings
  cacheDir: string;
  cacheExpiry: number;

  // Security
  requireVerification: boolean;
  requireSecurityAudit: boolean;
  minTrustLevel: TrustLevel;
  trustedAuthors: string[];
  blockedPlugins: string[];
  allowedPermissions: PluginPermission[];
  requirePermissionPrompt: boolean;

  // User identity
  authorId?: string;
  privateKeyPath?: string;
}

/**
 * Plugin installation manifest
 */
export interface PluginManifest {
  name: string;
  version: string;
  cid: string;
  installedAt: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

/**
 * Installed plugins database
 */
export interface InstalledPlugins {
  plugins: PluginManifest[];
  lastUpdated: string;
}
