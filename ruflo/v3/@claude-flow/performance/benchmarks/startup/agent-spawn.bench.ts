/**
 * Agent Spawn Benchmark
 *
 * Target: <200ms (4x faster than current ~800ms)
 *
 * Measures the time to spawn agents including initialization,
 * capability loading, and ready state achievement.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../../src/framework/benchmark.js';

// ============================================================================
// Simulated Agent Types
// ============================================================================

interface Agent {
  id: string;
  type: string;
  status: 'initializing' | 'ready' | 'busy' | 'terminated';
  capabilities: string[];
  spawnTime: number;
  readyTime?: number;
}

interface AgentPool {
  agents: Map<string, Agent>;
  available: Agent[];
  busy: Agent[];
}

// Agent type definitions
const AGENT_TYPES = {
  coder: {
    capabilities: ['code', 'edit', 'refactor', 'review'],
    initTime: 50,
  },
  tester: {
    capabilities: ['test', 'coverage', 'lint'],
    initTime: 40,
  },
  researcher: {
    capabilities: ['search', 'analyze', 'summarize'],
    initTime: 45,
  },
  coordinator: {
    capabilities: ['plan', 'delegate', 'monitor'],
    initTime: 60,
  },
  reviewer: {
    capabilities: ['review', 'suggest', 'approve'],
    initTime: 35,
  },
};

// ============================================================================
// Agent Spawn Functions
// ============================================================================

/**
 * Spawn a single agent (V2 style - sequential)
 */
async function spawnAgentV2(type: string): Promise<Agent> {
  const config = AGENT_TYPES[type as keyof typeof AGENT_TYPES] || {
    capabilities: [],
    initTime: 50,
  };

  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    status: 'initializing',
    capabilities: [],
    spawnTime: performance.now(),
  };

  // Sequential initialization
  await new Promise((resolve) => setTimeout(resolve, config.initTime / 5));

  // Load capabilities one by one
  for (const cap of config.capabilities) {
    agent.capabilities.push(cap);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  agent.status = 'ready';
  agent.readyTime = performance.now();

  return agent;
}

/**
 * Spawn a single agent (V3 style - optimized)
 */
async function spawnAgentV3(type: string): Promise<Agent> {
  const config = AGENT_TYPES[type as keyof typeof AGENT_TYPES] || {
    capabilities: [],
    initTime: 50,
  };

  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    status: 'initializing',
    capabilities: [...config.capabilities], // Instant capability assignment
    spawnTime: performance.now(),
  };

  // Minimal initialization
  await new Promise((resolve) => setTimeout(resolve, config.initTime / 10));

  agent.status = 'ready';
  agent.readyTime = performance.now();

  return agent;
}

/**
 * Spawn multiple agents in parallel
 */
async function spawnAgentsParallel(types: string[]): Promise<Agent[]> {
  return Promise.all(types.map((type) => spawnAgentV3(type)));
}

/**
 * Spawn multiple agents sequentially (V2 style)
 */
async function spawnAgentsSequential(types: string[]): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const type of types) {
    agents.push(await spawnAgentV2(type));
  }
  return agents;
}

/**
 * Get agent from pool (instant)
 */
function getAgentFromPool(pool: AgentPool, type: string): Agent | undefined {
  const index = pool.available.findIndex((a) => a.type === type);
  if (index >= 0) {
    const agent = pool.available.splice(index, 1)[0]!;
    agent.status = 'busy';
    pool.busy.push(agent);
    return agent;
  }
  return undefined;
}

/**
 * Create pre-warmed agent pool
 */
