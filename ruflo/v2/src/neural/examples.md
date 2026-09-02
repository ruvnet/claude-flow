# Neural Domain Mapper Examples

This document provides comprehensive examples of how to use the NeuralDomainMapper class for GNN-style domain relationship mapping.

## Quick Start

```typescript
import { 
  NeuralDomainMapper, 
  NeuralUtils, 
  DEFAULT_CONFIGS,
  createDomainMapperIntegration 
} from './neural';

// Create a basic domain mapper
const mapper = new NeuralDomainMapper(DEFAULT_CONFIGS.SMALL_SCALE.training);
```

## Example 1: Basic Domain Analysis

```typescript
import { NeuralDomainMapper, NeuralUtils } from './neural';

async function basicDomainAnalysis() {
  // Initialize the mapper
  const mapper = new NeuralDomainMapper();

  // Define domains
  const domains = [
    { id: 'user-service', name: 'User Management Service', type: 'api' },
    { id: 'auth-service', name: 'Authentication Service', type: 'api' },
    { id: 'notification-service', name: 'Notification Service', type: 'api' },
    { id: 'user-db', name: 'User Database', type: 'data' },
    { id: 'cache-layer', name: 'Redis Cache', type: 'data' },
    { id: 'admin-ui', name: 'Admin Dashboard', type: 'ui' },
    { id: 'mobile-app', name: 'Mobile Application', type: 'ui' }
  ];

  // Define relationships
  const relationships = [
    { source: 'user-service', target: 'auth-service', type: 'dependency' },
    { source: 'user-service', target: 'user-db', type: 'data-flow' },
    { source: 'user-service', target: 'cache-layer', type: 'data-flow' },
    { source: 'notification-service', target: 'user-service', type: 'communication' },
    { source: 'admin-ui', target: 'user-service', type: 'communication' },
    { source: 'mobile-app', target: 'user-service', type: 'communication' },
    { source: 'mobile-app', target: 'notification-service', type: 'communication' }
  ];

  // Create domain graph
  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);

  // Perform comprehensive analysis
  const analysis = await mapper.analyzeDomains(graph);

  console.log('=== Domain Analysis Results ===');
  console.log(`Overall Cohesion Score: ${analysis.cohesion.overallScore.toFixed(3)}`);
  console.log(`Circular Dependencies: ${analysis.dependencies.circularDependencies.length}`);
  console.log(`Optimization Proposals: ${analysis.optimization.proposals.length}`);
  console.log(`Recommendations:`);
  analysis.recommendations.forEach(rec => console.log(`  - ${rec}`));

  return analysis;
}
```

## Example 2: Domain Cohesion Analysis

```typescript
async function detailedCohesionAnalysis() {
  const mapper = new NeuralDomainMapper();
  
  // Create a complex graph with mixed cohesion levels
  const domains = [
    // High cohesion group - Authentication
    { id: 'auth-api', name: 'Auth API', type: 'api' },
    { id: 'auth-db', name: 'Auth Database', type: 'data' },
    { id: 'token-service', name: 'Token Service', type: 'api' },
    
    // Medium cohesion group - User Management
    { id: 'user-api', name: 'User API', type: 'api' },
    { id: 'user-db', name: 'User Database', type: 'data' },
    { id: 'profile-service', name: 'Profile Service', type: 'api' },
    
    // Low cohesion group - Mixed services
    { id: 'email-service', name: 'Email Service', type: 'api' },
    { id: 'file-storage', name: 'File Storage', type: 'data' },
    { id: 'analytics', name: 'Analytics Service', type: 'api' }
  ];

  const relationships = [
    // High cohesion relationships
    { source: 'auth-api', target: 'auth-db', type: 'data-flow' },
    { source: 'auth-api', target: 'token-service', type: 'dependency' },
    { source: 'token-service', target: 'auth-db', type: 'data-flow' },
    
    // Medium cohesion relationships
    { source: 'user-api', target: 'user-db', type: 'data-flow' },
    { source: 'profile-service', target: 'user-db', type: 'data-flow' },
    
    // Weak cross-domain relationships
    { source: 'user-api', target: 'auth-api', type: 'dependency' },
    { source: 'email-service', target: 'user-api', type: 'communication' },
    { source: 'analytics', target: 'user-api', type: 'data-flow' },
    { source: 'profile-service', target: 'file-storage', type: 'data-flow' }
  ];

  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);
  const cohesionAnalysis = await mapper.calculateDomainCohesion();

  console.log('=== Cohesion Analysis ===');
  console.log(`Overall Score: ${cohesionAnalysis.overallScore.toFixed(3)}`);
  console.log('Domain Scores:');
  
  for (const [domainId, score] of cohesionAnalysis.domainScores) {
    console.log(`  ${domainId}: ${score.toFixed(3)}`);
  }

  console.log('Weak Points:');
  cohesionAnalysis.weakPoints.forEach(wp => {
    console.log(`  ${wp.domainId} (${wp.score.toFixed(3)}): ${wp.reason}`);
    wp.suggestions.forEach(suggestion => {
      console.log(`    - ${suggestion}`);
    });
  });

  return cohesionAnalysis;
}
```

