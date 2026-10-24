/**
 * Neural training hooks for agentic-flow
 * 
 * Enables learning from multi-model responses with
 * pattern detection and adaptive optimization.
 */

import { agenticHookManager } from './hook-manager.js';
import type {
  AgenticHookContext,
  HookHandlerResult,
  NeuralHookPayload,
  Pattern,
  TrainingData,
  Prediction,
  Adaptation,
  SideEffect,
} from './types.js';

// ===== Pre-Neural Train Hook =====

export const preNeuralTrainHook = {
  id: 'agentic-pre-neural-train',
  type: 'pre-neural-train' as const,
  priority: 100,
  handler: async (
    payload: NeuralHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { operation, modelId, trainingData } = payload;
    
    if (operation !== 'train' || !trainingData) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Validate training data
    const validation = validateTrainingData(trainingData);
    if (!validation.valid) {
      return {
        continue: false,
        sideEffects: [
          {
            type: 'log',
            action: 'write',
            data: {
              level: 'error',
              message: 'Invalid training data',
              data: validation,
            },
          },
        ],
      };
    }
    
    // Augment training data with historical patterns
    const augmentedData = await augmentTrainingData(
      trainingData,
      modelId,
      context
    );
    
    // Balance dataset if needed
    const balancedData = balanceTrainingData(augmentedData);
    
    // Apply data preprocessing
    const preprocessedData = preprocessTrainingData(balancedData);
    
    // Store training session metadata
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `neural:training:${modelId}:${Date.now()}`,
        value: {
          originalSize: trainingData.inputs.length,
          augmentedSize: augmentedData.inputs.length,
          balancedSize: balancedData.inputs.length,
          epochs: balancedData.epochs,
          timestamp: Date.now(),
        },
        ttl: 86400, // 24 hours
      },
    });
    
    return {
      continue: true,
      modified: true,
      payload: {
        ...payload,
        trainingData: preprocessedData,
      },
      sideEffects,
    };
  },
};

// ===== Post-Neural Train Hook =====

