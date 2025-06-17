const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Performance Benchmarks', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('File Operations Performance', () => {
    it('should measure file read performance at different scales', async () => {
      const scales = [10, 50, 100, 200];
      const results = {};
      
      for (const scale of scales) {
        // Create files
        for (let i = 0; i < scale; i++) {
          harness.mockFS.set(`file${i}.txt`, `Content of file ${i}\n`.repeat(100));
        }
        
        const files = Array.from({ length: scale }, (_, i) => `file${i}.txt`);
        
        // Test different concurrency levels
        const concurrencyLevels = [1, 5, 10, 20];
        results[scale] = {};
        
        for (const concurrency of concurrencyLevels) {
          harness.concurrencyLimit = concurrency;
          
          const startTime = performance.now();
          const result = await harness.batchReadFiles(files);
          const endTime = performance.now();
          
          results[scale][concurrency] = {
            duration: endTime - startTime,
            throughput: scale / ((endTime - startTime) / 1000),
            successRate: result.successRate
          };
        }
        
        harness.reset();
      }
      
      // Analyze performance scaling
      console.log('\n=== File Read Performance ===');
      console.log('Scale | Concurrency | Duration (ms) | Throughput (files/s)');
      console.log('------|-------------|---------------|--------------------');
      
      for (const [scale, concurrencyResults] of Object.entries(results)) {
        for (const [concurrency, metrics] of Object.entries(concurrencyResults)) {
          console.log(`${scale.padEnd(5)} | ${concurrency.padEnd(11)} | ${metrics.duration.toFixed(2).padEnd(13)} | ${metrics.throughput.toFixed(2)}`);
        }
      }
      
      // Verify performance improvements
      for (const scale of scales) {
        const sequential = results[scale][1].duration;
        const parallel = results[scale][10].duration;
        const speedup = sequential / parallel;
        
        assert(speedup > 2, `Expected speedup > 2x for ${scale} files, got ${speedup.toFixed(2)}x`);
      }
    });

    it('should measure file write performance with different patterns', async () => {
      const patterns = {
        sequential: async (count) => {
          const files = {};
          for (let i = 0; i < count; i++) {
            files[`seq${i}.txt`] = `Sequential content ${i}`;
          }
          return files;
        },
        bulk: async (count) => {
          const files = {};
          const content = 'Bulk content '.repeat(1000); // Larger files
          for (let i = 0; i < count; i++) {
            files[`bulk${i}.txt`] = content;
          }
          return files;
        },
        mixed: async (count) => {
          const files = {};
          for (let i = 0; i < count; i++) {
            const size = i % 3 === 0 ? 1000 : i % 3 === 1 ? 100 : 10;
            files[`mixed${i}.txt`] = 'x'.repeat(size);
          }
          return files;
        }
      };
      
      const fileCounts = [20, 50, 100];
      const results = {};
      
      for (const pattern of Object.keys(patterns)) {
        results[pattern] = {};
        
        for (const count of fileCounts) {
          const files = await patterns[pattern](count);
          
          const { result, metrics } = await harness.measureResourceUsage(async () => {
            return await harness.batchWriteFiles(files);
          });
          
          results[pattern][count] = {
            duration: metrics.duration,
            throughput: count / (metrics.duration / 1000),
            memoryUsed: metrics.memory.heapUsed / 1024 / 1024, // MB
            successRate: result.successRate
          };
        }
      }
      
      console.log('\n=== File Write Performance ===');
      console.log('Pattern | Count | Duration (ms) | Throughput (files/s) | Memory (MB)');
      console.log('--------|-------|---------------|---------------------|------------');
      
      for (const [pattern, countResults] of Object.entries(results)) {
        for (const [count, metrics] of Object.entries(countResults)) {
          console.log(`${pattern.padEnd(7)} | ${count.padEnd(5)} | ${metrics.duration.toFixed(2).padEnd(13)} | ${metrics.throughput.toFixed(2).padEnd(19)} | ${metrics.memoryUsed.toFixed(2)}`);
        }
      }
    });
  });

  describe('Search Operations Performance', () => {
    it('should benchmark concurrent search operations', async () => {
      // Create a large codebase
      const moduleCount = 100;
      for (let i = 0; i < moduleCount; i++) {
        harness.mockFS.set(`src/module${i}.js`, `
          export class Module${i} {
            constructor() {
              this.logger = new Logger('Module${i}');
              this.config = getConfig();
              this.database = new Database();
            }
            
            async process${i}(data) {
              this.logger.info('Processing data');
              try {
                const result = await this.database.query('SELECT * FROM table${i}');
                return this.transform${i}(result);
              } catch (error) {
                this.logger.error('Process failed', error);
                throw error;
              }
            }
            
            transform${i}(data) {
              return data.map(item => ({
                ...item,
                processed: true,
                timestamp: Date.now()
              }));
            }
          }
        `);
      }
      
      const searchPatterns = [
        'logger',
        'error',
        'async',
        'process\\d+',
        'Database',
        'transform',
        'SELECT.*FROM',
        'constructor'
      ];
      
      // Test different concurrency levels
      const concurrencyTests = [1, 3, 5, 8];
      const results = {};
      
      for (const concurrency of concurrencyTests) {
        harness.concurrencyLimit = concurrency;
        
        const startTime = performance.now();
        const searchResults = await harness.batchSearch(searchPatterns);
        const endTime = performance.now();
        
        const totalMatches = searchResults.successful.reduce((sum, results) => 
          sum + results.reduce((s, r) => s + r.matches, 0), 0
        );
        
        results[concurrency] = {
          duration: endTime - startTime,
          patternsPerSecond: searchPatterns.length / ((endTime - startTime) / 1000),
          totalMatches,
          avgMatchesPerPattern: totalMatches / searchPatterns.length
        };
      }
      
      console.log('\n=== Search Performance ===');
      console.log('Concurrency | Duration (ms) | Patterns/s | Total Matches | Avg Matches/Pattern');
      console.log('------------|---------------|------------|---------------|-------------------');
      
      for (const [concurrency, metrics] of Object.entries(results)) {
        console.log(`${concurrency.padEnd(11)} | ${metrics.duration.toFixed(2).padEnd(13)} | ${metrics.patternsPerSecond.toFixed(2).padEnd(10)} | ${metrics.totalMatches.toString().padEnd(13)} | ${metrics.avgMatchesPerPattern.toFixed(2)}`);
      }
      
      // Verify performance scaling
      const speedup = results[1].duration / results[8].duration;
      assert(speedup > 3, `Expected speedup > 3x, got ${speedup.toFixed(2)}x`);
    });

    it('should measure complex pattern matching performance', async () => {
      // Create files with different content types
      const contentTypes = {
        'code.js': 'function calculate() { return 42; }\nconst result = calculate();\nconsole.log(result);',
        'data.json': '{"users": [{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}], "total": 2}',
        'config.yaml': 'database:\n  host: localhost\n  port: 5432\n  name: myapp',
        'readme.md': '# Project\n\n## Installation\n\n```bash\nnpm install\n```\n\n## Usage\n\nRun with `npm start`'
      };
      
      // Create multiple instances of each type
      const instancesPerType = 25;
      for (const [baseFile, content] of Object.entries(contentTypes)) {
        for (let i = 0; i < instancesPerType; i++) {
          const filename = baseFile.replace('.', `${i}.`);
          harness.mockFS.set(filename, content);
        }
      }
      
      const complexPatterns = [
        { pattern: 'function\\s+\\w+\\s*\\(', description: 'Function declarations' },
        { pattern: '"\\w+":\\s*[\\[{]', description: 'JSON object/array values' },
        { pattern: '^\\s*\\w+:', description: 'YAML keys' },
        { pattern: '```\\w+', description: 'Markdown code blocks' },
        { pattern: '\\b(?:const|let|var)\\s+\\w+', description: 'Variable declarations' }
      ];
      
      const results = await harness.executeBatch(complexPatterns, async (test) => {
        const startTime = performance.now();
        const searchResults = await harness.batchSearch([test.pattern]);
        const endTime = performance.now();
        
        const matches = searchResults.successful[0] || [];
        const totalMatches = matches.reduce((sum, r) => sum + r.matches, 0);
        
        return {
          pattern: test.description,
          regex: test.pattern,
          duration: endTime - startTime,
          filesMatched: matches.length,
          totalMatches,
          avgMatchesPerFile: matches.length > 0 ? totalMatches / matches.length : 0
        };
      });
      
      console.log('\n=== Complex Pattern Performance ===');
      console.log('Pattern              | Duration (ms) | Files Matched | Total Matches | Avg/File');
      console.log('---------------------|---------------|---------------|---------------|----------');
      
      results.successful.forEach(r => {
        console.log(`${r.pattern.padEnd(20)} | ${r.duration.toFixed(2).padEnd(13)} | ${r.filesMatched.toString().padEnd(13)} | ${r.totalMatches.toString().padEnd(13)} | ${r.avgMatchesPerFile.toFixed(2)}`);
      });
    });
  });

  describe('Batch Execution Scalability', () => {
    it('should measure scalability with increasing batch sizes', async () => {
      const batchSizes = [10, 25, 50, 100, 200];
      const results = {};
      
      for (const size of batchSizes) {
        const operations = Array.from({ length: size }, (_, i) => async () => {
          // Simulate varying operation complexity
          const complexity = i % 4;
          const delay = complexity === 0 ? 10 : complexity === 1 ? 20 : complexity === 2 ? 30 : 40;
          await harness.simulateDelay(delay);
          
          return {
            id: i,
            result: `Operation ${i} completed`,
            complexity,
            processingTime: delay
          };
        });
        
        // Test with optimal concurrency
        harness.concurrencyLimit = Math.min(10, Math.ceil(size / 10));
        
        const startTime = performance.now();
        const batchResult = await harness.executeBatch(operations, async (op) => await op());
        const endTime = performance.now();
        
        results[size] = {
          duration: endTime - startTime,
          throughput: size / ((endTime - startTime) / 1000),
          concurrency: harness.concurrencyLimit,
          successRate: batchResult.successRate,
          avgOperationTime: (endTime - startTime) / size
        };
      }
      
      console.log('\n=== Batch Execution Scalability ===');
      console.log('Batch Size | Duration (ms) | Throughput (ops/s) | Concurrency | Avg Op Time (ms)');
      console.log('-----------|---------------|-------------------|-------------|------------------');
      
      for (const [size, metrics] of Object.entries(results)) {
        console.log(`${size.padEnd(10)} | ${metrics.duration.toFixed(2).padEnd(13)} | ${metrics.throughput.toFixed(2).padEnd(17)} | ${metrics.concurrency.toString().padEnd(11)} | ${metrics.avgOperationTime.toFixed(2)}`);
      }
      
      // Verify linear scalability
      const smallBatch = results[25];
      const largeBatch = results[100];
      const scalabilityRatio = (largeBatch.throughput / smallBatch.throughput);
      
      assert(scalabilityRatio > 0.8, `Poor scalability: ${scalabilityRatio.toFixed(2)} (expected > 0.8)`);
    });

    it('should measure memory efficiency at scale', async () => {
      const scales = [
        { operations: 50, dataSize: 1024 },      // 1KB per operation
        { operations: 100, dataSize: 10240 },    // 10KB per operation
        { operations: 200, dataSize: 102400 }    // 100KB per operation
      ];
      
      const results = [];
      
      for (const scale of scales) {
        const operations = Array.from({ length: scale.operations }, (_, i) => async () => {
          // Simulate data processing
          const data = 'x'.repeat(scale.dataSize);
          await harness.simulateDelay(10);
          
          // Transform data (simulate processing)
          return {
            id: i,
            processed: data.length,
            hash: data.substring(0, 10) + '...' + data.substring(data.length - 10)
          };
        });
        
        const { result, metrics } = await harness.measureResourceUsage(async () => {
          return await harness.executeBatch(operations, async (op) => await op());
        });
        
        results.push({
          operations: scale.operations,
          dataSize: scale.dataSize,
          totalDataProcessed: scale.operations * scale.dataSize,
          duration: metrics.duration,
          memoryUsed: metrics.memory.heapUsed,
          memoryEfficiency: (scale.operations * scale.dataSize) / metrics.memory.heapUsed,
          throughput: scale.operations / (metrics.duration / 1000)
        });
      }
      
      console.log('\n=== Memory Efficiency at Scale ===');
      console.log('Ops | Data/Op | Total Data | Duration (ms) | Memory (MB) | Efficiency | Throughput');
      console.log('----|---------|------------|---------------|-------------|------------|------------');
      
      results.forEach(r => {
        console.log(`${r.operations.toString().padEnd(3)} | ${(r.dataSize/1024).toFixed(0).padEnd(7)}KB | ${(r.totalDataProcessed/1024/1024).toFixed(1).padEnd(10)}MB | ${r.duration.toFixed(2).padEnd(13)} | ${(r.memoryUsed/1024/1024).toFixed(2).padEnd(11)} | ${r.memoryEfficiency.toFixed(3).padEnd(10)} | ${r.throughput.toFixed(2)}`);
      });
      
      // Verify memory doesn't grow linearly with data
      const smallScale = results[0];
      const largeScale = results[2];
      const memoryGrowthRatio = largeScale.memoryUsed / smallScale.memoryUsed;
      const dataGrowthRatio = largeScale.totalDataProcessed / smallScale.totalDataProcessed;
      
      assert(memoryGrowthRatio < dataGrowthRatio * 0.5, 
        `Memory growth too high: ${memoryGrowthRatio.toFixed(2)}x for ${dataGrowthRatio.toFixed(2)}x data increase`);
    });
  });

  describe('Real-World Scenario Performance', () => {
    it('should benchmark a complete SPARC workflow', async () => {
      // Simulate a full SPARC workflow with multiple phases
      const workflow = {
        specification: {
          tasks: ['analyze-requirements', 'define-interfaces', 'create-specs'],
          concurrency: 3
        },
        architecture: {
          tasks: ['design-components', 'plan-database', 'define-apis', 'create-diagrams'],
          concurrency: 4
        },
        implementation: {
          tasks: Array.from({ length: 10 }, (_, i) => `implement-module-${i}`),
          concurrency: 5
        },
        testing: {
          tasks: Array.from({ length: 20 }, (_, i) => `test-case-${i}`),
          concurrency: 10
        },
        integration: {
          tasks: ['integrate-modules', 'e2e-tests', 'performance-tests'],
          concurrency: 3
        }
      };
      
      const phaseResults = {};
      const overallStart = performance.now();
      
      for (const [phase, config] of Object.entries(workflow)) {
        harness.concurrencyLimit = config.concurrency;
        
        const phaseTasks = config.tasks.map(task => async () => {
          // Simulate different task complexities
          const complexity = task.includes('test') ? 50 : 
                           task.includes('implement') ? 100 : 
                           task.includes('analyze') ? 150 : 80;
          
          await harness.simulateDelay(complexity);
          
          return {
            task,
            phase,
            duration: complexity,
            status: 'completed'
          };
        });
        
        const phaseStart = performance.now();
        const result = await harness.executeBatch(phaseTasks, async (task) => await task());
        const phaseEnd = performance.now();
        
        phaseResults[phase] = {
          taskCount: config.tasks.length,
          concurrency: config.concurrency,
          duration: phaseEnd - phaseStart,
          throughput: config.tasks.length / ((phaseEnd - phaseStart) / 1000),
          successRate: result.successRate
        };
      }
      
      const overallEnd = performance.now();
      const totalDuration = overallEnd - overallStart;
      
      console.log('\n=== SPARC Workflow Performance ===');
      console.log('Phase          | Tasks | Concurrency | Duration (ms) | Throughput (tasks/s)');
      console.log('---------------|-------|-------------|---------------|--------------------');
      
      for (const [phase, metrics] of Object.entries(phaseResults)) {
        console.log(`${phase.padEnd(14)} | ${metrics.taskCount.toString().padEnd(5)} | ${metrics.concurrency.toString().padEnd(11)} | ${metrics.duration.toFixed(2).padEnd(13)} | ${metrics.throughput.toFixed(2)}`);
      }
      
      console.log(`\nTotal workflow duration: ${totalDuration.toFixed(2)}ms`);
      
      // Calculate theoretical sequential time
      const sequentialTime = Object.values(phaseResults).reduce((sum, phase) => 
        sum + (phase.taskCount * phase.duration / phase.throughput), 0
      );
      
      const workflowSpeedup = sequentialTime / totalDuration;
      console.log(`Workflow speedup: ${workflowSpeedup.toFixed(2)}x`);
      
      assert(workflowSpeedup > 2.5, `Workflow speedup too low: ${workflowSpeedup.toFixed(2)}x`);
    });

    it('should benchmark multi-mode parallel execution', async () => {
      // Simulate running multiple SPARC modes in parallel
      const modes = [
        { name: 'architect', tasks: 5, complexity: 'high' },
        { name: 'code', tasks: 10, complexity: 'medium' },
        { name: 'tdd', tasks: 15, complexity: 'medium' },
        { name: 'debug', tasks: 8, complexity: 'high' },
        { name: 'security', tasks: 12, complexity: 'high' }
      ];
      
      // Sequential execution
      const sequentialStart = performance.now();
      for (const mode of modes) {
        const tasks = Array.from({ length: mode.tasks }, (_, i) => async () => {
          const delay = mode.complexity === 'high' ? 100 : 50;
          await harness.simulateDelay(delay);
          return { mode: mode.name, task: i };
        });
        
        harness.concurrencyLimit = 1;
        await harness.executeBatch(tasks, async (task) => await task());
      }
      const sequentialTime = performance.now() - sequentialStart;
      
      // Parallel execution
      harness.concurrencyLimit = 10;
      const parallelStart = performance.now();
      
      const allTasks = modes.flatMap(mode => 
        Array.from({ length: mode.tasks }, (_, i) => async () => {
          const delay = mode.complexity === 'high' ? 100 : 50;
          await harness.simulateDelay(delay);
          return { mode: mode.name, task: i };
        })
      );
      
      await harness.executeBatch(allTasks, async (task) => await task());
      const parallelTime = performance.now() - parallelStart;
      
      const speedup = sequentialTime / parallelTime;
      
      console.log('\n=== Multi-Mode Parallel Execution ===');
      console.log(`Total tasks: ${allTasks.length}`);
      console.log(`Sequential time: ${sequentialTime.toFixed(2)}ms`);
      console.log(`Parallel time: ${parallelTime.toFixed(2)}ms`);
      console.log(`Speedup: ${speedup.toFixed(2)}x`);
      
      assert(speedup > 5, `Multi-mode speedup too low: ${speedup.toFixed(2)}x`);
    });
  });

  describe('Performance Validation', () => {
    it('should validate claimed performance improvements', async () => {
      const performanceClaims = [
        { operation: 'file-operations', claimedSpeedup: 3 },
        { operation: 'search-operations', claimedSpeedup: 2 },
        { operation: 'multi-mode-execution', claimedSpeedup: 2 },
        { operation: 'batch-processing', claimedSpeedup: 4 }
      ];
      
      const validationResults = [];
      
      for (const claim of performanceClaims) {
        let actualSpeedup = 0;
        
        switch (claim.operation) {
          case 'file-operations':
            // Test file operations
            const fileCount = 50;
            for (let i = 0; i < fileCount; i++) {
              harness.mockFS.set(`test${i}.txt`, `Test content ${i}`);
            }
            const files = Array.from({ length: fileCount }, (_, i) => `test${i}.txt`);
            
            harness.concurrencyLimit = 1;
            const seqFileStart = Date.now();
            await harness.batchReadFiles(files);
            const seqFileTime = Date.now() - seqFileStart;
            
            harness.concurrencyLimit = 10;
            const parFileStart = Date.now();
            await harness.batchReadFiles(files);
            const parFileTime = Date.now() - parFileStart;
            
            actualSpeedup = seqFileTime / parFileTime;
            break;
            
          case 'search-operations':
            // Test search operations
            const patterns = ['test', 'content', '\\d+', 'Test.*content'];
            
            harness.concurrencyLimit = 1;
            const seqSearchStart = Date.now();
            await harness.batchSearch(patterns);
            const seqSearchTime = Date.now() - seqSearchStart;
            
            harness.concurrencyLimit = 4;
            const parSearchStart = Date.now();
            await harness.batchSearch(patterns);
            const parSearchTime = Date.now() - parSearchStart;
            
            actualSpeedup = seqSearchTime / parSearchTime;
            break;
            
          case 'batch-processing':
            // Test generic batch processing
            const operations = Array.from({ length: 40 }, (_, i) => async () => {
              await harness.simulateDelay(25);
              return i * 2;
            });
            
            harness.concurrencyLimit = 1;
            const seqBatchStart = Date.now();
            await harness.executeBatch(operations, async (op) => await op());
            const seqBatchTime = Date.now() - seqBatchStart;
            
            harness.concurrencyLimit = 8;
            const parBatchStart = Date.now();
            await harness.executeBatch(operations, async (op) => await op());
            const parBatchTime = Date.now() - parBatchStart;
            
            actualSpeedup = seqBatchTime / parBatchTime;
            break;
        }
        
        validationResults.push({
          operation: claim.operation,
          claimedSpeedup: claim.claimedSpeedup,
          actualSpeedup: actualSpeedup,
          validated: actualSpeedup >= claim.claimedSpeedup * 0.8, // Allow 20% variance
          variance: ((actualSpeedup - claim.claimedSpeedup) / claim.claimedSpeedup * 100)
        });
        
        harness.reset();
      }
      
      console.log('\n=== Performance Claims Validation ===');
      console.log('Operation           | Claimed | Actual | Validated | Variance');
      console.log('--------------------|---------|--------|-----------|----------');
      
      validationResults.forEach(r => {
        console.log(`${r.operation.padEnd(19)} | ${r.claimedSpeedup.toFixed(1).padEnd(7)}x | ${r.actualSpeedup.toFixed(1).padEnd(6)}x | ${r.validated ? 'YES' : 'NO '.padEnd(9)} | ${r.variance > 0 ? '+' : ''}${r.variance.toFixed(1)}%`);
      });
      
      const validatedCount = validationResults.filter(r => r.validated).length;
      assert(validatedCount >= 3, `Only ${validatedCount}/4 performance claims validated`);
    });
  });
});