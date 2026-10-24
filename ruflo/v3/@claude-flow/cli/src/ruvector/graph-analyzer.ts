/**
 * Graph Analyzer Module
 *
 * Provides code dependency graph analysis using ruvector's graph algorithms:
 * - MinCut for code boundary detection (refactoring suggestions)
 * - Louvain for module/community detection
 * - Circular dependency detection
 * - DOT format export for visualization
 *
 * Falls back to built-in implementations when @ruvector/wasm is not available.
 *
 * @module @claude-flow/cli/ruvector/graph-analyzer
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, extname, dirname, basename } from 'path';

// ============================================================================
// Caching for Performance
// ============================================================================

/**
 * Cache for dependency graphs (5 minute TTL)
 */
const graphCache = new Map<string, { graph: DependencyGraph; timestamp: number }>();
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cache for analysis results (2 minute TTL)
 */
const analysisResultCache = new Map<string, { result: GraphAnalysisResult; timestamp: number }>();
const ANALYSIS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Clear all graph caches
 */
export function clearGraphCaches(): void {
  graphCache.clear();
  analysisResultCache.clear();
}

/**
 * Get cache statistics
 */
export function getGraphCacheStats(): { graphCacheSize: number; analysisCacheSize: number } {
  return {
    graphCacheSize: graphCache.size,
    analysisCacheSize: analysisResultCache.size,
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Node in the dependency graph
 */
export interface GraphNode {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'module' | 'package';
  imports: string[];
  exports: string[];
  size: number;
  complexity?: number;
}

/**
 * Edge in the dependency graph
 */
export interface GraphEdge {
  source: string;
  target: string;
  type: 'import' | 'require' | 'dynamic' | 're-export';
  weight: number;
}

/**
 * Dependency graph representation
 */
export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  metadata: {
    rootDir: string;
    totalFiles: number;
    totalEdges: number;
    buildTime: number;
  };
}

/**
 * MinCut result representing a natural boundary in the codebase
 */
export interface MinCutBoundary {
  cutValue: number;
  partition1: string[];
  partition2: string[];
  cutEdges: GraphEdge[];
  suggestion: string;
}

/**
 * Community/module detection result
 */
export interface ModuleCommunity {
  id: number;
  members: string[];
  cohesion: number;
  centralNode?: string;
  suggestedName?: string;
}

/**
 * Circular dependency info
 */
export interface CircularDependency {
  cycle: string[];
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

/**
 * Analysis result
 */
export interface GraphAnalysisResult {
  graph: DependencyGraph;
  boundaries?: MinCutBoundary[];
  communities?: ModuleCommunity[];
  circularDependencies: CircularDependency[];
  statistics: {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    maxDegree: number;
    density: number;
    componentCount: number;
  };
}

// ============================================================================
// RuVector Integration (with graceful fallback)
// ============================================================================

/**
 * Interface for ruvector graph operations
 */
interface IRuVectorGraph {
  mincut(nodes: string[], edges: Array<[string, string, number]>): {
    cutValue: number;
    partition1: string[];
    partition2: string[];
    cutEdges: Array<[string, string]>;
  };
  louvain(nodes: string[], edges: Array<[string, string, number]>): {
    communities: Array<{ id: number; members: string[] }>;
    modularity: number;
  };
}

let ruVectorGraph: IRuVectorGraph | null = null;
let ruVectorLoadAttempted = false;

/**
 * Attempt to load ruvector graph algorithms
 */
async function loadRuVector(): Promise<IRuVectorGraph | null> {
  if (ruVectorLoadAttempted) return ruVectorGraph;
  ruVectorLoadAttempted = true;

  // Use dynamic module names to bypass TypeScript static analysis
  // These modules are optional and may not be installed
  const ruvectorModule = 'ruvector';
  const wasmModule = '@ruvector/wasm';

  try {
    // Try to load ruvector's graph module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ruvector: any = await import(/* webpackIgnore: true */ ruvectorModule).catch(() => null);

    if (ruvector && typeof ruvector.hooks_graph_mincut === 'function' && typeof ruvector.hooks_graph_cluster === 'function') {
      ruVectorGraph = {
        mincut: (nodes, edges) => ruvector.hooks_graph_mincut(nodes, edges),
        louvain: (nodes, edges) => ruvector.hooks_graph_cluster(nodes, edges),
      };
      return ruVectorGraph;
    }
  } catch {
    // Try alternative import paths
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wasm: any = await import(/* webpackIgnore: true */ wasmModule).catch(() => null);
      if (wasm && wasm.GraphAnalyzer) {
        const analyzer = new wasm.GraphAnalyzer();
        ruVectorGraph = {
          mincut: (nodes, edges) => analyzer.mincut(nodes, edges),
          louvain: (nodes, edges) => analyzer.louvain(nodes, edges),
        };
        return ruVectorGraph;
      }
    } catch {
      // Fallback will be used
    }
  }

  return null;
}

// ============================================================================
// Import/Require Parser
// ============================================================================

/**
 * Extract imports from TypeScript/JavaScript file
 */
function extractImports(content: string, _filePath: string): Array<{ path: string; type: GraphEdge['type'] }> {
  const imports: Array<{ path: string; type: GraphEdge['type'] }> = [];

  // ES6 import statements
  const esImportRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = esImportRegex.exec(content)) !== null) {
    imports.push({ path: match[1], type: 'import' });
  }

  // Side-effect imports: import 'module'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.push({ path: match[1], type: 'import' });
  }

  // CommonJS require
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({ path: match[1], type: 'require' });
  }

  // Dynamic imports
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({ path: match[1], type: 'dynamic' });
  }

  // Re-exports: export * from 'module'
  const reExportRegex = /export\s+(?:\*|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    imports.push({ path: match[1], type: 're-export' });
  }

  return imports;
}

