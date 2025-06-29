/**
 * Optional Property Utilities for exactOptionalPropertyTypes Compliance
 * Interface Design Agent #6 - Safe Optional Property Patterns
 */

// ===== SAFE OPTIONAL PROPERTY CONSTRUCTORS =====

/**
 * Safely create an object with optional properties, omitting undefined values
 */
export function createSafeOptional<T extends Record<string, any>>(
  obj: T
): SafeOptional<T> {
  const result: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  
  return result as SafeOptional<T>;
}

/**
 * Safely merge objects with optional properties
 */
export function mergeSafeOptional<T extends Record<string, any>, U extends Record<string, any>>(
  base: T,
  updates: U
): SafeOptional<T & U> {
  const result: any = { ...base };
  
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  
  return result as SafeOptional<T & U>;
}

/**
 * Type helper for safe optional properties
 */
export type SafeOptional<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
} & {
  [K in keyof T as T[K] extends undefined ? K : never]?: Exclude<T[K], undefined>;
};

// ===== SPECIFIC INTERFACE UTILITIES =====

/**
 * Safe ProcessPoolResult constructor
 */
export interface ProcessPoolResult {
  exitCode: number;
  output: string;
  error?: string | undefined;
  pid?: number | undefined;
}

export function createProcessPoolResult(data: {
  exitCode: number;
  output: string;
  error?: string;
  pid?: number;
}): ProcessPoolResult {
  const result: ProcessPoolResult = {
    exitCode: data.exitCode,
    output: data.output,
  };
  
  if (data.error !== undefined) {
    result.error = data.error;
  }
  
  if (data.pid !== undefined) {
    result.pid = data.pid;
  }
  
  return result;
}

/**
 * Safe QueryOptions constructor for memory commands
 * Must match the interface from advanced-memory-manager.ts
 */
export interface QueryOptions {
  namespace?: string;
  type?: string;
  tags?: string[];
  owner?: string;
  accessLevel?: 'private' | 'shared' | 'public';
  keyPattern?: string;
  valueSearch?: string;
  fullTextSearch?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
  lastAccessedAfter?: Date;
  lastAccessedBefore?: Date;
  sizeGreaterThan?: number;
  sizeLessThan?: number;
  includeExpired?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'key' | 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'size' | 'type';
  sortOrder?: 'asc' | 'desc';
  aggregateBy?: 'namespace' | 'type' | 'owner' | 'tags';
  includeMetadata?: boolean;
}

export function createQueryOptions(data: {
  fullTextSearch?: string;
  namespace?: string;
  type?: string;
  tags?: string[];
  owner?: string;
  accessLevel?: string;
  keyPattern?: string;
  valueSearch?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  lastAccessedAfter?: Date;
  lastAccessedBefore?: Date;
  minVersion?: number;
  maxVersion?: number;
  hasReferences?: boolean;
  hasDependencies?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeMetadata?: boolean;
}): QueryOptions {
  return createSafeOptional(data);
}

/**
 * Safe ExportOptions constructor
 */
export interface ExportOptions {
  format: 'json' | 'yaml' | 'csv' | 'xml';
  namespace?: string;
  type?: string;
  includeMetadata?: boolean;
  compression?: boolean;
  encryption?: {
    enabled: boolean;
    algorithm?: string;
    key?: string;
  };
  filtering?: QueryOptions;
}

export function createExportOptions(data: {
  format: ExportOptions['format'];
  namespace?: string;
  type?: string;
  includeMetadata?: boolean;
  compression?: boolean;
  encryption?: {
    enabled: boolean;
    algorithm?: string;
    key?: string;
  };
  filtering?: QueryOptions;
}): ExportOptions {
  const result: ExportOptions = {
    format: data.format,
  };
  
  if (data.namespace !== undefined) {
    result.namespace = data.namespace;
  }
  
  if (data.type !== undefined) {
    result.type = data.type;
  }
  
  if (data.includeMetadata !== undefined) {
    result.includeMetadata = data.includeMetadata;
  }
  
  if (data.compression !== undefined) {
    result.compression = data.compression;
  }
  
  if (data.encryption !== undefined) {
    result.encryption = data.encryption;
  }
  
  if (data.filtering !== undefined) {
    result.filtering = data.filtering;
  }
  
  return result;
}

/**
 * Safe ImportOptions constructor
 */
export interface ImportOptions {
  format: 'json' | 'yaml' | 'csv' | 'xml';
  namespace?: string;
  conflictResolution: 'overwrite' | 'skip' | 'merge' | 'rename';
  validation?: boolean;
  transformation?: {
    keyMapping?: Record<string, string>;
    valueTransformation?: (value: any) => any;
    metadataExtraction?: (entry: any) => Record<string, any>;
  };
  dryRun?: boolean;
}