## Example 3: Dependency Analysis and Optimization

```typescript
async function dependencyAnalysisExample() {
  const mapper = new NeuralDomainMapper();

  // Create a graph with circular dependencies
  const domains = [
    { id: 'order-service', name: 'Order Service', type: 'api' },
    { id: 'payment-service', name: 'Payment Service', type: 'api' },
    { id: 'inventory-service', name: 'Inventory Service', type: 'api' },
    { id: 'user-service', name: 'User Service', type: 'api' },
    { id: 'notification-service', name: 'Notification Service', type: 'api' }
  ];

  const relationships = [
    // Circular dependency: order -> payment -> inventory -> order
    { source: 'order-service', target: 'payment-service', type: 'dependency' },
    { source: 'payment-service', target: 'inventory-service', type: 'dependency' },
    { source: 'inventory-service', target: 'order-service', type: 'dependency' },
    
    // Additional dependencies
    { source: 'order-service', target: 'user-service', type: 'dependency' },
    { source: 'payment-service', target: 'user-service', type: 'dependency' },
    { source: 'notification-service', target: 'order-service', type: 'communication' },
    { source: 'notification-service', target: 'payment-service', type: 'communication' }
  ];

  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);
  const dependencyAnalysis = await mapper.identifyCrossDomainDependencies();

  console.log('=== Dependency Analysis ===');
  console.log(`Circular Dependencies Found: ${dependencyAnalysis.circularDependencies.length}`);
  
  dependencyAnalysis.circularDependencies.forEach((cycle, index) => {
    console.log(`  Cycle ${index + 1}: ${cycle.join(' -> ')}`);
  });

  console.log('\nCritical Paths:');
  dependencyAnalysis.criticalPaths.slice(0, 5).forEach((path, index) => {
    console.log(`  Path ${index + 1}: ${path.path.join(' -> ')}`);
    console.log(`    Risk: ${path.risk.toFixed(3)}, Impact: ${path.impact.toFixed(3)}`);
  });

  console.log('\nOptimizations:');
  dependencyAnalysis.optimizations.forEach(opt => {
    console.log(`  ${opt.type}: ${opt.affected.join(', ')}`);
    console.log(`    Benefit: ${opt.benefit.toFixed(3)}, Effort: ${opt.effort.toFixed(3)}`);
  });

  return dependencyAnalysis;
}
```

## Example 4: Training the Neural Network

```typescript
async function neuralNetworkTrainingExample() {
  const mapper = new NeuralDomainMapper({
    learningRate: 0.001,
    batchSize: 32,
    epochs: 100,
    optimizer: 'adam',
    lossFunction: 'mse',
    regularization: {
      l1: 0.0001,
      l2: 0.0001,
      dropout: 0.1
    },
    earlyStoping: {
      enabled: true,
      patience: 10,
      minDelta: 0.001
    },
    validationSplit: 0.2
  });

  // Generate training data from known good and bad domain structures
  const trainingInputs = [];
  const trainingOutputs = [];

  // Good structure examples (high cohesion, low coupling)
  const goodExamples = [
    {
      features: [1, 0, 0, 0.8, 0.9, 0.7, /* ... more features */],
      target: [0.9, 1, 0, 0.8] // [cohesion, success, failure, frequency]
    },
    // ... more good examples
  ];

  // Bad structure examples (low cohesion, high coupling)
  const badExamples = [
    {
      features: [0, 1, 1, 0.3, 0.4, 0.2, /* ... more features */],
      target: [0.2, 0, 1, 0.9] // [cohesion, success, failure, frequency]
    },
    // ... more bad examples
  ];

  // Combine examples
  const allExamples = [...goodExamples, ...badExamples];
  
  const trainingData = {
    inputs: allExamples.map(ex => ({ features: ex.features })),
    outputs: allExamples.map(ex => ex.target),
    batchSize: 32,
    epochs: 100
  };

  const validationData = {
    inputs: trainingData.inputs.slice(-20), // Last 20 for validation
    outputs: trainingData.outputs.slice(-20),
    batchSize: 16,
    epochs: 1
  };

  // Train the model
  console.log('Starting neural network training...');
  const trainingResult = await mapper.train(trainingData, validationData);

  console.log('=== Training Results ===');
  console.log(`Final Accuracy: ${trainingResult.finalAccuracy.toFixed(3)}`);
  console.log(`Training Epochs: ${trainingResult.trainingHistory.length}`);
  
  console.log('\nTraining History (last 10 epochs):');
  const recentHistory = trainingResult.trainingHistory.slice(-10);
  recentHistory.forEach(epoch => {
    console.log(`  Epoch ${epoch.epoch}: loss=${epoch.loss.toFixed(4)}, acc=${epoch.accuracy.toFixed(4)}`);
  });

  // Test prediction
  const testInput = { features: Array.from({ length: 64 }, () => Math.random()) };
  const prediction = await mapper.predict(testInput);

  console.log('\n=== Test Prediction ===');
  console.log(`Confidence: ${prediction.confidence.toFixed(3)}`);
  console.log(`Alternatives: ${prediction.alternatives.length}`);

  return { trainingResult, prediction };
}
```

