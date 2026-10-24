#!/usr/bin/env node
/**
 * Headless Runtime for Background Workers
 * Runs without TTY for daemon processes and scheduled tasks
 *
 * Usage:
 *   npx @claude-flow/cli headless --worker <type>
 *   npx @claude-flow/cli headless --daemon
 *   npx @claude-flow/cli headless --benchmark
 *
 * Environment:
 *   CLAUDE_FLOW_HEADLESS=true
 *   CLAUDE_CODE_HEADLESS=true
 *
 * @module v3/cli/runtime/headless
 */

import { HeadlessWorkerExecutor, HEADLESS_WORKER_TYPES, type HeadlessWorkerType } from '../services/headless-worker-executor.js';
import { WorkerDaemon, getDaemon, startDaemon, stopDaemon } from '../services/worker-daemon.js';
import {
  initializeIntelligence,
  benchmarkAdaptation,
  getIntelligenceStats
} from '../memory/intelligence.js';
import {
  getHNSWStatus,
  batchCosineSim,
  flashAttentionSearch
} from '../memory/memory-initializer.js';

// ============================================================================
// Types
// ============================================================================

interface HeadlessConfig {
  mode: 'worker' | 'daemon' | 'benchmark' | 'status';
  workerType?: HeadlessWorkerType;
  timeout?: number;
  verbose?: boolean;
}

interface BenchmarkResults {
  sona: {
    avgMs: number;
    targetMet: boolean;
  };
  flashAttention: {
    throughputPerMs: number;
    speedup: number;
  };
  hnsw: {
    entriesIndexed: number;
    searchTime: number;
  };
}

