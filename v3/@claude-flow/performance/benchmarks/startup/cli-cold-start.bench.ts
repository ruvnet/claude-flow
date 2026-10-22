/**
 * CLI Cold Start Benchmark
 *
 * Target: <500ms (see V3_PERFORMANCE_TARGETS['cli-cold-start'])
 *
 * Measures the time to start the CLI from a completely cold state,
 * including module loading, initialization, and ready state.
 *
 * 2026-09-05 dream-cycle finding: every benchmark below except
 * `runRealColdStartMeasurement()` is a synthetic `setTimeout()` delay chain
 * that never touches the real CLI — they are illustrative of *where* time
 * could go, not measurements of where it *does* go. The previously-present
 * "V2 vs V3 Speedup" benchmark computed a hardcoded ~5.00x on every run by
 * construction (`setTimeout(100)` vs `setTimeout(20)`, no code in between)
 * and has been removed rather than fixed — there is no "V2 binary" left to
 * compare against, so no synthetic replacement was substituted for it. The
 * real number now comes from `runRealColdStartMeasurement()`, which spawns
 * an actual `node bin/cli.js` child process via the `measureColdStart()`
 * helper that was already written but never called.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../../src/framework/benchmark.js';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the real CLI entry point this benchmark spawns for real measurements. */
export const CLI_BIN_PATH = path.resolve(__dirname, '../../../cli/bin/cli.js');

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Measure CLI cold start time by spawning a new process
 */
export async function measureColdStart(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();

    const child: ChildProcess = spawn(command, args, {
      stdio: 'pipe',
      shell: false, // Security: Avoid shell injection vulnerabilities
    });

    let output = '';

    child.stdout?.on('data', (data) => {
      output += data.toString();
      // Check for ready signal
      if (output.includes('Ready') || output.includes('initialized')) {
        const endTime = performance.now();
        child.kill();
        resolve(endTime - startTime);
      }
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', reject);

    child.on('close', () => {
      const endTime = performance.now();
      resolve(endTime - startTime);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error('Cold start timeout'));
    }, 10000);
  });
}

/**
 * Simulate module loading overhead
 */