## Example 5: Integration with Hooks System

```typescript
import { createDomainMapperIntegration } from './neural';

async function hookIntegrationExample() {
  // Create integrated mapper with auto-analysis enabled
  const integration = await createDomainMapperIntegration({
    enableAutoAnalysis: true,
    enableOptimizationSuggestions: true,
    enableContinuousLearning: true,
    confidenceThreshold: 0.7,
    analysisInterval: 30000, // 30 seconds
    maxOptimizationProposals: 10
  });

  // Set up event listeners
  integration.on('domain-analysis-completed', (result) => {
    console.log(`Domain analysis completed for ${result.graph.nodes.size} domains`);
    console.log(`Cohesion score: ${result.cohesion.overallScore.toFixed(3)}`);
    
    if (result.optimization.priority === 'high' || result.optimization.priority === 'critical') {
      console.log('🚨 High priority optimizations available!');
    }
  });

  integration.on('optimization-suggestions-generated', (result) => {
    console.log('💡 New optimization suggestions:');
    result.prioritizedActions.forEach(action => {
      console.log(`  ${action.priority.toUpperCase()}: ${action.action}`);
      console.log(`    Impact: ${action.impact.toFixed(2)}, Effort: ${action.effort.toFixed(2)}`);
    });
  });

  integration.on('continuous-learning-completed', (result) => {
    console.log(`🧠 Learning update: ${result.dataSize} samples processed`);
  });

  // Simulate domain analysis with mock context
  const mockContext = {
    sessionId: 'example-session',
    timestamp: Date.now(),
    correlationId: 'example-correlation-id',
    metadata: { source: 'integration-example' },
    memory: {
      namespace: 'domain-analysis',
      provider: 'default',
      cache: new Map()
    },
    neural: {
      modelId: 'domain-mapper',
      patterns: {
        add: () => {},
        get: () => undefined,
        findSimilar: () => [],
        getByType: () => [],
        prune: () => {},
        export: () => [],
        import: () => {}
      },
      training: {
        epoch: 0,
        loss: 0,
        accuracy: 0,
        learningRate: 0.001,
        optimizer: 'adam',
        checkpoints: []
      }
    },
    performance: {
      metrics: new Map(),
      bottlenecks: [],
      optimizations: []
    }
  };

  // Create a sample domain graph
  const domains = [
    { id: 'web-api', name: 'Web API Gateway', type: 'api' },
    { id: 'user-service', name: 'User Service', type: 'api' },
    { id: 'order-service', name: 'Order Service', type: 'api' },
    { id: 'database', name: 'Primary Database', type: 'data' },
    { id: 'cache', name: 'Redis Cache', type: 'data' }
  ];

  const relationships = [
    { source: 'web-api', target: 'user-service' },
    { source: 'web-api', target: 'order-service' },
    { source: 'user-service', target: 'database' },
    { source: 'order-service', target: 'database' },
    { source: 'user-service', target: 'cache' },
    { source: 'order-service', target: 'cache' }
  ];

  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);

  // Perform integrated analysis
  const analysisResult = await integration.analyzeDomains(graph, mockContext);

  console.log('=== Integration Analysis Results ===');
  console.log(`Analysis Time: ${analysisResult.metrics.analysisTime}ms`);
  console.log(`Patterns Detected: ${analysisResult.patterns.length}`);
  console.log(`Nodes Analyzed: ${analysisResult.metrics.nodesAnalyzed}`);
  console.log(`Edges Analyzed: ${analysisResult.metrics.edgesAnalyzed}`);

  // Get optimization suggestions
  const optimizationResult = await integration.getOptimizationSuggestions(mockContext);
  console.log(`\nOptimization applicability: ${optimizationResult.applicability.toFixed(3)}`);

  // Get integration statistics
  const stats = integration.getIntegrationStats();
  console.log('\n=== Integration Statistics ===');
  console.log(`Analyses performed: ${stats.analysesPerformed}`);
  console.log(`Average analysis time: ${stats.averageAnalysisTime.toFixed(2)}ms`);
  console.log(`Patterns learned: ${stats.patternsLearned}`);
  console.log(`Optimizations suggested: ${stats.optimizationsSuggested}`);

  return { analysisResult, optimizationResult, stats };
}
```