export function createImportOptions(data: {
  format: ImportOptions['format'];
  namespace?: string;
  conflictResolution: ImportOptions['conflictResolution'];
  validation?: boolean;
  transformation?: {
    keyMapping?: Record<string, string>;
    valueTransformation?: (value: any) => any;
    metadataExtraction?: (entry: any) => Record<string, any>;
  };
  dryRun?: boolean;
}): ImportOptions {
  const result: ImportOptions = {
    format: data.format,
    conflictResolution: data.conflictResolution,
  };
  
  if (data.namespace !== undefined) {
    result.namespace = data.namespace;
  }
  
  if (data.validation !== undefined) {
    result.validation = data.validation;
  }
  
  if (data.transformation !== undefined) {
    result.transformation = data.transformation;
  }
  
  if (data.dryRun !== undefined) {
    result.dryRun = data.dryRun;
  }
  
  return result;
}

/**
 * Safe CleanupOptions constructor
 */
export interface CleanupOptions {
  dryRun?: boolean;
  removeExpired?: boolean;
  removeOlderThan?: number;
  removeUnaccessed?: number;
  removeOrphaned?: boolean;
  removeDuplicates?: boolean;
  compressEligible?: boolean;
  archiveOld?: {
    enabled: boolean;
    olderThan: number;
    archivePath: string;
  };
  retentionPolicies?: Array<{
    namespace: string;
    maxAge: number;
    maxCount: number;
  }>;
}

export function createCleanupOptions(data: {
  dryRun?: boolean;
  removeExpired?: boolean;
  removeOlderThan?: number;
  removeUnaccessed?: number;
  removeOrphaned?: boolean;
  removeDuplicates?: boolean;
  compressEligible?: boolean;
  archiveOld?: {
    enabled: boolean;
    olderThan: number;
    archivePath: string;
  };
  retentionPolicies?: Array<{
    namespace: string;
    maxAge: number;
    maxCount: number;
  }>;
}): CleanupOptions {
  return createSafeOptional(data);
}

// ===== INDEXED ACCESS HELPERS =====

/**
 * Safe property access for objects with index signatures
 */
export function safeGet<T>(obj: Record<string, T>, key: string): T | undefined {
  return obj[key];
}

/**
 * Safe property access with default value
 */
export function safeGetWithDefault<T>(
  obj: Record<string, T>,
  key: string,
  defaultValue: T
): T {
  return obj[key] ?? defaultValue;
}

/**
 * Safe property setter for objects with index signatures
 */
export function safeSet<T>(obj: Record<string, T>, key: string, value: T): void {
  obj[key] = value;
}

/**
 * Type-safe property access for known keys
 */
export function getProperty<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  key: K
): T[K] {
  return obj[key];
}

/**
 * Type-safe property check
 */
export function hasProperty<T extends Record<string, any>>(
  obj: T,
  key: string
): key is keyof T {
  return key in obj;
}

// ===== VALIDATION HELPERS =====

/**
 * Validate required properties exist and are not undefined
 */
export function validateRequired<T extends Record<string, any>>(
  obj: T,
  requiredKeys: (keyof T)[]
): void {
  for (const key of requiredKeys) {
    if (obj[key] === undefined) {
      throw new Error(`Required property '${String(key)}' is undefined`);
    }
  }
}

/**
 * Filter out undefined properties from an object
 */
export function filterUndefined<T extends Record<string, any>>(obj: T): {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
} {
  const result: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Create a partial object with only defined properties
 */
export function createPartialDefined<T extends Record<string, any>>(
  obj: Partial<T>
): {
  [K in keyof T as T[K] extends undefined ? never : K]?: T[K];
} {
  return filterUndefined(obj) as any;
}

// ===== DATE HANDLING HELPERS =====

/**
 * Safe date creation from potentially undefined input
 */
export function createSafeDate(value: string | number | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  
  return new Date(value);
}

/**
 * Safe date creation with validation
 */
export function createValidDate(value: string | number | Date | undefined): Date {
  if (value === undefined) {
    throw new Error('Date value is required');
  }
  
  const date = new Date(value);
  
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
  
  return date;
}

// ===== ARRAY HELPERS =====

/**
 * Safe array access for potentially undefined arrays
 */
export function safeArrayAccess<T>(arr: T[] | undefined): T[] {
  return arr ?? [];
}

/**
 * Safe array mapping
 */
export function safeArrayMap<T, U>(
  arr: T[] | undefined,
  mapper: (item: T, index: number) => U
): U[] {
  return safeArrayAccess(arr).map(mapper);
}

/**
 * Safe array filtering
 */
export function safeArrayFilter<T>(
  arr: T[] | undefined,
  predicate: (item: T, index: number) => boolean
): T[] {
  return safeArrayAccess(arr).filter(predicate);
}

// ===== TYPE EXPORTS =====

export type {
  SafeOptional,
  ProcessPoolResult,
  QueryOptions,
  ExportOptions,
  ImportOptions,
  CleanupOptions,
};