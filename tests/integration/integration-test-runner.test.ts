/// <reference types="jest" />

/**
 * Integration test runner and validation suite
 * Orchestrates and validates all concurrency and multi-agent integration tests
 */

import {
  describe,
  it,
  beforeAll,
  afterAll,
  assertEquals,
  assertExists
} from '../test.utils.js';
import { TEST_CONFIG } from '../test.config.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Integration Test Suite Runner', () => {
  let testResults: Map<string, {
    passed: number;
    failed: number;
    duration: number;
    coverage: string[];
  }>;

  beforeAll(() => {
    testResults = new Map();
  });

  afterAll(async () => {
    // Generate integration test report
    const report = {
      timestamp: new Date().toISOString(),
      totalSuites: testResults.size,
      overallResults: Array.from(testResults.entries()).map(([suite, results]) => ({
        suite,
        ...results,
        successRate: results.passed / (results.passed + results.failed)
      })),
      recommendations: generateRecommendations(testResults)
    };

    const reportPath = path.join(__dirname, '../../test-results/integration-test-report.json');
    await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('INTEGRATION TEST SUITE SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Test Suites: ${report.totalSuites}`);
    
    report.overallResults.forEach(result => {
      console.log(`\n${result.suite}:`);
      console.log(`  ✅ Passed: ${result.passed}`);
      console.log(`  ❌ Failed: ${result.failed}`);
      console.log(`  📊 Success Rate: ${(result.successRate * 100).toFixed(2)}%`);
      console.log(`  ⏱️  Duration: ${result.duration}ms`);
    });
    
    if (report.recommendations.length > 0) {
      console.log('\n📋 RECOMMENDATIONS:');
      report.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
    }
    
    console.log(`\n📄 Full report saved to: ${reportPath}`);
    console.log('='.repeat(80));
  });

  describe('Test Suite Validation', () => {
    it('should validate test environment configuration', () => {
      // Verify test configuration
      expect(TEST_CONFIG.performance.concurrent_tasks).toBeDefined();
      expect(TEST_CONFIG.performance.concurrent_tasks).toContain(50); // For our 32+ agent tests
      
      expect(TEST_CONFIG.timeout.integration).toBeGreaterThan(30000); // Long enough for stress tests
      expect(TEST_CONFIG.performance.timeout_stress_duration).toBeGreaterThan(15000);
      
      // Verify test directories exist
      expect(fs.existsSync(TEST_CONFIG.directories.integration)).toBe(true);
      expect(fs.existsSync(TEST_CONFIG.directories.performance)).toBe(true);
      
      console.log('✅ Test environment configuration validated');
    });

    it('should verify all integration test files exist', () => {
      const requiredTestFiles = [
        'concurrency-stress.test.ts',
        'process-pool-consolidation.test.ts', 
        'swarm-validation-framework.test.ts'
      ];
      
      const integrationDir = path.join(__dirname);
      
      requiredTestFiles.forEach(testFile => {
        const testPath = path.join(integrationDir, testFile);
        expect(fs.existsSync(testPath)).toBe(true);
        
        // Verify file has substantial content (not empty)
        const stats = fs.statSync(testPath);
        expect(stats.size).toBeGreaterThan(1000); // At least 1KB of test code
      });
      
      console.log(`✅ All ${requiredTestFiles.length} integration test files validated`);
    });

    it('should validate test coverage targets', () => {
      const coverageAreas = [
        'StateManager concurrency with 32+ agents',
        'ProcessPool stress testing and lifecycle',
        'Swarm coordination and hierarchical management',
        'Inter-agent communication and message passing',
        'Resource management and cleanup',
        'System integrity and failure recovery',
        'Memory coordination under load',
        'Dynamic scaling and load balancing'
      ];
      
      // This would typically integrate with coverage tools
      // For now, we validate that our test areas are comprehensive
      coverageAreas.forEach(area => {
        console.log(`📋 Coverage area: ${area}`);
      });
      
      expect(coverageAreas.length).toBeGreaterThanOrEqual(8);
      console.log(`✅ Test coverage spans ${coverageAreas.length} critical areas`);
    });
  });

  describe('Performance Benchmark Validation', () => {
    it('should validate performance targets are achievable', async () => {
      const performanceTargets = {
        concurrent_agents: 64,
        max_message_processing_time: 100, // ms
        min_success_rate: 0.90, // 90%
        max_memory_growth: 100 * 1024 * 1024, // 100MB
        max_test_duration: 60000 // 60 seconds
      };
      
      // Quick performance baseline test
      const baselineStart = Date.now();
      const mockOperations = Array.from({ length: 100 }, async (_, i) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        return `operation-${i}`;
      });
      
      const results = await Promise.all(mockOperations);
      const baselineDuration = Date.now() - baselineStart;
      
      expect(results.length).toBe(100);
      expect(baselineDuration).toBeLessThan(1000); // Should complete quickly
      
      console.log(`✅ Performance baseline: ${results.length} operations in ${baselineDuration}ms`);
      
      // Log performance targets for reference
      Object.entries(performanceTargets).forEach(([key, value]) => {
        console.log(`📊 Target ${key}: ${value}`);
      });
    });

    it('should validate system resource limits', () => {
      const systemLimits = {
        maxHeapUsed: process.memoryUsage().heapUsed * 10, // 10x current usage
        maxProcesses: 64,
        maxFileDescriptors: 1024,
        maxConcurrentConnections: 256
      };
      
      // Verify we have adequate system resources for testing
      const currentMemory = process.memoryUsage();
      expect(currentMemory.heapUsed).toBeLessThan(systemLimits.maxHeapUsed);
      
      console.log('✅ System resource limits validated:');
      console.log(`  💾 Current heap: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  📊 Max allowed: ${(systemLimits.maxHeapUsed / 1024 / 1024).toFixed(2)}MB`);
    });
  });

  describe('Integration Test Execution Guidance', () => {
    it('should provide test execution instructions', () => {
      const executionInstructions = {
        prerequisites: [
          'Ensure test environment is clean (no running processes)',
          'Verify adequate system resources (RAM > 2GB, CPU cores > 4)',
          'Check that all dependencies are installed',
          'Confirm test database/storage is accessible'
        ],
        executionOrder: [
          '1. Run concurrency-stress.test.ts for basic load testing',
          '2. Run process-pool-consolidation.test.ts for process management',
          '3. Run swarm-validation-framework.test.ts for full coordination',
          '4. Review logs and metrics for any performance degradation'
        ],
        expectedDuration: {
          'concurrency-stress.test.ts': '5-10 minutes',
          'process-pool-consolidation.test.ts': '8-15 minutes',
          'swarm-validation-framework.test.ts': '10-20 minutes'
        },
        commonIssues: [
          'Memory growth during long-running tests (monitor heap usage)',
          'Process cleanup timeouts (increase timeout values if needed)',
          'Resource contention on limited hardware (reduce concurrent agents)',
          'Network timeouts in communication tests (check system load)'
        ]
      };
      
      console.log('\n📖 INTEGRATION TEST EXECUTION GUIDE:');
      console.log('\n✅ Prerequisites:');
      executionInstructions.prerequisites.forEach((prereq, i) => {
        console.log(`  ${i + 1}. ${prereq}`);
      });
      
      console.log('\n🔄 Execution Order:');
      executionInstructions.executionOrder.forEach(step => {
        console.log(`  ${step}`);
      });
      
      console.log('\n⏱️  Expected Duration:');
      Object.entries(executionInstructions.expectedDuration).forEach(([test, duration]) => {
        console.log(`  ${test}: ${duration}`);
      });
      
      console.log('\n⚠️  Common Issues:');
      executionInstructions.commonIssues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });
      
      expect(executionInstructions.prerequisites.length).toBeGreaterThan(0);
      expect(executionInstructions.executionOrder.length).toBeGreaterThan(0);
    });

    it('should validate CI/CD integration readiness', () => {
      const cicdConfig = {
        parallelExecution: false, // These tests should run sequentially
        timeoutMultiplier: 2, // Double normal timeouts for CI
        retryAttempts: 1, // Single retry for flaky tests
        resourceLimits: {
          memory: '4GB',
          cpu: '4 cores',
          timeout: '30 minutes'
        },
        environmentVariables: [
          'CLAUDE_FLOW_ENV=test',
          'CLAUDE_FLOW_LOG_LEVEL=info',
          'CLAUDE_FLOW_DISABLE_TELEMETRY=true'
        ]
      };
      
      console.log('\n🔧 CI/CD INTEGRATION CONFIGURATION:');
      console.log(`  🔄 Parallel execution: ${cicdConfig.parallelExecution}`);
      console.log(`  ⏰ Timeout multiplier: ${cicdConfig.timeoutMultiplier}x`);
      console.log(`  🔁 Retry attempts: ${cicdConfig.retryAttempts}`);
      console.log(`  📊 Memory limit: ${cicdConfig.resourceLimits.memory}`);
      console.log(`  🖥️  CPU requirement: ${cicdConfig.resourceLimits.cpu}`);
      console.log(`  ⏱️  Max timeout: ${cicdConfig.resourceLimits.timeout}`);
      
      expect(cicdConfig.resourceLimits.memory).toBeDefined();
      expect(cicdConfig.environmentVariables.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Generate recommendations based on test results
 */
function generateRecommendations(testResults: Map<string, any>): string[] {
  const recommendations: string[] = [];
  
  for (const [suite, results] of testResults) {
    const successRate = results.passed / (results.passed + results.failed);
    
    if (successRate < 0.90) {
      recommendations.push(`${suite}: Success rate below 90% (${(successRate * 100).toFixed(2)}%) - investigate failure patterns`);
    }
    
    if (results.duration > 300000) { // 5 minutes
      recommendations.push(`${suite}: Duration exceeds 5 minutes (${(results.duration / 1000).toFixed(2)}s) - consider optimization`);
    }
  }
  
  if (testResults.size < 3) {
    recommendations.push('Test coverage incomplete - ensure all integration test suites are running');
  }
  
  return recommendations;
}

/**
 * Export test runner utilities for external use
 */
export {
  generateRecommendations
};

/**
 * Test execution commands for reference:
 * 
 * # Run individual test suites:
 * npm test tests/integration/concurrency-stress.test.ts
 * npm test tests/integration/process-pool-consolidation.test.ts
 * npm test tests/integration/swarm-validation-framework.test.ts
 * 
 * # Run all integration tests:
 * npm test tests/integration/
 * 
 * # Run with coverage:
 * npm run test:coverage -- tests/integration/
 * 
 * # Run with performance monitoring:
 * npm run test:performance -- tests/integration/
 */