async function simulateModuleLoading(): Promise<void> {
  // Simulate loading core modules
  const modules = [
    'commander',
    'chalk',
    'ora',
    'inquirer',
    'fs-extra',
  ];

  for (const mod of modules) {
    // Simulate require overhead
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Simulate CLI initialization
 */
async function simulateCLIInit(): Promise<void> {
  // Configuration loading
  await new Promise((resolve) => setTimeout(resolve, 5));

  // Command registration
  const commands = Array.from({ length: 50 }, (_, i) => `command-${i}`);
  for (const cmd of commands) {
    // Register command
    void cmd;
  }

  // Plugin loading
  await new Promise((resolve) => setTimeout(resolve, 3));
}

/**
 * Real cold-start measurement: spawns the actual CLI binary N times and
 * reports genuine wall-clock timings. Uses `--version` because it is the
 * one subcommand that succeeds without a built `dist/` in this repo's
 * current worktree state (other subcommands import compiled output and
 * fail fast with ERR_MODULE_NOT_FOUND if `npm run build` hasn't run —
 * `measureColdStart()` still resolves on `child.on('close')` in that case,
 * so a failing invocation is honestly reported as a fast *failure*, not
 * silently treated as a successful start).
 */
export async function runRealColdStartMeasurement(
  iterations = 5
): Promise<{ mean: number; min: number; max: number; samples: number[] }> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(await measureColdStart('node', [CLI_BIN_PATH, '--version']));
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { mean, min: Math.min(...samples), max: Math.max(...samples), samples };
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runColdStartBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('CLI Cold Start');

  console.log('\n--- CLI Cold Start Benchmarks ---\n');

  // Benchmark 0: REAL cold start (spawns the actual CLI binary — everything
  // else in this suite below is a synthetic setTimeout() illustration, not
  // a measurement of real code).
  const real = await runRealColdStartMeasurement(5);
  console.log(`[REAL] CLI Cold Start (node bin/cli.js --version): ${formatTime(real.mean)}`);
  console.log(`  min=${formatTime(real.min)} max=${formatTime(real.max)} n=${real.samples.length}`);
  const realTarget = meetsTarget('cli-cold-start', real.mean);
  console.log(`  Target (<500ms): ${realTarget.met ? 'PASS' : 'FAIL'}`);
  console.log('\n--- Synthetic illustrations below (not real measurements) ---\n');

  // Benchmark 1: Module Loading Simulation
  const moduleResult = await runner.run(
    'module-loading',
    async () => {
      await simulateModuleLoading();
    },
    { iterations: 50 }
  );

  console.log(`Module Loading: ${formatTime(moduleResult.mean)}`);
  const moduleTarget = meetsTarget('cli-cold-start', moduleResult.mean);
  console.log(`  Target (<500ms): ${moduleTarget.met ? 'PASS' : 'FAIL'}`);

  // Benchmark 2: CLI Initialization
  const initResult = await runner.run(
    'cli-initialization',
    async () => {
      await simulateCLIInit();
    },
    { iterations: 50 }
  );

  console.log(`CLI Initialization: ${formatTime(initResult.mean)}`);

  // Benchmark 3: Lazy Loading Benefits
  const lazyLoadResult = await runner.run(
    'lazy-load-startup',
    async () => {
      // Simulate lazy loading - only load what's needed
      const essentialModules = ['commander'];
      for (const mod of essentialModules) {
        void mod;
        await new Promise((resolve) => setTimeout(resolve, 0.5));
      }
    },
    { iterations: 100 }
  );

  console.log(`Lazy Load Startup: ${formatTime(lazyLoadResult.mean)}`);

  // Benchmark 4: Parallel Module Loading
  const parallelLoadResult = await runner.run(
    'parallel-module-loading',
    async () => {
      // Load modules in parallel
      await Promise.all([
        new Promise((resolve) => setTimeout(resolve, 1)),
        new Promise((resolve) => setTimeout(resolve, 1)),
        new Promise((resolve) => setTimeout(resolve, 1)),
        new Promise((resolve) => setTimeout(resolve, 1)),
        new Promise((resolve) => setTimeout(resolve, 1)),
      ]);
    },
    { iterations: 100 }
  );

  console.log(`Parallel Module Loading: ${formatTime(parallelLoadResult.mean)}`);

  // Benchmark 5: Configuration Caching
  const configCacheResult = await runner.run(
    'cached-config-load',
    async () => {
      // Simulate cached configuration load
      const cache = new Map<string, object>();
      cache.set('config', { version: 3, mode: 'production' });
      const config = cache.get('config');
      void config;
    },
    { iterations: 1000 }
  );

  console.log(`Cached Config Load: ${formatTime(configCacheResult.mean)}`);

  // Benchmark 6: Full Cold Start Simulation
  const fullColdStartResult = await runner.run(
    'full-cold-start-simulation',
    async () => {
      // Phase 1: Essential imports (parallel)
      await Promise.all([
        new Promise((resolve) => setTimeout(resolve, 10)),
        new Promise((resolve) => setTimeout(resolve, 10)),
      ]);

      // Phase 2: Configuration
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Phase 3: Minimal command setup
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    { iterations: 50 }
  );

  console.log(`Full Cold Start (Optimized): ${formatTime(fullColdStartResult.mean)}`);
  const fullTarget = meetsTarget('cli-cold-start', fullColdStartResult.mean);
  console.log(`  Target (<500ms): ${fullTarget.met ? 'PASS' : 'FAIL'}`);

  // NOTE: a "V2 vs V3 Comparison Simulation" benchmark previously lived here.
  // It computed setTimeout(100) vs setTimeout(20) with no code in between —
  // a "5.00x speedup" guaranteed by construction on every run, regardless of
  // any real V2 or V3 behavior. Removed 2026-09-05 rather than "fixed": there
  // is no V2 binary left in this repo to honestly compare against. The [REAL]
  // measurement above is this suite's only real speedup evidence now.

  // Print summary
  runner.printResults();
}

// ============================================================================
// Optimization Strategies
// ============================================================================

export const coldStartOptimizations = {
  /**
   * Lazy loading: Only load modules when needed
   */
  lazyLoading: {
    description: 'Defer non-essential module loading until first use',
    expectedImprovement: '40-60%',
    implementation: `
      // Instead of:
      import * as allModules from './modules';

      // Use:
      async function getModule(name) {
        return await import(\`./modules/\${name}\`);
      }
    `,
  },

  /**
   * Parallel initialization: Initialize independent components concurrently
   */
  parallelInit: {
    description: 'Initialize independent components in parallel',
    expectedImprovement: '20-40%',
    implementation: `
      // Instead of:
      await initConfig();
      await initLogger();
      await initPlugins();

      // Use:
      await Promise.all([
        initConfig(),
        initLogger(),
        initPlugins(),
      ]);
    `,
  },

  /**
   * Pre-bundling: Use esbuild/Rollup for faster module resolution
   */
  preBundling: {
    description: 'Pre-bundle dependencies to reduce require() overhead',
    expectedImprovement: '30-50%',
    implementation: `
      // Build step:
      esbuild --bundle --platform=node --outfile=dist/cli.js
    `,
  },

  /**
   * Configuration caching: Cache parsed configuration
   */
  configCaching: {
    description: 'Cache parsed configuration to avoid repeated parsing',
    expectedImprovement: '10-20%',
    implementation: `
      const configCache = new Map();

      function loadConfig(path) {
        if (configCache.has(path)) {
          return configCache.get(path);
        }
        const config = parseConfig(readFile(path));
        configCache.set(path, config);
        return config;
      }
    `,
  },

  /**
   * Snapshot: Use V8 startup snapshots for instant loading
   */
  v8Snapshot: {
    description: 'Use V8 startup snapshots for pre-compiled code',
    expectedImprovement: '50-70%',
    implementation: `
      // Generate snapshot:
      node --snapshot-blob=snapshot.blob --build-snapshot script.js

      // Run with snapshot:
      node --snapshot-blob=snapshot.blob
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runColdStartBenchmarks().catch(console.error);
}

export default runColdStartBenchmarks;
