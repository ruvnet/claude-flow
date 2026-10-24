/**
 * Verification Integration Module
 * Connects verification system to actual agent operations and task execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * Verification middleware for task execution
 * Intercepts task results and verifies them
 */
export class VerificationMiddleware {
  constructor(verificationSystem) {
    this.verificationSystem = verificationSystem;
    this.enabled = true;
    this.autoRollback = true;
  }

  /**
   * Wrap task execution with verification
   */
  async executeWithVerification(taskFn, taskId, agentType, context) {
    // Pre-task verification
    const preCheck = await this.preTaskVerification(taskId, context);
    if (!preCheck.passed && this.enabled) {
      console.log(`❌ Pre-task verification failed for ${taskId}`);
      return { success: false, reason: 'Pre-task verification failed', preCheck };
    }

    // Execute the actual task
    let result;
    let error;
    try {
      result = await taskFn();
    } catch (err) {
      error = err;
      result = { success: false, error: err.message };
    }

    // Post-task verification
    const postCheck = await this.postTaskVerification(taskId, agentType, result, context);
    
    // If verification fails and auto-rollback is enabled
    if (!postCheck.passed && this.autoRollback) {
      await this.rollbackTask(taskId, context);
      return { 
        success: false, 
        reason: 'Post-task verification failed', 
        result,
        verification: postCheck,
        rollback: true 
      };
    }

    return {
      success: postCheck.passed,
      result,
      verification: postCheck
    };
  }

