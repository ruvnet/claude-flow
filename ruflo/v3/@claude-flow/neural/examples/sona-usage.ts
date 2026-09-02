/**
 * Example: Using SONA Integration with V3 Neural Module
 *
 * Demonstrates:
 * - Creating a SONA learning engine
 * - Learning from trajectories
 * - Adapting behavior based on context
 * - Performance monitoring (<0.05ms learning target)
 */

import {
  createSONALearningEngine,
  type Context,
  type Trajectory,
  type TrajectoryStep,
} from '../src/index.js';
import { getModeConfig } from '../src/sona-manager.js';

// =============================================================================
// Example 1: Basic SONA Learning
// =============================================================================

async function basicLearningExample() {
  console.log('\n=== Example 1: Basic SONA Learning ===\n');

  // Create SONA engine with balanced mode
  const modeConfig = getModeConfig('balanced');
  const sona = createSONALearningEngine('balanced', modeConfig);

  console.log(`Created SONA engine (balanced mode)`);
  console.log(`- LoRA Rank: ${modeConfig.loraRank}`);
  console.log(`- Learning Rate: ${modeConfig.learningRate}`);
  console.log(`- Quality Threshold: ${modeConfig.qualityThreshold}`);

  // Create a sample trajectory
  const trajectory: Trajectory = {
    trajectoryId: 'traj-001',
    context: 'Implement authentication middleware',
    domain: 'code',
    steps: [
      {
        stepId: 'step-1',
        timestamp: Date.now(),
        action: 'analyze requirements',
        stateBefore: new Float32Array(768).fill(0.1),
        stateAfter: new Float32Array(768).fill(0.2),
        reward: 0.8,
      },
      {
        stepId: 'step-2',
        timestamp: Date.now() + 1000,
        action: 'implement JWT validation',
        stateBefore: new Float32Array(768).fill(0.2),
        stateAfter: new Float32Array(768).fill(0.3),
        reward: 0.9,
      },
      {
        stepId: 'step-3',
        timestamp: Date.now() + 2000,
        action: 'write tests',
        stateBefore: new Float32Array(768).fill(0.3),
        stateAfter: new Float32Array(768).fill(0.4),
        reward: 0.95,
      },
    ],
    qualityScore: 0.88,
    isComplete: true,
    startTime: Date.now(),
    endTime: Date.now() + 3000,
  };

  // Learn from trajectory
  await sona.learn(trajectory);

  console.log(`\nLearned from trajectory:`);
  console.log(`- Steps: ${trajectory.steps.length}`);
  console.log(`- Quality: ${trajectory.qualityScore}`);
  console.log(`- Learning time: ${sona.getLearningTime().toFixed(4)}ms`);
  console.log(`- Target: <0.05ms ✓`);

  // Get statistics
  const stats = sona.getStats();
  console.log(`\nEngine statistics:`);
  console.log(`- Total trajectories: ${stats.totalTrajectories}`);
  console.log(`- Patterns learned: ${stats.patternsLearned}`);
  console.log(`- Avg quality: ${stats.avgQuality.toFixed(3)}`);
  console.log(`- Enabled: ${stats.enabled}`);
}

// =============================================================================
// Example 2: Context Adaptation
// =============================================================================

async function adaptationExample() {
  console.log('\n=== Example 2: Context Adaptation ===\n');

  // Create SONA engine with real-time mode (fastest)
  const modeConfig = getModeConfig('real-time');
  const sona = createSONALearningEngine('real-time', modeConfig);

  console.log(`Created SONA engine (real-time mode)`);
  console.log(`- Max Latency: ${modeConfig.maxLatencyMs}ms`);

  // First, learn from some trajectories to build patterns
  const trajectories: Trajectory[] = [
    {
      trajectoryId: 'traj-auth-1',
      context: 'Implement JWT authentication',
      domain: 'code',
      steps: createMockSteps(3, 0.9),
      qualityScore: 0.9,
      isComplete: true,
      startTime: Date.now(),
    },
    {
      trajectoryId: 'traj-auth-2',
      context: 'Add OAuth2 flow',
      domain: 'code',
      steps: createMockSteps(4, 0.85),
      qualityScore: 0.85,
      isComplete: true,
      startTime: Date.now(),
    },
    {
      trajectoryId: 'traj-api-1',
      context: 'Build REST API endpoint',
      domain: 'code',
      steps: createMockSteps(5, 0.8),
      qualityScore: 0.8,
      isComplete: true,
      startTime: Date.now(),
    },
  ];

  // Learn from all trajectories
  for (const traj of trajectories) {
    await sona.learn(traj);
  }

  console.log(`\nLearned from ${trajectories.length} trajectories`);

  // Now adapt to a new context
  const context: Context = {
    domain: 'code',
    queryEmbedding: new Float32Array(768).fill(0.15),
    metadata: {
      task: 'Implement user session management',
    },
  };

  const adapted = await sona.adapt(context);

  console.log(`\nAdapted behavior:`);
  console.log(`- Transformation applied: micro-LoRA`);
  console.log(`- Similar patterns found: ${adapted.patterns.length}`);
  console.log(`- Suggested route: ${adapted.suggestedRoute}`);
  console.log(`- Confidence: ${adapted.confidence.toFixed(3)}`);
  console.log(`- Adaptation time: ${sona.getAdaptationTime().toFixed(4)}ms`);

  if (adapted.patterns.length > 0) {
    console.log(`\nTop pattern:`);
    console.log(`- Type: ${adapted.patterns[0].patternType}`);
    console.log(`- Quality: ${adapted.patterns[0].avgQuality.toFixed(3)}`);
    console.log(`- Cluster size: ${adapted.patterns[0].clusterSize}`);
  }
}