/**
 * Extract exports from TypeScript/JavaScript file
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];

  // Named exports
  const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Export list: export { a, b, c }
  const exportListRegex = /export\s+\{([^}]+)\}/g;
  while ((match = exportListRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
    exports.push(...names.filter(n => n));
  }

  // Default export
  if (/export\s+default/.test(content)) {
    exports.push('default');
  }

  return exports;
}

/**
 * Resolve import path to absolute file path
 */
function resolveImportPath(importPath: string, fromFile: string, rootDir: string): string | null {
  // Skip external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const fromDir = dirname(fromFile);
  let resolved: string;

  if (importPath.startsWith('/')) {
    resolved = join(rootDir, importPath);
  } else {
    resolved = join(fromDir, importPath);
  }

  // Handle extension-less imports
  const ext = extname(resolved);
  if (!ext) {
    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    for (const tryExt of extensions) {
      const tryPath = resolved + tryExt;
      return tryPath; // Return normalized, existence check done later
    }
    // Could be index file
    return join(resolved, 'index');
  }

  return resolved;
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * Build dependency graph from source directory (with caching)
 */
export async function buildDependencyGraph(
  rootDir: string,
  options: {
    include?: string[];
    exclude?: string[];
    maxDepth?: number;
    skipCache?: boolean;
  } = {}
): Promise<DependencyGraph> {
  // Check cache first
  const cacheKey = `${rootDir}:${JSON.stringify(options)}`;
  if (!options.skipCache) {
    const cached = graphCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
      return cached.graph;
    }
  }

  const startTime = Date.now();
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const include = options.include || ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  const exclude = options.exclude || ['node_modules', 'dist', 'build', '.git', '__tests__', '*.test.*', '*.spec.*'];
  const maxDepth = options.maxDepth ?? 10;

  /**
   * Check if path should be excluded
   */
  function shouldExclude(path: string): boolean {
    const name = basename(path);
    return exclude.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(name);
      }
      return name === pattern || path.includes(`/${pattern}/`);
    });
  }

  /**
   * Recursively scan directory for source files
   */
  async function scanDir(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(rootDir, fullPath);

        if (shouldExclude(fullPath)) continue;

        if (entry.isDirectory()) {
          await scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (include.includes(ext)) {
            await processFile(fullPath, relPath);
          }
        }
      }
    } catch {
      // Directory not readable, skip
    }
  }

  /**
   * Process a single source file
   */
  async function processFile(fullPath: string, relPath: string): Promise<void> {
    try {
      const content = await readFile(fullPath, 'utf-8');
      const fileStats = await stat(fullPath);

      const imports = extractImports(content, fullPath);
      const exportsList = extractExports(content);

      // Create node
      const node: GraphNode = {
        id: relPath,
        path: relPath,
        name: basename(relPath, extname(relPath)),
        type: 'file',
        imports: imports.map(i => i.path),
        exports: exportsList,
        size: fileStats.size,
        complexity: estimateComplexity(content),
      };

      nodes.set(relPath, node);

      // Create edges for imports
      for (const imp of imports) {
        const resolved = resolveImportPath(imp.path, fullPath, rootDir);
        if (resolved) {
          const targetRel = relative(rootDir, resolved);
          edges.push({
            source: relPath,
            target: targetRel,
            type: imp.type,
            weight: imp.type === 're-export' ? 2 : 1,
          });
        }
      }
    } catch {
      // File not readable, skip
    }
  }

  // Build the graph
  await scanDir(rootDir, 0);

  // Normalize edges - ensure targets exist (with extension variations)
  const normalizedEdges: GraphEdge[] = [];
  for (const edge of edges) {
    // Try to find matching node
    let targetKey = edge.target;
    if (!nodes.has(targetKey)) {
      // Try with different extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
      const baseTarget = targetKey.replace(/\.[^.]+$/, '');
      for (const ext of extensions) {
        if (nodes.has(baseTarget + ext)) {
          targetKey = baseTarget + ext;
          break;
        }
        // Try index files
        if (nodes.has(join(baseTarget, 'index' + ext))) {
          targetKey = join(baseTarget, 'index' + ext);
          break;
        }
      }
    }

    if (nodes.has(targetKey)) {
      normalizedEdges.push({ ...edge, target: targetKey });
    }
  }

  const graph: DependencyGraph = {
    nodes,
    edges: normalizedEdges,
    metadata: {
      rootDir,
      totalFiles: nodes.size,
      totalEdges: normalizedEdges.length,
      buildTime: Date.now() - startTime,
    },
  };

  // Cache the result
  graphCache.set(cacheKey, { graph, timestamp: Date.now() });

  return graph;
}