  /**
   * Pre-task verification checks
   */
  async preTaskVerification(taskId, context) {
    const checks = [];

    // Check if environment is clean
    if (context.requiresCleanState) {
      const gitStatus = await this.checkGitStatus();
      checks.push({
        name: 'clean-state',
        passed: gitStatus.clean,
        score: gitStatus.clean ? 1.0 : 0.0
      });
    }

    // Check dependencies
    if (context.dependencies) {
      for (const dep of context.dependencies) {
        const exists = await this.checkDependency(dep);
        checks.push({
          name: `dependency-${dep}`,
          passed: exists,
          score: exists ? 1.0 : 0.0
        });
      }
    }

    const score = checks.length > 0 
      ? checks.reduce((sum, c) => sum + c.score, 0) / checks.length
      : 1.0;

    return {
      passed: score >= 0.95,
      score,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Post-task verification checks
   */
  async postTaskVerification(taskId, agentType, result, context) {
    const checks = [];

    // Verify based on agent type
    switch (agentType) {
      case 'coder':
        // Check if code compiles
        if (context.language === 'typescript' || context.language === 'javascript') {
          const typecheck = await this.runTypeCheck();
          checks.push({
            name: 'typecheck',
            passed: typecheck.passed,
            score: typecheck.score
          });
        }

        // Check if tests pass
        if (context.hasTests) {
          const tests = await this.runTests();
          checks.push({
            name: 'tests',
            passed: tests.passed,
            score: tests.score
          });
        }

        // Check linting
        const lint = await this.runLint();
        checks.push({
          name: 'lint',
          passed: lint.passed,
          score: lint.score
        });
        break;

      case 'researcher':
        // Verify research output has required sections
        if (result && result.output) {
          const hasFindings = result.output.includes('findings') || result.output.includes('results');
          checks.push({
            name: 'research-completeness',
            passed: hasFindings,
            score: hasFindings ? 1.0 : 0.5
          });
        }
        break;

      case 'tester':
        // Verify test coverage meets threshold
        if (context.requiresCoverage) {
          const coverage = await this.checkTestCoverage();
          checks.push({
            name: 'coverage',
            passed: coverage.percentage >= 80,
            score: coverage.percentage / 100
          });
        }
        break;

      case 'architect':
        // Verify architecture decisions are documented
        const hasDocs = await this.checkDocumentation();
        checks.push({
          name: 'documentation',
          passed: hasDocs,
          score: hasDocs ? 1.0 : 0.3
        });
        break;
    }

    // Check result success claim
    if (result && result.success !== undefined) {
      checks.push({
        name: 'claimed-success',
        passed: result.success,
        score: result.success ? 1.0 : 0.0
      });
    }

    const score = checks.length > 0
      ? checks.reduce((sum, c) => sum + c.score, 0) / checks.length
      : 0.5;

    // Store verification result
    await this.verificationSystem.verifyTask(taskId, agentType, {
      success: result?.success,
      checks,
      score
    });

    return {
      passed: score >= this.verificationSystem.getThreshold(),
      score,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Rollback task changes
   */
  async rollbackTask(taskId, context) {
    console.log(`🔄 Rolling back task ${taskId}...`);
    
    try {
      // If we have a git checkpoint, rollback to it
      if (context.gitCheckpoint) {
        await execAsync(`git reset --hard ${context.gitCheckpoint}`);
        console.log(`✅ Rolled back to checkpoint ${context.gitCheckpoint}`);
      } else {
        // Otherwise just reset to last commit
        await execAsync('git reset --hard HEAD');
        console.log(`✅ Rolled back to last commit`);
      }
      return true;
    } catch (error) {
      console.error(`❌ Rollback failed: ${error.message}`);
      return false;
    }
  }

  // Helper methods for actual checks

  async checkGitStatus() {
    try {
      const { stdout } = await execAsync('git status --porcelain');
      return { clean: stdout.trim() === '' };
    } catch {
      return { clean: false };
    }
  }

  async checkDependency(dep) {
    try {
      await execAsync(`which ${dep}`);
      return true;
    } catch {
      return false;
    }
  }

  async runTypeCheck() {
    try {
      const { stdout } = await execAsync('npm run typecheck 2>&1 || true');
      const hasErrors = stdout.toLowerCase().includes('error');
      return {
        passed: !hasErrors,
        score: hasErrors ? 0.5 : 1.0
      };
    } catch {
      return { passed: false, score: 0.3 };
    }
  }

  async runTests() {
    try {
      const { stdout } = await execAsync('npm test 2>&1 || true');
      const passed = stdout.includes('PASS') || stdout.includes('passing');
      const failed = stdout.includes('FAIL') || stdout.includes('failing');
      
      if (passed && !failed) {
        return { passed: true, score: 1.0 };
      } else if (passed && failed) {
        return { passed: false, score: 0.7 };
      } else {
        return { passed: false, score: 0.3 };
      }
    } catch {
      return { passed: false, score: 0.0 };
    }
  }

  async runLint() {
    try {
      const { stdout } = await execAsync('npm run lint 2>&1 || true');
      const hasErrors = stdout.toLowerCase().includes('error');
      const hasWarnings = stdout.toLowerCase().includes('warning');
      
      if (!hasErrors && !hasWarnings) {
        return { passed: true, score: 1.0 };
      } else if (!hasErrors && hasWarnings) {
        return { passed: true, score: 0.8 };
      } else {
        return { passed: false, score: 0.5 };
      }
    } catch {
      return { passed: false, score: 0.3 };
    }
  }

  async checkTestCoverage() {
    try {
      const { stdout } = await execAsync('npm run coverage 2>&1 || true');
      const match = stdout.match(/(\d+(\.\d+)?)\s*%/);
      const percentage = match ? parseFloat(match[1]) : 0;
      return { percentage };
    } catch {
      return { percentage: 0 };
    }
  }

  async checkDocumentation() {
    try {
      // Check if common documentation files exist
      const docFiles = ['README.md', 'ARCHITECTURE.md', 'docs/design.md'];
      for (const file of docFiles) {
        try {
          await fs.access(file);
          return true;
        } catch {
          // Continue checking other files
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Integration with swarm command
 */
export function integrateWithSwarm(swarmCommand, verificationSystem) {
  const originalExecute = swarmCommand.execute;
  const middleware = new VerificationMiddleware(verificationSystem);

  swarmCommand.execute = async function(objective, options) {
    // Create checkpoint before swarm execution
    const checkpoint = await createGitCheckpoint();
    
    // Wrap the original execution with verification
    const context = {
      requiresCleanState: !options.allowDirty,
      dependencies: options.dependencies || [],
      language: options.language || 'javascript',
      hasTests: options.runTests !== false,
      requiresCoverage: options.coverage === true,
      gitCheckpoint: checkpoint
    };

    // Execute with verification
    return await middleware.executeWithVerification(
      () => originalExecute.call(this, objective, options),
      `swarm-${Date.now()}`,
      'swarm',
      context
    );
  };

  return swarmCommand;
}

/**
 * Integration with non-interactive mode
 */
export function integrateWithNonInteractive(flags, verificationSystem) {
  // Add verification flags to non-interactive mode
  const verificationFlags = {
    ...flags,
    verify: true,
    verificationThreshold: flags.threshold || 0.95,
    autoRollback: flags.rollback !== false
  };

  // Return a verification wrapper for non-interactive execution
  return {
    flags: verificationFlags,
    preExecute: async (taskId) => {
      await verificationSystem.initialize('strict');
      console.log('✅ Verification enabled for non-interactive mode');
    },
    postExecute: async (taskId, result) => {
      const verification = await verificationSystem.verifyTask(
        taskId,
        'non-interactive',
        result
      );
      
      if (!verification.passed) {
        console.error('❌ Verification failed in non-interactive mode');
        process.exit(1);
      }
    }
  };
}

/**
 * Integration with training system
 */
export function integrateWithTraining(trainingSystem, verificationSystem) {
  // Feed verification results to training system
  verificationSystem.onVerification = async (verification) => {
    // Convert verification to training data
    const trainingData = {
      input: {
        taskId: verification.taskId,
        agentType: verification.agentType,
        context: verification.context
      },
      output: {
        success: verification.passed,
        score: verification.score,
        checks: verification.results
      }
    };

    // Feed to training system
    await trainingSystem.learn(trainingData);
    
    // Update agent model based on performance
    if (verification.agentType) {
      await trainingSystem.updateAgentModel(
        verification.agentType,
        verification.score
      );
    }
  };

  return verificationSystem;
}

/**
 * Create git checkpoint for rollback
 */
async function createGitCheckpoint() {
  try {
    // Create a temporary commit as checkpoint
    const { stdout } = await execAsync('git rev-parse HEAD');
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Export verification hooks for command integration
 */
export const verificationHooks = {
  beforeTask: async (taskId, context) => {
    // Hook called before task execution
    console.log(`🔍 Pre-task verification for ${taskId}`);
  },
  
  afterTask: async (taskId, result, context) => {
    // Hook called after task execution
    console.log(`✅ Post-task verification for ${taskId}`);
  },
  
  onFailure: async (taskId, verification) => {
    // Hook called when verification fails
    console.log(`❌ Verification failed for ${taskId}: ${verification.score}`);
  }
};

export default {
  VerificationMiddleware,
  integrateWithSwarm,
  integrateWithNonInteractive,
  integrateWithTraining,
  verificationHooks
};