## Example 6: Advanced Boundary Optimization

```typescript
async function boundaryOptimizationExample() {
  const mapper = new NeuralDomainMapper();

  // Create a suboptimal domain structure
  const domains = [
    // Monolithic user domain (should be split)
    { id: 'user-monolith', name: 'User Monolith', type: 'api' },
    
    // Fragmented authentication (should be merged)
    { id: 'auth-validation', name: 'Auth Validation', type: 'api' },
    { id: 'auth-tokens', name: 'Auth Tokens', type: 'api' },
    { id: 'auth-permissions', name: 'Auth Permissions', type: 'api' },
    
    // Well-structured order domain
    { id: 'order-api', name: 'Order API', type: 'api' },
    { id: 'order-db', name: 'Order Database', type: 'data' },
    
    // Shared utilities (good candidates for abstraction)
    { id: 'logging-service', name: 'Logging Service', type: 'api' },
    { id: 'config-service', name: 'Config Service', type: 'api' }
  ];

  const relationships = [
    // Monolith has too many responsibilities
    { source: 'user-monolith', target: 'auth-validation', type: 'dependency' },
    { source: 'user-monolith', target: 'order-api', type: 'communication' },
    { source: 'user-monolith', target: 'logging-service', type: 'dependency' },
    { source: 'user-monolith', target: 'config-service', type: 'dependency' },
    
    // Fragmented auth services
    { source: 'auth-validation', target: 'auth-tokens', type: 'dependency' },
    { source: 'auth-validation', target: 'auth-permissions', type: 'dependency' },
    { source: 'auth-tokens', target: 'auth-permissions', type: 'communication' },
    
    // Good order structure
    { source: 'order-api', target: 'order-db', type: 'data-flow' },
    
    // Shared dependencies
    { source: 'order-api', target: 'logging-service', type: 'dependency' },
    { source: 'order-api', target: 'config-service', type: 'dependency' },
    { source: 'auth-validation', target: 'logging-service', type: 'dependency' }
  ];

  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);
  const optimization = await mapper.provideBoundaryOptimization();

  console.log('=== Boundary Optimization Analysis ===');
  console.log(`Optimization Score: ${optimization.optimizationScore.toFixed(3)}`);
  console.log(`Priority: ${optimization.priority.toUpperCase()}`);
  console.log(`\nOptimization Proposals:`);

  optimization.proposals.forEach((proposal, index) => {
    console.log(`\n${index + 1}. ${proposal.type.toUpperCase()} - ${proposal.domains.join(', ')}`);
    console.log(`   Confidence: ${proposal.confidence.toFixed(3)}`);
    console.log(`   Metrics:`);
    console.log(`     Cohesion Improvement: ${proposal.metrics.cohesionImprovement.toFixed(3)}`);
    console.log(`     Coupling Reduction: ${proposal.metrics.couplingReduction.toFixed(3)}`);
    console.log(`     Performance Impact: ${proposal.metrics.performanceImpact.toFixed(3)}`);
    console.log(`     Maintainability Impact: ${proposal.metrics.maintainabilityImpact.toFixed(3)}`);
    
    if (proposal.newBoundary) {
      console.log(`   New Boundary: ${proposal.newBoundary.nodes.length} nodes, ${proposal.newBoundary.edges.length} edges`);
    }
  });

  return optimization;
}
```

## Example 7: Performance Monitoring and Metrics

