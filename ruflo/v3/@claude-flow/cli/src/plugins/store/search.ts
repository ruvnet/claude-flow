/**
 * Plugin Search Service
 * Search and filter plugins from the registry
 */

import type {
  PluginEntry,
  PluginRegistry,
  PluginSearchOptions,
  PluginSearchResult,
} from './types.js';

/**
 * Search plugins in the registry
 */
export function searchPlugins(
  registry: PluginRegistry,
  options: PluginSearchOptions = {}
): PluginSearchResult {
  let plugins = [...registry.plugins];

  // Text search (name, displayName, description, tags)
  if (options.query) {
    const query = options.query.toLowerCase();
    plugins = plugins.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.displayName.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.tags.some(t => t.toLowerCase().includes(query)) ||
      p.keywords.some(k => k.toLowerCase().includes(query))
    );
  }

  // Category filter
  if (options.category) {
    plugins = plugins.filter(p =>
      p.categories.includes(options.category!)
    );
  }

  // Type filter
  if (options.type) {
    plugins = plugins.filter(p => p.type === options.type);
  }

  // Tags filter (match any)
  if (options.tags && options.tags.length > 0) {
    plugins = plugins.filter(p =>
      options.tags!.some(tag => p.tags.includes(tag))
    );
  }

  // Author filter
  if (options.author) {
    plugins = plugins.filter(p =>
      p.author.id === options.author ||
      p.author.displayName?.toLowerCase().includes(options.author!.toLowerCase())
    );
  }

  // Rating filter
  if (options.minRating !== undefined) {
    plugins = plugins.filter(p => p.rating >= options.minRating!);
  }

  // Downloads filter
  if (options.minDownloads !== undefined) {
    plugins = plugins.filter(p => p.downloads >= options.minDownloads!);
  }

  // Verified filter
  if (options.verified !== undefined) {
    plugins = plugins.filter(p => p.verified === options.verified);
  }

  // Trust level filter
  if (options.trustLevel) {
    const trustOrder = ['unverified', 'community', 'verified', 'official'];
    const minIndex = trustOrder.indexOf(options.trustLevel);
    plugins = plugins.filter(p => {
      const pluginIndex = trustOrder.indexOf(p.trustLevel);
      return pluginIndex >= minIndex;
    });
  }

  // Permissions filter
  if (options.permissions && options.permissions.length > 0) {
    plugins = plugins.filter(p =>
      options.permissions!.every(perm => p.permissions.includes(perm))
    );
  }

  // Security audit filter
  if (options.hasSecurityAudit !== undefined) {
    plugins = plugins.filter(p =>
      options.hasSecurityAudit ? p.securityAudit !== undefined : true
    );
  }

  // Sort
  const sortBy = options.sortBy || 'downloads';
  const sortOrder = options.sortOrder || 'desc';

  plugins.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'downloads':
        comparison = a.downloads - b.downloads;
        break;
      case 'rating':
        comparison = a.rating - b.rating;
        break;
      case 'newest':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'reputation':
        comparison = a.author.reputation - b.author.reputation;
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Pagination
  const total = plugins.length;
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const page = Math.floor(offset / limit) + 1;

  plugins = plugins.slice(offset, offset + limit);

  return {
    plugins,
    total,
    page,
    pageSize: limit,
    hasMore: offset + limit < total,
    query: options,
  };
}

/**
 * Get search suggestions based on partial query
 */
export function getPluginSearchSuggestions(
  registry: PluginRegistry,
  partialQuery: string,
  limit: number = 10
): string[] {
  const query = partialQuery.toLowerCase();
  const suggestions = new Set<string>();

  // Search in plugin names
  for (const plugin of registry.plugins) {
    if (plugin.name.toLowerCase().includes(query)) {
      suggestions.add(plugin.name);
    }
    if (plugin.displayName.toLowerCase().includes(query)) {
      suggestions.add(plugin.displayName);
    }
    // Search in tags
    for (const tag of plugin.tags) {
      if (tag.toLowerCase().includes(query)) {
        suggestions.add(tag);
      }
    }
    // Search in keywords
    for (const keyword of plugin.keywords) {
      if (keyword.toLowerCase().includes(query)) {
        suggestions.add(keyword);
      }
    }
  }

  return Array.from(suggestions).slice(0, limit);
}

/**
 * Get tag cloud with counts
 */
export function getPluginTagCloud(registry: PluginRegistry): Map<string, number> {
  const tagCounts = new Map<string, number>();

  for (const plugin of registry.plugins) {
    for (const tag of plugin.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // Sort by count descending
  const sortedEntries = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
  return new Map(sortedEntries);
}

/**
 * Get category statistics
 */
export function getPluginCategoryStats(registry: PluginRegistry): Map<string, number> {
  const categoryCounts = new Map<string, number>();

  for (const plugin of registry.plugins) {
    for (const category of plugin.categories) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }

  return categoryCounts;
}

/**
 * Find similar plugins based on tags and category
 */
export function findSimilarPlugins(
  registry: PluginRegistry,
  pluginId: string,
  limit: number = 5
): PluginEntry[] {
  const targetPlugin = registry.plugins.find(p => p.id === pluginId);
  if (!targetPlugin) {
    return [];
  }

  // Score plugins by tag overlap and category match
  const scored = registry.plugins
    .filter(p => p.id !== pluginId)
    .map(plugin => {
      let score = 0;

      // Tag overlap
      const tagOverlap = plugin.tags.filter(t =>
        targetPlugin.tags.includes(t)
      ).length;
      score += tagOverlap * 2;

      // Category match
      const categoryMatch = plugin.categories.some(c =>
        targetPlugin.categories.includes(c)
      );
      if (categoryMatch) score += 3;

      // Type match
      if (plugin.type === targetPlugin.type) score += 2;

      // Same author bonus
      if (plugin.author.id === targetPlugin.author.id) score += 1;

      return { plugin, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(s => s.plugin);
}

/**
 * Get featured plugins
 */
export function getFeaturedPlugins(registry: PluginRegistry): PluginEntry[] {
  return registry.featured
    .map(id => registry.plugins.find(p => p.id === id))
    .filter((p): p is PluginEntry => p !== undefined);
}

/**
 * Get trending plugins
 */
export function getTrendingPlugins(registry: PluginRegistry): PluginEntry[] {
  return registry.trending
    .map(id => registry.plugins.find(p => p.id === id))
    .filter((p): p is PluginEntry => p !== undefined);
}

/**
 * Get newest plugins
 */
export function getNewestPlugins(registry: PluginRegistry): PluginEntry[] {
  return registry.newest
    .map(id => registry.plugins.find(p => p.id === id))
    .filter((p): p is PluginEntry => p !== undefined);
}

/**
 * Get official plugins
 */
export function getOfficialPlugins(registry: PluginRegistry): PluginEntry[] {
  return registry.official
    .map(id => registry.plugins.find(p => p.id === id))
    .filter((p): p is PluginEntry => p !== undefined);
}

/**
 * Get plugins by permission
 */
export function getPluginsByPermission(
  registry: PluginRegistry,
  permission: string
): PluginEntry[] {
  return registry.plugins.filter(p =>
    p.permissions.includes(permission as any)
  );
}