/**
 * Estimate cyclomatic complexity from code
 */
function estimateComplexity(content: string): number {
  let complexity = 1;

  // Count branching statements
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]+:/g, // Ternary operator
    /&&/g,
    /\|\|/g,
  ];

  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) complexity += matches.length;
  }

  return complexity;
}

// ============================================================================
// MinCut Algorithm (Fallback Implementation)
// ============================================================================

/**
 * Stoer-Wagner MinCut algorithm (fallback when ruvector not available)
 * Finds minimum cut with deterministic result
 */
function fallbackMinCut(
  nodes: string[],
  edges: Array<[string, string, number]>
): {
  cutValue: number;
  partition1: string[];
  partition2: string[];
  cutEdges: Array<[string, string]>;
} {
  if (nodes.length < 2) {
    return {
      cutValue: 0,
      partition1: nodes,
      partition2: [],
      cutEdges: [],
    };
  }

  // Build adjacency map with weights
  const adj = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    adj.set(node, new Map());
  }
  for (const [u, v, w] of edges) {
    if (adj.has(u) && adj.has(v)) {
      adj.get(u)!.set(v, (adj.get(u)!.get(v) || 0) + w);
      adj.get(v)!.set(u, (adj.get(v)!.get(u) || 0) + w);
    }
  }

  let bestCut = Infinity;
  let bestPartition1: string[] = [];
  let bestPartition2: string[] = [];
  let bestCutEdges: Array<[string, string]> = [];

  // Run multiple iterations for better results
  const iterations = Math.min(nodes.length * 2, 20);

  for (let iter = 0; iter < iterations; iter++) {
    // Start from different nodes
    const startNode = nodes[iter % nodes.length];
    const inSet = new Set<string>([startNode]);
    const remaining = new Set(nodes.filter(n => n !== startNode));

    while (remaining.size > 1) {
      // Find node with maximum connectivity to current set
      let maxNode = '';
      let maxConn = -1;

      for (const node of Array.from(remaining)) {
        let conn = 0;
        for (const inNode of Array.from(inSet)) {
          conn += adj.get(node)?.get(inNode) || 0;
        }
        if (conn > maxConn) {
          maxConn = conn;
          maxNode = node;
        }
      }

      if (!maxNode) break;

      remaining.delete(maxNode);
      inSet.add(maxNode);
    }

    if (remaining.size === 1) {
      const lastNode = Array.from(remaining)[0];
      let cutValue = 0;
      const cutEdges: Array<[string, string]> = [];

      for (const inNode of Array.from(inSet)) {
        const weight = adj.get(lastNode)?.get(inNode) || 0;
        if (weight > 0) {
          cutValue += weight;
          cutEdges.push([lastNode, inNode]);
        }
      }

      if (cutValue < bestCut) {
        bestCut = cutValue;
        bestPartition1 = Array.from(inSet);
        bestPartition2 = [lastNode];
        bestCutEdges = cutEdges;
      }
    }
  }

  // If we didn't find a good cut, split roughly in half
  if (bestCut === Infinity) {
    const mid = Math.floor(nodes.length / 2);
    bestPartition1 = nodes.slice(0, mid);
    bestPartition2 = nodes.slice(mid);
    bestCut = 0;
    bestCutEdges = [];

    for (const [u, v, w] of edges) {
      const uIn1 = bestPartition1.includes(u);
      const vIn1 = bestPartition1.includes(v);
      if (uIn1 !== vIn1) {
        bestCut += w;
        bestCutEdges.push([u, v]);
      }
    }
  }

  return {
    cutValue: bestCut,
    partition1: bestPartition1,
    partition2: bestPartition2,
    cutEdges: bestCutEdges,
  };
}

