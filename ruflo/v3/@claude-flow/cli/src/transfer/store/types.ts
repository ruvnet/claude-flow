/**
 * Pattern Store Types
 * Decentralized pattern marketplace using IPFS
 */

import type { TrustLevel, AnonymizationLevel } from '../types.js';

/**
 * Pattern entry in the registry
 */
export interface PatternEntry {
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
  author: PatternAuthor;
  license: string;
  categories: string[];
  tags: string[];
  language?: string;
  framework?: string;

  // Stats
  downloads: number;
  rating: number;
  ratingCount: number;
  lastUpdated: string;
  createdAt: string;

  // Requirements
  minClaudeFlowVersion: string;
  dependencies?: string[];

  // Verification
  verified: boolean;
  trustLevel: TrustLevel;
  signature?: string;
  publicKey?: string;
}

/**
 * Pattern author info
 */
export interface PatternAuthor {
  id: string;
  displayName?: string;
  publicKey?: string;
  verified: boolean;
  patterns: number;
  totalDownloads: number;
}

/**
 * Category in the registry
 */
export interface PatternCategory {
  id: string;
  name: string;
  description: string;
  patternCount: number;
  icon?: string;
  subcategories?: PatternCategory[];
}

/**
 * Decentralized registry structure
 * Stored on IPFS with IPNS pointer for updates
 */
export interface PatternRegistry {
  // Registry metadata
  version: string;
  updatedAt: string;
  ipnsName: string;
  previousCid?: string;

  // Content
  patterns: PatternEntry[];
  categories: PatternCategory[];
  authors: PatternAuthor[];

  // Stats
  totalPatterns: number;
  totalDownloads: number;
  totalAuthors: number;

  // Featured/promoted
  featured: string[];
  trending: string[];
  newest: string[];

  // Verification
  registrySignature?: string;
  registryPublicKey?: string;
}

/**
 * Search query options
 */
export interface SearchOptions {
  query?: string;
  category?: string;
  language?: string;
  framework?: string;
  tags?: string[];
  author?: string;
  minRating?: number;
  minDownloads?: number;
  verified?: boolean;
  trustLevel?: TrustLevel;
  sortBy?: 'downloads' | 'rating' | 'newest' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Search result
 */
export interface SearchResult {
  patterns: PatternEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: SearchOptions;
}

/**
 * Publish options
 */
export interface PublishOptions {
  name: string;
  displayName: string;
  description: string;
  categories: string[];
  tags: string[];
  license: string;
  language?: string;
  framework?: string;
  anonymize: AnonymizationLevel;
  privateKeyPath?: string;
}

/**
 * Publish result
 */
export interface PublishResult {
  success: boolean;
  patternId: string;
  cid: string;
  registryCid: string;
  gatewayUrl: string;
  message: string;
}

/**
 * Download options
 */
export interface DownloadOptions {
  output?: string;
  verify?: boolean;
  import?: boolean;
  importStrategy?: 'replace' | 'merge' | 'append';
}

/**
 * Download result
 */
export interface DownloadResult {
  success: boolean;
  pattern: PatternEntry;
  outputPath?: string;
  imported?: boolean;
  verified: boolean;
  size: number;
}

/**
 * Known registries (bootstrap nodes)
 */
export interface KnownRegistry {
  name: string;
  description: string;
  ipnsName: string;
  gateway: string;
  publicKey: string;
  trusted: boolean;
}

/**
 * Store configuration
 */
export interface StoreConfig {
  // Registry discovery
  registries: KnownRegistry[];
  defaultRegistry: string;

  // IPFS settings
  gateway: string;
  timeout: number;

  // Cache settings
  cacheDir: string;
  cacheExpiry: number;

  // Security
  requireVerification: boolean;
  minTrustLevel: TrustLevel;
  trustedAuthors: string[];
  blockedPatterns: string[];

  // User identity
  authorId?: string;
  privateKeyPath?: string;
}

/**
 * Rating submission
 */
export interface RatingSubmission {
  patternId: string;
  rating: number;
  comment?: string;
  authorId: string;
  signature: string;
}
