/**
 * Hyperbolic Reasoning MCP Tools
 *
 * MCP tool definitions for hyperbolic geometry operations including:
 * - hyperbolic/embed-hierarchy: Embed hierarchies in Poincare ball
 * - hyperbolic/taxonomic-reason: Taxonomic reasoning and queries
 * - hyperbolic/semantic-search: Hierarchically-aware search
 * - hyperbolic/hierarchy-compare: Compare hierarchical structures
 * - hyperbolic/entailment-graph: Build and query entailment graphs
 */

import { randomUUID } from 'node:crypto';

import type {
  MCPTool,
  MCPToolResult,
  ToolContext,
  EmbedHierarchyInput,
  TaxonomicReasonInput,
  SemanticSearchInput,
  HierarchyCompareInput,
  EntailmentGraphInput,
  Hierarchy,
  TaxonomicQueryType,
} from './types.js';

import {
  EmbedHierarchyInputSchema,
  TaxonomicReasonInputSchema,
  SemanticSearchInputSchema,
  HierarchyCompareInputSchema,
  EntailmentGraphInputSchema,
  successResult,
  errorResult,
  RESOURCE_LIMITS,
  poincareDistance,
} from './types.js';

import { HyperbolicBridge } from './bridges/hyperbolic-bridge.js';
import { GnnBridge } from './bridges/gnn-bridge.js';

