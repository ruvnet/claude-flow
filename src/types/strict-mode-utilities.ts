/**
 * TypeScript Strict Mode Utilities
 * Comprehensive type utilities for exactOptionalPropertyTypes and strict mode compliance
 * 
 * @description This file provides reusable type utilities and patterns for handling
 * TypeScript's strict mode settings, particularly exactOptionalPropertyTypes and
 * noPropertyAccessFromIndexSignature.
 */

// ===== EXACT OPTIONAL PROPERTY TYPES UTILITIES =====

/**
 * Utility type to make optional properties explicitly accept undefined
 * This is needed for exactOptionalPropertyTypes: true compliance
 */
export type ExactOptional<T> = {
  [K in keyof T]: T[K] | undefined;
};

/**
 * Utility type for partial objects that properly handle exactOptionalPropertyTypes
 * All optional properties can be undefined or omitted entirely
 */
export type StrictPartial<T> = {
  [P in keyof T]?: T[P] | undefined;
};

/**
 * Utility type for making specific properties optional with undefined support
 */
export type MakeOptionalWithUndefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: T[P] | undefined;
};

/**
 * Utility type for ensuring optional properties can be undefined
 */
export type OptionalUndefined<T> = {
  [K in keyof T]: undefined extends T[K] ? T[K] : T[K] | undefined;
};

// ===== SAFE INDEX SIGNATURE ACCESS UTILITIES =====

/**
 * Utility type for safe access to objects with index signatures
 * Ensures all property access is done via bracket notation
 */
export type SafeRecord<K extends string | number | symbol, V> = {
  readonly [P in K]: V;
} & {
  [key: string]: V | undefined;
  [key: number]: V | undefined;
};

/**
 * Helper function for safe property access from objects with index signatures
 * @param obj Object to access
 * @param key Property key
 * @param defaultValue Default value if property doesn't exist
 * @returns Property value or default
 */
export function safeGet<T>(
  obj: Record<string, T> | undefined,
  key: string,
  defaultValue?: T
): T | undefined {
  if (!obj) return defaultValue;
  return obj[key] ?? defaultValue;
}

/**
 * Helper function for safe property access from environment variables
 * @param key Environment variable key
 * @param defaultValue Default value if not found
 * @returns Environment variable value or default
 */
export function safeEnvGet(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

/**
 * Type-safe environment variable access
 */
export type SafeEnv = {
  get(key: string): string | undefined;
  getRequired(key: string): string;
  getWithDefault(key: string, defaultValue: string): string;
};

export const safeEnv: SafeEnv = {
  get(key: string): string | undefined {
    return process.env[key];
  },
  
  getRequired(key: string): string {
    const value = process.env[key];
    if (value === undefined) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  },
  
  getWithDefault(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
  }
};

// ===== PROCESS RESULT TYPES =====

/**
 * Strict mode compliant process result interface
 * Fixes exactOptionalPropertyTypes issues with process execution
 */
export interface StrictProcessResult {
  exitCode: number;
  output: string;
  error?: string | undefined;
  pid?: number | undefined;
  signal?: string | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
}

/**
 * Factory function for creating strict process results
 */
export function createProcessResult(params: {
  exitCode: number;
  output: string;
  error?: string;
  pid?: number;
  signal?: string;
  stdout?: string;
  stderr?: string;
}): StrictProcessResult {
  return {
    exitCode: params.exitCode,
    output: params.output,
    error: params.error,
    pid: params.pid,
    signal: params.signal,
    stdout: params.stdout,
    stderr: params.stderr
  };
}

// ===== QUERY OPTIONS TYPES =====

/**
 * Strict mode compliant query options with proper undefined handling
 */
export interface StrictQueryOptions {
  namespace?: string | undefined;
  type?: string | undefined;
  tags?: string[] | undefined;
  owner?: string | undefined;
  accessLevel?: ('private' | 'shared' | 'public') | undefined;
  keyPattern?: string | undefined;
  valueSearch?: string | undefined;
  fullTextSearch?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
  updatedAfter?: Date | undefined;
  updatedBefore?: Date | undefined;
  lastAccessedAfter?: Date | undefined;
  lastAccessedBefore?: Date | undefined;
  sizeGreaterThan?: number | undefined;
  sizeLessThan?: number | undefined;
  includeExpired?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sortBy?: ('key' | 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'size' | 'type') | undefined;
  sortOrder?: ('asc' | 'desc') | undefined;
}

/**
 * Factory function for creating strict query options
 */
export function createQueryOptions(options: Partial<StrictQueryOptions> = {}): StrictQueryOptions {
  return {
    namespace: options.namespace,
    type: options.type,
    tags: options.tags,
    owner: options.owner,
    accessLevel: options.accessLevel,
    keyPattern: options.keyPattern,
    valueSearch: options.valueSearch,
    fullTextSearch: options.fullTextSearch,
    createdAfter: options.createdAfter,
    createdBefore: options.createdBefore,
    updatedAfter: options.updatedAfter,
    updatedBefore: options.updatedBefore,
    lastAccessedAfter: options.lastAccessedAfter,
    lastAccessedBefore: options.lastAccessedBefore,
    sizeGreaterThan: options.sizeGreaterThan,
    sizeLessThan: options.sizeLessThan,
    includeExpired: options.includeExpired,
    limit: options.limit,
    offset: options.offset,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder
  };
}

// ===== CONFIGURATION TYPES =====

/**
 * Strict mode compliant export options
 */
export interface StrictExportOptions {
  format: 'json' | 'yaml' | 'csv' | 'sqlite';
  namespace?: string | undefined;
  type?: string | undefined;
  includeMetadata?: boolean | undefined;
  compression?: boolean | undefined;
  encryption?: {
    enabled: boolean;
    algorithm?: string | undefined;
    key?: string | undefined;
  } | undefined;
  filtering?: StrictQueryOptions | undefined;
}

/**
 * Strict mode compliant import options
 */
export interface StrictImportOptions {
  format: 'json' | 'yaml' | 'csv' | 'sqlite';
  namespace?: string | undefined;
  conflictResolution: 'skip' | 'overwrite' | 'merge' | 'error';
  validation?: boolean | undefined;
  transformation?: {
    keyMapping?: Record<string, string> | undefined;
    valueTransformation?: ((value: any) => any) | undefined;
    metadataExtraction?: ((entry: any) => Record<string, any>) | undefined;
  } | undefined;
  dryRun?: boolean | undefined;
}

/**
 * Strict mode compliant cleanup options
 */
export interface StrictCleanupOptions {
  dryRun?: boolean | undefined;
  removeExpired?: boolean | undefined;
  removeOlderThan?: number | undefined;
  removeUnaccessed?: number | undefined;
  removeOrphaned?: boolean | undefined;
  removeDuplicates?: boolean | undefined;
  compressEligible?: boolean | undefined;
  archiveOld?: {
    enabled: boolean;
    olderThan: number;
    archivePath: string;
  } | undefined;
  retentionPolicies?: string[] | undefined;
}

// ===== TYPE VALIDATION UTILITIES =====

/**
 * Check if a value is safely assignable to an optional property
 */
export function isAssignableToOptional<T>(
  value: T | undefined,
  check: (val: T) => boolean = () => true
): value is T | undefined {
  return value === undefined || check(value);
}

/**
 * Safely assign value to optional property with validation
 */
export function safeAssign<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
  validator?: (val: T[K]) => boolean
): void {
  if (value !== undefined) {
    if (validator && !validator(value)) {
      throw new Error(`Invalid value for property ${String(key)}`);
    }
    target[key] = value;
  }
}

