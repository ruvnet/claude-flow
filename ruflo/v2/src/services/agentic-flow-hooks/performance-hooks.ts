/**
 * Performance optimization hooks for agentic-flow
 * 
 * Tracks metrics, identifies bottlenecks, and provides
 * optimization suggestions based on provider performance.
 */

import { agenticHookManager } from './hook-manager.js';
import type {
  AgenticHookContext,
  HookHandlerResult,
  PerformanceHookPayload,
  PerformanceMetric,
  BottleneckAnalysis,
  OptimizationSuggestion,
  SideEffect,
} from './types.js';

// ===== Performance Metric Hook =====

export const performanceMetricHook = {
  id: 'agentic-performance-metric',
  type: 'performance-metric' as const,
  priority: 100,
  handler: async (
    payload: PerformanceHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { metric, value, unit, threshold } = payload;
    
    const sideEffects: SideEffect[] = [];
    
    // Store metric
    const metricData: PerformanceMetric = {
      name: metric,
      value,
      unit,
      timestamp: Date.now(),
      tags: extractTags(payload.context),
    };
    
    context.performance.metrics.set(metric, metricData);
    
    // Check threshold violations
    if (threshold !== undefined) {
      const violated = checkThreshold(value, threshold, payload.context);
      
      if (violated) {
        sideEffects.push({
          type: 'notification',
          action: 'emit',
          data: {
            event: 'performance:threshold:violated',
            data: {
              metric,
              value,
              threshold,
              unit,
            },
          },
        });
        
        // Generate optimization suggestion
        const suggestion = await generateOptimizationSuggestion(
          metric,
          value,
          threshold,
          context
        );
        
        if (suggestion) {
          context.performance.optimizations.push(suggestion);
          sideEffects.push({
            type: 'log',
            action: 'write',
            data: {
              level: 'info',
              message: 'Optimization suggestion generated',
              data: suggestion,
            },
          });
        }
      }
    }
    
    // Update rolling averages
    await updateRollingAverages(metric, value, context);
    
    // Detect anomalies
    const anomaly = await detectAnomaly(metric, value, context);
    if (anomaly) {
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'performance:anomaly:detected',
          data: { metric, value, anomaly },
        },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Performance Bottleneck Hook =====

export const performanceBottleneckHook = {
  id: 'agentic-performance-bottleneck',
  type: 'performance-bottleneck' as const,
  priority: 90,
  handler: async (
    payload: PerformanceHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { bottleneck } = payload;
    
    if (!bottleneck) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Analyze bottleneck severity
    const analysis: BottleneckAnalysis = {
      component: bottleneck.location,
      severity: mapSeverity(bottleneck.severity),
      impact: bottleneck.severity / 10, // Normalize to 0-1
      suggestions: bottleneck.suggestions,
    };
    
    context.performance.bottlenecks.push(analysis);
    
    // Store for historical analysis
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `bottleneck:${analysis.component}:${Date.now()}`,
        value: analysis,
        ttl: 86400, // 24 hours
      },
    });
    
    // Check for recurring bottlenecks
    const recurrence = await checkBottleneckRecurrence(
      analysis.component,
      context
    );
    
    if (recurrence.count > 3) {
      // Recurring bottleneck - escalate
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'performance:bottleneck:recurring',
          data: {
            component: analysis.component,
            occurrences: recurrence.count,
            timespan: recurrence.timespan,
          },
        },
      });
      
      // Generate advanced optimization
      const optimization = await generateAdvancedOptimization(
        analysis,
        recurrence,
        context
      );
      
      if (optimization) {
        context.performance.optimizations.push(optimization);
      }
    }
    
    // Correlate with other metrics
    const correlations = await findMetricCorrelations(
      analysis.component,
      context
    );
    
    if (correlations.length > 0) {
      sideEffects.push({
        type: 'log',
        action: 'write',
        data: {
          level: 'info',
          message: 'Bottleneck correlations found',
          data: { bottleneck: analysis, correlations },
        },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Performance Optimization Hook =====

export const performanceOptimizationHook = {
  id: 'agentic-performance-optimization',
  type: 'performance-optimization' as const,
  priority: 80,
  handler: async (
    payload: PerformanceHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { optimization } = payload;
    
    if (!optimization) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Validate optimization
    const validation = await validateOptimization(optimization, context);
    if (!validation.valid) {
      sideEffects.push({
        type: 'log',
        action: 'write',
        data: {
          level: 'warning',
          message: 'Optimization validation failed',
          data: { optimization, validation },
        },
      });
      return { continue: true, sideEffects };
    }
    
    // Simulate optimization impact
    const simulation = await simulateOptimization(optimization, context);
    
    if (simulation.expectedImprovement < 0.1) {
      // Low impact - skip
      return { continue: true };
    }
    
    // Store optimization recommendation
    const recommendation = {
      optimization,
      simulation,
      timestamp: Date.now(),
      autoApply: optimization.applied && simulation.risk === 'low',
    };
    
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `optimization:${optimization.type}:${Date.now()}`,
        value: recommendation,
        ttl: 604800, // 7 days
      },
    });
    
    // Auto-apply low-risk optimizations
    if (recommendation.autoApply) {
      await applyOptimization(optimization, context);
      
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'performance:optimization:applied',
          data: { optimization, automatic: true },
        },
      });
    } else {
      // Queue for manual review
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'performance:optimization:suggested',
          data: { optimization, simulation },
        },
      });
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Performance Threshold Hook =====

