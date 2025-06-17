const { TestHarness } = require('../test-harness');
const assert = require('assert');
const os = require('os');

describe('Resource Usage Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
  });

  afterEach(() => {
    harness.reset();
    if (global.gc) global.gc(); // Force garbage collection if available
  });

  describe('Memory Usage Patterns', () => {
    it('should maintain stable memory usage during batch operations', async () => {
      const iterations = 5;
      const memorySnapshots = [];
      
      for (let i = 0; i < iterations; i++) {
        // Create and process files
        const fileCount = 100;
        for (let j = 0; j < fileCount; j++) {
          harness.mockFS.set(`iteration${i}_file${j}.txt`, 'x'.repeat(10000)); // 10KB per file
        }
        
        const files = Array.from({ length: fileCount }, (_, j) => `iteration${i}_file${j}.txt`);
        
        const beforeMemory = process.memoryUsage();
        await harness.batchReadFiles(files);
        const afterMemory = process.memoryUsage();
        
        memorySnapshots.push({
          iteration: i,
          before: beforeMemory.heapUsed / 1024 / 1024, // MB
          after: afterMemory.heapUsed / 1024 / 1024,
          delta: (afterMemory.heapUsed - beforeMemory.heapUsed) / 1024 / 1024
        });
        
        // Clean up files from this iteration
        files.forEach(f => harness.mockFS.delete(f));
      }
      
      console.log('\n=== Memory Stability Test ===');
      console.log('Iteration | Before (MB) | After (MB) | Delta (MB)');
      console.log('----------|-------------|------------|------------');
      
      memorySnapshots.forEach(snapshot => {
        console.log(`${snapshot.iteration.toString().padEnd(9)} | ${snapshot.before.toFixed(2).padEnd(11)} | ${snapshot.after.toFixed(2).padEnd(10)} | ${snapshot.delta > 0 ? '+' : ''}${snapshot.delta.toFixed(2)}`);
      });
      
      // Check for memory leaks (memory shouldn't grow significantly)
      const firstSnapshot = memorySnapshots[0];
      const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
      const totalGrowth = lastSnapshot.after - firstSnapshot.before;
      
      assert(totalGrowth < 50, `Memory grew by ${totalGrowth.toFixed(2)}MB, possible leak`);
    });

    it('should efficiently handle large data volumes', async () => {
      const dataSizes = [
        { files: 10, sizeKB: 100 },
        { files: 50, sizeKB: 100 },
        { files: 100, sizeKB: 100 },
        { files: 10, sizeKB: 1000 },
        { files: 50, sizeKB: 1000 }
      ];
      
      const results = [];
      
      for (const config of dataSizes) {
        // Create files
        const content = 'x'.repeat(config.sizeKB * 1024);
        for (let i = 0; i < config.files; i++) {
          harness.mockFS.set(`large${i}.dat`, content);
        }
        
        const files = Array.from({ length: config.files }, (_, i) => `large${i}.dat`);
        const totalDataMB = (config.files * config.sizeKB) / 1024;
        
        const { result, metrics } = await harness.measureResourceUsage(async () => {
          return await harness.batchReadFiles(files);
        });
        
        results.push({
          files: config.files,
          sizePerFile: config.sizeKB,
          totalData: totalDataMB,
          memoryUsed: metrics.memory.heapUsed / 1024 / 1024,
          memoryEfficiency: totalDataMB / (metrics.memory.heapUsed / 1024 / 1024),
          duration: metrics.duration,
          throughputMBps: totalDataMB / (metrics.duration / 1000)
        });
        
        // Clean up
        harness.reset();
      }
      
      console.log('\n=== Large Data Volume Handling ===');
      console.log('Files | Size/File | Total Data | Memory Used | Efficiency | Throughput');
      console.log('------|-----------|------------|-------------|------------|------------');
      
      results.forEach(r => {
        console.log(`${r.files.toString().padEnd(5)} | ${r.sizePerFile.toString().padEnd(9)}KB | ${r.totalData.toFixed(1).padEnd(10)}MB | ${r.memoryUsed.toFixed(1).padEnd(11)}MB | ${r.memoryEfficiency.toFixed(2).padEnd(10)} | ${r.throughputMBps.toFixed(1)}MB/s`);
      });
      
      // Verify memory efficiency
      results.forEach(r => {
        assert(r.memoryEfficiency > 0.5, `Poor memory efficiency: ${r.memoryEfficiency.toFixed(2)}`);
      });
    });
  });

  describe('CPU Usage Optimization', () => {
    it('should distribute CPU load effectively across workers', async () => {
      const cpuIntensiveTasks = Array.from({ length: 20 }, (_, i) => async () => {
        // Simulate CPU-intensive work
        let result = 0;
        const iterations = 1000000;
        for (let j = 0; j < iterations; j++) {
          result += Math.sqrt(j) * Math.sin(j);
        }
        return { task: i, result: result > 0 };
      });
      
      // Test different concurrency levels
      const concurrencyLevels = [1, 2, 4, 8, os.cpus().length];
      const cpuResults = [];
      
      for (const concurrency of concurrencyLevels) {
        harness.concurrencyLimit = concurrency;
        
        const startCPU = process.cpuUsage();
        const startTime = Date.now();
        
        await harness.executeBatch(cpuIntensiveTasks, async (task) => await task());
        
        const endTime = Date.now();
        const endCPU = process.cpuUsage(startCPU);
        
        const wallTime = endTime - startTime;
        const cpuTime = (endCPU.user + endCPU.system) / 1000; // Convert to ms
        const cpuEfficiency = cpuTime / (wallTime * concurrency);
        
        cpuResults.push({
          concurrency,
          wallTime,
          cpuTime,
          cpuEfficiency,
          parallelEfficiency: wallTime * concurrency / (wallTime * concurrencyLevels[0])
        });
      }
      
      console.log('\n=== CPU Load Distribution ===');
      console.log('Concurrency | Wall Time | CPU Time | CPU Efficiency | Parallel Efficiency');
      console.log('------------|-----------|----------|----------------|-------------------');
      
      cpuResults.forEach(r => {
        console.log(`${r.concurrency.toString().padEnd(11)} | ${r.wallTime.toString().padEnd(9)}ms | ${r.cpuTime.toFixed(0).padEnd(8)}ms | ${(r.cpuEfficiency * 100).toFixed(1).padEnd(14)}% | ${(r.parallelEfficiency * 100).toFixed(1)}%`);
      });
      
      // Verify CPU is being utilized effectively
      const optimalConcurrency = cpuResults.find(r => r.concurrency === os.cpus().length);
      assert(optimalConcurrency.cpuEfficiency > 0.5, `Low CPU efficiency: ${(optimalConcurrency.cpuEfficiency * 100).toFixed(1)}%`);
    });

    it('should handle mixed IO and CPU workloads efficiently', async () => {
      const mixedTasks = Array.from({ length: 30 }, (_, i) => {
        const taskType = i % 3 === 0 ? 'io' : i % 3 === 1 ? 'cpu' : 'mixed';
        
        return async () => {
          if (taskType === 'io') {
            // IO-bound task
            await harness.simulateDelay(50);
            const data = await harness.mockReadFile('package.json');
            return { task: i, type: 'io', dataSize: data.length };
          } else if (taskType === 'cpu') {
            // CPU-bound task
            let result = 0;
            for (let j = 0; j < 500000; j++) {
              result += Math.sqrt(j);
            }
            return { task: i, type: 'cpu', result: result > 0 };
          } else {
            // Mixed task
            await harness.simulateDelay(20);
            let result = 0;
            for (let j = 0; j < 250000; j++) {
              result += Math.sqrt(j);
            }
            return { task: i, type: 'mixed', result: result > 0 };
          }
        };
      });
      
      // Add test file
      harness.mockFS.set('package.json', JSON.stringify({ name: 'test', version: '1.0.0' }));
      
      const { result, metrics } = await harness.measureResourceUsage(async () => {
        harness.concurrencyLimit = os.cpus().length;
        return await harness.executeBatch(mixedTasks, async (task) => await task());
      });
      
      const taskTypes = result.successful.reduce((acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      }, {});
      
      console.log('\n=== Mixed Workload Performance ===');
      console.log(`Total tasks: ${mixedTasks.length}`);
      console.log(`Task distribution: IO=${taskTypes.io}, CPU=${taskTypes.cpu}, Mixed=${taskTypes.mixed}`);
      console.log(`Total duration: ${metrics.duration.toFixed(2)}ms`);
      console.log(`CPU time: ${(metrics.cpu.user + metrics.cpu.system).toFixed(2)}ms`);
      console.log(`Memory delta: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Throughput: ${(mixedTasks.length / (metrics.duration / 1000)).toFixed(2)} tasks/s`);
      
      // Verify efficient handling
      const throughput = mixedTasks.length / (metrics.duration / 1000);
      assert(throughput > 50, `Low throughput for mixed workload: ${throughput.toFixed(2)} tasks/s`);
    });
  });

  describe('Resource Limits and Constraints', () => {
    it('should respect memory constraints during batch operations', async () => {
      // Simulate memory-constrained environment
      const memoryLimit = 100; // MB
      const fileSize = 5; // MB per file
      const totalFiles = 50;
      
      // Create large files
      const largeContent = 'x'.repeat(fileSize * 1024 * 1024);
      for (let i = 0; i < totalFiles; i++) {
        harness.mockFS.set(`constrained${i}.dat`, largeContent);
      }
      
      const files = Array.from({ length: totalFiles }, (_, i) => `constrained${i}.dat`);
      
      // Process in batches to stay within memory limit
      const batchSize = Math.floor(memoryLimit / fileSize / 2); // Safety factor of 2
      const batches = [];
      
      for (let i = 0; i < files.length; i += batchSize) {
        batches.push(files.slice(i, i + batchSize));
      }
      
      console.log('\n=== Memory-Constrained Processing ===');
      console.log(`Memory limit: ${memoryLimit}MB`);
      console.log(`File size: ${fileSize}MB`);
      console.log(`Total files: ${totalFiles}`);
      console.log(`Batch size: ${batchSize} files`);
      console.log(`Total batches: ${batches.length}`);
      
      const batchResults = [];
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const beforeMemory = process.memoryUsage();
        
        const result = await harness.batchReadFiles(batch);
        
        const afterMemory = process.memoryUsage();
        const memoryUsed = (afterMemory.heapUsed - beforeMemory.heapUsed) / 1024 / 1024;
        
        batchResults.push({
          batch: i + 1,
          filesProcessed: batch.length,
          memoryUsed,
          withinLimit: memoryUsed < memoryLimit
        });
        
        // Simulate cleanup between batches
        if (global.gc) global.gc();
      }
      
      console.log('\nBatch | Files | Memory Used | Within Limit');
      console.log('------|-------|-------------|-------------');
      
      batchResults.forEach(r => {
        console.log(`${r.batch.toString().padEnd(5)} | ${r.filesProcessed.toString().padEnd(5)} | ${r.memoryUsed.toFixed(2).padEnd(11)}MB | ${r.withinLimit ? 'YES' : 'NO'}`);
      });
      
      // Verify all batches stayed within memory limit
      assert(batchResults.every(r => r.withinLimit), 'Some batches exceeded memory limit');
    });

    it('should handle resource exhaustion gracefully', async () => {
      // Simulate resource exhaustion scenarios
      const scenarios = [
        {
          name: 'High concurrency',
          concurrency: 100,
          tasks: 200,
          expectedBehavior: 'throttle'
        },
        {
          name: 'Large data volume',
          concurrency: 10,
          tasks: 50,
          dataSize: 10000000, // 10MB per task
          expectedBehavior: 'batch'
        },
        {
          name: 'CPU intensive',
          concurrency: os.cpus().length * 2,
          tasks: 50,
          cpuIntensive: true,
          expectedBehavior: 'queue'
        }
      ];
      
      const scenarioResults = [];
      
      for (const scenario of scenarios) {
        harness.concurrencyLimit = scenario.concurrency;
        
        const tasks = Array.from({ length: scenario.tasks }, (_, i) => async () => {
          if (scenario.cpuIntensive) {
            // CPU-intensive work
            let result = 0;
            for (let j = 0; j < 1000000; j++) {
              result += Math.sqrt(j);
            }
            return { task: i, result };
          } else if (scenario.dataSize) {
            // Memory-intensive work
            const data = 'x'.repeat(scenario.dataSize);
            return { task: i, processed: data.length };
          } else {
            // Regular task
            await harness.simulateDelay(10);
            return { task: i };
          }
        });
        
        const startTime = Date.now();
        const startMemory = process.memoryUsage();
        
        try {
          const result = await harness.executeBatch(tasks, async (task) => await task());
          const endTime = Date.now();
          const endMemory = process.memoryUsage();
          
          scenarioResults.push({
            scenario: scenario.name,
            success: true,
            duration: endTime - startTime,
            memoryDelta: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024,
            throughput: scenario.tasks / ((endTime - startTime) / 1000),
            successRate: result.successRate
          });
        } catch (error) {
          scenarioResults.push({
            scenario: scenario.name,
            success: false,
            error: error.message
          });
        }
      }
      
      console.log('\n=== Resource Exhaustion Handling ===');
      console.log('Scenario         | Success | Duration | Memory Δ | Throughput | Success Rate');
      console.log('-----------------|---------|----------|----------|------------|-------------');
      
      scenarioResults.forEach(r => {
        if (r.success) {
          console.log(`${r.scenario.padEnd(16)} | YES     | ${r.duration.toString().padEnd(8)}ms | ${r.memoryDelta.toFixed(1).padEnd(8)}MB | ${r.throughput.toFixed(1).padEnd(10)} | ${(r.successRate * 100).toFixed(1)}%`);
        } else {
          console.log(`${r.scenario.padEnd(16)} | NO      | -        | -        | -          | Error: ${r.error}`);
        }
      });
      
      // All scenarios should complete successfully
      assert(scenarioResults.every(r => r.success), 'Some scenarios failed to handle resource constraints');
    });
  });

  describe('Resource Monitoring', () => {
    it('should track resource usage over time', async () => {
      const duration = 5000; // 5 seconds
      const sampleInterval = 500; // Sample every 500ms
      const samples = [];
      
      // Start background tasks
      const backgroundTasks = Array.from({ length: 100 }, (_, i) => async () => {
        const delay = Math.random() * 200 + 50;
        await harness.simulateDelay(delay);
        
        // Some tasks do more work
        if (i % 5 === 0) {
          let result = 0;
          for (let j = 0; j < 100000; j++) {
            result += Math.sqrt(j);
          }
        }
        
        return { task: i, completed: true };
      });
      
      // Monitor resources while executing tasks
      const monitoring = setInterval(() => {
        const usage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        samples.push({
          timestamp: Date.now(),
          memory: {
            heapUsed: usage.heapUsed / 1024 / 1024,
            heapTotal: usage.heapTotal / 1024 / 1024,
            external: usage.external / 1024 / 1024,
            rss: usage.rss / 1024 / 1024
          },
          cpu: cpuUsage
        });
      }, sampleInterval);
      
      const startTime = Date.now();
      harness.concurrencyLimit = 5;
      
      await harness.executeBatch(backgroundTasks, async (task) => await task());
      
      clearInterval(monitoring);
      const endTime = Date.now();
      
      // Calculate statistics
      const memoryStats = {
        min: Math.min(...samples.map(s => s.memory.heapUsed)),
        max: Math.max(...samples.map(s => s.memory.heapUsed)),
        avg: samples.reduce((sum, s) => sum + s.memory.heapUsed, 0) / samples.length
      };
      
      console.log('\n=== Resource Usage Over Time ===');
      console.log(`Monitoring duration: ${endTime - startTime}ms`);
      console.log(`Samples collected: ${samples.length}`);
      console.log(`\nMemory Usage (MB):`);
      console.log(`  Min: ${memoryStats.min.toFixed(2)}`);
      console.log(`  Max: ${memoryStats.max.toFixed(2)}`);
      console.log(`  Avg: ${memoryStats.avg.toFixed(2)}`);
      console.log(`  Range: ${(memoryStats.max - memoryStats.min).toFixed(2)}`);
      
      // Verify resource usage stayed reasonable
      assert(memoryStats.max - memoryStats.min < 100, 'Memory usage fluctuated too much');
      assert(memoryStats.avg < 200, 'Average memory usage too high');
    });

    it('should provide resource usage predictions', async () => {
      // Test resource usage with different input sizes
      const testSizes = [10, 25, 50, 100, 200];
      const measurements = [];
      
      for (const size of testSizes) {
        // Create tasks of varying complexity
        const tasks = Array.from({ length: size }, (_, i) => async () => {
          const dataSize = 1000 * (i % 10 + 1); // 1-10KB
          const data = 'x'.repeat(dataSize);
          
          await harness.simulateDelay(10);
          
          return {
            task: i,
            processed: data.length,
            result: data.substring(0, 10)
          };
        });
        
        const { result, metrics } = await harness.measureResourceUsage(async () => {
          harness.concurrencyLimit = 10;
          return await harness.executeBatch(tasks, async (task) => await task());
        });
        
        measurements.push({
          inputSize: size,
          duration: metrics.duration,
          memory: metrics.memory.heapUsed / 1024 / 1024,
          throughput: size / (metrics.duration / 1000)
        });
        
        harness.reset();
      }
      
      // Calculate regression for predictions
      const n = measurements.length;
      const sumX = measurements.reduce((sum, m) => sum + m.inputSize, 0);
      const sumY = measurements.reduce((sum, m) => sum + m.duration, 0);
      const sumXY = measurements.reduce((sum, m) => sum + m.inputSize * m.duration, 0);
      const sumX2 = measurements.reduce((sum, m) => sum + m.inputSize * m.inputSize, 0);
      
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      
      console.log('\n=== Resource Usage Scaling ===');
      console.log('Input Size | Duration (ms) | Memory (MB) | Throughput');
      console.log('-----------|---------------|-------------|------------');
      
      measurements.forEach(m => {
        console.log(`${m.inputSize.toString().padEnd(10)} | ${m.duration.toFixed(2).padEnd(13)} | ${m.memory.toFixed(2).padEnd(11)} | ${m.throughput.toFixed(2)}`);
      });
      
      console.log(`\nLinear regression: Duration = ${slope.toFixed(2)} * InputSize + ${intercept.toFixed(2)}`);
      
      // Predict for larger sizes
      const predictions = [500, 1000];
      console.log('\nPredictions:');
      predictions.forEach(size => {
        const predictedDuration = slope * size + intercept;
        console.log(`  ${size} items: ~${predictedDuration.toFixed(0)}ms`);
      });
      
      // Verify linear scaling
      const r2 = measurements.reduce((sum, m) => {
        const predicted = slope * m.inputSize + intercept;
        const error = m.duration - predicted;
        return sum + error * error;
      }, 0);
      
      assert(r2 < 100000, 'Resource usage not scaling linearly');
    });
  });
});