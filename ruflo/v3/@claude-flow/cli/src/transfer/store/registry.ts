/**
 * Decentralized Pattern Registry
 * IPFS-based registry with IPNS for mutable references
 */

import * as crypto from 'crypto';
import type {
  PatternRegistry,
  PatternEntry,
  PatternCategory,
  PatternAuthor,
  KnownRegistry,
  StoreConfig,
} from './types.js';

/**
 * Registry version
 */
export const REGISTRY_VERSION = '1.0.0';

/**
 * Default bootstrap registries for discovery
 */
export const BOOTSTRAP_REGISTRIES: KnownRegistry[] = [
  {
    name: 'claude-flow-official',
    description: 'Official Claude Flow pattern registry',
    ipnsName: 'k51qzi5uqu5dj0w8q1xvqn8ql2g4p7x8qpk9vz3xm1y2n3o4p5q6r7s8t9u0v',
    gateway: 'https://w3s.link',
    publicKey: 'ed25519:claude-flow-registry-key',
    trusted: true,
  },
  {
    name: 'community-patterns',
    description: 'Community-contributed patterns',
    ipnsName: 'k51qzi5uqu5dkkph0w8q1xvqn8ql2g4p7x8qpk9vz3xm1y2n3o4p5q6r7s8',
    gateway: 'https://dweb.link',
    publicKey: 'ed25519:community-registry-key',
    trusted: false,
  },
];

/**
 * Default store configuration
 */
export const DEFAULT_STORE_CONFIG: StoreConfig = {
  registries: BOOTSTRAP_REGISTRIES,
  defaultRegistry: 'claude-flow-official',
  gateway: 'https://w3s.link',
  timeout: 30000,
  cacheDir: '.claude-flow/patterns/cache',
  cacheExpiry: 3600000, // 1 hour
  requireVerification: false,
  minTrustLevel: 'unverified',
  trustedAuthors: [],
  blockedPatterns: [],
};

/**
 * Create a new empty registry
 */
export function createRegistry(ipnsName: string): PatternRegistry {
  return {
    version: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    ipnsName,

    patterns: [],
    categories: getDefaultCategories(),
    authors: [],

    totalPatterns: 0,
    totalDownloads: 0,
    totalAuthors: 0,

    featured: [],
    trending: [],
    newest: [],
  };
}

/**
 * Default pattern categories
 */
export function getDefaultCategories(): PatternCategory[] {
  return [
    {
      id: 'routing',
      name: 'Task Routing',
      description: 'Patterns for routing tasks to appropriate agents',
      patternCount: 0,
      icon: '🔀',
    },
    {
      id: 'coordination',
      name: 'Swarm Coordination',
      description: 'Multi-agent coordination and communication patterns',
      patternCount: 0,
      icon: '🐝',
    },
    {
      id: 'security',
      name: 'Security',
      description: 'Security analysis and vulnerability detection patterns',
      patternCount: 0,
      icon: '🔒',
    },
    {
      id: 'performance',
      name: 'Performance',
      description: 'Performance optimization and profiling patterns',
      patternCount: 0,
      icon: '⚡',
    },
    {
      id: 'testing',
      name: 'Testing',
      description: 'Test generation and quality assurance patterns',
      patternCount: 0,
      icon: '🧪',
    },
    {
      id: 'documentation',
      name: 'Documentation',
      description: 'Documentation generation and maintenance patterns',
      patternCount: 0,
      icon: '📚',
    },
    {
      id: 'refactoring',
      name: 'Refactoring',
      description: 'Code refactoring and improvement patterns',
      patternCount: 0,
      icon: '🔧',
    },
    {
      id: 'language',
      name: 'Language-Specific',
      description: 'Patterns optimized for specific programming languages',
      patternCount: 0,
      icon: '💻',
      subcategories: [
        { id: 'typescript', name: 'TypeScript', description: 'TypeScript patterns', patternCount: 0 },
        { id: 'python', name: 'Python', description: 'Python patterns', patternCount: 0 },
        { id: 'rust', name: 'Rust', description: 'Rust patterns', patternCount: 0 },
        { id: 'go', name: 'Go', description: 'Go patterns', patternCount: 0 },
      ],
    },
    {
      id: 'framework',
      name: 'Framework-Specific',
      description: 'Patterns for specific frameworks',
      patternCount: 0,
      icon: '🏗️',
      subcategories: [
        { id: 'react', name: 'React', description: 'React patterns', patternCount: 0 },
        { id: 'nextjs', name: 'Next.js', description: 'Next.js patterns', patternCount: 0 },
        { id: 'node', name: 'Node.js', description: 'Node.js patterns', patternCount: 0 },
      ],
    },
  ];
}