export const performanceThresholdHook = {
  id: 'agentic-performance-threshold',
  type: 'performance-threshold' as const,
  priority: 95,
  handler: async (
    payload: PerformanceHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { metric, value, threshold } = payload;
    
    if (threshold === undefined) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Dynamic threshold adjustment
    const historicalData = await getMetricHistory(metric, context);
    const adjustedThreshold = calculateDynamicThreshold(
      threshold,
      historicalData
    );
    
    if (adjustedThreshold !== threshold) {
      sideEffects.push({
        type: 'log',
        action: 'write',
        data: {
          level: 'info',
          message: 'Threshold dynamically adjusted',
          data: {
            metric,
            original: threshold,
            adjusted: adjustedThreshold,
          },
        },
      });
    }
    
    // Predict threshold violations
    const prediction = await predictThresholdViolation(
      metric,
      value,
      adjustedThreshold,
      historicalData
    );
    
    if (prediction.willViolate && prediction.confidence > 0.7) {
      sideEffects.push({
        type: 'notification',
        action: 'emit',
        data: {
          event: 'performance:threshold:predicted',
          data: {
            metric,
            currentValue: value,
            threshold: adjustedThreshold,
            predictedTime: prediction.timeToViolation,
            confidence: prediction.confidence,
          },
        },
      });
      
      // Proactive optimization
      const proactiveOpt = await generateProactiveOptimization(
        metric,
        prediction,
        context
      );
      
      if (proactiveOpt) {
        context.performance.optimizations.push(proactiveOpt);
      }
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== Helper Functions =====

function extractTags(context: Record<string, any>): string[] {
  const tags: string[] = [];
  
  if (context.provider) tags.push(`provider:${context.provider}`);
  if (context.model) tags.push(`model:${context.model}`);
  if (context.operation) tags.push(`op:${context.operation}`);
  if (context.component) tags.push(`component:${context.component}`);
  
  return tags;
}

function checkThreshold(
  value: number,
  threshold: number,
  context: Record<string, any>
): boolean {
  // Check if threshold is violated based on context
  const operator = context.thresholdOperator || 'gt';
  
  switch (operator) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    case 'ne': return value !== threshold;
    default: return value > threshold;
  }
}

async function generateOptimizationSuggestion(
  metric: string,
  value: number,
  threshold: number,
  context: AgenticHookContext
): Promise<OptimizationSuggestion | null> {
  // Generate optimization based on metric type
  const metricType = getMetricType(metric);
  
  switch (metricType) {
    case 'latency':
      if (value > threshold * 2) {
        return {
          type: 'cache',
          target: metric,
          expectedImprovement: 50,
          implementation: 'Enable response caching for frequently accessed data',
          risk: 'low',
        };
      } else if (value > threshold * 1.5) {
        return {
          type: 'parallel',
          target: metric,
          expectedImprovement: 30,
          implementation: 'Parallelize independent operations',
          risk: 'medium',
        };
      }
      break;
      
    case 'throughput':
      if (value < threshold * 0.5) {
        return {
          type: 'batch',
          target: metric,
          expectedImprovement: 40,
          implementation: 'Batch similar requests together',
          risk: 'low',
        };
      }
      break;
      
    case 'memory':
      if (value > threshold * 0.9) {
        return {
          type: 'resource',
          target: metric,
          expectedImprovement: 20,
          implementation: 'Implement memory pooling and recycling',
          risk: 'medium',
        };
      }
      break;
  }
  
  return null;
}

async function updateRollingAverages(
  metric: string,
  value: number,
  context: AgenticHookContext
): Promise<void> {
  const avgKey = `avg:${metric}`;
  const history = await context.memory.cache.get(avgKey) || [];
  
  history.push({ value, timestamp: Date.now() });
  
  // Keep last 1000 values
  if (history.length > 1000) {
    history.shift();
  }
  
  await context.memory.cache.set(avgKey, history);
}

async function detectAnomaly(
  metric: string,
  value: number,
  context: AgenticHookContext
): Promise<any | null> {
  const avgKey = `avg:${metric}`;
  const history = await context.memory.cache.get(avgKey) || [];
  
  if (history.length < 100) {
    return null; // Not enough data
  }
  
  // Calculate statistics
  const values = history.map((h: any) => h.value);
  const mean = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  const variance = values.reduce((a: number, b: number) => 
    a + Math.pow(b - mean, 2), 0
  ) / values.length;
  const stdDev = Math.sqrt(variance);
  
  // Check if value is anomalous (> 3 standard deviations)
  const zScore = Math.abs((value - mean) / stdDev);
  
  if (zScore > 3) {
    return {
      type: 'statistical',
      zScore,
      mean,
      stdDev,
      severity: zScore > 5 ? 'high' : 'medium',
    };
  }
  
  return null;
}

function mapSeverity(severity: number): BottleneckAnalysis['severity'] {
  if (severity >= 8) return 'critical';
  if (severity >= 6) return 'high';
  if (severity >= 4) return 'medium';
  return 'low';
}

async function checkBottleneckRecurrence(
  component: string,
  context: AgenticHookContext
): Promise<{ count: number; timespan: number }> {
  const historyKey = `bottleneck:history:${component}`;
  const history = await context.memory.cache.get(historyKey) || [];
  
  const now = Date.now();
  const dayAgo = now - 86400000;
  
  // Count occurrences in last 24 hours
  const recentOccurrences = history.filter((h: any) => 
    h.timestamp > dayAgo
  );
  
  return {
    count: recentOccurrences.length,
    timespan: 86400000, // 24 hours in ms
  };
}

async function generateAdvancedOptimization(
  bottleneck: BottleneckAnalysis,
  recurrence: { count: number; timespan: number },
  context: AgenticHookContext
): Promise<OptimizationSuggestion | null> {
  // Generate advanced optimization for recurring bottlenecks
  if (bottleneck.severity === 'critical' && recurrence.count > 5) {
    return {
      type: 'algorithm',
      target: bottleneck.component,
      expectedImprovement: 60,
      implementation: `Redesign ${bottleneck.component} algorithm for better scalability`,
      risk: 'high',
    };
  }
  
  if (bottleneck.severity === 'high' && recurrence.count > 3) {
    return {
      type: 'cache',
      target: bottleneck.component,
      expectedImprovement: 40,
      implementation: `Implement distributed caching for ${bottleneck.component}`,
      risk: 'medium',
    };
  }
  
  return null;
}

async function findMetricCorrelations(
  component: string,
  context: AgenticHookContext
): Promise<Array<{ metric: string; correlation: number }>> {
  const correlations: Array<{ metric: string; correlation: number }> = [];
  
  // Check correlations with other metrics
  for (const [metric, data] of context.performance.metrics) {
    if (data.tags.includes(`component:${component}`)) {
      // Simple correlation check
      correlations.push({
        metric: data.name,
        correlation: 0.7, // Placeholder
      });
    }
  }
  
  return correlations;
}

async function validateOptimization(
  optimization: any,
  context: AgenticHookContext
): Promise<{ valid: boolean; reason?: string }> {
  // Validate optimization is safe to apply
  if (!optimization.type || !optimization.details) {
    return {
      valid: false,
      reason: 'Missing required optimization fields',
    };
  }
  
  // Check risk level
  if (optimization.details === 'high' && !context.metadata.allowHighRisk) {
    return {
      valid: false,
      reason: 'High-risk optimizations not allowed',
    };
  }
  
  return { valid: true };
}

async function simulateOptimization(
  optimization: any,
  context: AgenticHookContext
): Promise<any> {
  // Simulate optimization impact
  const baseline = await getBaselineMetrics(optimization.type, context);
  
  const simulation = {
    expectedImprovement: optimization.improvement || 0.2,
    risk: calculateRisk(optimization),
    affectedMetrics: identifyAffectedMetrics(optimization),
    rollbackPlan: generateRollbackPlan(optimization),
  };
  
  return simulation;
}

async function applyOptimization(
  optimization: any,
  context: AgenticHookContext
): Promise<void> {
  // Apply optimization
  // Placeholder implementation
  const timestamp = Date.now();
  
  // Store optimization application
  await context.memory.cache.set(
    `applied:${optimization.type}:${timestamp}`,
    {
      optimization,
      appliedAt: timestamp,
      appliedBy: 'automatic',
    }
  );
}

async function getMetricHistory(
  metric: string,
  context: AgenticHookContext
): Promise<any[]> {
  const historyKey = `history:${metric}`;
  return await context.memory.cache.get(historyKey) || [];
}

function calculateDynamicThreshold(
  baseThreshold: number,
  historicalData: any[]
): number {
  if (historicalData.length < 50) {
    return baseThreshold; // Not enough data
  }
  
  // Calculate percentile-based threshold
  const values = historicalData
    .map(d => d.value)
    .sort((a, b) => a - b);
  
  const p95 = values[Math.floor(values.length * 0.95)];
  
  // Adjust threshold based on historical performance
  return Math.max(baseThreshold, p95 * 1.1);
}

async function predictThresholdViolation(
  metric: string,
  currentValue: number,
  threshold: number,
  historicalData: any[]
): Promise<any> {
  if (historicalData.length < 10) {
    return {
      willViolate: false,
      confidence: 0,
    };
  }
  
  // Simple linear trend prediction
  const recentValues = historicalData.slice(-10).map(d => d.value);
  const trend = calculateTrend(recentValues);
  
  if (trend > 0 && currentValue > threshold * 0.8) {
    const timeToViolation = (threshold - currentValue) / trend;
    
    return {
      willViolate: true,
      timeToViolation,
      confidence: Math.min(trend * 10, 0.9),
    };
  }
  
  return {
    willViolate: false,
    confidence: 0,
  };
}

async function generateProactiveOptimization(
  metric: string,
  prediction: any,
  context: AgenticHookContext
): Promise<OptimizationSuggestion | null> {
  // Generate proactive optimization to prevent violation
  const metricType = getMetricType(metric);
  
  if (metricType === 'latency' && prediction.timeToViolation < 300000) {
    return {
      type: 'cache',
      target: metric,
      expectedImprovement: 30,
      implementation: 'Preemptively cache high-latency operations',
      risk: 'low',
    };
  }
  
  return null;
}

function getMetricType(metric: string): string {
  if (metric.includes('latency')) return 'latency';
  if (metric.includes('throughput')) return 'throughput';
  if (metric.includes('memory')) return 'memory';
  if (metric.includes('cpu')) return 'cpu';
  return 'unknown';
}

async function getBaselineMetrics(
  type: string,
  context: AgenticHookContext
): Promise<any> {
  // Get baseline metrics for comparison
  // Placeholder implementation
  return {};
}

function calculateRisk(optimization: any): string {
  // Calculate optimization risk level
  if (optimization.type === 'algorithm') return 'high';
  if (optimization.type === 'architecture') return 'high';
  if (optimization.type === 'cache') return 'low';
  if (optimization.type === 'batch') return 'low';
  return 'medium';
}

function identifyAffectedMetrics(optimization: any): string[] {
  // Identify metrics affected by optimization
  const affected: string[] = [];
  
  switch (optimization.type) {
    case 'cache':
      affected.push('latency', 'memory_usage');
      break;
    case 'parallel':
      affected.push('latency', 'cpu_usage', 'throughput');
      break;
    case 'batch':
      affected.push('throughput', 'latency');
      break;
    case 'algorithm':
      affected.push('latency', 'cpu_usage', 'memory_usage');
      break;
  }
  
  return affected;
}

function generateRollbackPlan(optimization: any): any {
  // Generate rollback plan
  return {
    steps: [
      'Capture current metrics',
      'Apply optimization',
      'Monitor for 5 minutes',
      'Rollback if metrics degrade',
    ],
    triggers: {
      errorRate: 0.05,
      latencyIncrease: 1.5,
    },
  };
}

function calculateTrend(values: number[]): number {
  if (values.length < 2) return 0;
  
  // Simple linear regression
  const n = values.length;
  const sumX = values.reduce((a, _, i) => a + i, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((a, b, i) => a + i * b, 0);
  const sumX2 = values.reduce((a, _, i) => a + i * i, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  return slope;
}

// ===== Register Hooks =====

export function registerPerformanceHooks(): void {
  agenticHookManager.register(performanceMetricHook);
  agenticHookManager.register(performanceBottleneckHook);
  agenticHookManager.register(performanceOptimizationHook);
  agenticHookManager.register(performanceThresholdHook);
}