// ============================================================================
// Main Runtime
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): HeadlessConfig {
  const args = process.argv.slice(2);
  const config: HeadlessConfig = {
    mode: 'status',
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--worker' || arg === '-w') {
      config.mode = 'worker';
      config.workerType = args[++i] as HeadlessWorkerType;
    } else if (arg === '--daemon' || arg === '-d') {
      config.mode = 'daemon';
    } else if (arg === '--benchmark' || arg === '-b') {
      config.mode = 'benchmark';
    } else if (arg === '--status' || arg === '-s') {
      config.mode = 'status';
    } else if (arg === '--timeout' || arg === '-t') {
      config.timeout = parseInt(args[++i], 10) || 60000;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return config;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Headless Runtime for Claude Flow V3

Usage:
  headless --worker <type>    Run a specific worker
  headless --daemon           Start background daemon
  headless --benchmark        Run performance benchmarks
  headless --status           Show system status

Workers: ${HEADLESS_WORKER_TYPES.join(', ')}

Options:
  -w, --worker <type>   Worker type to run
  -d, --daemon          Run as daemon
  -b, --benchmark       Run benchmarks
  -s, --status          Show status
  -t, --timeout <ms>    Execution timeout (default: 60000)
  -v, --verbose         Verbose output
  -h, --help            Show help

Environment:
  CLAUDE_FLOW_HEADLESS=true   Enable headless mode
  CLAUDE_CODE_HEADLESS=true   Enable Claude Code headless

Examples:
  headless --worker audit --timeout 120000
  headless --daemon
  headless --benchmark
`);
}

/**
 * Run a specific worker
 */
async function runWorker(workerType: HeadlessWorkerType, timeout: number): Promise<void> {
  console.log(`[Headless] Starting worker: ${workerType}`);

  const executor = new HeadlessWorkerExecutor(process.cwd(), {
    maxConcurrent: 1,
    defaultTimeoutMs: timeout
  });

  try {
    const result = await executor.execute(workerType, {
      timeoutMs: timeout,
      model: 'sonnet',
      sandbox: 'permissive'
    });

    if (result.success) {
      console.log(`[Headless] Worker ${workerType} completed successfully`);
      console.log(`[Headless] Duration: ${result.durationMs}ms`);
      if (result.output) {
        console.log(`[Headless] Output: ${JSON.stringify(result.output).slice(0, 500)}...`);
      }
    } else {
      console.error(`[Headless] Worker ${workerType} failed: ${result.error}`);
      process.exit(1);
    }
  } finally {
    // executor doesn't have shutdown, just let it be garbage collected
  }
}

/**
 * Run daemon mode
 */
async function runDaemon(): Promise<void> {
  console.log('[Headless] Starting daemon mode...');

  // Start the daemon
  const daemon = await startDaemon(process.cwd());

  console.log('[Headless] Daemon started');
  console.log('[Headless] Press Ctrl+C to stop');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Headless] Shutting down daemon...');
    await stopDaemon();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Headless] Received SIGTERM, shutting down...');
    await stopDaemon();
    process.exit(0);
  });

  // Keep process running
  await new Promise(() => {});
}

/**
 * Run benchmarks
 */
async function runBenchmarks(): Promise<BenchmarkResults> {
  console.log('=== Claude Flow V3 Performance Benchmarks ===\n');

  // Initialize intelligence
  await initializeIntelligence();

  // SONA Benchmark
  console.log('1. SONA Adaptation Benchmark (10,000 iterations)...');
  const sonaResult = benchmarkAdaptation(10000);
  console.log(`   Average: ${sonaResult.avgMs.toFixed(4)}ms`);
  console.log(`   Target (<0.05ms): ${sonaResult.targetMet ? '✅ ACHIEVED' : '❌ NOT MET'}`);

  // Flash Attention Benchmark
  console.log('\n2. Flash Attention Search Benchmark...');
  const dim = 384;
  const count = 10000;
  const query = new Float32Array(dim).map(() => Math.random() - 0.5);
  const vectors = Array.from({ length: count }, () =>
    new Float32Array(dim).map(() => Math.random() - 0.5)
  );

  // Warmup
  flashAttentionSearch(query, vectors, { k: 10 });

  const flashStart = performance.now();
  for (let i = 0; i < 10; i++) {
    flashAttentionSearch(query, vectors, { k: 10 });
  }
  const flashTime = (performance.now() - flashStart) / 10;
  const throughput = count / flashTime;

  // Brute force comparison
  const bruteStart = performance.now();
  for (let i = 0; i < 10; i++) {
    const scores = batchCosineSim(query, vectors);
    Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, 10);
  }
  const bruteTime = (performance.now() - bruteStart) / 10;
  const speedup = bruteTime / flashTime;

  console.log(`   Throughput: ${throughput.toFixed(0)} vectors/ms`);
  console.log(`   Time for 10k vectors: ${flashTime.toFixed(2)}ms`);
  console.log(`   Speedup vs brute force: ${speedup.toFixed(2)}x`);

  // HNSW Status
  console.log('\n3. HNSW Index Status...');
  const hnswStatus = getHNSWStatus();
  console.log(`   Entries indexed: ${hnswStatus.entryCount}`);
  console.log(`   Initialized: ${hnswStatus.initialized}`);

  // Intelligence Stats
  console.log('\n4. Intelligence System Stats...');
  const stats = getIntelligenceStats();
  console.log(`   SONA enabled: ${stats.sonaEnabled}`);
  console.log(`   Patterns learned: ${stats.patternsLearned}`);
  console.log(`   Avg adaptation time: ${stats.avgAdaptationTime.toFixed(4)}ms`);

  console.log('\n=== Benchmark Complete ===');

  return {
    sona: {
      avgMs: sonaResult.avgMs,
      targetMet: sonaResult.targetMet
    },
    flashAttention: {
      throughputPerMs: throughput,
      speedup
    },
    hnsw: {
      entriesIndexed: hnswStatus.entryCount,
      searchTime: flashTime
    }
  };
}

/**
 * Show system status
 */
async function showStatus(): Promise<void> {
  console.log('=== Claude Flow V3 System Status ===\n');

  // Check daemon
  const daemon = getDaemon();
  console.log('Daemon:');
  if (daemon) {
    const status = daemon.getStatus();
    console.log(`  Running: ${status.running}`);
    console.log(`  PID: ${status.pid}`);
    console.log(`  Workers: ${status.workers.size}`);
  } else {
    console.log('  Not initialized');
  }

  // Intelligence
  const stats = getIntelligenceStats();
  console.log('\nIntelligence:');
  console.log(`  SONA enabled: ${stats.sonaEnabled}`);
  console.log(`  ReasoningBank size: ${stats.reasoningBankSize}`);
  console.log(`  Patterns learned: ${stats.patternsLearned}`);

  // HNSW
  const hnsw = getHNSWStatus();
  console.log('\nHNSW Index:');
  console.log(`  Initialized: ${hnsw.initialized}`);
  console.log(`  Entries: ${hnsw.entryCount}`);

  console.log('\nEnvironment:');
  console.log(`  CLAUDE_FLOW_HEADLESS: ${process.env.CLAUDE_FLOW_HEADLESS || 'not set'}`);
  console.log(`  CLAUDE_CODE_HEADLESS: ${process.env.CLAUDE_CODE_HEADLESS || 'not set'}`);
  console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Set headless environment
  process.env.CLAUDE_FLOW_HEADLESS = 'true';

  const config = parseArgs();

  try {
    switch (config.mode) {
      case 'worker':
        if (!config.workerType || !HEADLESS_WORKER_TYPES.includes(config.workerType)) {
          console.error(`Invalid worker type. Available: ${HEADLESS_WORKER_TYPES.join(', ')}`);
          process.exit(1);
        }
        await runWorker(config.workerType, config.timeout || 60000);
        break;

      case 'daemon':
        await runDaemon();
        break;

      case 'benchmark':
        await runBenchmarks();
        break;

      case 'status':
      default:
        await showStatus();
        break;
    }
  } catch (error) {
    console.error('[Headless] Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);

export { main, runWorker, runDaemon, runBenchmarks, showStatus };
export type { HeadlessConfig, BenchmarkResults };
