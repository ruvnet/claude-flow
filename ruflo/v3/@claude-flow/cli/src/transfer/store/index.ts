/**
 * Pattern Store Module
 * Decentralized pattern marketplace using IPFS
 */

// Types
export type {
  PatternEntry,
  PatternAuthor,
  PatternCategory,
  PatternRegistry,
  SearchOptions,
  SearchResult,
  PublishOptions,
  PublishResult,
  DownloadOptions,
  DownloadResult,
  KnownRegistry,
  StoreConfig,
  RatingSubmission,
} from './types.js';

// Registry
export {
  REGISTRY_VERSION,
  BOOTSTRAP_REGISTRIES,
  DEFAULT_STORE_CONFIG,
  createRegistry,
  getDefaultCategories,
  addPatternToRegistry,
  removePatternFromRegistry,
  serializeRegistry,
  deserializeRegistry,
  signRegistry,
  verifyRegistrySignature,
  mergeRegistries,
  generatePatternId,
} from './registry.js';

// Discovery
export type { DiscoveryResult, IPNSResolution } from './discovery.js';
export { PatternDiscovery, createDiscoveryService } from './discovery.js';

// Search
export {
  searchPatterns,
  getFeaturedPatterns,
  getTrendingPatterns,
  getNewestPatterns,
  getPatternById,
  getPatternByName,
  getPatternsByAuthor,
  getPatternsByCategory,
  getSimilarPatterns,
  getCategoryStats,
  getTagCloud,
  getSearchSuggestions,
} from './search.js';

// Download
export type { DownloadProgressCallback } from './download.js';
export {
  PatternDownloader,
  batchDownload,
  createDownloader,
} from './download.js';

// Publish
export type { ContributionRequest } from './publish.js';
export {
  PatternPublisher,
  submitContribution,
  checkContributionStatus,
  createPublisher,
  quickPublish,
} from './publish.js';

// Import classes and functions for PatternStore
import type { PatternRegistry, SearchOptions, SearchResult, DownloadOptions, DownloadResult, PublishOptions, PublishResult, PatternEntry, PatternCategory, KnownRegistry, StoreConfig } from './types.js';
import type { CFPFormat } from '../types.js';
import { PatternDiscovery } from './discovery.js';
import { PatternDownloader } from './download.js';
import { PatternPublisher } from './publish.js';
import {
  searchPatterns as doSearchPatterns,
  getFeaturedPatterns as doGetFeaturedPatterns,
  getTrendingPatterns as doGetTrendingPatterns,
  getNewestPatterns as doGetNewestPatterns,
} from './search.js';

/**
 * Pattern Store - High-level API
 */
export class PatternStore {
  private discovery: PatternDiscovery | null = null;
  private downloader: PatternDownloader | null = null;
  private publisher: PatternPublisher | null = null;
  private registry: PatternRegistry | null = null;
  private config: Partial<StoreConfig>;

  constructor(config: Partial<StoreConfig> = {}) {
    this.config = config;
  }

  /**
   * Initialize store and load registry
   */
  async initialize(registryName?: string): Promise<boolean> {
    // Dynamic imports to avoid ESM/CommonJS issues
    const { PatternDiscovery } = await import('./discovery.js');
    const { PatternDownloader } = await import('./download.js');
    const { PatternPublisher } = await import('./publish.js');

    this.discovery = new PatternDiscovery(this.config);
    this.downloader = new PatternDownloader(this.config);
    this.publisher = new PatternPublisher(this.config);

    const result = await this.discovery.discoverRegistry(registryName);
    if (result.success && result.registry) {
      this.registry = result.registry;
      return true;
    }
    return false;
  }

  /**
   * Search patterns
   */
  search(options: SearchOptions = {}): SearchResult {
    if (!this.registry) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return doSearchPatterns(this.registry, options);
  }

  /**
   * Get pattern by ID
   */
  getPattern(patternId: string): PatternEntry | undefined {
    if (!this.registry) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.registry.patterns.find(p => p.id === patternId);
  }

  /**
   * Download pattern
   */
  async download(
    patternId: string,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    const pattern = this.getPattern(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }
    if (!this.downloader) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.downloader.downloadPattern(pattern, options);
  }

  /**
   * Publish pattern
   */
  async publish(
    cfp: CFPFormat,
    options: PublishOptions
  ): Promise<PublishResult> {
    if (!this.publisher) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.publisher.publishPattern(cfp, options);
  }

  /**
   * Get featured patterns
   */
  getFeatured(): PatternEntry[] {
    if (!this.registry) return [];
    return doGetFeaturedPatterns(this.registry);
  }

  /**
   * Get trending patterns
   */
  getTrending(): PatternEntry[] {
    if (!this.registry) return [];
    return doGetTrendingPatterns(this.registry);
  }

  /**
   * Get newest patterns
   */
  getNewest(): PatternEntry[] {
    if (!this.registry) return [];
    return doGetNewestPatterns(this.registry);
  }

  /**
   * Get categories
   */
  getCategories(): PatternCategory[] {
    if (!this.registry) return [];
    return this.registry.categories;
  }

  /**
   * Get available registries
   */
  getRegistries(): KnownRegistry[] {
    if (!this.discovery) return [];
    return this.discovery.listRegistries();
  }

  /**
   * Refresh registry
   */
  async refresh(): Promise<boolean> {
    if (this.discovery) {
      this.discovery.clearCache();
    }
    return this.initialize();
  }

  /**
   * Get store statistics
   */
  getStats(): {
    totalPatterns: number;
    totalDownloads: number;
    totalAuthors: number;
    categories: number;
  } {
    if (!this.registry) {
      return { totalPatterns: 0, totalDownloads: 0, totalAuthors: 0, categories: 0 };
    }
    return {
      totalPatterns: this.registry.totalPatterns,
      totalDownloads: this.registry.totalDownloads,
      totalAuthors: this.registry.totalAuthors,
      categories: this.registry.categories.length,
    };
  }
}

/**
 * Create pattern store instance
 */
export function createPatternStore(
  config?: Partial<StoreConfig>
): PatternStore {
  return new PatternStore(config);
}
