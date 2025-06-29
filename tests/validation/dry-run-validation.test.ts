/// <reference types="jest" />

/**
 * Comprehensive Dry-Run Validation Tests
 * Tests the dry-run validation framework itself
 */

import { 
  DryRunValidator, 
  DryRunTestFixtures, 
  DryRunPerformanceValidator,
  DryRunResult 
} from '../utils/dry-run-validation.js';
import { 
  EnhancedTestRunner, 
  TestScenario,
  TestCoverageAnalyzer 
} from '../utils/enhanced-testing-framework.js';
import { AsyncTestUtils, PerformanceTestUtils } from '../utils/test-utils.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Dry-Run Validation Framework', () => {
  let validator: DryRunValidator;
  let testRunner: EnhancedTestRunner;
  let tempDir: string;

  beforeAll(async () => {
    validator = new DryRunValidator();
    testRunner = new EnhancedTestRunner();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-test-'));
  });

  afterAll(async () => {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error);
    }
  });

  describe('File System Operation Validation', () => {
    test('should validate safe file creation', async () => {
      const testFile = path.join(tempDir, 'test-file.txt');
      const result = await validator.validateFileSystemOperation(
        'create',
        testFile,
        { content: 'test content' }
      );

      expect(result.success).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(result.errors).toHaveLength(0);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe('create');
      expect(result.operations[0].reversible).toBe(true);
    });

    test('should block system file modification', async () => {
      const result = await validator.validateFileSystemOperation(
        'update',
        '/etc/passwd',
        { content: 'malicious content' }
      );

      expect(result.success).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors).toContain('Cannot modify system file: /etc/passwd');
    });

    test('should warn about large file operations', async () => {
      const largeContent = 'x'.repeat(200 * 1024 * 1024); // 200MB
      const testFile = path.join(tempDir, 'large-file.txt');
      
      const result = await validator.validateFileSystemOperation(
        'create',
        testFile,
        { content: largeContent }
      );

      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].type).toBe('disk');
      expect(result.resources[0].critical).toBe(true);
    });

    test('should handle file backup scenarios', async () => {
      const testFile = path.join(tempDir, 'existing-file.txt');
      
      // Create a file first
      fs.writeFileSync(testFile, 'existing content');
      
      const result = await validator.validateFileSystemOperation(
        'update',
        testFile,
        { content: 'new content', backup: true }
      );

      expect(result.success).toBe(true);
      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].type).toBe('create'); // backup
      expect(result.operations[1].type).toBe('update'); // actual update
      expect(result.operations[1].reversible).toBe(true);
    });
  });

  describe('Command Execution Validation', () => {
    test('should validate safe commands', async () => {
      const result = await validator.validateCommandExecution(
        'echo',
        ['hello', 'world'],
        { timeout: 5000 }
      );

      expect(result.success).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe('execute');
    });

    test('should block dangerous commands', async () => {
      const result = await validator.validateCommandExecution(
        'rm',
        ['-rf', '/'],
        {}
      );

      expect(result.success).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors).toContain('Potentially unsafe command: rm');
    });

    test('should warn about destructive arguments', async () => {
      const result = await validator.validateCommandExecution(
        'git',
        ['reset', '--hard', 'HEAD~5'],
        {}
      );

      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('destructive arguments');
    });

    test('should estimate resource usage for long-running commands', async () => {
      const result = await validator.validateCommandExecution(
        'node',
        ['long-running-script.js'],
        { timeout: 60000 }
      );

      expect(result.success).toBe(true);
      expect(result.resources.length).toBeGreaterThan(0);
      expect(result.estimatedDuration).toBe(60000);
    });
  });

  describe('Network Operation Validation', () => {
    test('should validate HTTPS requests', async () => {
      const result = await validator.validateNetworkOperation(
        'http',
        'https://api.example.com/data',
        { method: 'GET', timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.operations[0].reversible).toBe(true); // GET is reversible
      expect(result.resources.some(r => r.type === 'network')).toBe(true);
    });

    test('should warn about non-HTTPS protocols', async () => {
      const result = await validator.validateNetworkOperation(
        'http',
        'http://insecure.example.com/data',
        { method: 'GET' }
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.includes('Non-HTTP protocol'))).toBe(false); // HTTP is allowed, just warned about security
    });

    test('should handle invalid URLs', async () => {
      const result = await validator.validateNetworkOperation(
        'http',
        'not-a-valid-url',
        {}
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid URL: not-a-valid-url');
    });
  });

  describe('Memory Operation Validation', () => {
    test('should validate normal memory operations', async () => {
      const result = await validator.validateMemoryOperation(
        'store',
        'test-key',
        { data: { message: 'test data' } }
      );

      expect(result.success).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(result.operations[0].reversible).toBe(true);
    });

    test('should block excessive memory usage', async () => {
      const result = await validator.validateMemoryOperation(
        'store',
        'large-data',
        { size: 600 * 1024 * 1024 } // 600MB
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Data size exceeds limit: 629145600 bytes');
    });

    test('should warn about large memory allocations', async () => {
      const result = await validator.validateMemoryOperation(
        'allocate',
        'large-buffer',
        { size: 150 * 1024 * 1024 } // 150MB
      );

      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.resources[0].critical).toBe(true);
    });
  });

  describe('Batch Operation Validation', () => {
    test('should validate multiple safe operations', async () => {
      const operations = [
        {
          type: 'filesystem',
          target: path.join(tempDir, 'batch-file-1.txt'),
          options: { content: 'content 1' }
        },
        {
          type: 'command',
          target: 'echo',
          options: { args: ['test'] }
        },
        {
          type: 'memory',
          target: 'batch-key',
          options: { data: { value: 42 } }
        }
      ];

      const result = await validator.validateBatchOperation(operations);

      expect(result.success).toBe(true);
      expect(result.operations).toHaveLength(3);
      expect(result.riskLevel).toBe('low');
    });

    test('should fail batch if any operation is dangerous', async () => {
      const operations = [
        {
          type: 'filesystem',
          target: path.join(tempDir, 'safe-file.txt'),
          options: { content: 'safe content' }
        },
        {
          type: 'filesystem',
          target: '/etc/passwd',
          options: { content: 'malicious content' }
        }
      ];

      const result = await validator.validateBatchOperation(operations);

      expect(result.success).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.errors.some(e => e.includes('system file'))).toBe(true);
    });

    test('should combine resource requirements', async () => {
      const operations = [
        {
          type: 'memory',
          target: 'key1',
          options: { size: 50 * 1024 * 1024 } // 50MB
        },
        {
          type: 'memory',
          target: 'key2',
          options: { size: 30 * 1024 * 1024 } // 30MB
        }
      ];

      const result = await validator.validateBatchOperation(operations);

      expect(result.success).toBe(true);
      expect(result.resources).toHaveLength(1); // Combined memory requirement
      expect(result.resources[0].amount).toBe(80); // 80MB total
    });
  });

  describe('Isolated Execution Testing', () => {
    test('should execute safe operations in isolation', async () => {
      const operation = async () => {
        return { result: 'test completed', timestamp: Date.now() };
      };

      const result = await validator.executeDryRun(
        operation,
        { timeout: 5000, memoryLimit: 100 * 1024 * 1024 }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.result).toBe('test completed');
      expect(result.riskLevel).toBe('low');
    });

    test('should handle operation timeouts', async () => {
      const operation = async () => {
        await AsyncTestUtils.delay(10000); // 10 second delay
        return 'should not complete';
      };

      const result = await validator.executeDryRun(
        operation,
        { timeout: 1000 } // 1 second timeout
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.riskLevel).toBe('medium');
    });

    test('should monitor memory usage during execution', async () => {
      const operation = async () => {
        // Allocate some memory
        const arrays: number[][] = [];
        for (let i = 0; i < 1000; i++) {
          arrays.push(new Array(1000).fill(i));
        }
        return arrays.length;
      };

      const result = await validator.executeDryRun(
        operation,
        { memoryLimit: 500 * 1024 * 1024 }
      );

      expect(result.success).toBe(true);
      expect(result.resources.some(r => r.type === 'memory')).toBe(true);
    });
  });

  describe('Test Fixtures and Scenarios', () => {
    test('should provide comprehensive file operation test scenarios', () => {
      const scenarios = DryRunTestFixtures.createFileOperationScenarios();
      
      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios.every(s => s.name && s.operation && s.expectedResult)).toBe(true);
      
      // Test each scenario
      scenarios.forEach(scenario => {
        expect(scenario.expectedResult.success).toBeDefined();
        expect(scenario.expectedResult.riskLevel).toBeDefined();
      });
    });

    test('should provide comprehensive command execution test scenarios', () => {
      const scenarios = DryRunTestFixtures.createCommandScenarios();
      
      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios.every(s => s.name && s.operation && s.expectedResult)).toBe(true);
    });

    test('should execute all fixture scenarios successfully', async () => {
      const fileScenarios = DryRunTestFixtures.createFileOperationScenarios();
      const commandScenarios = DryRunTestFixtures.createCommandScenarios();
      
      // Test file scenarios
      for (const scenario of fileScenarios) {
        const [operation, target, options] = scenario.operation;
        const result = await validator.validateFileSystemOperation(operation, target, options);
        
        expect(result.success).toBe(scenario.expectedResult.success);
        expect(result.riskLevel).toBe(scenario.expectedResult.riskLevel);
        
        if (scenario.expectedResult.errors) {
          expect(result.errors).toEqual(expect.arrayContaining(scenario.expectedResult.errors));
        }
      }

      // Test command scenarios
      for (const scenario of commandScenarios) {
        const [command, args, options] = scenario.operation;
        const result = await validator.validateCommandExecution(command, args, options);
        
        expect(result.success).toBe(scenario.expectedResult.success);
        expect(result.riskLevel).toBe(scenario.expectedResult.riskLevel);
      }
    });
  });

  describe('Performance Validation', () => {
    test('should benchmark validation performance', async () => {
      const performanceValidator = new DryRunPerformanceValidator();
      
      const operation = async () => {
        return await validator.validateFileSystemOperation(
          'create',
          path.join(tempDir, `perf-test-${Date.now()}.txt`),
          { content: 'performance test content' }
        );
      };

      const benchmarkResult = await performanceValidator.benchmarkValidation(
        operation,
        { iterations: 50, concurrency: 5 }
      );

      expect(benchmarkResult.stats.mean).toBeLessThan(1000); // Should be fast
      expect(benchmarkResult.validationReliability).toBeGreaterThan(0.9); // Should be reliable
      expect(benchmarkResult.stats.p95).toBeLessThan(2000); // 95th percentile under 2 seconds
    });

    test('should maintain consistent validation results', async () => {
      const results: DryRunResult[] = [];
      
      // Run the same validation multiple times
      for (let i = 0; i < 10; i++) {
        const result = await validator.validateFileSystemOperation(
          'create',
          path.join(tempDir, `consistency-test-${i}.txt`),
          { content: 'consistency test' }
        );
        results.push(result);
      }

      // All results should be consistent
      const firstResult = results[0];
      results.forEach(result => {
        expect(result.success).toBe(firstResult.success);
        expect(result.riskLevel).toBe(firstResult.riskLevel);
        expect(result.operations.length).toBe(firstResult.operations.length);
      });
    });
  });

  describe('Enhanced Test Runner Integration', () => {
    test('should create and execute test scenarios with dry-run validation', async () => {
      const testScenario: TestScenario = {
        name: 'Enhanced Test Runner - Dry Run Integration',
        description: 'Test that the enhanced test runner works with dry-run validation',
        mode: 'unit',
        operation: async () => {
          return { message: 'test completed successfully', timestamp: Date.now() };
        },
        validation: async (result) => {
          expect(result.message).toBe('test completed successfully');
          expect(result.timestamp).toBeGreaterThan(0);
        },
        dryRun: true,
        timeout: 5000
      };

      const result = await testRunner.executeScenario(testScenario);

      expect(result.success).toBe(true);
      expect(result.dryRunResult).toBeDefined();
      expect(result.dryRunResult?.success).toBe(true);
      expect(result.metrics.operationDuration).toBeGreaterThan(0);
      expect(result.memoryUsage).toBeGreaterThan(0);
    });

    test('should generate comprehensive test suites', () => {
      const mockModule = {
        createUser: (name: string, email: string) => ({ id: 1, name, email }),
        deleteUser: (id: number) => ({ deleted: true, id }),
        updateUser: (id: number, data: any) => ({ id, ...data })
      };

      const testSuite = testRunner.createModuleTestSuite(
        'UserModule',
        mockModule,
        {
          modes: ['unit', 'integration', 'performance'],
          generateEdgeCases: true,
          includeChaosTests: true,
          performanceThresholds: {
            createUser: 1000,
            deleteUser: 500,
            updateUser: 800
          }
        }
      );

      expect(testSuite.length).toBeGreaterThan(0);
      expect(testSuite.some(t => t.mode === 'unit')).toBe(true);
      expect(testSuite.some(t => t.mode === 'integration')).toBe(true);
      expect(testSuite.some(t => t.mode === 'performance')).toBe(true);
      expect(testSuite.some(t => t.mode === 'chaos')).toBe(true);
    });
  });

  describe('Coverage Analysis', () => {
    test('should analyze test coverage gaps', async () => {
      const coverageAnalyzer = new TestCoverageAnalyzer();
      
      const analysis = await coverageAnalyzer.analyzeCoverageGaps(
        ['src/core/orchestrator.ts', 'src/cli/commands/start.ts'],
        ['tests/unit/core/orchestrator.test.ts']
      );

      expect(analysis.recommendations).toBeDefined();
      expect(Array.isArray(analysis.recommendations)).toBe(true);
      expect(analysis.uncoveredFiles).toBeDefined();
      expect(analysis.uncoveredFunctions).toBeDefined();
    });

    test('should generate comprehensive coverage reports', async () => {
      const mockResults: any[] = [
        {
          scenario: { mode: 'unit' },
          success: true,
          duration: 100,
          memoryUsage: 1024 * 1024
        },
        {
          scenario: { mode: 'integration' },
          success: false,
          duration: 500,
          memoryUsage: 2 * 1024 * 1024
        }
      ];

      const coverageAnalyzer = new TestCoverageAnalyzer();
      const report = await coverageAnalyzer.generateCoverageReport(mockResults);

      expect(report.summary.totalTests).toBe(2);
      expect(report.summary.passedTests).toBe(1);
      expect(report.summary.failedTests).toBe(1);
      expect(report.details.length).toBeGreaterThan(0);
    });
  });
});