// ============================================================================
// Louvain Algorithm (Fallback Implementation)
// ============================================================================

/**
 * Louvain community detection algorithm (fallback when ruvector not available)
 * Greedy modularity optimization
 */
function fallbackLouvain(
  nodes: string[],
  edges: Array<[string, string, number]>
): {
  communities: Array<{ id: number; members: string[] }>;
  modularity: number;
} {
  if (nodes.length === 0) {
    return { communities: [], modularity: 0 };
  }

  // Build adjacency map
  const adj = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    adj.set(node, new Map());
  }
  let totalWeight = 0;
  for (const [u, v, w] of edges) {
    if (adj.has(u) && adj.has(v)) {
      adj.get(u)!.set(v, (adj.get(u)!.get(v) || 0) + w);
      adj.get(v)!.set(u, (adj.get(v)!.get(u) || 0) + w);
      totalWeight += w * 2;
    }
  }

  if (totalWeight === 0) {
    // No edges, each node is its own community
    return {
      communities: nodes.map((n, i) => ({ id: i, members: [n] })),
      modularity: 0,
    };
  }

  // Initialize: each node in its own community
  const community = new Map<string, number>();
  let nextCommunityId = 0;
  for (const node of nodes) {
    community.set(node, nextCommunityId++);
  }

  // Calculate node degree
  const degree = new Map<string, number>();
  for (const node of nodes) {
    let d = 0;
    for (const [, w] of Array.from(adj.get(node)!.entries())) {
      d += w;
    }
    degree.set(node, d);
  }

  // Louvain phase 1: local moving
  let improved = true;
  const maxIterations = 10;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (const node of nodes) {
      const currentCommunity = community.get(node)!;
      const nodeAdj = adj.get(node)!;
      const nodeDegree = degree.get(node)!;

      // Calculate modularity gain for moving to each neighbor's community
      const communityWeights = new Map<number, number>();

      for (const [neighbor, weight] of Array.from(nodeAdj.entries())) {
        const neighborCommunity = community.get(neighbor)!;
        communityWeights.set(
          neighborCommunity,
          (communityWeights.get(neighborCommunity) || 0) + weight
        );
      }

      // Calculate community totals
      const communityTotal = new Map<number, number>();
      for (const [n, c] of Array.from(community.entries())) {
        communityTotal.set(c, (communityTotal.get(c) || 0) + (degree.get(n) || 0));
      }

      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const [targetCommunity, edgeWeight] of Array.from(communityWeights.entries())) {
        if (targetCommunity === currentCommunity) continue;

        // Calculate modularity gain
        const currentTotal = communityTotal.get(currentCommunity) || 0;
        const targetTotal = communityTotal.get(targetCommunity) || 0;
        const currentEdges = communityWeights.get(currentCommunity) || 0;

        const gain =
          (edgeWeight - currentEdges) / totalWeight -
          (nodeDegree * (targetTotal - currentTotal + nodeDegree)) / (totalWeight * totalWeight);

        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }

      if (bestCommunity !== currentCommunity) {
        community.set(node, bestCommunity);
        improved = true;
      }
    }
  }

  // Collect communities
  const communityMembers = new Map<number, string[]>();
  for (const [node, comm] of Array.from(community.entries())) {
    if (!communityMembers.has(comm)) {
      communityMembers.set(comm, []);
    }
    communityMembers.get(comm)!.push(node);
  }

  // Renumber communities
  const communities: Array<{ id: number; members: string[] }> = [];
  let id = 0;
  for (const members of Array.from(communityMembers.values())) {
    communities.push({ id: id++, members });
  }

  // Calculate modularity
  let modularity = 0;
  for (const [u, v, w] of edges) {
    const cu = community.get(u)!;
    const cv = community.get(v)!;
    if (cu === cv) {
      const du = degree.get(u)!;
      const dv = degree.get(v)!;
      modularity += w - (du * dv) / totalWeight;
    }
  }
  modularity /= totalWeight;

  return { communities, modularity };
}