```typescript
async function performanceMonitoringExample() {
  const mapper = new NeuralDomainMapper();

  // Create a large graph for performance testing
  const domainCount = 100;
  const edgeCount = 200;

  const domains = Array.from({ length: domainCount }, (_, i) => ({
    id: `domain-${i}`,
    name: `Domain ${i}`,
    type: i % 4 === 0 ? 'api' : i % 4 === 1 ? 'data' : i % 4 === 2 ? 'ui' : 'integration'
  }));

  const relationships = Array.from({ length: edgeCount }, (_, i) => {
    const source = Math.floor(Math.random() * domainCount);
    let target = Math.floor(Math.random() * domainCount);
    
    // Ensure no self-loops
    while (target === source) {
      target = Math.floor(Math.random() * domainCount);
    }

    return {
      source: `domain-${source}`,
      target: `domain-${target}`,
      type: ['dependency', 'communication', 'data-flow'][Math.floor(Math.random() * 3)]
    };
  });

  const graph = NeuralUtils.createSimpleDomainGraph(domains, relationships);

  console.log('=== Performance Test Setup ===');
  console.log(`Domains: ${domainCount}`);
  console.log(`Relationships: ${edgeCount}`);

  // Measure analysis performance
  const startTime = Date.now();
  
  const [cohesionAnalysis, dependencyAnalysis, optimization] = await Promise.all([
    mapper.calculateDomainCohesion(),
    mapper.identifyCrossDomainDependencies(),
    mapper.provideBoundaryOptimization()
  ]);

  const analysisTime = Date.now() - startTime;

  console.log('\n=== Performance Results ===');
  console.log(`Total Analysis Time: ${analysisTime}ms`);
  console.log(`Cohesion Score: ${cohesionAnalysis.overallScore.toFixed(3)}`);
  console.log(`Circular Dependencies: ${dependencyAnalysis.circularDependencies.length}`);
  console.log(`Optimization Proposals: ${optimization.proposals.length}`);

  // Get model statistics
  const stats = mapper.getModelStats();
  console.log('\n=== Model Statistics ===');
  console.log(`Graph Size: ${stats.graphSize.nodes} nodes, ${stats.graphSize.edges} edges`);
  console.log(`Training State: Epoch ${stats.trainingState.epoch}, Accuracy ${stats.trainingState.accuracy.toFixed(3)}`);
  console.log(`Model Version: ${stats.modelVersion}`);
  console.log(`Last Training: ${stats.lastTraining ? new Date(stats.lastTraining).toISOString() : 'Never'}`);
  console.log(`Cohesion Score: ${stats.cohesionScore.toFixed(3)}`);

  // Memory usage estimation
  const memoryUsage = {
    nodesMemory: stats.graphSize.nodes * 64 * 8, // 64 features * 8 bytes per float
    edgesMemory: stats.graphSize.edges * 32 * 8,  // 32 features * 8 bytes per float
    weightsMemory: Array.from(mapper.weights.values()).reduce((sum, w) => sum + w.length * 8, 0),
    biasesMemory: Array.from(mapper.biases.values()).reduce((sum, b) => sum + b.length * 8, 0)
  };

  const totalMemory = Object.values(memoryUsage).reduce((sum, mem) => sum + mem, 0);

  console.log('\n=== Memory Usage Estimation ===');
  console.log(`Nodes: ${(memoryUsage.nodesMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Edges: ${(memoryUsage.edgesMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Weights: ${(memoryUsage.weightsMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Biases: ${(memoryUsage.biasesMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total: ${(totalMemory / 1024 / 1024).toFixed(2)} MB`);

  return {
    analysisTime,
    stats,
    memoryUsage,
    results: { cohesionAnalysis, dependencyAnalysis, optimization }
  };
}
```

## Running the Examples

To run any of these examples, save them in a TypeScript file and execute:

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run example
node dist/examples.js
```

Or if using ts-node:

```bash
npx ts-node examples.ts
```

## Integration with Claude Flow

These examples demonstrate how the NeuralDomainMapper integrates with the broader Claude Flow ecosystem:

1. **Hooks Integration**: Automatic analysis triggers based on neural patterns
2. **Memory System**: Persistent storage of analysis results and learning patterns  
3. **Performance Monitoring**: Real-time metrics and optimization suggestions
4. **Event System**: Reactive updates and notifications
5. **Configuration Management**: Flexible configuration for different use cases

The NeuralDomainMapper provides a powerful foundation for understanding and optimizing domain relationships in complex systems, enabling better architecture decisions and improved system maintainability.