// ===== CLI COMMAND UTILITIES =====

/**
 * Type-safe options parser for CLI commands
 */
export interface StrictCommandOptions {
  [key: string]: any;
}

/**
 * Helper function for safely accessing CLI command options
 */
export function getCommandOption<T>(
  options: StrictCommandOptions,
  key: string,
  defaultValue?: T
): T | undefined {
  return (options[key] as T) ?? defaultValue;
}

/**
 * Helper function for safely accessing required CLI command options
 */
export function getRequiredCommandOption<T>(
  options: StrictCommandOptions,
  key: string
): T {
  const value = options[key] as T;
  if (value === undefined) {
    throw new Error(`Required option '${key}' is missing`);
  }
  return value;
}

// ===== AGENT CAPABILITIES UTILITIES =====

/**
 * Type-safe agent capabilities mapping
 */
export interface AgentCapabilitiesMap {
  readonly researcher: readonly string[];
  readonly coder: readonly string[];
  readonly implementer: readonly string[];
  readonly analyst: readonly string[];
  readonly custom: readonly string[];
}

/**
 * Safe access to agent capabilities
 */
export function getAgentCapabilities(
  capabilities: AgentCapabilitiesMap,
  type: string
): readonly string[] {
  // Use bracket notation for type-safe access
  const typeCapabilities = capabilities[type as keyof AgentCapabilitiesMap];
  return typeCapabilities ?? capabilities['custom'];
}

// ===== TYPE CONVERSION UTILITIES =====

/**
 * Convert legacy interfaces to strict mode compliant versions
 */
export function toStrictQueryOptions(legacy: any): StrictQueryOptions {
  return createQueryOptions({
    namespace: legacy.namespace,
    type: legacy.type,
    tags: legacy.tags,
    owner: legacy.owner,
    accessLevel: legacy.accessLevel,
    keyPattern: legacy.keyPattern,
    valueSearch: legacy.valueSearch,
    fullTextSearch: legacy.fullTextSearch,
    createdAfter: legacy.createdAfter,
    createdBefore: legacy.createdBefore,
    updatedAfter: legacy.updatedAfter,
    updatedBefore: legacy.updatedBefore,
    lastAccessedAfter: legacy.lastAccessedAfter,
    lastAccessedBefore: legacy.lastAccessedBefore,
    sizeGreaterThan: legacy.sizeGreaterThan,
    sizeLessThan: legacy.sizeLessThan,
    includeExpired: legacy.includeExpired,
    limit: legacy.limit,
    offset: legacy.offset,
    sortBy: legacy.sortBy,
    sortOrder: legacy.sortOrder
  });
}

// ===== CONSTANTS =====

/**
 * Default values for strict mode compliance
 */
export const STRICT_DEFAULTS = {
  PROCESS_TIMEOUT: 30000,
  QUERY_LIMIT: 100,
  CLEANUP_BATCH_SIZE: 1000,
  MAX_RETRIES: 3,
  DEFAULT_ACCESS_LEVEL: 'private' as const,
  DEFAULT_SORT_ORDER: 'desc' as const
} as const;

// ===== EXPORT ALIASES FOR COMPATIBILITY =====

// Re-export for easy migration
export type { StrictProcessResult as ProcessPoolResult };
export type { StrictQueryOptions as QueryOptions };
export type { StrictExportOptions as ExportOptions };
export type { StrictImportOptions as ImportOptions };
export type { StrictCleanupOptions as CleanupOptions };