// ============================================================================
// Circular Dependency Detection
// ============================================================================

/**
 * Detect circular dependencies using DFS
 */
export function detectCircularDependencies(graph: DependencyGraph): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  // Build adjacency list
  const adjList = new Map<string, string[]>();
  for (const node of Array.from(graph.nodes.keys())) {
    adjList.set(node, []);
  }
  for (const edge of graph.edges) {
    const list = adjList.get(edge.source);
    if (list) {
      list.push(edge.target);
    }
  }

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = adjList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycle.push(neighbor); // Complete the cycle

        const severity = getCycleSeverity(cycle, graph);
        cycles.push({
          cycle,
          severity,
          suggestion: getCycleSuggestion(cycle, graph),
        });
      }
    }

    recursionStack.delete(node);
    path.pop();
  }

  for (const node of Array.from(graph.nodes.keys())) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

function getCycleSeverity(cycle: string[], _graph: DependencyGraph): 'low' | 'medium' | 'high' {
  // High severity if cycle involves many files or core modules
  if (cycle.length > 5) return 'high';
  if (cycle.some(n => n.includes('index') || n.includes('core'))) return 'high';
  if (cycle.length > 3) return 'medium';
  return 'low';
}

function getCycleSuggestion(cycle: string[], graph: DependencyGraph): string {
  if (cycle.length === 2) {
    return `Consider extracting shared code into a separate module to break the cycle between ${cycle[0]} and ${cycle[1]}`;
  }

  // Find the weakest link (least important edge)
  let weakestEdge = '';
  let minImports = Infinity;

  for (let i = 0; i < cycle.length - 1; i++) {
    const from = cycle[i];
    const to = cycle[i + 1];
    const fromNode = graph.nodes.get(from);
    if (fromNode && fromNode.imports.length < minImports) {
      minImports = fromNode.imports.length;
      weakestEdge = `${from} -> ${to}`;
    }
  }

  return `Break the cycle by refactoring the dependency: ${weakestEdge}. Consider dependency injection or extracting interfaces.`;
}

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Analyze graph boundaries using MinCut algorithm
 */
export async function analyzeMinCutBoundaries(
  graph: DependencyGraph,
  numPartitions: number = 2
): Promise<MinCutBoundary[]> {
  const nodes = Array.from(graph.nodes.keys());
  const edges: Array<[string, string, number]> = graph.edges.map(e => [e.source, e.target, e.weight]);

  const boundaries: MinCutBoundary[] = [];

  // Try to use ruvector, fallback to built-in
  const ruVector = await loadRuVector();

  // Get initial partition
  let result: ReturnType<typeof fallbackMinCut>;
  if (ruVector) {
    result = ruVector.mincut(nodes, edges);
  } else {
    result = fallbackMinCut(nodes, edges);
  }

  boundaries.push({
    cutValue: result.cutValue,
    partition1: result.partition1,
    partition2: result.partition2,
    cutEdges: result.cutEdges.map(([s, t]) => {
      const edge = graph.edges.find(e => e.source === s && e.target === t);
      return edge || { source: s, target: t, type: 'import' as const, weight: 1 };
    }),
    suggestion: generateBoundarySuggestion(result.partition1, result.partition2, graph),
  });

  // Recursively partition if needed
  if (numPartitions > 2 && result.partition1.length > 2) {
    const subEdges: Array<[string, string, number]> = edges.filter(
      ([u, v]) => result.partition1.includes(u) && result.partition1.includes(v)
    );
    const subResult = ruVector
      ? ruVector.mincut(result.partition1, subEdges)
      : fallbackMinCut(result.partition1, subEdges);

    if (subResult.cutValue > 0) {
      boundaries.push({
        cutValue: subResult.cutValue,
        partition1: subResult.partition1,
        partition2: subResult.partition2,
        cutEdges: subResult.cutEdges.map(([s, t]) => {
          const edge = graph.edges.find(e => e.source === s && e.target === t);
          return edge || { source: s, target: t, type: 'import' as const, weight: 1 };
        }),
        suggestion: generateBoundarySuggestion(subResult.partition1, subResult.partition2, graph),
      });
    }
  }

  return boundaries;
}

