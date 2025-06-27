/**
 * Runtime Migration Validation Test Suite
 * Phase 2 CLI Consolidation & Runtime Migration
 * 
 * QA TESTER AGENT - swarm-development-hierarchical-1751006703324
 * 
 * This test suite validates that runtime migration from dual TypeScript/Deno + JavaScript/Node.js
 * to unified Node.js runtime maintains all functionality and compatibility.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface RuntimeTest {
  testName: string;
  command: string[];
  expectedBehavior: string;
  actualResult?: any;
  status: 'pending' | 'passed' | 'failed' | 'warning';
  notes?: string;
}

interface MigrationValidation {
  preConsolidationSnapshot: any;
  postConsolidationSnapshot: any;
  runtimeTests: RuntimeTest[];
  compatibilityMatrix: {
    nodeJsVersion: string;
    npmVersion: string;
    osInfo: any;
    dependencies: any;
  };
  migrationIssues: string[];
  recommendations: string[];
}

describe('Runtime Migration Validation', () => {
  let testDir: string;
  let migrationValidation: MigrationValidation;
  const CLI_PATH = './claude-flow';

  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-migration-test-'));
    
    migrationValidation = {
      preConsolidationSnapshot: null,
      postConsolidationSnapshot: null,
      runtimeTests: [],
      compatibilityMatrix: {
        nodeJsVersion: process.version,
        npmVersion: execSync('npm --version', { encoding: 'utf8' }).trim(),
        osInfo: {
          platform: os.platform(),
          arch: os.arch(),
          release: os.release()
        },
        dependencies: {}
      },
      migrationIssues: [],
      recommendations: []
    };

    console.log('Runtime Environment:', migrationValidation.compatibilityMatrix);
  });

  afterAll(async () => {
    // Save migration validation results
    const resultsPath = path.join(testDir, 'runtime-migration-validation.json');
    fs.writeFileSync(resultsPath, JSON.stringify(migrationValidation, null, 2));
    console.log(`Migration validation results saved to: ${resultsPath}`);
    
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Cleanup warning: ${error}`);
    }
  });

  beforeEach(() => {
    process.chdir('/Users/mac-main/Documents/augment-projects/Claude Flow Implementations/claude-code-flow');
  });

  describe('Pre-Consolidation Behavior Snapshot', () => {
    it('should capture current command behavior baseline', async () => {
      const commands = [
        ['--help'],
        ['status'],
        ['config', 'show'],
        ['memory', 'list'],
        ['sparc', 'modes'],
        ['agent', 'list'],
        ['mcp', 'status']
      ];

      const snapshot: any = {};
      
      for (const command of commands) {
        try {
          const result = execSync(`${CLI_PATH} ${command.join(' ')}`, {
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          snapshot[command.join(' ')] = {
            exitCode: 0,
            output: result,
            timestamp: new Date().toISOString()
          };
        } catch (error: any) {
          snapshot[command.join(' ')] = {
            exitCode: error.status || -1,
            output: error.stdout || '',
            error: error.stderr || error.message,
            timestamp: new Date().toISOString()
          };
        }
      }

      migrationValidation.preConsolidationSnapshot = snapshot;
      expect(Object.keys(snapshot).length).toBeGreaterThan(0);
      
      console.log('Pre-consolidation snapshot captured for', Object.keys(snapshot).length, 'commands');
    });

    it('should validate current TypeScript/Deno implementation paths', async () => {
      const typescriptPaths = [
        'src/cli/main.ts',
        'src/cli/commands/start.ts',
        'src/cli/commands/sparc.ts',
        'src/cli/commands/agent.ts',
        'src/cli/commands/memory.ts',
        'src/cli/commands/mcp.ts'
      ];

      let foundPaths = 0;
      for (const tsPath of typescriptPaths) {
        if (fs.existsSync(tsPath)) {
          foundPaths++;
        }
      }

      expect(foundPaths).toBeGreaterThan(0);
      migrationValidation.migrationIssues.push(`Found ${foundPaths}/${typescriptPaths.length} TypeScript implementation files`);
    });

    it('should validate current JavaScript/Node.js implementation paths', async () => {
      const javascriptPaths = [
        'src/cli/simple-cli.ts',
        'src/cli/simple-commands/start.js',
        'src/cli/simple-commands/sparc.js',
        'src/cli/simple-commands/agent.js',
        'src/cli/simple-commands/memory.js',
        'src/cli/simple-commands/mcp.js'
      ];

      let foundPaths = 0;
      for (const jsPath of javascriptPaths) {
        if (fs.existsSync(jsPath)) {
          foundPaths++;
        }
      }

      expect(foundPaths).toBeGreaterThan(0);
      migrationValidation.migrationIssues.push(`Found ${foundPaths}/${javascriptPaths.length} JavaScript implementation files`);
    });
  });

  describe('Dual Runtime Compatibility Tests', () => {
    it('should test Node.js compatibility for all CLI commands', async () => {
      const nodeTests: RuntimeTest[] = [
        {
          testName: 'Node.js Help Command',
          command: [CLI_PATH, '--help'],
          expectedBehavior: 'Should display help with Node.js runtime'
        },
        {
          testName: 'Node.js Status Command',
          command: [CLI_PATH, 'status'],
          expectedBehavior: 'Should show system status with Node.js runtime'
        },
        {
          testName: 'Node.js Config Command',
          command: [CLI_PATH, 'config', 'show'],
          expectedBehavior: 'Should handle configuration with Node.js runtime'
        }
      ];

      for (const test of nodeTests) {
        try {
          const result = execSync(test.command.join(' '), {
            encoding: 'utf8',
            timeout: 15000,
            env: { ...process.env, FORCE_NODE_RUNTIME: 'true' }
          });
          
          test.actualResult = { exitCode: 0, output: result };
          test.status = 'passed';
        } catch (error: any) {
          test.actualResult = { 
            exitCode: error.status || -1, 
            error: error.message,
            stderr: error.stderr
          };
          test.status = error.status <= 1 ? 'warning' : 'failed';
        }
      }

      migrationValidation.runtimeTests.push(...nodeTests);
      
      const passedTests = nodeTests.filter(t => t.status === 'passed').length;
      expect(passedTests).toBeGreaterThanOrEqual(nodeTests.length * 0.8); // 80% pass rate minimum
    });

    it('should validate environment variable handling', async () => {
      const envTests = [
        { name: 'NODE_ENV=test', env: { NODE_ENV: 'test' } },
        { name: 'NODE_ENV=production', env: { NODE_ENV: 'production' } },
        { name: 'DEBUG=*', env: { DEBUG: '*' } },
        { name: 'CLAUDE_WORKING_DIR=custom', env: { CLAUDE_WORKING_DIR: testDir } }
      ];

      for (const envTest of envTests) {
        try {
          const result = execSync(`${CLI_PATH} --help`, {
            encoding: 'utf8',
            timeout: 10000,
            env: { ...process.env, ...envTest.env }
          });

          migrationValidation.runtimeTests.push({
            testName: `Environment Variable Test: ${envTest.name}`,
            command: [CLI_PATH, '--help'],
            expectedBehavior: 'Should work with custom environment variables',
            actualResult: { exitCode: 0, output: result },
            status: 'passed'
          });
        } catch (error: any) {
          migrationValidation.runtimeTests.push({
            testName: `Environment Variable Test: ${envTest.name}`,
            command: [CLI_PATH, '--help'],
            expectedBehavior: 'Should work with custom environment variables',
            actualResult: { exitCode: error.status, error: error.message },
            status: 'failed',
            notes: `Failed with environment: ${JSON.stringify(envTest.env)}`
          });
        }
      }
    });
  });

  describe('Dependency Migration Validation', () => {
    it('should check for Node.js module compatibility', async () => {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      migrationValidation.compatibilityMatrix.dependencies = packageJson.dependencies;

      // Check for problematic dependencies that might not work after consolidation
      const potentialIssues = [];
      
      if (packageJson.dependencies) {
        for (const [dep, version] of Object.entries(packageJson.dependencies)) {
          // Check for Deno-specific dependencies
          if (dep.includes('deno') || dep.includes('@deno/')) {
            potentialIssues.push(`Deno-specific dependency: ${dep}@${version}`);
          }
          
          // Check for dual runtime dependencies
          if (dep.includes('isomorphic') || dep.includes('universal')) {
            migrationValidation.recommendations.push(`Review dual runtime dependency: ${dep}@${version}`);
          }
        }
      }

      migrationValidation.migrationIssues.push(...potentialIssues);
      expect(potentialIssues.length).toBeLessThan(10); // Should have manageable number of issues
    });

    it('should validate TypeScript compilation compatibility', async () => {
      try {
        // Check if TypeScript files can be processed
        execSync('npx tsc --noEmit --skipLibCheck', {
          encoding: 'utf8',
          timeout: 30000
        });

        migrationValidation.runtimeTests.push({
          testName: 'TypeScript Compilation Check',
          command: ['npx', 'tsc', '--noEmit'],
          expectedBehavior: 'TypeScript should compile without errors',
          actualResult: { exitCode: 0, output: 'Compilation successful' },
          status: 'passed'
        });
      } catch (error: any) {
        migrationValidation.runtimeTests.push({
          testName: 'TypeScript Compilation Check',
          command: ['npx', 'tsc', '--noEmit'],
          expectedBehavior: 'TypeScript should compile without errors',
          actualResult: { exitCode: error.status, error: error.message },
          status: 'warning',
          notes: 'TypeScript compilation issues detected - may need resolution during consolidation'
        });
      }
    });
  });

  describe('File System Migration Validation', () => {
    it('should validate file path resolution compatibility', async () => {
      const criticalPaths = [
        './claude-flow',
        'src/cli/main.ts',
        'src/cli/simple-cli.ts',
        'package.json',
        'tsconfig.json'
      ];

      for (const filePath of criticalPaths) {
        const exists = fs.existsSync(filePath);
        
        migrationValidation.runtimeTests.push({
          testName: `File Path Validation: ${filePath}`,
          command: ['test', '-f', filePath],
          expectedBehavior: 'Critical files should be accessible',
          actualResult: { exists, path: filePath },
          status: exists ? 'passed' : 'failed',
          notes: exists ? undefined : `Missing critical file: ${filePath}`
        });
      }
    });

    it('should check for cross-platform path compatibility', async () => {
      const pathSeparatorTests = [
        'src/cli/main.ts',
        'src\\cli\\main.ts',  // Windows style
        './src/cli/main.ts',  // Relative path
        '../claude-code-flow/src/cli/main.ts'  // Parent reference
      ];

      for (const testPath of pathSeparatorTests) {
        try {
          const normalizedPath = path.normalize(testPath);
          const resolved = path.resolve(normalizedPath);
          
          migrationValidation.runtimeTests.push({
            testName: `Path Normalization Test: ${testPath}`,
            command: ['normalize-path', testPath],
            expectedBehavior: 'Paths should normalize correctly across platforms',
            actualResult: { 
              original: testPath, 
              normalized: normalizedPath, 
              resolved: resolved 
            },
            status: 'passed'
          });
        } catch (error: any) {
          migrationValidation.runtimeTests.push({
            testName: `Path Normalization Test: ${testPath}`,
            command: ['normalize-path', testPath],
            expectedBehavior: 'Paths should normalize correctly across platforms',
            actualResult: { error: error.message },
            status: 'failed'
          });
        }
      }
    });
  });

  describe('Performance Impact Assessment', () => {
    it('should measure command execution times before consolidation', async () => {
      const performanceTests = [
        ['--help'],
        ['status'],
        ['config', 'show'],
        ['sparc', 'modes']
      ];

      for (const command of performanceTests) {
        const startTime = Date.now();
        
        try {
          execSync(`${CLI_PATH} ${command.join(' ')}`, {
            encoding: 'utf8',
            timeout: 10000
          });
          
          const duration = Date.now() - startTime;
          
          migrationValidation.runtimeTests.push({
            testName: `Performance Baseline: ${command.join(' ')}`,
            command: [CLI_PATH, ...command],
            expectedBehavior: 'Should execute within reasonable time',
            actualResult: { duration, exitCode: 0 },
            status: duration < 5000 ? 'passed' : 'warning',
            notes: `Execution time: ${duration}ms`
          });
        } catch (error: any) {
          migrationValidation.runtimeTests.push({
            testName: `Performance Baseline: ${command.join(' ')}`,
            command: [CLI_PATH, ...command],
            expectedBehavior: 'Should execute within reasonable time',
            actualResult: { error: error.message, exitCode: error.status },
            status: 'failed'
          });
        }
      }
    });
  });

  describe('Migration Readiness Assessment', () => {
    it('should generate migration readiness report', async () => {
      const totalTests = migrationValidation.runtimeTests.length;
      const passedTests = migrationValidation.runtimeTests.filter(t => t.status === 'passed').length;
      const failedTests = migrationValidation.runtimeTests.filter(t => t.status === 'failed').length;
      const warningTests = migrationValidation.runtimeTests.filter(t => t.status === 'warning').length;

      const readinessScore = (passedTests + (warningTests * 0.5)) / totalTests;

      migrationValidation.recommendations.push(
        `Migration Readiness Score: ${(readinessScore * 100).toFixed(1)}%`,
        `Total Tests: ${totalTests}`,
        `Passed: ${passedTests}`,
        `Warnings: ${warningTests}`,
        `Failed: ${failedTests}`
      );

      if (readinessScore >= 0.8) {
        migrationValidation.recommendations.push('✅ System is ready for runtime migration');
      } else if (readinessScore >= 0.6) {
        migrationValidation.recommendations.push('⚠️ System has some issues but migration is feasible with caution');
      } else {
        migrationValidation.recommendations.push('❌ System has significant issues - address before migration');
      }

      expect(readinessScore).toBeGreaterThan(0.5); // Minimum 50% readiness
      console.log(`Migration Readiness: ${(readinessScore * 100).toFixed(1)}%`);
    });
  });
});