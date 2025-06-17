const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Debug Mode Batch Integration Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('complex');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Parallel Diagnostic Analysis', () => {
    it('should run multiple diagnostics concurrently', async () => {
      const diagnosticTypes = [
        { type: 'syntax', severity: 'error' },
        { type: 'type-checking', severity: 'error' },
        { type: 'linting', severity: 'warning' },
        { type: 'complexity', severity: 'info' },
        { type: 'security', severity: 'warning' }
      ];

      // Add files with various issues
      harness.mockFS.set('src/buggy1.ts', `function test() {
        const x = 1
        console.log(x  // Missing closing parenthesis
      }`);
      
      harness.mockFS.set('src/buggy2.ts', `export function calculate(a: number, b: string) {
        return a + b; // Type error
      }`);
      
      harness.mockFS.set('src/buggy3.ts', `const password = "admin123"; // Security issue`);

      const diagnostics = await harness.executeBatch(diagnosticTypes, async (diagnostic) => {
        const files = Array.from(harness.mockFS.keys()).filter(f => f.endsWith('.ts'));
        const issues = [];
        
        for (const file of files) {
          const content = await harness.mockReadFile(file);
          
          if (diagnostic.type === 'syntax' && content.includes('console.log(x')) {
            issues.push({
              file,
              line: 3,
              message: 'Missing closing parenthesis',
              severity: 'error'
            });
          }
          
          if (diagnostic.type === 'type-checking' && content.includes('a + b')) {
            issues.push({
              file,
              line: 2,
              message: "Operator '+' cannot be applied to types 'number' and 'string'",
              severity: 'error'
            });
          }
          
          if (diagnostic.type === 'security' && content.includes('password =')) {
            issues.push({
              file,
              line: 1,
              message: 'Hardcoded password detected',
              severity: 'warning'
            });
          }
        }
        
        return {
          diagnostic: diagnostic.type,
          issueCount: issues.length,
          issues,
          executionTime: Math.random() * 100 + 50
        };
      });

      assert.strictEqual(diagnostics.successful.length, 5);
      const totalIssues = diagnostics.successful.reduce((sum, d) => sum + d.issueCount, 0);
      assert(totalIssues >= 3);
    });

    it('should analyze error patterns across multiple files', async () => {
      // Add files with common error patterns
      const errorPatterns = {
        'src/null-ref.js': `function process(data) {
          return data.value.toString(); // Potential null reference
        }`,
        'src/array-bounds.js': `function getItem(arr, index) {
          return arr[index].name; // Potential undefined access
        }`,
        'src/async-error.js': `async function fetchData() {
          const result = await fetch(url); // Missing error handling
          return result.json();
        }`,
        'src/resource-leak.js': `function readFile() {
          const file = fs.openSync('data.txt');
          // Missing file close
          return fs.readSync(file);
        }`
      };
      
      Object.entries(errorPatterns).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const patternAnalysis = await harness.executeBatch(
        Object.keys(errorPatterns),
        async (file) => {
          const content = await harness.mockReadFile(file);
          const patterns = [];
          
          if (content.includes('.value.') || content.includes('[index].')) {
            patterns.push({ type: 'null-reference', confidence: 0.9 });
          }
          if (content.includes('await') && !content.includes('try')) {
            patterns.push({ type: 'unhandled-promise', confidence: 0.8 });
          }
          if (content.includes('openSync') && !content.includes('closeSync')) {
            patterns.push({ type: 'resource-leak', confidence: 0.95 });
          }
          
          return {
            file,
            patterns,
            riskLevel: patterns.length > 0 ? 'high' : 'low',
            suggestions: patterns.map(p => ({
              pattern: p.type,
              fix: `Add ${p.type === 'null-reference' ? 'null checks' : 
                       p.type === 'unhandled-promise' ? 'try-catch blocks' : 
                       'proper resource cleanup'}`
            }))
          };
        }
      );
      
      assert.strictEqual(patternAnalysis.successful.length, 4);
      const highRiskFiles = patternAnalysis.successful.filter(r => r.riskLevel === 'high');
      assert(highRiskFiles.length >= 3);
    });
  });

  describe('Concurrent Stack Trace Analysis', () => {
    it('should analyze multiple stack traces in parallel', async () => {
      const stackTraces = [
        {
          id: 'error1',
          trace: `TypeError: Cannot read property 'name' of undefined
    at UserService.getUser (src/services/user.service.ts:45:23)
    at AuthController.login (src/controllers/auth.controller.ts:23:34)
    at app.post (src/app.ts:78:12)`
        },
        {
          id: 'error2',
          trace: `ReferenceError: config is not defined
    at Database.connect (src/db/database.ts:12:5)
    at App.initialize (src/app.ts:34:20)
    at Object.<anonymous> (src/index.ts:5:9)`
        },
        {
          id: 'error3',
          trace: `Error: Connection timeout
    at RedisClient.connect (node_modules/redis/lib/client.js:234:15)
    at CacheService.initialize (src/services/cache.service.ts:18:25)
    at App.setupServices (src/app.ts:45:30)`
        }
      ];
      
      const traceAnalysis = await harness.executeBatch(stackTraces, async (error) => {
        const lines = error.trace.split('\n');
        const errorType = lines[0].split(':')[0];
        const stackFrames = lines.slice(1).map(line => {
          const match = line.match(/at (.+) \((.+):(\d+):(\d+)\)/);
          if (match) {
            return {
              function: match[1],
              file: match[2],
              line: parseInt(match[3]),
              column: parseInt(match[4])
            };
          }
          return null;
        }).filter(Boolean);
        
        return {
          errorId: error.id,
          errorType,
          rootCause: stackFrames[0],
          callStack: stackFrames,
          affectedFiles: [...new Set(stackFrames.map(f => f.file))],
          analysis: {
            isUserCode: stackFrames[0].file.startsWith('src/'),
            depth: stackFrames.length,
            pattern: errorType === 'TypeError' ? 'null-safety' : 
                    errorType === 'ReferenceError' ? 'undefined-variable' : 'runtime'
          }
        };
      });
      
      assert.strictEqual(traceAnalysis.successful.length, 3);
      assert(traceAnalysis.successful.every(r => r.callStack.length > 0));
      assert(traceAnalysis.successful.some(r => r.analysis.pattern === 'null-safety'));
    });

    it('should correlate errors across multiple log files', async () => {
      // Simulate log files with errors
      const logFiles = {
        'logs/app-2024-01-15.log': `2024-01-15 10:23:45 ERROR UserService - Failed to fetch user: id=123
2024-01-15 10:23:45 ERROR AuthController - Login failed for user@example.com
2024-01-15 10:24:12 WARN Database - Connection pool exhausted
2024-01-15 10:24:13 ERROR UserService - Database query timeout`,
        'logs/app-2024-01-16.log': `2024-01-16 09:15:22 ERROR UserService - Failed to fetch user: id=456
2024-01-16 09:15:23 ERROR Database - Connection refused
2024-01-16 09:16:45 ERROR AuthController - Token validation failed`,
        'logs/error.log': `ERROR: UserService consistently failing
ERROR: Database connection issues recurring
WARNING: High memory usage detected`
      };
      
      Object.entries(logFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const logAnalysis = await harness.executeBatch(
        Object.keys(logFiles),
        async (logFile) => {
          const content = await harness.mockReadFile(logFile);
          const lines = content.split('\n');
          
          const errors = lines.filter(line => line.includes('ERROR'));
          const warnings = lines.filter(line => line.includes('WARN'));
          
          // Extract error patterns
          const patterns = {};
          errors.forEach(error => {
            const match = error.match(/ERROR (\w+)/);
            if (match) {
              patterns[match[1]] = (patterns[match[1]] || 0) + 1;
            }
          });
          
          return {
            file: logFile,
            errorCount: errors.length,
            warningCount: warnings.length,
            patterns,
            topIssue: Object.entries(patterns)
              .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none',
            timeRange: logFile.includes('2024') ? 
              logFile.match(/\d{4}-\d{2}-\d{2}/)[0] : 'ongoing'
          };
        }
      );
      
      assert.strictEqual(logAnalysis.successful.length, 3);
      
      // Aggregate patterns across all logs
      const allPatterns = {};
      logAnalysis.successful.forEach(log => {
        Object.entries(log.patterns).forEach(([pattern, count]) => {
          allPatterns[pattern] = (allPatterns[pattern] || 0) + count;
        });
      });
      
      assert(allPatterns.UserService >= 3);
      assert(allPatterns.Database >= 2);
    });
  });

  describe('Performance Profiling', () => {
    it('should profile multiple code sections concurrently', async () => {
      const profilingTargets = [
        { function: 'calculatePrimes', iterations: 1000 },
        { function: 'sortLargeArray', iterations: 500 },
        { function: 'processStrings', iterations: 2000 },
        { function: 'recursiveTraversal', iterations: 100 }
      ];
      
      const profiling = await harness.executeBatch(profilingTargets, async (target) => {
        const measurements = [];
        
        // Simulate profiling runs
        for (let i = 0; i < 5; i++) {
          const startTime = performance.now();
          await harness.simulateDelay(Math.random() * 50 + 10);
          const endTime = performance.now();
          
          measurements.push({
            run: i + 1,
            duration: endTime - startTime,
            memoryUsage: Math.random() * 1000000 + 500000 // bytes
          });
        }
        
        const avgDuration = measurements.reduce((sum, m) => sum + m.duration, 0) / measurements.length;
        const avgMemory = measurements.reduce((sum, m) => sum + m.memoryUsage, 0) / measurements.length;
        
        return {
          function: target.function,
          iterations: target.iterations,
          measurements,
          summary: {
            averageDuration: avgDuration.toFixed(2) + 'ms',
            averageMemory: (avgMemory / 1024 / 1024).toFixed(2) + 'MB',
            throughput: (target.iterations / (avgDuration / 1000)).toFixed(2) + ' ops/sec'
          },
          bottleneck: avgDuration > 40 ? 'CPU' : 'none'
        };
      });
      
      assert.strictEqual(profiling.successful.length, 4);
      assert(profiling.successful.every(r => r.measurements.length === 5));
      assert(profiling.successful.some(r => r.bottleneck === 'CPU'));
    });

    it('should detect memory leaks across multiple components', async () => {
      const components = [
        { name: 'CacheManager', type: 'service' },
        { name: 'EventEmitter', type: 'utility' },
        { name: 'ConnectionPool', type: 'infrastructure' },
        { name: 'RequestHandler', type: 'middleware' }
      ];
      
      const memoryAnalysis = await harness.executeBatch(components, async (component) => {
        const memorySnapshots = [];
        
        // Simulate memory growth over time
        for (let i = 0; i < 10; i++) {
          await harness.simulateDelay(20);
          const baseMemory = 1000000; // 1MB base
          let growth = 0;
          
          // Some components have memory leaks
          if (component.name === 'EventEmitter' || component.name === 'ConnectionPool') {
            growth = i * 50000; // 50KB per iteration
          }
          
          memorySnapshots.push({
            iteration: i,
            heapUsed: baseMemory + growth + Math.random() * 10000,
            external: 500000 + Math.random() * 50000
          });
        }
        
        // Analyze memory trend
        const firstSnapshot = memorySnapshots[0].heapUsed;
        const lastSnapshot = memorySnapshots[memorySnapshots.length - 1].heapUsed;
        const growthRate = (lastSnapshot - firstSnapshot) / firstSnapshot;
        
        return {
          component: component.name,
          type: component.type,
          memorySnapshots,
          analysis: {
            initialMemory: (firstSnapshot / 1024 / 1024).toFixed(2) + 'MB',
            finalMemory: (lastSnapshot / 1024 / 1024).toFixed(2) + 'MB',
            growthRate: (growthRate * 100).toFixed(1) + '%',
            hasLeak: growthRate > 0.2,
            severity: growthRate > 0.5 ? 'critical' : growthRate > 0.2 ? 'warning' : 'none'
          }
        };
      });
      
      assert.strictEqual(memoryAnalysis.successful.length, 4);
      const leaks = memoryAnalysis.successful.filter(r => r.analysis.hasLeak);
      assert(leaks.length >= 2);
      assert(leaks.some(l => l.component === 'EventEmitter'));
    });
  });

  describe('Batch Breakpoint Management', () => {
    it('should set breakpoints across multiple files concurrently', async () => {
      const breakpointRequests = [
        { file: 'src/services/auth.service.ts', lines: [23, 45, 67] },
        { file: 'src/controllers/user.controller.ts', lines: [12, 34, 56, 78] },
        { file: 'src/utils/validation.ts', lines: [10, 20, 30] },
        { file: 'src/models/user.model.ts', lines: [5, 15] }
      ];
      
      const breakpointSetting = await harness.executeBatch(breakpointRequests, async (request) => {
        const content = await harness.mockReadFile(request.file);
        const lines = content.split('\n');
        
        const validBreakpoints = request.lines.filter(line => {
          // Simulate checking if line is valid for breakpoint
          return line <= lines.length && lines[line - 1]?.trim().length > 0;
        });
        
        return {
          file: request.file,
          requested: request.lines.length,
          set: validBreakpoints.length,
          breakpoints: validBreakpoints.map(line => ({
            line,
            condition: null,
            hitCount: 0,
            enabled: true
          })),
          failed: request.lines.length - validBreakpoints.length
        };
      });
      
      assert.strictEqual(breakpointSetting.successful.length, 4);
      const totalBreakpoints = breakpointSetting.successful.reduce((sum, r) => sum + r.set, 0);
      assert(totalBreakpoints >= 10);
    });

    it('should evaluate watch expressions in parallel', async () => {
      const watchExpressions = [
        { expression: 'user.name', context: { user: { name: 'John', id: 123 } } },
        { expression: 'items.length', context: { items: [1, 2, 3, 4, 5] } },
        { expression: 'config.debug', context: { config: { debug: true, port: 3000 } } },
        { expression: 'Math.max(a, b)', context: { a: 10, b: 20 } },
        { expression: 'error.message', context: { error: null } }
      ];
      
      const evaluations = await harness.executeBatch(watchExpressions, async (watch) => {
        try {
          // Simulate expression evaluation
          const result = await new Promise((resolve) => {
            setTimeout(() => {
              if (watch.expression === 'user.name') resolve('John');
              else if (watch.expression === 'items.length') resolve(5);
              else if (watch.expression === 'config.debug') resolve(true);
              else if (watch.expression === 'Math.max(a, b)') resolve(20);
              else if (watch.expression === 'error.message') resolve(undefined);
            }, 30);
          });
          
          return {
            expression: watch.expression,
            value: result,
            type: typeof result,
            error: null
          };
        } catch (error) {
          return {
            expression: watch.expression,
            value: undefined,
            type: 'error',
            error: error.message
          };
        }
      });
      
      assert.strictEqual(evaluations.successful.length, 5);
      assert.strictEqual(evaluations.successful[0].value, 'John');
      assert.strictEqual(evaluations.successful[1].value, 5);
      assert.strictEqual(evaluations.successful[4].value, undefined);
    });
  });

  describe('Debug Session Performance', () => {
    it('should demonstrate speedup with parallel debugging operations', async () => {
      const debugOperations = Array.from({ length: 20 }, (_, i) => ({
        id: `op${i}`,
        type: i % 3 === 0 ? 'stackTrace' : i % 3 === 1 ? 'variables' : 'evaluate',
        complexity: Math.random() > 0.5 ? 'high' : 'low'
      }));
      
      // Sequential simulation
      harness.concurrencyLimit = 1;
      const sequentialStart = Date.now();
      await harness.executeBatch(debugOperations, async (op) => {
        const delay = op.complexity === 'high' ? 100 : 50;
        await harness.simulateDelay(delay);
        return { operation: op.id, completed: true };
      });
      const sequentialTime = Date.now() - sequentialStart;
      
      // Parallel execution
      harness.concurrencyLimit = 5;
      const parallelStart = Date.now();
      await harness.executeBatch(debugOperations, async (op) => {
        const delay = op.complexity === 'high' ? 100 : 50;
        await harness.simulateDelay(delay);
        return { operation: op.id, completed: true };
      });
      const parallelTime = Date.now() - parallelStart;
      
      const speedup = sequentialTime / parallelTime;
      assert(speedup > 3, `Expected speedup > 3x, got ${speedup.toFixed(2)}x`);
      
      console.log(`Debug operations speedup: ${speedup.toFixed(2)}x`);
    });
  });
});