function generateBoundarySuggestion(partition1: string[], partition2: string[], _graph: DependencyGraph): string {
  // Analyze the partitions to suggest organization
  const p1Dirs = partition1.map(p => dirname(p)).filter(d => d !== '.');
  const p2Dirs = partition2.map(p => dirname(p)).filter(d => d !== '.');
  const p1DirsSet = new Set(p1Dirs);
  const p2DirsSet = new Set(p2Dirs);

  if (p1DirsSet.size === 1 && p2DirsSet.size === 1) {
    const dir1 = p1Dirs[0];
    const dir2 = p2Dirs[0];
    return `Natural boundary detected between ${dir1}/ and ${dir2}/. These could be separate packages.`;
  }

  if (partition1.length > partition2.length * 3) {
    return `Consider extracting ${partition2.length} files into a separate module. They have minimal coupling to the rest.`;
  }

  return `Found ${partition1.length} and ${partition2.length} file groups with minimal coupling. Consider organizing into separate modules.`;
}

/**
 * Analyze module communities using Louvain algorithm
 */
export async function analyzeModuleCommunities(graph: DependencyGraph): Promise<ModuleCommunity[]> {
  const nodes = Array.from(graph.nodes.keys());
  const edges: Array<[string, string, number]> = graph.edges.map(e => [e.source, e.target, e.weight]);

  // Try to use ruvector, fallback to built-in
  const ruVector = await loadRuVector();
  const result = ruVector ? ruVector.louvain(nodes, edges) : fallbackLouvain(nodes, edges);

  return result.communities.map(comm => {
    // Find the most connected node as central
    let maxConnections = 0;
    let centralNode = comm.members[0];

    for (const member of comm.members) {
      const connections = graph.edges.filter(
        e =>
          (e.source === member && comm.members.includes(e.target)) ||
          (e.target === member && comm.members.includes(e.source))
      ).length;

      if (connections > maxConnections) {
        maxConnections = connections;
        centralNode = member;
      }
    }

    // Calculate cohesion (internal edges / total possible edges)
    const internalEdges = graph.edges.filter(
      e => comm.members.includes(e.source) && comm.members.includes(e.target)
    ).length;
    const possibleEdges = (comm.members.length * (comm.members.length - 1)) / 2;
    const cohesion = possibleEdges > 0 ? internalEdges / possibleEdges : 1;

    // Suggest name based on common directory
    const dirs = comm.members.map(m => dirname(m));
    const commonDir = findCommonPrefix(dirs);
    const suggestedName = commonDir || basename(centralNode, extname(centralNode));

    return {
      id: comm.id,
      members: comm.members,
      cohesion,
      centralNode,
      suggestedName,
    };
  });
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  const sorted = [...strings].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let i = 0;
  while (i < first.length && first[i] === last[i]) {
    i++;
  }

  const prefix = first.slice(0, i);
  // Return the last complete directory segment
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash > 0 ? prefix.slice(0, lastSlash) : '';
}

/**
 * Full graph analysis (with caching)
 */
