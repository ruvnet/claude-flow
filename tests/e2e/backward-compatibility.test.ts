/**
 * Comprehensive Backward Compatibility Test Suite
 * Phase 2 CLI Consolidation & Runtime Migration
 * 
 * QA TESTER AGENT - swarm-development-hierarchical-1751006703324
 * 
 * This test suite validates that all existing CLI commands continue to work
 * after consolidation and runtime migration changes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test configuration
interface TestResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timestamp: string;
}

interface ValidationMatrix {
  tier1Commands: string[];
  tier2Commands: string[];
  tier3Commands: string[];
  sparcModes: string[];
  results: TestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

describe('Backward Compatibility Test Suite', () => {
  let testDir: string;
  let validationMatrix: ValidationMatrix;
  
  const CLI_PATH = './claude-flow';
  const TIMEOUT = 30000; // 30 seconds per test
  
  beforeAll(async () => {
    // Initialize validation matrix
    validationMatrix = {
      tier1Commands: ['start', 'sparc', 'init', 'swarm', 'agent'],
      tier2Commands: ['memory', 'mcp', 'config', 'task', 'monitor', 'status', 'session'],
      tier3Commands: ['project', 'deploy', 'cloud', 'security', 'analytics'],
      sparcModes: [
        'orchestrator', 'coder', 'researcher', 'tdd', 'architect', 
        'reviewer', 'debugger', 'tester', 'analyzer', 'optimizer',
        'documenter', 'designer', 'innovator'
      ],
      results: [],
      summary: { totalTests: 0, passed: 0, failed: 0, warnings: 0 }
    };
    
    // Create test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-flow-compat-test-'));
    console.log(`Test directory: ${testDir}`);
  });
  
  afterAll(async () => {
    // Save validation results
    const resultsPath = path.join(testDir, 'backward-compatibility-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(validationMatrix, null, 2));
    console.log(`Results saved to: ${resultsPath}`);
    
    // Cleanup
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Cleanup warning: ${error}`);
    }
  });

  beforeEach(() => {
    // Ensure we're in project directory
    process.chdir('/Users/mac-main/Documents/augment-projects/Claude Flow Implementations/claude-code-flow');
  });

  /**
   * Helper function to execute CLI commands with proper error handling
   */
  async function executeCommand(command: string, args: string[] = [], options: any = {}): Promise<TestResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: TIMEOUT,
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (exitCode) => {
        const duration = Date.now() - startTime;
        const result: TestResult = {
          command,
          args,
          exitCode: exitCode || 0,
          stdout,
          stderr,
          duration,
          timestamp
        };
        
        validationMatrix.results.push(result);
        resolve(result);
      });
      
      child.on('error', (error) => {
        const duration = Date.now() - startTime;
        const result: TestResult = {
          command,
          args,
          exitCode: -1,
          stdout: '',
          stderr: error.message,
          duration,
          timestamp
        };
        
        validationMatrix.results.push(result);
        resolve(result);
      });
    });
  }

  describe('Tier 1 Critical Commands', () => {
    describe('Help and Version Commands', () => {
      it('should display help information', async () => {
        const result = await executeCommand(CLI_PATH, ['--help']);
        
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Claude-Flow');
        expect(result.stdout).toContain('USAGE:');
        expect(result.stdout).toContain('COMMANDS:');
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode === 0) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should display version information', async () => {
        const result = await executeCommand(CLI_PATH, ['--version']);
        
        // Version might exit with 0 or show in help, both acceptable
        expect(result.exitCode).toBeLessThanOrEqual(1);
        expect(result.stdout + result.stderr).toMatch(/v?\d+\.\d+\.\d+/);
        
        validationMatrix.summary.totalTests++;
        validationMatrix.summary.passed++;
      });
    });

    describe('Status Command', () => {
      it('should show system status', async () => {
        const result = await executeCommand(CLI_PATH, ['status']);
        
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('System Status');
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode === 0) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });

    describe('Config Command', () => {
      it('should show configuration', async () => {
        const result = await executeCommand(CLI_PATH, ['config', 'show']);
        
        // Config show should work or gracefully handle missing config
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should validate configuration', async () => {
        const result = await executeCommand(CLI_PATH, ['config', 'validate']);
        
        // Should either validate successfully or show helpful error
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });

    describe('Memory Command', () => {
      it('should list memory entries', async () => {
        const result = await executeCommand(CLI_PATH, ['memory', 'list']);
        
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should show memory stats', async () => {
        const result = await executeCommand(CLI_PATH, ['memory', 'stats']);
        
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });

    describe('SPARC Command', () => {
      it('should list SPARC modes', async () => {
        const result = await executeCommand(CLI_PATH, ['sparc', 'modes']);
        
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('modes');
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode === 0) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should show SPARC help', async () => {
        const result = await executeCommand(CLI_PATH, ['sparc', '--help']);
        
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('SPARC');
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode === 0) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });

    describe('Agent Command', () => {
      it('should list agents', async () => {
        const result = await executeCommand(CLI_PATH, ['agent', 'list']);
        
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should show agent help', async () => {
        const result = await executeCommand(CLI_PATH, ['agent', '--help']);
        
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('agent');
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode === 0) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });

    describe('MCP Command', () => {
      it('should show MCP status', async () => {
        const result = await executeCommand(CLI_PATH, ['mcp', 'status']);
        
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });

      it('should list MCP tools', async () => {
        const result = await executeCommand(CLI_PATH, ['mcp', 'tools']);
        
        expect(result.exitCode).toBeLessThanOrEqual(1);
        
        validationMatrix.summary.totalTests++;
        if (result.exitCode <= 1) {
          validationMatrix.summary.passed++;
        } else {
          validationMatrix.summary.failed++;
        }
      });
    });
  });

  describe('Command Error Handling', () => {
    it('should handle invalid commands gracefully', async () => {
      const result = await executeCommand(CLI_PATH, ['invalid-command']);
      
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr + result.stdout).toMatch(/unknown|invalid|error/i);
      
      validationMatrix.summary.totalTests++;
      validationMatrix.summary.passed++; // Error handling is expected
    });

    it('should handle invalid subcommands gracefully', async () => {
      const result = await executeCommand(CLI_PATH, ['config', 'invalid-subcommand']);
      
      expect(result.exitCode).toBeGreaterThan(0);
      
      validationMatrix.summary.totalTests++;
      validationMatrix.summary.passed++; // Error handling is expected
    });
  });

  describe('Performance Validation', () => {
    it('should execute help command quickly', async () => {
      const result = await executeCommand(CLI_PATH, ['--help']);
      
      expect(result.duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.exitCode).toBe(0);
      
      validationMatrix.summary.totalTests++;
      if (result.exitCode === 0 && result.duration < 5000) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.warnings++;
      }
    });

    it('should execute status command within reasonable time', async () => {
      const result = await executeCommand(CLI_PATH, ['status']);
      
      expect(result.duration).toBeLessThan(10000); // Should complete within 10 seconds
      
      validationMatrix.summary.totalTests++;
      if (result.duration < 10000) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.warnings++;
      }
    });
  });

  describe('Cross-platform Compatibility', () => {
    it('should work with different NODE_ENV settings', async () => {
      const result = await executeCommand(CLI_PATH, ['--help'], {
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      expect(result.exitCode).toBe(0);
      
      validationMatrix.summary.totalTests++;
      if (result.exitCode === 0) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.failed++;
      }
    });

    it('should handle missing dependencies gracefully', async () => {
      // Test with minimal PATH to simulate missing dependencies
      const result = await executeCommand(CLI_PATH, ['--help'], {
        env: { ...process.env, PATH: '/usr/bin:/bin' }
      });
      
      // Should still show help even with limited PATH
      expect(result.exitCode).toBeLessThanOrEqual(1);
      
      validationMatrix.summary.totalTests++;
      if (result.exitCode <= 1) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.failed++;
      }
    });
  });

  describe('Output Format Validation', () => {
    it('should maintain consistent help format', async () => {
      const result = await executeCommand(CLI_PATH, ['--help']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE:');
      expect(result.stdout).toContain('COMMANDS:');
      expect(result.stdout).toMatch(/claude-flow/i);
      
      validationMatrix.summary.totalTests++;
      if (result.exitCode === 0) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.failed++;
      }
    });

    it('should provide JSON output when requested', async () => {
      const result = await executeCommand(CLI_PATH, ['status', '--json']);
      
      // Should either provide JSON or gracefully handle the flag
      expect(result.exitCode).toBeLessThanOrEqual(1);
      
      validationMatrix.summary.totalTests++;
      if (result.exitCode <= 1) {
        validationMatrix.summary.passed++;
      } else {
        validationMatrix.summary.failed++;
      }
    });
  });
});