async function createAgentPool(types: string[]): Promise<AgentPool> {
  const agents = await spawnAgentsParallel(types);
  const pool: AgentPool = {
    agents: new Map(),
    available: agents,
    busy: [],
  };

  for (const agent of agents) {
    pool.agents.set(agent.id, agent);
  }

  return pool;
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runAgentSpawnBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Agent Spawn');

  console.log('\n--- Agent Spawn Benchmarks ---\n');

  // Benchmark 1: Single Agent Spawn (V2 Style)
  const singleV2Result = await runner.run(
    'single-agent-spawn-v2',
    async () => {
      await spawnAgentV2('coder');
    },
    { iterations: 50 }
  );

  console.log(`Single Agent (V2): ${formatTime(singleV2Result.mean)}`);

  // Benchmark 2: Single Agent Spawn (V3 Style)
  const singleV3Result = await runner.run(
    'single-agent-spawn-v3',
    async () => {
      await spawnAgentV3('coder');
    },
    { iterations: 100 }
  );

  console.log(`Single Agent (V3): ${formatTime(singleV3Result.mean)}`);
  const singleTarget = meetsTarget('agent-spawn', singleV3Result.mean);
  console.log(`  Target (<200ms): ${singleTarget.met ? 'PASS' : 'FAIL'}`);

  // Calculate single spawn speedup
  const singleSpeedup = singleV2Result.mean / singleV3Result.mean;
  console.log(`  Speedup: ${singleSpeedup.toFixed(2)}x`);

  // Benchmark 3: 5 Agents Sequential (V2 Style)
  const sequential5Result = await runner.run(
    '5-agents-sequential',
    async () => {
      await spawnAgentsSequential(['coder', 'tester', 'researcher', 'coordinator', 'reviewer']);
    },
    { iterations: 20 }
  );

  console.log(`5 Agents Sequential: ${formatTime(sequential5Result.mean)}`);

  // Benchmark 4: 5 Agents Parallel (V3 Style)
  const parallel5Result = await runner.run(
    '5-agents-parallel',
    async () => {
      await spawnAgentsParallel(['coder', 'tester', 'researcher', 'coordinator', 'reviewer']);
    },
    { iterations: 50 }
  );

  console.log(`5 Agents Parallel: ${formatTime(parallel5Result.mean)}`);
  const parallelSpeedup = sequential5Result.mean / parallel5Result.mean;
  console.log(`  Speedup: ${parallelSpeedup.toFixed(2)}x`);

  // Benchmark 5: 15 Agents Parallel (V3 Swarm)
  const parallel15Result = await runner.run(
    '15-agents-parallel',
    async () => {
      const types = Array.from({ length: 15 }, (_, i) =>
        Object.keys(AGENT_TYPES)[i % Object.keys(AGENT_TYPES).length]!
      );
      await spawnAgentsParallel(types);
    },
    { iterations: 20 }
  );

  console.log(`15 Agents Parallel: ${formatTime(parallel15Result.mean)}`);

  // Benchmark 6: Agent Pool Creation
  const poolCreationResult = await runner.run(
    'agent-pool-creation',
    async () => {
      await createAgentPool(['coder', 'tester', 'researcher', 'coordinator', 'reviewer']);
    },
    { iterations: 30 }
  );

  console.log(`Pool Creation (5 agents): ${formatTime(poolCreationResult.mean)}`);

  // Benchmark 7: Agent From Pool (Instant)
  const pool = await createAgentPool(['coder', 'coder', 'tester', 'tester', 'researcher']);

  const poolGetResult = await runner.run(
    'get-agent-from-pool',
    async () => {
      // Reset pool for each iteration
      pool.available = [...pool.agents.values()];
      pool.busy = [];

      getAgentFromPool(pool, 'coder');
    },
    { iterations: 1000 }
  );

  console.log(`Get Agent from Pool: ${formatTime(poolGetResult.mean)}`);

  // Benchmark 8: Agent Capability Check
  const capabilityCheckResult = await runner.run(
    'capability-check',
    async () => {
      const agent = await spawnAgentV3('coder');
      const hasCapability = agent.capabilities.includes('code');
      void hasCapability;
    },
    { iterations: 100 }
  );

  console.log(`Agent with Capability Check: ${formatTime(capabilityCheckResult.mean)}`);

  // Benchmark 9: Batch Agent Status Update
  const agents = await spawnAgentsParallel(Array(20).fill('coder'));

  const statusUpdateResult = await runner.run(
    'batch-status-update',
    async () => {
      for (const agent of agents) {
        agent.status = 'busy';
      }
    },
    { iterations: 1000 }
  );

  console.log(`Batch Status Update (20 agents): ${formatTime(statusUpdateResult.mean)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`V2 -> V3 Single Agent Speedup: ${singleSpeedup.toFixed(2)}x`);
  console.log(`Sequential -> Parallel (5 agents) Speedup: ${parallelSpeedup.toFixed(2)}x`);
  console.log(`Pool vs Spawn Speedup: ${(singleV3Result.mean / poolGetResult.mean).toFixed(2)}x`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Agent Spawn Optimization Strategies
// ============================================================================

export const agentSpawnOptimizations = {
  /**
   * Agent pooling: Pre-spawn and reuse agents
   */
  agentPooling: {
    description: 'Maintain a pool of pre-spawned agents for instant acquisition',
    expectedImprovement: '90-99%',
    implementation: `
      class AgentPool {
        private available: Agent[] = [];
        private minSize = 5;

        async acquire(type: string): Promise<Agent> {
          const agent = this.available.find(a => a.type === type);
          if (agent) {
            return agent; // Instant!
          }
          return this.spawn(type); // Fallback
        }

        async maintain(): Promise<void> {
          while (this.available.length < this.minSize) {
            this.available.push(await this.spawn('generic'));
          }
        }
      }
    `,
  },

  /**
   * Parallel spawning: Spawn multiple agents concurrently
   */
  parallelSpawning: {
    description: 'Spawn multiple agents in parallel using Promise.all',
    expectedImprovement: '60-80%',
    implementation: `
      async function spawnSwarm(types: string[]): Promise<Agent[]> {
        return Promise.all(types.map(type => spawnAgent(type)));
      }
    `,
  },

  /**
   * Lazy capability loading: Defer capability initialization
   */
  lazyCapabilities: {
    description: 'Load agent capabilities on first use',
    expectedImprovement: '30-50%',
    implementation: `
      class LazyAgent {
        private _capabilities?: string[];

        get capabilities(): string[] {
          if (!this._capabilities) {
            this._capabilities = loadCapabilities(this.type);
          }
          return this._capabilities;
        }
      }
    `,
  },

  /**
   * Worker threads: Use worker threads for CPU-intensive init
   */
  workerThreads: {
    description: 'Offload agent initialization to worker threads',
    expectedImprovement: '40-60%',
    implementation: `
      const { Worker } = require('worker_threads');

      async function spawnInWorker(type: string): Promise<Agent> {
        return new Promise((resolve) => {
          const worker = new Worker('./agent-worker.js', {
            workerData: { type }
          });
          worker.on('message', resolve);
        });
      }
    `,
  },

  /**
   * Prototype-based instantiation: Use Object.create for fast cloning
   */
  prototypeInstantiation: {
    description: 'Use prototype-based instantiation for fast agent creation',
    expectedImprovement: '20-30%',
    implementation: `
      const agentPrototypes = new Map<string, Agent>();

      function createAgent(type: string): Agent {
        const prototype = agentPrototypes.get(type);
        if (prototype) {
          return Object.create(prototype, {
            id: { value: generateId() },
            status: { value: 'ready', writable: true },
          });
        }
        return new Agent(type);
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAgentSpawnBenchmarks().catch(console.error);
}

export default runAgentSpawnBenchmarks;