export async function analyzeGraph(
  rootDir: string,
  options: {
    includeBoundaries?: boolean;
    includeModules?: boolean;
    numPartitions?: number;
    skipCache?: boolean;
  } = {}
): Promise<GraphAnalysisResult> {
  // Check cache first
  const cacheKey = `analysis:${rootDir}:${JSON.stringify(options)}`;
  if (!options.skipCache) {
    const cached = analysisResultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const graph = await buildDependencyGraph(rootDir, { skipCache: options.skipCache });

  // Calculate statistics
  const nodeCount = graph.nodes.size;
  const edgeCount = graph.edges.length;

  const degrees = new Map<string, number>();
  for (const node of Array.from(graph.nodes.keys())) {
    degrees.set(node, 0);
  }
  for (const edge of graph.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  }

  const degreeValues = Array.from(degrees.values());
  const avgDegree = degreeValues.length > 0 ? degreeValues.reduce((a, b) => a + b, 0) / degreeValues.length : 0;
  const maxDegree = degreeValues.length > 0 ? Math.max(...degreeValues) : 0;
  const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;

  // Count connected components
  const visited = new Set<string>();
  let componentCount = 0;

  function dfs(node: string): void {
    visited.add(node);
    for (const edge of graph.edges) {
      if (edge.source === node && !visited.has(edge.target)) {
        dfs(edge.target);
      }
      if (edge.target === node && !visited.has(edge.source)) {
        dfs(edge.source);
      }
    }
  }

  for (const node of Array.from(graph.nodes.keys())) {
    if (!visited.has(node)) {
      componentCount++;
      dfs(node);
    }
  }

  // Detect circular dependencies
  const circularDependencies = detectCircularDependencies(graph);

  // Analyze boundaries and communities if requested
  let boundaries: MinCutBoundary[] | undefined;
  let communities: ModuleCommunity[] | undefined;

  if (options.includeBoundaries !== false) {
    boundaries = await analyzeMinCutBoundaries(graph, options.numPartitions);
  }

  if (options.includeModules !== false) {
    communities = await analyzeModuleCommunities(graph);
  }

  const result: GraphAnalysisResult = {
    graph,
    boundaries,
    communities,
    circularDependencies,
    statistics: {
      nodeCount,
      edgeCount,
      avgDegree,
      maxDegree,
      density,
      componentCount,
    },
  };

  // Cache the result
  analysisResultCache.set(cacheKey, { result, timestamp: Date.now() });

  return result;
}

// ============================================================================
// DOT Format Export
// ============================================================================

/**
 * Export graph to DOT format for visualization
 */
export function exportToDot(
  result: GraphAnalysisResult,
  options: {
    includeLabels?: boolean;
    colorByCommunity?: boolean;
    highlightCycles?: boolean;
  } = {}
): string {
  const { graph, communities, circularDependencies } = result;
  const lines: string[] = ['digraph DependencyGraph {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded];');
  lines.push('');

  // Generate colors for communities
  const communityColors = new Map<string, string>();
  if (options.colorByCommunity && communities) {
    const colors = [
      '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
      '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    ];
    for (const comm of communities) {
      const color = colors[comm.id % colors.length];
      for (const member of comm.members) {
        communityColors.set(member, color);
      }
    }
  }

  // Find nodes in cycles
  const nodesInCycles = new Set<string>();
  if (options.highlightCycles && circularDependencies) {
    for (const cycle of circularDependencies) {
      for (const node of cycle.cycle) {
        nodesInCycles.add(node);
      }
    }
  }

  // Output nodes
  lines.push('  // Nodes');
  for (const [id, node] of Array.from(graph.nodes.entries())) {
    const attrs: string[] = [];

    if (options.includeLabels !== false) {
      attrs.push(`label="${node.name}"`);
    }

    if (communityColors.has(id)) {
      attrs.push(`fillcolor="${communityColors.get(id)}"`, 'style="filled,rounded"');
    }

    if (nodesInCycles.has(id)) {
      attrs.push('color=red', 'penwidth=2');
    }

    const attrStr = attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
    lines.push(`  "${id}"${attrStr};`);
  }

  lines.push('');

  // Output edges
  lines.push('  // Edges');
  for (const edge of graph.edges) {
    const attrs: string[] = [];

    if (edge.type === 'dynamic') {
      attrs.push('style=dashed');
    } else if (edge.type === 're-export') {
      attrs.push('style=bold');
    }

    // Check if edge is part of a cycle
    if (options.highlightCycles) {
      const isCycleEdge = circularDependencies.some(cd => {
        for (let i = 0; i < cd.cycle.length - 1; i++) {
          if (cd.cycle[i] === edge.source && cd.cycle[i + 1] === edge.target) {
            return true;
          }
        }
        return false;
      });

      if (isCycleEdge) {
        attrs.push('color=red', 'penwidth=2');
      }
    }

    const attrStr = attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
    lines.push(`  "${edge.source}" -> "${edge.target}"${attrStr};`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ============================================================================
// Exports
// ============================================================================

export {
  loadRuVector,
  fallbackMinCut,
  fallbackLouvain,
};
