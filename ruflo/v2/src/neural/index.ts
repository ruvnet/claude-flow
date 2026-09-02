/**
 * Neural Module - Advanced Domain Mapping and GNN Analysis
 * 
 * This module provides Graph Neural Network (GNN) based domain relationship
 * mapping, analysis, and optimization capabilities for Claude Flow.
 * 
 * Key Features:
 * - Domain structure to graph conversion
 * - GNN-based relationship analysis
 * - Domain cohesion scoring
 * - Cross-domain dependency identification
 * - Predictive boundary optimization
 * - Neural network training and inference
 * - Integration with Claude Flow hooks system
 * 
 * @author Claude Flow Neural Team
 * @version 2.0.0
 */

// Core exports
export {
  NeuralDomainMapper,
  type DomainNode,
  type DomainEdge,
  type DomainGraph,
  type CohesionAnalysis,
  type DependencyAnalysis,
  type BoundaryOptimization,
  type GNNLayerConfig,
  type TrainingConfig,
} from './NeuralDomainMapper.js';

// Integration exports
export {
  NeuralDomainMapperIntegration,
  createDomainMapperIntegration,
  type DomainMapperIntegrationConfig,
  type DomainAnalysisResult,
} from './integration.js';

// Re-export commonly used types from the hooks system
export type {
  Pattern,
  TrainingData,
  Prediction,
  Adaptation,
  AgenticHookContext,
  NeuralHookPayload,
} from '../services/agentic-flow-hooks/types.js';

/**
 * Neural module version
 */
export const NEURAL_MODULE_VERSION = '2.0.0';

/**
 * Default configurations for common use cases
 */
export const DEFAULT_CONFIGS = {
  /**
   * Configuration for small-scale domain analysis (< 50 domains)
   */
  SMALL_SCALE: {
    training: {
      learningRate: 0.01,
      batchSize: 16,
      epochs: 50,
      optimizer: 'adam' as const,
      lossFunction: 'mse' as const,
      regularization: {
        l1: 0.0001,
        l2: 0.0001,
        dropout: 0.1,
      },
      earlyStoping: {
        enabled: true,
        patience: 10,
        minDelta: 0.001,
      },
      validationSplit: 0.2,
    },
    integration: {
      enableAutoAnalysis: true,
      enableOptimizationSuggestions: true,
      enableContinuousLearning: true,
      confidenceThreshold: 0.6,
      analysisInterval: 60000, // 1 minute
      maxOptimizationProposals: 5,
    },
  },

  /**
   * Configuration for medium-scale domain analysis (50-200 domains)
   */
  MEDIUM_SCALE: {
    training: {
      learningRate: 0.005,
      batchSize: 32,
      epochs: 100,
      optimizer: 'adam' as const,
      lossFunction: 'mse' as const,
      regularization: {
        l1: 0.0001,
        l2: 0.0001,
        dropout: 0.15,
      },
      earlyStoping: {
        enabled: true,
        patience: 15,
        minDelta: 0.0005,
      },
      validationSplit: 0.2,
    },
    integration: {
      enableAutoAnalysis: true,
      enableOptimizationSuggestions: true,
      enableContinuousLearning: true,
      confidenceThreshold: 0.7,
      analysisInterval: 30000, // 30 seconds
      maxOptimizationProposals: 10,
    },
  },

  /**
   * Configuration for large-scale domain analysis (> 200 domains)
   */
  LARGE_SCALE: {
    training: {
      learningRate: 0.001,
      batchSize: 64,
      epochs: 200,
      optimizer: 'adamw' as const,
      lossFunction: 'mse' as const,
      regularization: {
        l1: 0.0002,
        l2: 0.0002,
        dropout: 0.2,
      },
      earlyStoping: {
        enabled: true,
        patience: 20,
        minDelta: 0.0001,
      },
      validationSplit: 0.15,
    },
    integration: {
      enableAutoAnalysis: true,
      enableOptimizationSuggestions: true,
      enableContinuousLearning: false, // Disable for performance
      confidenceThreshold: 0.8,
      analysisInterval: 120000, // 2 minutes
      maxOptimizationProposals: 20,
    },
  },

  /**
   * Configuration for high-frequency real-time analysis
   */
  REAL_TIME: {
    training: {
      learningRate: 0.01,
      batchSize: 8,
      epochs: 20,
      optimizer: 'sgd' as const,
      lossFunction: 'mse' as const,
      regularization: {
        l1: 0,
        l2: 0,
        dropout: 0.05,
      },
      earlyStoping: {
        enabled: true,
        patience: 5,
        minDelta: 0.01,
      },
      validationSplit: 0.1,
    },
    integration: {
      enableAutoAnalysis: true,
      enableOptimizationSuggestions: false, // Disable for speed
      enableContinuousLearning: true,
      confidenceThreshold: 0.5,
      analysisInterval: 5000, // 5 seconds
      maxOptimizationProposals: 3,
    },
  },
} as const;

