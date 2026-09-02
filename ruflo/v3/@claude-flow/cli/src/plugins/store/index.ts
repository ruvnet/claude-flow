/**
 * Plugin Store Module
 * Decentralized plugin marketplace using IPFS
 *
 * Provides:
 * - Plugin discovery via IPNS
 * - Search with filters
 * - Download with verification
 * - Publish with signing
 */

// Re-export types
export * from './types.js';

// Re-export discovery
export {
  PluginDiscoveryService,
  createPluginDiscoveryService,
  DEFAULT_PLUGIN_STORE_CONFIG,
  type PluginDiscoveryResult,
} from './discovery.js';

// Re-export search
export {
  searchPlugins,
  getPluginSearchSuggestions,
  getPluginTagCloud,
  getPluginCategoryStats,
  findSimilarPlugins,
  getFeaturedPlugins,
  getTrendingPlugins,
  getNewestPlugins,
  getOfficialPlugins,
  getPluginsByPermission,
} from './search.js';

// High-level Plugin Store API
import type {
  PluginRegistry,
  PluginEntry,
  PluginSearchOptions,
  PluginSearchResult,
  PluginStoreConfig,
} from './types.js';
import { PluginDiscoveryService } from './discovery.js';
import { searchPlugins, findSimilarPlugins } from './search.js';

/**
 * High-level Plugin Store API
 */
export class PluginStore {
  private discovery: PluginDiscoveryService;
  private registry: PluginRegistry | null = null;

  constructor(config?: Partial<PluginStoreConfig>) {
    this.discovery = new PluginDiscoveryService(config);
  }

  /**
   * Initialize the store by discovering the registry
   */
  async initialize(registryName?: string): Promise<boolean> {
    const result = await this.discovery.discoverRegistry(registryName);
    if (result.success && result.registry) {
      this.registry = result.registry;
      return true;
    }
    return false;
  }

  /**
   * Check if store is initialized
   */
  isInitialized(): boolean {
    return this.registry !== null;
  }

  /**
   * Get the current registry
   */
  getRegistry(): PluginRegistry | null {
    return this.registry;
  }

  /**
   * Search plugins
   */
  search(options: PluginSearchOptions = {}): PluginSearchResult {
    if (!this.registry) {
      return {
        plugins: [],
        total: 0,
        page: 1,
        pageSize: options.limit || 20,
        hasMore: false,
        query: options,
      };
    }
    return searchPlugins(this.registry, options);
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): PluginEntry | undefined {
    return this.registry?.plugins.find(p => p.id === pluginId);
  }

  /**
   * Get similar plugins
   */
  getSimilarPlugins(pluginId: string, limit: number = 5): PluginEntry[] {
    if (!this.registry) return [];
    return findSimilarPlugins(this.registry, pluginId, limit);
  }

  /**
   * Get featured plugins
   */
  getFeatured(): PluginEntry[] {
    if (!this.registry) return [];
    return this.registry.featured
      .map(id => this.registry!.plugins.find(p => p.id === id))
      .filter((p): p is PluginEntry => p !== undefined);
  }

  /**
   * Get official plugins
   */
  getOfficial(): PluginEntry[] {
    if (!this.registry) return [];
    return this.registry.official
      .map(id => this.registry!.plugins.find(p => p.id === id))
      .filter((p): p is PluginEntry => p !== undefined);
  }

  /**
   * Get trending plugins
   */
  getTrending(): PluginEntry[] {
    if (!this.registry) return [];
    return this.registry.trending
      .map(id => this.registry!.plugins.find(p => p.id === id))
      .filter((p): p is PluginEntry => p !== undefined);
  }

  /**
   * Get newest plugins
   */
  getNewest(): PluginEntry[] {
    if (!this.registry) return [];
    return this.registry.newest
      .map(id => this.registry!.plugins.find(p => p.id === id))
      .filter((p): p is PluginEntry => p !== undefined);
  }

  /**
   * Get discovery service
   */
  getDiscovery(): PluginDiscoveryService {
    return this.discovery;
  }

  /**
   * Refresh registry
   */
  async refresh(registryName?: string): Promise<boolean> {
    this.discovery.clearCache();
    return this.initialize(registryName);
  }
}

/**
 * Create a new plugin store instance
 */
export function createPluginStore(config?: Partial<PluginStoreConfig>): PluginStore {
  return new PluginStore(config);
}
