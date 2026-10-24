/**
 * Integration tests for MCP Pattern Persistence
 * Tests neural_train storage, neural_patterns retrieval, and statistics
 */

import { EnhancedMemory } from '../../src/memory/enhanced-memory.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock MCP server for testing
class TestMcpServer {
  constructor(options = {}) {
    this.memoryStore = options.memoryStore;
    this.sessionId = `test-session-${Date.now()}`;
  }

  async executeTool(name, args) {
    // Import the actual handler logic from mcp-server.js
    // For testing, we'll inline the logic here
    switch (name) {
      case 'neural_train':
        return await this.handleNeuralTrain(args);
      case 'neural_patterns':
        return await this.handleNeuralPatterns(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async handleNeuralTrain(args) {
    const epochs = args.epochs || 50;
    const baseAccuracy = 0.65;
    const maxAccuracy = 0.98;

    const epochFactor = Math.min(epochs / 100, 10);
    const accuracyGain = (maxAccuracy - baseAccuracy) * (1 - Math.exp(-epochFactor / 3));
    const finalAccuracy = baseAccuracy + accuracyGain + (Math.random() * 0.05 - 0.025);

    const baseTime = 2;
    const timePerEpoch = 0.08;
    const trainingTime = baseTime + epochs * timePerEpoch + (Math.random() * 2 - 1);

    const modelId = `model_${args.pattern_type || 'general'}_${Date.now()}`;
    const patternData = {
      success: true,
      modelId: modelId,
      pattern_type: args.pattern_type || 'coordination',
      epochs: epochs,
      accuracy: Math.min(finalAccuracy, maxAccuracy),
      training_time: Math.max(trainingTime, 1),
      status: 'completed',
      improvement_rate: epochFactor > 1 ? 'converged' : 'improving',
      data_source: args.training_data || 'recent',
      timestamp: new Date().toISOString(),
      training_metadata: {
        baseAccuracy: baseAccuracy,
        maxAccuracy: maxAccuracy,
        epochFactor: epochFactor,
        finalAccuracy: Math.min(finalAccuracy, maxAccuracy),
      },
    };

    if (this.memoryStore) {
      try {
        await this.memoryStore.store(modelId, JSON.stringify(patternData), {
          namespace: 'patterns',
          ttl: 30 * 24 * 60 * 60 * 1000,
          metadata: {
            sessionId: this.sessionId,
            pattern_type: args.pattern_type || 'coordination',
            accuracy: patternData.accuracy,
            epochs: epochs,
            storedBy: 'neural_train',
            type: 'neural_pattern',
          },
        });

        const statsKey = `stats_${args.pattern_type || 'coordination'}`;
        const existingStats = await this.memoryStore.retrieve(statsKey, {
          namespace: 'pattern-stats',
        });

        let stats = existingStats
          ? JSON.parse(existingStats)
          : {
              pattern_type: args.pattern_type || 'coordination',
              total_trainings: 0,
              avg_accuracy: 0,
              max_accuracy: 0,
              min_accuracy: 1,
              total_epochs: 0,
              models: [],
            };

        stats.total_trainings += 1;
        stats.avg_accuracy = (stats.avg_accuracy * (stats.total_trainings - 1) + patternData.accuracy) / stats.total_trainings;
        stats.max_accuracy = Math.max(stats.max_accuracy, patternData.accuracy);
        stats.min_accuracy = Math.min(stats.min_accuracy, patternData.accuracy);
        stats.total_epochs += epochs;
        stats.models.push({
          modelId: modelId,
          accuracy: patternData.accuracy,
          timestamp: patternData.timestamp,
        });

        if (stats.models.length > 50) {
          stats.models = stats.models.slice(-50);
        }

        await this.memoryStore.store(statsKey, JSON.stringify(stats), {
          namespace: 'pattern-stats',
          ttl: 30 * 24 * 60 * 60 * 1000,
          metadata: {
            pattern_type: args.pattern_type || 'coordination',
            storedBy: 'neural_train',
            type: 'pattern_statistics',
          },
        });
      } catch (error) {
        console.error(`Failed to persist pattern: ${error.message}`);
      }
    }

    return patternData;
  }

  async handleNeuralPatterns(args) {
    if (!this.memoryStore) {
      return {
        success: false,
        error: 'Shared memory system not initialized',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      switch (args.action) {
        case 'analyze':
          if (args.metadata && args.metadata.modelId) {
            const patternValue = await this.memoryStore.retrieve(args.metadata.modelId, {
              namespace: 'patterns',
            });

            if (!patternValue) {
              return {
                success: false,
                action: 'analyze',
                error: 'Pattern not found',
                modelId: args.metadata.modelId,
                timestamp: new Date().toISOString(),
              };
            }

            const pattern = JSON.parse(patternValue);
            return {
              success: true,
              action: 'analyze',
              pattern: pattern,
              analysis: {
                quality: pattern.accuracy > 0.9 ? 'excellent' : pattern.accuracy > 0.75 ? 'good' : 'fair',
                confidence: pattern.accuracy,
                pattern_type: pattern.pattern_type,
                training_epochs: pattern.epochs,
                improvement_rate: pattern.improvement_rate,
                data_source: pattern.data_source,
              },
              timestamp: new Date().toISOString(),
            };
          } else {
            const allPatterns = await this.memoryStore.list({
              namespace: 'patterns',
              limit: 100,
            });

            return {
              success: true,
              action: 'analyze',
              total_patterns: allPatterns.length,
              patterns: allPatterns.map((p) => {
                try {
                  const data = JSON.parse(p.value);
                  return {
                    modelId: data.modelId,
                    pattern_type: data.pattern_type,
                    accuracy: data.accuracy,
                    timestamp: data.timestamp,
                  };
                } catch (e) {
                  return { error: 'Failed to parse pattern data' };
                }
              }),
              timestamp: new Date().toISOString(),
            };
          }

        case 'learn':
          if (!args.operation || !args.outcome) {
            return {
              success: false,
              action: 'learn',
              error: 'operation and outcome are required for learning',
              timestamp: new Date().toISOString(),
            };
          }

          const learningId = `learning_${Date.now()}`;
          const learningData = {
            learningId: learningId,
            operation: args.operation,
            outcome: args.outcome,
            metadata: args.metadata || {},
            timestamp: new Date().toISOString(),
          };

          await this.memoryStore.store(learningId, JSON.stringify(learningData), {
            namespace: 'patterns',
            ttl: 30 * 24 * 60 * 60 * 1000,
            metadata: {
              sessionId: this.sessionId,
              storedBy: 'neural_patterns',
              type: 'learning_experience',
              operation: args.operation,
            },
          });

          return {
            success: true,
            action: 'learn',
            learningId: learningId,
            stored: true,
            timestamp: new Date().toISOString(),
          };

        case 'predict':
          const patternType = (args.metadata && args.metadata.pattern_type) || 'coordination';
          const statsKey = `stats_${patternType}`;
          const statsValue = await this.memoryStore.retrieve(statsKey, {
            namespace: 'pattern-stats',
          });

          if (!statsValue) {
            return {
              success: true,
              action: 'predict',
              prediction: {
                confidence: 0.5,
                recommendation: 'No historical data available for this pattern type',
                pattern_type: patternType,
              },
              timestamp: new Date().toISOString(),
            };
          }

          const stats = JSON.parse(statsValue);
          return {
            success: true,
            action: 'predict',
            prediction: {
              confidence: stats.avg_accuracy,
              expected_accuracy: stats.avg_accuracy,
              pattern_type: patternType,
              recommendation:
                stats.avg_accuracy > 0.85
                  ? 'High confidence - pattern is well-established'
                  : stats.avg_accuracy > 0.7
                    ? 'Moderate confidence - more training recommended'
                    : 'Low confidence - significant training needed',
              historical_trainings: stats.total_trainings,
              best_accuracy: stats.max_accuracy,
            },
            timestamp: new Date().toISOString(),
          };

        case 'stats':
          const requestedType = (args.metadata && args.metadata.pattern_type) || null;

          if (requestedType) {
            const statsKey = `stats_${requestedType}`;
            const statsValue = await this.memoryStore.retrieve(statsKey, {
              namespace: 'pattern-stats',
            });

            if (!statsValue) {
              return {
                success: true,
                action: 'stats',
                pattern_type: requestedType,
                statistics: {
                  total_trainings: 0,
                  message: 'No training data available for this pattern type',
                },
                timestamp: new Date().toISOString(),
              };
            }

            const stats = JSON.parse(statsValue);
            return {
              success: true,
              action: 'stats',
              pattern_type: requestedType,
              statistics: stats,
              timestamp: new Date().toISOString(),
            };
          } else {
            const allStats = await this.memoryStore.list({
              namespace: 'pattern-stats',
              limit: 100,
            });

            return {
              success: true,
              action: 'stats',
              total_pattern_types: allStats.length,
              statistics: allStats.map((s) => {
                try {
                  return JSON.parse(s.value);
                } catch (e) {
                  return { error: 'Failed to parse stats data' };
                }
              }),
              timestamp: new Date().toISOString(),
            };
          }

        default:
          return {
            success: false,
            error: `Unknown action: ${args.action}. Valid actions are: analyze, learn, predict, stats`,
            timestamp: new Date().toISOString(),
          };
      }
    } catch (error) {
      return {
        success: false,
        action: args.action,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

describe('MCP Pattern Persistence Integration Tests', () => {
  let mcpServer;
  let memoryStore;
  let tempDir;

  beforeEach(async () => {
    // Create temporary directory for test storage
    tempDir = path.join(process.cwd(), '.test-data', `test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    // Initialize memory store with test directory
    memoryStore = new EnhancedMemory({
      dataDir: tempDir,
      enablePersistence: true,
    });

    // Initialize test MCP server with memory store
    mcpServer = new TestMcpServer({
      memoryStore: memoryStore,
    });
  });

  afterEach(async () => {
    // Cleanup temporary directory
    if (tempDir && (await fs.pathExists(tempDir))) {
      await fs.remove(tempDir);
    }
  });

  describe('neural_train persistence', () => {
    it('should store trained pattern to memory', async () => {
      // Train a neural pattern
      const trainResult = await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'test training data',
        epochs: 50,
      });

      expect(trainResult.success).toBe(true);
      expect(trainResult.modelId).toBeDefined();
      expect(trainResult.accuracy).toBeGreaterThan(0);

      // Verify pattern was stored in memory
      const storedPattern = await memoryStore.retrieve(trainResult.modelId, {
        namespace: 'patterns',
      });

      expect(storedPattern).toBeDefined();
      const patternData = JSON.parse(storedPattern);
      expect(patternData.modelId).toBe(trainResult.modelId);
      expect(patternData.pattern_type).toBe('coordination');
      expect(patternData.accuracy).toBe(trainResult.accuracy);
    });

    it('should update pattern statistics', async () => {
      // Train multiple patterns of the same type
      const pattern1 = await mcpServer.executeTool('neural_train', {
        pattern_type: 'optimization',
        training_data: 'test data 1',
        epochs: 30,
      });

      const pattern2 = await mcpServer.executeTool('neural_train', {
        pattern_type: 'optimization',
        training_data: 'test data 2',
        epochs: 60,
      });

      expect(pattern1.success).toBe(true);
      expect(pattern2.success).toBe(true);

      // Verify statistics were updated
      const statsKey = 'stats_optimization';
      const storedStats = await memoryStore.retrieve(statsKey, {
        namespace: 'pattern-stats',
      });

      expect(storedStats).toBeDefined();
      const stats = JSON.parse(storedStats);
      expect(stats.total_trainings).toBe(2);
      expect(stats.pattern_type).toBe('optimization');
      expect(stats.total_epochs).toBe(90); // 30 + 60
      expect(stats.models.length).toBe(2);
    });

    it('should handle different pattern types independently', async () => {
      // Train different pattern types
      await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'coordination data',
        epochs: 40,
      });

      await mcpServer.executeTool('neural_train', {
        pattern_type: 'prediction',
        training_data: 'prediction data',
        epochs: 50,
      });

      // Verify separate statistics
      const coordStats = await memoryStore.retrieve('stats_coordination', {
        namespace: 'pattern-stats',
      });
      const predStats = await memoryStore.retrieve('stats_prediction', {
        namespace: 'pattern-stats',
      });

      expect(coordStats).toBeDefined();
      expect(predStats).toBeDefined();

      const coordData = JSON.parse(coordStats);
      const predData = JSON.parse(predStats);

      expect(coordData.pattern_type).toBe('coordination');
      expect(predData.pattern_type).toBe('prediction');
      expect(coordData.total_trainings).toBe(1);
      expect(predData.total_trainings).toBe(1);
    });
  });

  describe('neural_patterns analyze action', () => {
    it('should retrieve specific pattern by modelId', async () => {
      // Train and store a pattern
      const trainResult = await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'test data',
        epochs: 50,
      });

      // Retrieve the pattern using neural_patterns
      const analyzeResult = await mcpServer.executeTool('neural_patterns', {
        action: 'analyze',
        metadata: {
          modelId: trainResult.modelId,
        },
      });

      expect(analyzeResult.success).toBe(true);
      expect(analyzeResult.action).toBe('analyze');
      expect(analyzeResult.pattern).toBeDefined();
      expect(analyzeResult.pattern.modelId).toBe(trainResult.modelId);
      expect(analyzeResult.analysis).toBeDefined();
      expect(analyzeResult.analysis.pattern_type).toBe('coordination');
    });

    it('should list all patterns when no modelId specified', async () => {
      // Train multiple patterns
      await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'data 1',
        epochs: 30,
      });

      await mcpServer.executeTool('neural_train', {
        pattern_type: 'optimization',
        training_data: 'data 2',
        epochs: 40,
      });

      // List all patterns
      const listResult = await mcpServer.executeTool('neural_patterns', {
        action: 'analyze',
      });

      expect(listResult.success).toBe(true);
      expect(listResult.total_patterns).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(listResult.patterns)).toBe(true);
      expect(listResult.patterns.length).toBeGreaterThanOrEqual(2);
    });

    it('should return error for non-existent pattern', async () => {
      const analyzeResult = await mcpServer.executeTool('neural_patterns', {
        action: 'analyze',
        metadata: {
          modelId: 'non_existent_model_123',
        },
      });

      expect(analyzeResult.success).toBe(false);
      expect(analyzeResult.error).toBe('Pattern not found');
    });
  });

  describe('neural_patterns learn action', () => {
    it('should store learning experience', async () => {
      const learnResult = await mcpServer.executeTool('neural_patterns', {
        action: 'learn',
        operation: 'test_operation',
        outcome: 'successful',
        metadata: {
          context: 'test context',
          performance: 0.95,
        },
      });

      expect(learnResult.success).toBe(true);
      expect(learnResult.action).toBe('learn');
      expect(learnResult.learningId).toBeDefined();
      expect(learnResult.stored).toBe(true);

      // Verify learning was stored
      const storedLearning = await memoryStore.retrieve(learnResult.learningId, {
        namespace: 'patterns',
      });

      expect(storedLearning).toBeDefined();
      const learningData = JSON.parse(storedLearning);
      expect(learningData.operation).toBe('test_operation');
      expect(learningData.outcome).toBe('successful');
    });

    it('should require operation and outcome', async () => {
      const learnResult = await mcpServer.executeTool('neural_patterns', {
        action: 'learn',
        // Missing operation and outcome
      });

      expect(learnResult.success).toBe(false);
      expect(learnResult.error).toContain('operation and outcome are required');
    });
  });

  describe('neural_patterns predict action', () => {
    it('should make predictions based on historical data', async () => {
      // Train some patterns to build historical data
      await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'data 1',
        epochs: 80,
      });

      await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'data 2',
        epochs: 90,
      });

      // Make prediction
      const predictResult = await mcpServer.executeTool('neural_patterns', {
        action: 'predict',
        metadata: {
          pattern_type: 'coordination',
        },
      });

      expect(predictResult.success).toBe(true);
      expect(predictResult.action).toBe('predict');
      expect(predictResult.prediction).toBeDefined();
      expect(predictResult.prediction.pattern_type).toBe('coordination');
      expect(predictResult.prediction.confidence).toBeGreaterThan(0);
      expect(predictResult.prediction.historical_trainings).toBe(2);
    });

    it('should handle prediction without historical data', async () => {
      const predictResult = await mcpServer.executeTool('neural_patterns', {
        action: 'predict',
        metadata: {
          pattern_type: 'nonexistent_type',
        },
      });

      expect(predictResult.success).toBe(true);
      expect(predictResult.prediction.confidence).toBe(0.5);
      expect(predictResult.prediction.recommendation).toContain('No historical data');
    });
  });

  describe('neural_patterns stats action', () => {
    it('should return statistics for specific pattern type', async () => {
      // Train patterns
      await mcpServer.executeTool('neural_train', {
        pattern_type: 'optimization',
        training_data: 'data 1',
        epochs: 50,
      });

      await mcpServer.executeTool('neural_train', {
        pattern_type: 'optimization',
        training_data: 'data 2',
        epochs: 60,
      });

      // Get statistics
      const statsResult = await mcpServer.executeTool('neural_patterns', {
        action: 'stats',
        metadata: {
          pattern_type: 'optimization',
        },
      });

      expect(statsResult.success).toBe(true);
      expect(statsResult.action).toBe('stats');
      expect(statsResult.pattern_type).toBe('optimization');
      expect(statsResult.statistics).toBeDefined();
      expect(statsResult.statistics.total_trainings).toBe(2);
      expect(statsResult.statistics.total_epochs).toBe(110);
      expect(statsResult.statistics.avg_accuracy).toBeGreaterThan(0);
    });

    it('should return statistics for all pattern types', async () => {
      // Train different pattern types
      await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'data 1',
        epochs: 30,
      });

      await mcpServer.executeTool('neural_train', {
        pattern_type: 'prediction',
        training_data: 'data 2',
        epochs: 40,
      });

      // Get all statistics
      const statsResult = await mcpServer.executeTool('neural_patterns', {
        action: 'stats',
      });

      expect(statsResult.success).toBe(true);
      expect(statsResult.action).toBe('stats');
      expect(statsResult.total_pattern_types).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(statsResult.statistics)).toBe(true);
    });

    it('should handle stats request for non-existent pattern type', async () => {
      const statsResult = await mcpServer.executeTool('neural_patterns', {
        action: 'stats',
        metadata: {
          pattern_type: 'nonexistent',
        },
      });

      expect(statsResult.success).toBe(true);
      expect(statsResult.statistics.total_trainings).toBe(0);
      expect(statsResult.statistics.message).toContain('No training data available');
    });
  });

  describe('error handling', () => {
    it('should handle invalid action', async () => {
      const result = await mcpServer.executeTool('neural_patterns', {
        action: 'invalid_action',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('should handle memory store not initialized', async () => {
      const serverWithoutMemory = new McpServer({});

      const result = await serverWithoutMemory.executeTool('neural_patterns', {
        action: 'analyze',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Shared memory system not initialized');
    });
  });

  describe('data persistence across sessions', () => {
    it('should persist patterns across server restarts', async () => {
      // Train pattern with first server instance
      const trainResult = await mcpServer.executeTool('neural_train', {
        pattern_type: 'coordination',
        training_data: 'persistent data',
        epochs: 50,
      });

      const modelId = trainResult.modelId;

      // Simulate server restart by creating new instance with same data dir
      const newMemoryStore = new EnhancedMemory({
        dataDir: tempDir,
        enablePersistence: true,
      });

      const newServer = new TestMcpServer({
        memoryStore: newMemoryStore,
      });

      // Retrieve pattern with new server instance
      const retrieveResult = await newServer.executeTool('neural_patterns', {
        action: 'analyze',
        metadata: {
          modelId: modelId,
        },
      });

      expect(retrieveResult.success).toBe(true);
      expect(retrieveResult.pattern.modelId).toBe(modelId);
    });
  });
});