export const postNeuralTrainHook = {
  id: 'agentic-post-neural-train',
  type: 'post-neural-train' as const,
  priority: 100,
  handler: async (
    payload: NeuralHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { modelId, accuracy, trainingData } = payload;
    
    const sideEffects: SideEffect[] = [];
    
    // Store training results
    const trainingResult = {
      modelId,
      accuracy,
      timestamp: Date.now(),
      sessionId: context.sessionId,
      dataSize: trainingData?.inputs.length || 0,
      epochs: trainingData?.epochs || 0,
    };
    
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `neural:results:${modelId}:${Date.now()}`,
        value: trainingResult,
        ttl: 604800, // 7 days
      },
    });
    
    // Update model performance history
    await updateModelPerformance(modelId, accuracy, context);
    
    // Check if model should be promoted
    const shouldPromote = await evaluateModelPromotion(modelId, accuracy, context);
    if (shouldPromote) {
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'neural:model:promoted',
          data: { modelId, accuracy },
        },
      });
    }
    
    // Extract learned patterns
    const patterns = await extractLearnedPatterns(modelId, context);
    if (patterns.length > 0) {
      sideEffects.push({
        type: 'neural',
        action: 'store-patterns',
        data: { patterns },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Neural Pattern Detected Hook =====

export const neuralPatternDetectedHook = {
  id: 'agentic-neural-pattern-detected',
  type: 'neural-pattern-detected' as const,
  priority: 90,
  handler: async (
    payload: NeuralHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { patterns } = payload;
    
    if (!patterns || patterns.length === 0) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Analyze pattern significance
    for (const pattern of patterns) {
      const significance = calculatePatternSignificance(pattern);
      
      if (significance > 0.7) {
        // High significance pattern
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            key: `pattern:significant:${pattern.id}`,
            value: {
              pattern,
              significance,
              detectedAt: Date.now(),
              context: context.metadata,
            },
            ttl: 0, // Permanent
          },
        });
        
        // Trigger adaptation if needed
        const adaptation = await generateAdaptation(pattern, context);
        if (adaptation) {
          sideEffects.push({
            type: 'neural',
            action: 'adapt',
            data: { adaptation },
          });
        }
      }
      
      // Update pattern store
      context.neural.patterns.add(pattern);
    }
    
    // Check for pattern combinations
    const combinations = findPatternCombinations(patterns, context);
    if (combinations.length > 0) {
      sideEffects.push({
        type: 'log',
        action: 'write',
        data: {
          level: 'info',
          message: 'Pattern combinations detected',
          data: { combinations },
        },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Neural Prediction Hook =====

export const neuralPredictionHook = {
  id: 'agentic-neural-prediction',
  type: 'neural-prediction' as const,
  priority: 100,
  handler: async (
    payload: NeuralHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { prediction, modelId } = payload;
    
    if (!prediction) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Validate prediction confidence
    if (prediction.confidence < 0.5) {
      // Low confidence - consider alternatives
      const alternatives = await generateAlternatives(
        prediction.input,
        modelId,
        context
      );
      
      if (alternatives.length > 0) {
        return {
          continue: true,
          modified: true,
          payload: {
            ...payload,
            prediction: {
              ...prediction,
              alternatives: [...prediction.alternatives, ...alternatives],
            },
          },
          sideEffects: [
            {
              type: 'metric',
              action: 'increment',
              data: { name: 'neural.predictions.low_confidence' },
            },
          ],
        };
      }
    }
    
    // Store prediction for future training
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `prediction:${modelId}:${Date.now()}`,
        value: {
          input: prediction.input,
          output: prediction.output,
          confidence: prediction.confidence,
          timestamp: Date.now(),
        },
        ttl: 86400, // 24 hours
      },
    });
    
    // Track prediction metrics
    sideEffects.push({
      type: 'metric',
      action: 'update',
      data: {
        name: `neural.predictions.confidence.${modelId}`,
        value: prediction.confidence,
      },
    });
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Neural Adaptation Hook =====

export const neuralAdaptationHook = {
  id: 'agentic-neural-adaptation',
  type: 'neural-adaptation' as const,
  priority: 90,
  handler: async (
    payload: NeuralHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { adaptations, modelId } = payload;
    
    if (!adaptations || adaptations.length === 0) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Validate adaptations
    const validAdaptations = adaptations.filter(a => 
      validateAdaptation(a, modelId, context)
    );
    
    if (validAdaptations.length === 0) {
      return { continue: true };
    }
    
    // Apply adaptations in order of impact
    const sortedAdaptations = validAdaptations.sort((a, b) => 
      Math.abs(b.impact) - Math.abs(a.impact)
    );
    
    for (const adaptation of sortedAdaptations) {
      // Store adaptation history
      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          key: `adaptation:${modelId}:${adaptation.target}:${Date.now()}`,
          value: adaptation,
          ttl: 604800, // 7 days
        },
      });
      
      // Apply adaptation based on type
      switch (adaptation.type) {
        case 'parameter':
          await applyParameterAdaptation(adaptation, modelId, context);
          break;
          
        case 'architecture':
          await applyArchitectureAdaptation(adaptation, modelId, context);
          break;
          
        case 'strategy':
          await applyStrategyAdaptation(adaptation, modelId, context);
          break;
      }
      
      // Track adaptation metrics
      sideEffects.push({
        type: 'metric',
        action: 'increment',
        data: { name: `neural.adaptations.${adaptation.type}` },
      });
    }
    
    // Trigger retraining if significant adaptations
    const totalImpact = sortedAdaptations.reduce((sum, a) => 
      sum + Math.abs(a.impact), 0
    );
    
    if (totalImpact > 0.5) {
      sideEffects.push({
        type: 'neural',
        action: 'retrain',
        data: {
          modelId,
          reason: 'significant_adaptations',
          adaptations: sortedAdaptations.length,
        },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Helper Functions =====

function validateTrainingData(data: TrainingData): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  
  if (!data.inputs || data.inputs.length === 0) {
    errors.push('No input data provided');
  }
  
  if (!data.outputs || data.outputs.length === 0) {
    errors.push('No output data provided');
  }
  
  if (data.inputs.length !== data.outputs.length) {
    errors.push('Input and output lengths do not match');
  }
  
  if (data.batchSize <= 0) {
    errors.push('Invalid batch size');
  }
  
  if (data.epochs <= 0) {
    errors.push('Invalid number of epochs');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function augmentTrainingData(
  data: TrainingData,
  modelId: string,
  context: AgenticHookContext
): Promise<TrainingData> {
  // Augment with historical successful patterns
  const historicalPatterns = await loadHistoricalPatterns(modelId, context);
  
  const augmented: TrainingData = {
    ...data,
    inputs: [...data.inputs],
    outputs: [...data.outputs],
    labels: data.labels ? [...data.labels] : undefined,
    weights: data.weights ? [...data.weights] : undefined,
  };
  
  // Add successful patterns
  for (const pattern of historicalPatterns) {
    if (pattern.type === 'success' && pattern.confidence > 0.8) {
      augmented.inputs.push(pattern.context.input);
      augmented.outputs.push(pattern.context.output);
      
      if (augmented.weights) {
        // Give higher weight to successful patterns
        augmented.weights.push(pattern.confidence);
      }
    }
  }
  
  return augmented;
}

function balanceTrainingData(data: TrainingData): TrainingData {
  // Balance dataset to prevent bias
  if (!data.labels) {
    return data;
  }
  
  // Count occurrences of each label
  const labelCounts = new Map<string, number>();
  for (const label of data.labels) {
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  
  // Find minimum count
  const minCount = Math.min(...labelCounts.values());
  
  // Balance by undersampling
  const balanced: TrainingData = {
    ...data,
    inputs: [],
    outputs: [],
    labels: [],
    weights: data.weights ? [] : undefined,
  };
  
  const labelIndices = new Map<string, number[]>();
  data.labels.forEach((label, i) => {
    if (!labelIndices.has(label)) {
      labelIndices.set(label, []);
    }
    labelIndices.get(label)!.push(i);
  });
  
  // Sample equally from each label
  for (const [label, indices] of labelIndices.entries()) {
    const sampled = indices
      .sort(() => Math.random() - 0.5)
      .slice(0, minCount);
    
    for (const idx of sampled) {
      balanced.inputs.push(data.inputs[idx]);
      balanced.outputs.push(data.outputs[idx]);
      balanced.labels!.push(label);
      
      if (data.weights && balanced.weights) {
        balanced.weights.push(data.weights[idx]);
      }
    }
  }
  
  return balanced;
}

function preprocessTrainingData(data: TrainingData): TrainingData {
  // Apply preprocessing transformations
  const processed: TrainingData = {
    ...data,
    inputs: data.inputs.map(input => normalizeInput(input)),
    outputs: data.outputs.map(output => normalizeOutput(output)),
  };
  
  return processed;
}

function normalizeInput(input: any): any {
  // Normalize input data
  // Placeholder - actual implementation would depend on data type
  return input;
}

function normalizeOutput(output: any): any {
  // Normalize output data
  // Placeholder - actual implementation would depend on data type
  return output;
}

async function updateModelPerformance(
  modelId: string,
  accuracy: number,
  context: AgenticHookContext
): Promise<void> {
  const perfKey = `model:performance:${modelId}`;
  const history = await context.memory.cache.get(perfKey) || [];
  
  history.push({
    accuracy,
    timestamp: Date.now(),
    sessionId: context.sessionId,
  });
  
  // Keep last 100 performance records
  if (history.length > 100) {
    history.shift();
  }
  
  await context.memory.cache.set(perfKey, history);
}

async function evaluateModelPromotion(
  modelId: string,
  accuracy: number,
  context: AgenticHookContext
): Promise<boolean> {
  // Check if model should be promoted to production
  const perfKey = `model:performance:${modelId}`;
  const history = await context.memory.cache.get(perfKey) || [];
  
  if (history.length < 10) {
    return false; // Not enough history
  }
  
  // Calculate average accuracy over last 10 runs
  const recent = history.slice(-10);
  const avgAccuracy = recent.reduce((sum: number, h: any) => 
    sum + h.accuracy, 0
  ) / recent.length;
  
  // Promote if consistently above threshold
  return avgAccuracy > 0.85 && accuracy > 0.85;
}

async function extractLearnedPatterns(
  modelId: string,
  context: AgenticHookContext
): Promise<Pattern[]> {
  // Extract patterns learned during training
  // Placeholder implementation
  return [];
}

function calculatePatternSignificance(pattern: Pattern): number {
  // Calculate pattern significance score
  const baseScore = pattern.confidence;
  const occurrenceBonus = Math.min(pattern.occurrences / 100, 0.2);
  
  return Math.min(baseScore + occurrenceBonus, 1.0);
}

async function generateAdaptation(
  pattern: Pattern,
  context: AgenticHookContext
): Promise<Adaptation | null> {
  // Generate adaptation based on pattern
  if (pattern.type === 'failure' && pattern.confidence > 0.8) {
    return {
      type: 'parameter',
      target: 'learning_rate',
      oldValue: context.neural.training.learningRate,
      newValue: context.neural.training.learningRate * 0.9,
      reason: `High confidence failure pattern detected: ${pattern.id}`,
      impact: -0.1,
    };
  }
  
  if (pattern.type === 'optimization' && pattern.confidence > 0.9) {
    return {
      type: 'strategy',
      target: 'batch_size',
      oldValue: 32,
      newValue: 64,
      reason: `Optimization opportunity detected: ${pattern.id}`,
      impact: 0.2,
    };
  }
  
  return null;
}

function findPatternCombinations(
  patterns: Pattern[],
  context: AgenticHookContext
): Array<{ patterns: Pattern[]; significance: number }> {
  const combinations: Array<{ patterns: Pattern[]; significance: number }> = [];
  
  // Find co-occurring patterns
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const pattern1 = patterns[i];
      const pattern2 = patterns[j];
      
      // Check if patterns are related
      if (areRelatedPatterns(pattern1, pattern2)) {
        const significance = 
          (pattern1.confidence + pattern2.confidence) / 2 * 1.2;
        
        combinations.push({
          patterns: [pattern1, pattern2],
          significance: Math.min(significance, 1.0),
        });
      }
    }
  }
  
  return combinations;
}

function areRelatedPatterns(p1: Pattern, p2: Pattern): boolean {
  // Check if patterns are related
  // Simplified implementation
  return p1.type === p2.type || 
    Object.keys(p1.context).some(key => key in p2.context);
}

async function generateAlternatives(
  input: any,
  modelId: string,
  context: AgenticHookContext
): Promise<Array<{ output: any; confidence: number }>> {
  // Generate alternative predictions
  // Placeholder implementation
  return [];
}

function validateAdaptation(
  adaptation: Adaptation,
  modelId: string,
  context: AgenticHookContext
): boolean {
  // Validate adaptation is safe to apply
  if (Math.abs(adaptation.impact) > 0.5) {
    // Large impact adaptations need more validation
    return context.neural.training.epoch > 10;
  }
  
  return true;
}

async function applyParameterAdaptation(
  adaptation: Adaptation,
  modelId: string,
  context: AgenticHookContext
): Promise<void> {
  // Apply parameter adaptation
  // Placeholder implementation
}

async function applyArchitectureAdaptation(
  adaptation: Adaptation,
  modelId: string,
  context: AgenticHookContext
): Promise<void> {
  // Apply architecture adaptation
  // Placeholder implementation
}

async function applyStrategyAdaptation(
  adaptation: Adaptation,
  modelId: string,
  context: AgenticHookContext
): Promise<void> {
  // Apply strategy adaptation
  // Placeholder implementation
}

async function loadHistoricalPatterns(
  modelId: string,
  context: AgenticHookContext
): Promise<Pattern[]> {
  // Load historical patterns
  const patterns: Pattern[] = [];
  
  // Get recent patterns from memory
  const patternKeys = await context.memory.cache.get(`patterns:${modelId}`) || [];
  
  for (const key of patternKeys.slice(-100)) {
    const pattern = await context.memory.cache.get(key);
    if (pattern) {
      patterns.push(pattern);
    }
  }
  
  return patterns;
}

// ===== Register Hooks =====

export function registerNeuralHooks(): void {
  agenticHookManager.register(preNeuralTrainHook);
  agenticHookManager.register(postNeuralTrainHook);
  agenticHookManager.register(neuralPatternDetectedHook);
  agenticHookManager.register(neuralPredictionHook);
  agenticHookManager.register(neuralAdaptationHook);
}