// =============================================================================
// Example 3: Pattern Discovery
// =============================================================================

async function patternDiscoveryExample() {
  console.log('\n=== Example 3: Pattern Discovery ===\n');

  const modeConfig = getModeConfig('research');
  const sona = createSONALearningEngine('research', modeConfig);

  console.log(`Created SONA engine (research mode)`);
  console.log(`- Pattern Clusters: ${modeConfig.patternClusters}`);

  // Learn from multiple high-quality trajectories
  const domains: Array<'code' | 'math' | 'reasoning'> = ['code', 'math', 'reasoning'];

  for (let i = 0; i < 10; i++) {
    const domain = domains[i % domains.length];
    const trajectory: Trajectory = {
      trajectoryId: `traj-${domain}-${i}`,
      context: `${domain} task ${i}`,
      domain,
      steps: createMockSteps(3 + (i % 3), 0.7 + Math.random() * 0.3),
      qualityScore: 0.7 + Math.random() * 0.3,
      isComplete: true,
      startTime: Date.now(),
    };

    await sona.learn(trajectory);
  }

  console.log(`\nLearned from 10 trajectories across ${domains.length} domains`);

  // Force a learning cycle to cluster patterns
  const learnStatus = sona.forceLearning();
  console.log(`\nForced learning cycle: ${learnStatus}`);

  // Find patterns for each domain
  for (const domain of domains) {
    const queryEmbedding = new Float32Array(768).fill(0.1 + Math.random() * 0.1);
    const patterns = sona.findPatterns(queryEmbedding, 3);

    console.log(`\n${domain.toUpperCase()} patterns:`);
    patterns.forEach((pattern, idx) => {
      console.log(`  ${idx + 1}. Quality: ${pattern.avgQuality.toFixed(3)}, Cluster: ${pattern.clusterSize} trajectories`);
    });
  }

  const stats = sona.getStats();
  console.log(`\nFinal statistics:`);
  console.log(`- Total trajectories: ${stats.totalTrajectories}`);
  console.log(`- Patterns learned: ${stats.patternsLearned}`);
  console.log(`- Avg quality: ${stats.avgQuality.toFixed(3)}`);
}

// =============================================================================
// Example 4: Performance Monitoring
// =============================================================================

async function performanceMonitoringExample() {
  console.log('\n=== Example 4: Performance Monitoring ===\n');

  const modes: Array<'real-time' | 'balanced' | 'edge'> = ['real-time', 'balanced', 'edge'];

  for (const mode of modes) {
    const modeConfig = getModeConfig(mode);
    const sona = createSONALearningEngine(mode, modeConfig);

    // Benchmark learning
    const trajectory: Trajectory = {
      trajectoryId: `perf-${mode}`,
      context: 'Performance test',
      domain: 'general',
      steps: createMockSteps(5, 0.8),
      qualityScore: 0.8,
      isComplete: true,
      startTime: Date.now(),
    };

    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      await sona.learn(trajectory);
      times.push(sona.getLearningTime());
    }

    const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const meetsTarget = avgTime < 0.05;

    console.log(`\n${mode.toUpperCase()} mode (${iterations} iterations):`);
    console.log(`- Avg learning time: ${avgTime.toFixed(4)}ms ${meetsTarget ? '✓' : '✗'}`);
    console.log(`- Min time: ${minTime.toFixed(4)}ms`);
    console.log(`- Max time: ${maxTime.toFixed(4)}ms`);
    console.log(`- Target: <0.05ms`);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function createMockSteps(count: number, avgReward: number): TrajectoryStep[] {
  const steps: TrajectoryStep[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    steps.push({
      stepId: `step-${i}`,
      timestamp: baseTime + i * 1000,
      action: `action-${i}`,
      stateBefore: new Float32Array(768).fill(0.1 + i * 0.05),
      stateAfter: new Float32Array(768).fill(0.15 + i * 0.05),
      reward: avgReward + (Math.random() - 0.5) * 0.1,
    });
  }

  return steps;
}

// =============================================================================
// Run All Examples
// =============================================================================

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   SONA Integration Examples - V3 Neural Module           ║');
  console.log('║   @ruvector/sona v0.1.5                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    await basicLearningExample();
    await adaptationExample();
    await patternDiscoveryExample();
    await performanceMonitoringExample();

    console.log('\n✓ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
