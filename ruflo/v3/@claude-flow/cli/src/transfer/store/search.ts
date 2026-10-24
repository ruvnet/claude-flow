/**
 * Pattern Search Service
 * Search and filter patterns from decentralized registry
 */

import type {
  PatternRegistry,
  PatternEntry,
  SearchOptions,
  SearchResult,
} from './types.js';

/**
 * Search patterns in registry
 */
export function searchPatterns(
  registry: PatternRegistry,
  options: SearchOptions = {}
): SearchResult {
  let patterns = [...registry.patterns];

  // Text search
  if (options.query) {
    const query = options.query.toLowerCase();
    patterns = patterns.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.displayName.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.tags.some(t => t.toLowerCase().includes(query))
    );
  }

  // Category filter
  if (options.category) {
    patterns = patterns.filter(p => p.categories.includes(options.category!));
  }

  // Language filter
  if (options.language) {
    patterns = patterns.filter(p => p.language === options.language);
  }

  // Framework filter
  if (options.framework) {
    patterns = patterns.filter(p => p.framework === options.framework);
  }

  // Tags filter
  if (options.tags && options.tags.length > 0) {
    patterns = patterns.filter(p =>
      options.tags!.some(t => p.tags.includes(t))
    );
  }

  // Author filter
  if (options.author) {
    patterns = patterns.filter(p => p.author.id === options.author);
  }

  // Rating filter
  if (options.minRating !== undefined) {
    patterns = patterns.filter(p => p.rating >= options.minRating!);
  }

  // Downloads filter
  if (options.minDownloads !== undefined) {
    patterns = patterns.filter(p => p.downloads >= options.minDownloads!);
  }

  // Verified filter
  if (options.verified !== undefined) {
    patterns = patterns.filter(p => p.verified === options.verified);
  }

  // Trust level filter
  if (options.trustLevel) {
    const trustLevels = ['unverified', 'community', 'verified', 'official'];
    const minLevel = trustLevels.indexOf(options.trustLevel);
    patterns = patterns.filter(p => {
      const patternLevel = trustLevels.indexOf(p.trustLevel);
      return patternLevel >= minLevel;
    });
  }

  // Sort
  const sortBy = options.sortBy || 'downloads';
  const sortOrder = options.sortOrder || 'desc';

  patterns.sort((a, b) => {
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
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Pagination
  const total = patterns.length;
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const page = Math.floor(offset / limit) + 1;

  patterns = patterns.slice(offset, offset + limit);

  return {
    patterns,
    total,
    page,
    pageSize: limit,
    hasMore: offset + patterns.length < total,
    query: options,
  };
}

/**
 * Get featured patterns
 */
export function getFeaturedPatterns(registry: PatternRegistry): PatternEntry[] {
  return registry.featured
    .map(id => registry.patterns.find(p => p.id === id))
    .filter((p): p is PatternEntry => p !== undefined);
}

/**
 * Get trending patterns
 */
export function getTrendingPatterns(registry: PatternRegistry): PatternEntry[] {
  return registry.trending
    .map(id => registry.patterns.find(p => p.id === id))
    .filter((p): p is PatternEntry => p !== undefined);
}

/**
 * Get newest patterns
 */
export function getNewestPatterns(registry: PatternRegistry): PatternEntry[] {
  return registry.newest
    .map(id => registry.patterns.find(p => p.id === id))
    .filter((p): p is PatternEntry => p !== undefined);
}

/**
 * Get pattern by ID
 */
export function getPatternById(
  registry: PatternRegistry,
  patternId: string
): PatternEntry | undefined {
  return registry.patterns.find(p => p.id === patternId);
}

/**
 * Get pattern by name
 */
export function getPatternByName(
  registry: PatternRegistry,
  name: string
): PatternEntry | undefined {
  return registry.patterns.find(p => p.name === name);
}

/**
 * Get patterns by author
 */
export function getPatternsByAuthor(
  registry: PatternRegistry,
  authorId: string
): PatternEntry[] {
  return registry.patterns.filter(p => p.author.id === authorId);
}

/**
 * Get patterns by category
 */
export function getPatternsByCategory(
  registry: PatternRegistry,
  categoryId: string
): PatternEntry[] {
  return registry.patterns.filter(p => p.categories.includes(categoryId));
}

/**
 * Get similar patterns (by tags and category)
 */
export function getSimilarPatterns(
  registry: PatternRegistry,
  pattern: PatternEntry,
  limit: number = 5
): PatternEntry[] {
  const scores = new Map<string, number>();

  for (const p of registry.patterns) {
    if (p.id === pattern.id) continue;

    let score = 0;

    // Shared tags
    const sharedTags = p.tags.filter(t => pattern.tags.includes(t));
    score += sharedTags.length * 2;

    // Shared categories
    const sharedCategories = p.categories.filter(c => pattern.categories.includes(c));
    score += sharedCategories.length * 3;

    // Same language
    if (p.language === pattern.language) score += 1;

    // Same framework
    if (p.framework === pattern.framework) score += 2;

    // Same author
    if (p.author.id === pattern.author.id) score += 1;

    if (score > 0) {
      scores.set(p.id, score);
    }
  }

  // Sort by score and return top matches
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => registry.patterns.find(p => p.id === id)!)
    .filter(p => p !== undefined);
}

/**
 * Get category stats
 */
export function getCategoryStats(registry: PatternRegistry): Map<string, number> {
  const stats = new Map<string, number>();

  for (const category of registry.categories) {
    const count = registry.patterns.filter(p =>
      p.categories.includes(category.id)
    ).length;
    stats.set(category.id, count);
  }

  return stats;
}

/**
 * Get tag cloud (tag -> count)
 */
export function getTagCloud(registry: PatternRegistry): Map<string, number> {
  const tags = new Map<string, number>();

  for (const pattern of registry.patterns) {
    for (const tag of pattern.tags) {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }

  return tags;
}

/**
 * Autocomplete search suggestions
 */
export function getSearchSuggestions(
  registry: PatternRegistry,
  partial: string,
  limit: number = 10
): string[] {
  const suggestions = new Set<string>();
  const query = partial.toLowerCase();

  // Add matching pattern names
  for (const pattern of registry.patterns) {
    if (pattern.name.toLowerCase().includes(query)) {
      suggestions.add(pattern.name);
    }
    if (pattern.displayName.toLowerCase().includes(query)) {
      suggestions.add(pattern.displayName);
    }
  }

  // Add matching tags
  for (const pattern of registry.patterns) {
    for (const tag of pattern.tags) {
      if (tag.toLowerCase().includes(query)) {
        suggestions.add(tag);
      }
    }
  }

  // Add matching categories
  for (const category of registry.categories) {
    if (category.name.toLowerCase().includes(query)) {
      suggestions.add(category.name);
    }
  }

  return Array.from(suggestions).slice(0, limit);
}