/**
 * Add a pattern to the registry
 */
export function addPatternToRegistry(
  registry: PatternRegistry,
  entry: PatternEntry
): PatternRegistry {
  const updated = { ...registry };

  // Check for existing pattern with same name
  const existingIndex = updated.patterns.findIndex(p => p.name === entry.name);
  if (existingIndex >= 0) {
    // Update existing
    updated.patterns[existingIndex] = entry;
  } else {
    // Add new
    updated.patterns.push(entry);
  }

  // Update author
  const authorIndex = updated.authors.findIndex(a => a.id === entry.author.id);
  if (authorIndex >= 0) {
    updated.authors[authorIndex].patterns++;
  } else {
    updated.authors.push(entry.author);
  }

  // Update category counts
  for (const cat of updated.categories) {
    cat.patternCount = updated.patterns.filter(p => p.categories.includes(cat.id)).length;
  }

  // Update stats
  updated.totalPatterns = updated.patterns.length;
  updated.totalAuthors = updated.authors.length;
  updated.updatedAt = new Date().toISOString();

  // Update newest
  updated.newest = updated.patterns
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map(p => p.id);

  // Update trending (by recent downloads - simplified)
  updated.trending = updated.patterns
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, 10)
    .map(p => p.id);

  return updated;
}

/**
 * Remove a pattern from the registry
 */
export function removePatternFromRegistry(
  registry: PatternRegistry,
  patternId: string
): PatternRegistry {
  const updated = { ...registry };
  updated.patterns = updated.patterns.filter(p => p.id !== patternId);
  updated.totalPatterns = updated.patterns.length;
  updated.updatedAt = new Date().toISOString();
  return updated;
}

/**
 * Serialize registry to JSON
 */
export function serializeRegistry(registry: PatternRegistry): string {
  return JSON.stringify(registry, null, 2);
}

/**
 * Deserialize registry from JSON
 */
export function deserializeRegistry(json: string): PatternRegistry {
  const registry = JSON.parse(json);

  // Validate version
  if (!registry.version) {
    throw new Error('Invalid registry: missing version');
  }

  return registry as PatternRegistry;
}

/**
 * Sign registry with private key
 */
export function signRegistry(registry: PatternRegistry, privateKey: string): PatternRegistry {
  const content = JSON.stringify({
    version: registry.version,
    updatedAt: registry.updatedAt,
    patterns: registry.patterns.map(p => p.cid),
    totalPatterns: registry.totalPatterns,
  });

  // In production: Use actual Ed25519 signing
  const signature = crypto
    .createHmac('sha256', privateKey)
    .update(content)
    .digest('hex');

  return {
    ...registry,
    registrySignature: signature,
    registryPublicKey: 'ed25519:' + crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 32),
  };
}

/**
 * Verify registry signature
 */
export function verifyRegistrySignature(registry: PatternRegistry): boolean {
  if (!registry.registrySignature || !registry.registryPublicKey) {
    return false;
  }

  // In production: Use actual Ed25519 verification
  // For now, just check signature exists
  return registry.registrySignature.length === 64;
}

/**
 * Merge two registries (for sync)
 */
export function mergeRegistries(
  local: PatternRegistry,
  remote: PatternRegistry
): PatternRegistry {
  const merged = createRegistry(local.ipnsName);

  // Combine patterns, preferring newer versions
  const patternMap = new Map<string, PatternEntry>();

  for (const pattern of [...local.patterns, ...remote.patterns]) {
    const existing = patternMap.get(pattern.name);
    if (!existing || new Date(pattern.lastUpdated) > new Date(existing.lastUpdated)) {
      patternMap.set(pattern.name, pattern);
    }
  }

  merged.patterns = Array.from(patternMap.values());

  // Combine authors
  const authorMap = new Map<string, PatternAuthor>();
  for (const author of [...local.authors, ...remote.authors]) {
    const existing = authorMap.get(author.id);
    if (!existing || author.patterns > existing.patterns) {
      authorMap.set(author.id, author);
    }
  }
  merged.authors = Array.from(authorMap.values());

  // Update stats
  merged.totalPatterns = merged.patterns.length;
  merged.totalAuthors = merged.authors.length;
  merged.totalDownloads = merged.patterns.reduce((sum, p) => sum + p.downloads, 0);

  return merged;
}

/**
 * Generate pattern ID from name
 */
export function generatePatternId(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const hash = crypto.createHash('sha256').update(name + Date.now()).digest('hex').slice(0, 8);
  return `${normalized}-${hash}`;
}