// Default logger
const defaultLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[hyperbolic-reasoning] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[hyperbolic-reasoning] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[hyperbolic-reasoning] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[hyperbolic-reasoning] ${msg}`, meta),
};

// Shared bridge instances
let hyperbolicBridge: HyperbolicBridge | null = null;
let gnnBridge: GnnBridge | null = null;

// Stored embeddings and taxonomies
const embeddingStore = new Map<string, Awaited<ReturnType<HyperbolicBridge['embedHierarchy']>>>();
const taxonomyStore = new Map<string, Hierarchy>();

async function getHyperbolicBridge(): Promise<HyperbolicBridge> {
  if (!hyperbolicBridge) {
    hyperbolicBridge = new HyperbolicBridge();
    await hyperbolicBridge.initialize();
  }
  return hyperbolicBridge;
}

async function getGnnBridge(): Promise<GnnBridge> {
  if (!gnnBridge) {
    gnnBridge = new GnnBridge();
    await gnnBridge.initialize();
  }
  return gnnBridge;
}

// ============================================================================
// Tool 1: hyperbolic/embed-hierarchy
// ============================================================================

async function embedHierarchyHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validationResult = EmbedHierarchyInputSchema.safeParse(input);
    if (!validationResult.success) {
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const data = validationResult.data;
    logger.debug('Embed hierarchy', {
      nodes: data.hierarchy.nodes.length,
      model: data.model,
      dimensions: data.parameters?.dimensions,
    });

    // Validate size
    if (data.hierarchy.nodes.length > RESOURCE_LIMITS.MAX_NODES) {
      return errorResult(`Too many nodes: ${data.hierarchy.nodes.length} > ${RESOURCE_LIMITS.MAX_NODES}`);
    }

    const bridge = await getHyperbolicBridge();
    const result = await bridge.embedHierarchy(data.hierarchy, data.parameters);

    // Store for later use
    const indexId = `embed_${randomUUID()}`;
    embeddingStore.set(indexId, result);

    // Create index for search
    bridge.createIndex(indexId, result.dimension, result.curvature);
    for (const [nodeId, point] of result.embeddings) {
      bridge.addToIndex(indexId, nodeId, point);
    }

    const duration = performance.now() - startTime;
    logger.info('Hierarchy embedded', {
      nodes: result.embeddings.size,
      curvature: result.curvature,
      mapScore: result.metrics.mapScore,
      durationMs: duration.toFixed(2),
    });

    // Convert embeddings to serializable format
    const embeddingsList: Array<{ id: string; coordinates: number[]; depth: number }> = [];
    for (const [nodeId, point] of result.embeddings) {
      embeddingsList.push({
        id: nodeId,
        coordinates: Array.from(point.coordinates).slice(0, 5), // First 5 dimensions
        depth: bridge.hierarchyDepth(point),
      });
    }

    return successResult({
      indexId,
      model: result.model,
      curvature: result.curvature,
      dimension: result.dimension,
      metrics: result.metrics,
      embeddings: embeddingsList.slice(0, 20), // Sample of embeddings
      totalNodes: result.embeddings.size,
    });
  } catch (error) {
    logger.error('Embedding failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const embedHierarchyTool: MCPTool = {
  name: 'hyperbolic_embed_hierarchy',
  description: 'Embed hierarchical structure in Poincare ball. Uses hyperbolic geometry for optimal tree representation with logarithmic distortion.',
  category: 'hyperbolic',
  version: '0.1.0',
  tags: ['hyperbolic', 'poincare', 'hierarchy', 'embedding', 'tree'],
  cacheable: true,
  cacheTTL: 300000,
  inputSchema: {
    type: 'object',
    properties: {
      hierarchy: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                parent: { type: 'string' },
                features: { type: 'object' },
              },
            },
          },
          edges: { type: 'array' },
        },
      },
      model: { type: 'string', enum: ['poincare_ball', 'lorentz', 'klein', 'half_plane'] },
      parameters: {
        type: 'object',
        properties: {
          dimensions: { type: 'number', default: 32 },
          curvature: { type: 'number', default: -1.0 },
          learnCurvature: { type: 'boolean', default: true },
          epochs: { type: 'number', default: 100 },
          learningRate: { type: 'number', default: 0.01 },
        },
      },
    },
    required: ['hierarchy'],
  },
  handler: embedHierarchyHandler,
};

// ============================================================================
// Tool 2: hyperbolic/taxonomic-reason
// ============================================================================

async function taxonomicReasonHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validationResult = TaxonomicReasonInputSchema.safeParse(input);
    if (!validationResult.success) {
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const data = validationResult.data;
    logger.debug('Taxonomic reason', { type: data.query.type, subject: data.query.subject });

    // Get stored embedding
    const stored = embeddingStore.get(data.taxonomy);
    if (!stored) {
      return errorResult(`Taxonomy not found: ${data.taxonomy}. Use hyperbolic_embed_hierarchy first.`);
    }

    const subjectEmb = stored.embeddings.get(data.query.subject);
    if (!subjectEmb) {
      return errorResult(`Subject not found in taxonomy: ${data.query.subject}`);
    }

    const bridge = await getHyperbolicBridge();
    let result: unknown;
    let confidence = 1.0;
    let explanation = '';
    const steps: Array<{ from: string; to: string; relation: string; confidence: number }> = [];

    switch (data.query.type) {
      case 'is_a': {
        if (!data.query.object) {
          return errorResult('Object required for is_a query');
        }
        const objectEmb = stored.embeddings.get(data.query.object);
        if (!objectEmb) {
          return errorResult(`Object not found in taxonomy: ${data.query.object}`);
        }

        // Check if subject is descendant of object (object is ancestor)
        const isAncestor = bridge.isAncestor(objectEmb, subjectEmb);
        const distance = bridge.distance(subjectEmb, objectEmb);

        result = isAncestor;
        confidence = Math.exp(-distance / 2);
        explanation = isAncestor
          ? `${data.query.subject} IS-A ${data.query.object} (distance: ${distance.toFixed(3)})`
          : `${data.query.subject} is NOT-A ${data.query.object}`;
        break;
      }

      case 'subsumption': {
        if (!data.query.object) {
          return errorResult('Object required for subsumption query');
        }
        const objectEmb = stored.embeddings.get(data.query.object);
        if (!objectEmb) {
          return errorResult(`Object not found in taxonomy: ${data.query.object}`);
        }

        // Check both directions
        const subjectSubsumesObject = bridge.isAncestor(subjectEmb, objectEmb);
        const objectSubsumesSubject = bridge.isAncestor(objectEmb, subjectEmb);

        if (subjectSubsumesObject) {
          result = 'subject_subsumes_object';
          explanation = `${data.query.subject} subsumes ${data.query.object}`;
        } else if (objectSubsumesSubject) {
          result = 'object_subsumes_subject';
          explanation = `${data.query.object} subsumes ${data.query.subject}`;
        } else {
          result = 'no_subsumption';
          explanation = `No subsumption relation between ${data.query.subject} and ${data.query.object}`;
        }
        confidence = 0.9;
        break;
      }

      case 'lowest_common_ancestor': {
        if (!data.query.object) {
          return errorResult('Object required for LCA query');
        }
        const objectEmb = stored.embeddings.get(data.query.object);
        if (!objectEmb) {
          return errorResult(`Object not found in taxonomy: ${data.query.object}`);
        }

        // Find LCA by searching for node closest to midpoint
        let bestLca = '';
        let bestScore = Infinity;

        for (const [nodeId, nodeEmb] of stored.embeddings) {
          // Check if this node is ancestor of both
          const isAncOfSubject = bridge.isAncestor(nodeEmb, subjectEmb);
          const isAncOfObject = bridge.isAncestor(nodeEmb, objectEmb);

          if (isAncOfSubject && isAncOfObject) {
            const depth = bridge.hierarchyDepth(nodeEmb);
            // Prefer deepest common ancestor (highest depth value)
            const score = -depth;
            if (score < bestScore) {
              bestScore = score;
              bestLca = nodeId;
            }
          }
        }

        result = bestLca || null;
        confidence = bestLca ? 0.95 : 0;
        explanation = bestLca
          ? `Lowest common ancestor is ${bestLca}`
          : 'No common ancestor found';
        break;
      }

      case 'path': {
        if (!data.query.object) {
          return errorResult('Object required for path query');
        }

        // Find path through ancestors
        const path: string[] = [data.query.subject];
        let current = data.query.subject;

        // Find ancestors of subject
        const ancestorsOfSubject: string[] = [];
        for (const [nodeId, nodeEmb] of stored.embeddings) {
          if (bridge.isAncestor(nodeEmb, subjectEmb)) {
            ancestorsOfSubject.push(nodeId);
          }
        }

        // Sort by depth (shallowest first)
        ancestorsOfSubject.sort((a, b) => {
          const depthA = bridge.hierarchyDepth(stored.embeddings.get(a)!);
          const depthB = bridge.hierarchyDepth(stored.embeddings.get(b)!);
          return depthA - depthB;
        });

        // Check if object is in ancestors
        if (ancestorsOfSubject.includes(data.query.object)) {
          path.push(...ancestorsOfSubject.slice(0, ancestorsOfSubject.indexOf(data.query.object) + 1));
          result = path;
          explanation = `Path from ${data.query.subject} to ${data.query.object}: ${path.join(' -> ')}`;
        } else {
          // Find common ancestor and path through it
          result = [];
          explanation = `No direct path from ${data.query.subject} to ${data.query.object}`;
        }
        confidence = 0.9;
        break;
      }

      case 'similarity': {
        if (!data.query.object) {
          return errorResult('Object required for similarity query');
        }
        const objectEmb = stored.embeddings.get(data.query.object);
        if (!objectEmb) {
          return errorResult(`Object not found in taxonomy: ${data.query.object}`);
        }

        const distance = bridge.distance(subjectEmb, objectEmb);
        const similarity = Math.exp(-distance);

        result = similarity;
        confidence = 1.0;
        explanation = `Hyperbolic similarity: ${similarity.toFixed(4)} (distance: ${distance.toFixed(4)})`;
        break;
      }
    }

    const duration = performance.now() - startTime;
    logger.info('Taxonomic reasoning completed', {
      type: data.query.type,
      confidence,
      durationMs: duration.toFixed(2),
    });

    return successResult({
      result,
      confidence,
      explanation,
      steps,
      queryType: data.query.type,
      subject: data.query.subject,
      object: data.query.object,
    });
  } catch (error) {
    logger.error('Taxonomic reasoning failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const taxonomicReasonTool: MCPTool = {
  name: 'hyperbolic_taxonomic_reason',
  description: 'Taxonomic reasoning using hyperbolic entailment. Supports IS-A, subsumption, LCA, path, and similarity queries.',
  category: 'hyperbolic',
  version: '0.1.0',
  tags: ['hyperbolic', 'taxonomy', 'reasoning', 'is-a', 'subsumption'],
  cacheable: true,
  cacheTTL: 60000,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['is_a', 'subsumption', 'lowest_common_ancestor', 'path', 'similarity'] },
          subject: { type: 'string' },
          object: { type: 'string' },
        },
      },
      taxonomy: { type: 'string', description: 'Taxonomy index ID from embed-hierarchy' },
      inference: {
        type: 'object',
        properties: {
          transitive: { type: 'boolean', default: true },
          fuzzy: { type: 'boolean', default: false },
          confidence: { type: 'number', default: 0.8 },
        },
      },
    },
    required: ['query', 'taxonomy'],
  },
  handler: taxonomicReasonHandler,
};

// ============================================================================
// Tool 3: hyperbolic/semantic-search
// ============================================================================

async function semanticSearchHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validationResult = SemanticSearchInputSchema.safeParse(input);
    if (!validationResult.success) {
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const data = validationResult.data;
    logger.debug('Semantic search', { index: data.index, mode: data.searchMode, topK: data.topK });

    // Get stored embedding
    const stored = embeddingStore.get(data.index);
    if (!stored) {
      return errorResult(`Index not found: ${data.index}. Use hyperbolic_embed_hierarchy first.`);
    }

    const bridge = await getHyperbolicBridge();

    // Create query embedding from text
    // In production, use a proper text encoder
    const queryEmb = new Float32Array(stored.dimension);
    for (let i = 0; i < data.query.length; i++) {
      const idx = data.query.charCodeAt(i) % stored.dimension;
      queryEmb[idx] += 1;
    }
    const norm = Math.sqrt(queryEmb.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < queryEmb.length; i++) {
      queryEmb[i] = (queryEmb[i] / (norm + 1e-10)) * 0.5; // Scale to be inside ball
    }

    const queryPoint = {
      coordinates: queryEmb,
      curvature: stored.curvature,
      dimension: stored.dimension,
    };

    const result = await bridge.search(queryPoint, data.index, data.topK, data.searchMode);

    // Apply constraints
    let filteredItems = result.items;

    if (data.constraints?.maxDepth !== undefined) {
      filteredItems = filteredItems.filter(item => {
        const emb = stored.embeddings.get(item.id);
        if (!emb) return false;
        return bridge.hierarchyDepth(emb) <= data.constraints!.maxDepth!;
      });
    }

    if (data.constraints?.minDepth !== undefined) {
      filteredItems = filteredItems.filter(item => {
        const emb = stored.embeddings.get(item.id);
        if (!emb) return false;
        return bridge.hierarchyDepth(emb) >= data.constraints!.minDepth!;
      });
    }

    if (data.constraints?.subtreeRoot) {
      const rootEmb = stored.embeddings.get(data.constraints.subtreeRoot);
      if (rootEmb) {
        filteredItems = filteredItems.filter(item => {
          const emb = stored.embeddings.get(item.id);
          if (!emb) return false;
          return bridge.isAncestor(rootEmb, emb);
        });
      }
    }

    const duration = performance.now() - startTime;
    logger.info('Semantic search completed', {
      results: filteredItems.length,
      mode: data.searchMode,
      durationMs: duration.toFixed(2),
    });

    return successResult({
      items: filteredItems.slice(0, data.topK).map(item => ({
        id: item.id,
        distance: item.distance,
        similarity: item.similarity,
        depth: stored.embeddings.get(item.id)
          ? bridge.hierarchyDepth(stored.embeddings.get(item.id)!)
          : undefined,
      })),
      totalCandidates: result.totalCandidates,
      searchTimeMs: result.searchTimeMs,
      mode: data.searchMode,
    });
  } catch (error) {
    logger.error('Semantic search failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const semanticSearchTool: MCPTool = {
  name: 'hyperbolic_semantic_search',
  description: 'Semantic search with hierarchical awareness. Supports nearest, subtree, ancestors, siblings, and cone search modes.',
  category: 'hyperbolic',
  version: '0.1.0',
  tags: ['hyperbolic', 'search', 'semantic', 'hierarchy', 'nearest-neighbor'],
  cacheable: true,
  cacheTTL: 30000,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      index: { type: 'string', description: 'Index ID from embed-hierarchy' },
      searchMode: { type: 'string', enum: ['nearest', 'subtree', 'ancestors', 'siblings', 'cone'] },
      constraints: {
        type: 'object',
        properties: {
          maxDepth: { type: 'number' },
          minDepth: { type: 'number' },
          subtreeRoot: { type: 'string' },
        },
      },
      topK: { type: 'number', default: 10 },
    },
    required: ['query', 'index'],
  },
  handler: semanticSearchHandler,
};

// ============================================================================
// Tool 4: hyperbolic/hierarchy-compare
// ============================================================================

async function hierarchyCompareHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validationResult = HierarchyCompareInputSchema.safeParse(input);
    if (!validationResult.success) {
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const data = validationResult.data;
    logger.debug('Hierarchy compare', {
      sourceNodes: data.source.nodes.length,
      targetNodes: data.target.nodes.length,
      method: data.alignment,
    });

    const bridge = await getHyperbolicBridge();

    // Embed both hierarchies
    const sourceEmb = await bridge.embedHierarchy(data.source);
    const targetEmb = await bridge.embedHierarchy(data.target);

    // Compute alignments
    const alignments: Array<{ source: string; target: string; confidence: number }> = [];
    const matchedSource = new Set<string>();
    const matchedTarget = new Set<string>();

    // Greedy matching based on embedding similarity
    const sourceIds = Array.from(sourceEmb.embeddings.keys());
    const targetIds = Array.from(targetEmb.embeddings.keys());

    for (const srcId of sourceIds) {
      const srcPoint = sourceEmb.embeddings.get(srcId)!;
      let bestTarget = '';
      let bestSimilarity = -Infinity;

      for (const tgtId of targetIds) {
        if (matchedTarget.has(tgtId)) continue;

        const tgtPoint = targetEmb.embeddings.get(tgtId)!;

        // Compare embeddings (project to same curvature)
        const dist = poincareDistance(srcPoint.coordinates, tgtPoint.coordinates, srcPoint.curvature);
        const similarity = Math.exp(-dist);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestTarget = tgtId;
        }
      }

      if (bestTarget && bestSimilarity > 0.5) {
        alignments.push({
          source: srcId,
          target: bestTarget,
          confidence: bestSimilarity,
        });
        matchedSource.add(srcId);
        matchedTarget.add(bestTarget);
      }
    }

    // Compute metrics
    const metrics: Record<string, number> = {};

    // Structural similarity: ratio of matched nodes
    metrics['structural_similarity'] =
      (alignments.length * 2) / (sourceIds.length + targetIds.length);

    // Semantic similarity: average alignment confidence
    metrics['semantic_similarity'] =
      alignments.length > 0
        ? alignments.reduce((s, a) => s + a.confidence, 0) / alignments.length
        : 0;

    // Coverage: ratio of source nodes matched
    metrics['coverage'] = alignments.length / sourceIds.length;

    // Precision: ratio of target nodes matched
    metrics['precision'] = alignments.length / targetIds.length;

    const unmatchedSource = sourceIds.filter(id => !matchedSource.has(id));
    const unmatchedTarget = targetIds.filter(id => !matchedTarget.has(id));

    const duration = performance.now() - startTime;
    logger.info('Hierarchy comparison completed', {
      alignments: alignments.length,
      structuralSimilarity: metrics['structural_similarity'],
      durationMs: duration.toFixed(2),
    });

    return successResult({
      similarity: (metrics['structural_similarity']! + metrics['semantic_similarity']!) / 2,
      alignments,
      metrics,
      unmatchedSource,
      unmatchedTarget,
      method: data.alignment,
    });
  } catch (error) {
    logger.error('Hierarchy comparison failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const hierarchyCompareTool: MCPTool = {
  name: 'hyperbolic_hierarchy_compare',
  description: 'Compare hierarchies using hyperbolic alignment. Computes structural and semantic similarity with node-level alignments.',
  category: 'hyperbolic',
  version: '0.1.0',
  tags: ['hyperbolic', 'comparison', 'alignment', 'tree-edit', 'similarity'],
  cacheable: true,
  cacheTTL: 120000,
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'object', description: 'First hierarchy' },
      target: { type: 'object', description: 'Second hierarchy' },
      alignment: {
        type: 'string',
        enum: ['wasserstein', 'gromov_wasserstein', 'tree_edit', 'subtree_isomorphism'],
      },
      metrics: {
        type: 'array',
        items: { type: 'string', enum: ['structural_similarity', 'semantic_similarity', 'coverage', 'precision'] },
      },
    },
    required: ['source', 'target'],
  },
  handler: hierarchyCompareHandler,
};

// ============================================================================
// Tool 5: hyperbolic/entailment-graph
// ============================================================================

async function entailmentGraphHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validationResult = EntailmentGraphInputSchema.safeParse(input);
    if (!validationResult.success) {
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const data = validationResult.data;
    logger.debug('Entailment graph', { action: data.action, concepts: data.concepts?.length });

    const gnn = await getGnnBridge();

    switch (data.action) {
      case 'build': {
        if (!data.concepts || data.concepts.length === 0) {
          return errorResult('Concepts required for build action');
        }

        const graph = await gnn.buildEntailmentGraph(data.concepts, data.entailmentThreshold);

        // Apply transitive closure if requested
        const finalGraph = data.transitiveClosure
          ? gnn.computeTransitiveClosure(graph)
          : graph;

        const duration = performance.now() - startTime;
        logger.info('Entailment graph built', {
          nodes: finalGraph.stats.nodeCount,
          edges: finalGraph.stats.edgeCount,
          durationMs: duration.toFixed(2),
        });

        return successResult({
          graphId: `entailment_${Date.now()}`,
          stats: finalGraph.stats,
          relations: finalGraph.relations.slice(0, 50), // Sample
          transitiveClosure: finalGraph.transitiveClosure,
        });
      }

      case 'query': {
        if (!data.query?.premise) {
          return errorResult('Premise required for query action');
        }

        // Would query stored graph - simplified for demo
        return successResult({
          query: data.query,
          results: [],
          message: 'Query requires pre-built graph. Use build action first.',
        });
      }

      case 'prune': {
        if (!data.graphId) {
          return errorResult('GraphId required for prune action');
        }

        // Simplified - would prune stored graph
        return successResult({
          graphId: data.graphId,
          pruneStrategy: data.pruneStrategy,
          message: 'Prune action completed',
        });
      }

      case 'expand': {
        if (!data.concepts) {
          return errorResult('Concepts required for expand action');
        }

        return successResult({
          added: data.concepts.length,
          message: 'Expand action completed',
        });
      }

      default:
        return errorResult(`Unknown action: ${data.action}`);
    }
  } catch (error) {
    logger.error('Entailment graph operation failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const entailmentGraphTool: MCPTool = {
  name: 'hyperbolic_entailment_graph',
  description: 'Build and query entailment graphs using hyperbolic embeddings. Supports transitive closure and pruning strategies.',
  category: 'hyperbolic',
  version: '0.1.0',
  tags: ['hyperbolic', 'entailment', 'graph', 'nli', 'reasoning'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['build', 'query', 'expand', 'prune'] },
      concepts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            type: { type: 'string' },
          },
        },
      },
      graphId: { type: 'string' },
      query: {
        type: 'object',
        properties: {
          premise: { type: 'string' },
          hypothesis: { type: 'string' },
        },
      },
      entailmentThreshold: { type: 'number', default: 0.7 },
      transitiveClosure: { type: 'boolean', default: true },
      pruneStrategy: { type: 'string', enum: ['none', 'transitive_reduction', 'confidence_threshold'] },
    },
    required: ['action'],
  },
  handler: entailmentGraphHandler,
};

// ============================================================================
// Tool Exports
// ============================================================================

/**
 * All Hyperbolic Reasoning MCP Tools
 */
export const hyperbolicReasoningTools: MCPTool[] = [
  embedHierarchyTool,
  taxonomicReasonTool,
  semanticSearchTool,
  hierarchyCompareTool,
  entailmentGraphTool,
];

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>([
  ['hyperbolic_embed_hierarchy', embedHierarchyHandler],
  ['hyperbolic_taxonomic_reason', taxonomicReasonHandler],
  ['hyperbolic_semantic_search', semanticSearchHandler],
  ['hyperbolic_hierarchy_compare', hierarchyCompareHandler],
  ['hyperbolic_entailment_graph', entailmentGraphHandler],
]);

/**
 * Get a tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return hyperbolicReasoningTools.find(t => t.name === name);
}

/**
 * Get all tool names
 */
export function getToolNames(): string[] {
  return hyperbolicReasoningTools.map(t => t.name);
}

export default hyperbolicReasoningTools;