/**
 * Utility functions for common operations
 */
export const NeuralUtils = {
  /**
   * Create a simple domain graph from a basic structure
   */
  createSimpleDomainGraph: (
    domains: Array<{ id: string; name: string; type: string }>,
    relationships: Array<{ source: string; target: string; type?: string }>
  ) => {
    const graph: DomainGraph = {
      nodes: new Map(),
      edges: new Map(),
      metadata: {
        created: Date.now(),
        lastTraining: 0,
        version: '1.0.0',
        cohesionScore: 0,
        totalNodes: domains.length,
        totalEdges: relationships.length,
      },
    };

    // Add nodes
    domains.forEach(domain => {
      const node: DomainNode = {
        id: domain.id,
        name: domain.name,
        type: domain.type as DomainNode['type'],
        features: Array.from({ length: 64 }, () => Math.random()),
        metadata: {
          size: 1,
          complexity: 0.5,
          stability: 0.8,
          dependencies: [],
          lastUpdated: Date.now(),
          version: '1.0.0',
        },
        activation: 0,
        embedding: Array.from({ length: 32 }, () => (Math.random() - 0.5) * 0.1),
      };
      graph.nodes.set(domain.id, node);
    });

    // Add edges
    relationships.forEach(rel => {
      const edgeId = `${rel.source}->${rel.target}`;
      const edge: DomainEdge = {
        source: rel.source,
        target: rel.target,
        weight: 1.0,
        type: (rel.type as DomainEdge['type']) || 'dependency',
        features: Array.from({ length: 32 }, () => Math.random()),
        metadata: {
          frequency: 1,
          latency: 100,
          reliability: 0.99,
          bandwidth: 1000,
          direction: 'unidirectional',
        },
      };
      graph.edges.set(edgeId, edge);
    });

    return graph;
  },

  /**
   * Generate synthetic training data for testing
   */
  generateSyntheticTrainingData: (size: number): TrainingData => {
    const inputs = Array.from({ length: size }, () => ({
      features: Array.from({ length: 64 }, () => Math.random()),
    }));

    const outputs = Array.from({ length: size }, () => 
      Array.from({ length: 4 }, () => Math.random())
    );

    return {
      inputs,
      outputs,
      batchSize: Math.min(32, size),
      epochs: Math.max(1, Math.min(50, size / 10)),
    };
  },

  /**
   * Calculate basic domain metrics
   */
  calculateBasicMetrics: (graph: DomainGraph) => {
    const nodeCount = graph.nodes.size;
    const edgeCount = graph.edges.size;
    const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;

    // Calculate in/out degree distributions
    const inDegrees = new Map<string, number>();
    const outDegrees = new Map<string, number>();

    // Initialize degrees
    for (const nodeId of graph.nodes.keys()) {
      inDegrees.set(nodeId, 0);
      outDegrees.set(nodeId, 0);
    }

    // Count degrees
    for (const edge of graph.edges.values()) {
      outDegrees.set(edge.source, (outDegrees.get(edge.source) || 0) + 1);
      inDegrees.set(edge.target, (inDegrees.get(edge.target) || 0) + 1);
    }

    const avgInDegree = Array.from(inDegrees.values()).reduce((sum, deg) => sum + deg, 0) / nodeCount;
    const avgOutDegree = Array.from(outDegrees.values()).reduce((sum, deg) => sum + deg, 0) / nodeCount;

    return {
      nodeCount,
      edgeCount,
      density,
      avgInDegree,
      avgOutDegree,
      complexity: Math.log(nodeCount + 1) * density,
    };
  },

  /**
   * Validate domain graph structure
   */
  validateDomainGraph: (graph: DomainGraph): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty graph
    if (graph.nodes.size === 0) {
      errors.push('Graph has no nodes');
    }

    // Check for orphaned edges
    for (const edge of graph.edges.values()) {
      if (!graph.nodes.has(edge.source)) {
        errors.push(`Edge references non-existent source node: ${edge.source}`);
      }
      if (!graph.nodes.has(edge.target)) {
        errors.push(`Edge references non-existent target node: ${edge.target}`);
      }
    }

    // Check for isolated nodes
    const connectedNodes = new Set<string>();
    for (const edge of graph.edges.values()) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }

    for (const nodeId of graph.nodes.keys()) {
      if (!connectedNodes.has(nodeId)) {
        warnings.push(`Isolated node detected: ${nodeId}`);
      }
    }

    // Check for very sparse or very dense graphs
    const density = NeuralUtils.calculateBasicMetrics(graph).density;
    if (density < 0.1) {
      warnings.push('Graph is very sparse (density < 0.1)');
    } else if (density > 0.8) {
      warnings.push('Graph is very dense (density > 0.8)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },
};

/**
 * Example usage patterns
 */
export const Examples = {
  /**
   * Basic domain analysis example
   */
  basicAnalysis: async () => {
    // Create a simple domain mapper
    const mapper = new NeuralDomainMapper(DEFAULT_CONFIGS.SMALL_SCALE.training);

    // Create a sample domain graph
    const graph = NeuralUtils.createSimpleDomainGraph(
      [
        { id: 'user-service', name: 'User Service', type: 'api' },
        { id: 'auth-service', name: 'Authentication Service', type: 'api' },
        { id: 'user-db', name: 'User Database', type: 'data' },
        { id: 'user-ui', name: 'User Interface', type: 'ui' },
      ],
      [
        { source: 'user-service', target: 'auth-service', type: 'dependency' },
        { source: 'user-service', target: 'user-db', type: 'data-flow' },
        { source: 'user-ui', target: 'user-service', type: 'communication' },
      ]
    );

    // Perform analysis
    const analysis = await mapper.analyzeDomains(graph);
    
    return {
      cohesionScore: analysis.cohesion.overallScore,
      dependencyCount: analysis.dependencies.graph.size,
      optimizationProposals: analysis.optimization.proposals.length,
      recommendations: analysis.recommendations,
    };
  },

  /**
   * Training and prediction example
   */
  trainingExample: async () => {
    const mapper = new NeuralDomainMapper(DEFAULT_CONFIGS.MEDIUM_SCALE.training);

    // Generate synthetic training data
    const trainingData = NeuralUtils.generateSyntheticTrainingData(100);
    const validationData = NeuralUtils.generateSyntheticTrainingData(20);

    // Train the model
    const trainingResult = await mapper.train(trainingData, validationData);

    // Make a prediction
    const prediction = await mapper.predict({
      features: Array.from({ length: 64 }, () => Math.random()),
    });

    return {
      finalAccuracy: trainingResult.finalAccuracy,
      trainingEpochs: trainingResult.trainingHistory.length,
      predictionConfidence: prediction.confidence,
      alternativeCount: prediction.alternatives.length,
    };
  },

  /**
   * Integration with hooks system example
   */
  integrationExample: async () => {
    // Create integrated domain mapper
    const integration = await createDomainMapperIntegration(
      DEFAULT_CONFIGS.MEDIUM_SCALE.integration
    );

    // Set up event listeners
    integration.on('domain-analysis-completed', (result: DomainAnalysisResult) => {
      console.log(`Analysis completed: ${result.cohesion.overallScore} cohesion score`);
    });

    integration.on('optimization-suggestions-generated', (result: any) => {
      console.log(`${result.prioritizedActions.length} optimization suggestions generated`);
    });

    // Get integration statistics
    const stats = integration.getIntegrationStats();

    return {
      initialized: true,
      stats,
    };
  },
};

// Default export for convenience
export default {
  NeuralDomainMapper,
  NeuralDomainMapperIntegration,
  createDomainMapperIntegration,
  DEFAULT_CONFIGS,
  NeuralUtils,
  Examples,
  NEURAL_MODULE_VERSION,
};