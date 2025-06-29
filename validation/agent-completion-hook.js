#!/usr/bin/env node

/**
 * Agent Completion Hook
 * 
 * This script is designed to be called by other swarm agents when they complete their work.
 * It triggers incremental validation and coordinates with the validation specialist.
 */

import IncrementalValidator from './incremental-validator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AgentCompletionHook {
  constructor() {
    this.validator = new IncrementalValidator();
    this.hooksDir = path.join(__dirname, 'hooks');
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
    }
  }

  /**
   * Called by agents when they complete work
   */
  async onAgentComplete(agentInfo) {
    const {
      agentId,
      role,
      workDescription,
      filesModified = [],
      expectedImpact = 'unknown',
      priority = 'medium'
    } = agentInfo;

    console.log(`\n🔗 Agent completion hook triggered`);
    console.log(`   Agent: ${agentId} (${role})`);
    console.log(`   Work: ${workDescription}`);
    console.log(`   Files: ${filesModified.length} modified`);
    console.log(`   Impact: ${expectedImpact}`);

    // Record the completion
    await this.recordCompletion(agentInfo);

    // Trigger validation based on priority and impact
    const shouldValidateNow = this.shouldTriggerImmediateValidation(agentInfo);
    
    if (shouldValidateNow) {
      console.log(`🚀 Triggering immediate validation...`);
      
      try {
        const results = await this.validator.validateIncremental(
          `${agentId}(${role})`,
          workDescription
        );
        
        // Check if this agent's work caused regressions
        const regressions = this.detectRegressions(results, agentInfo);
        
        if (regressions.length > 0) {
          console.log(`⚠️ Potential regressions detected:`);
          regressions.forEach(regression => {
            console.log(`   - ${regression}`);
          });
          
          // Notify the agent and swarm
          await this.notifyRegressions(agentInfo, regressions);
        } else {
          console.log(`✅ No regressions detected from ${agentId}'s work`);
        }
        
        return results;
        
      } catch (error) {
        console.error(`❌ Validation failed after ${agentId} completion:`, error.message);
        await this.notifyValidationFailure(agentInfo, error);
        throw error;
      }
    } else {
      console.log(`⏳ Validation scheduled for batch processing`);
      return null;
    }
  }

  /**
   * Determine if immediate validation is needed
   */
  shouldTriggerImmediateValidation(agentInfo) {
    const { priority, expectedImpact, filesModified = [] } = agentInfo;
    
    // Always validate high priority or critical impact work
    if (priority === 'high' || priority === 'critical') {
      return true;
    }
    
    if (expectedImpact === 'critical' || expectedImpact === 'high') {
      return true;
    }
    
    // Validate if many files were modified
    if (filesModified.length > 10) {
      return true;
    }
    
    // Validate if core system files were modified
    const coreFiles = filesModified.filter(file => 
      file.includes('/core/') || 
      file.includes('/config/') ||
      file.includes('tsconfig') ||
      file.includes('package.json')
    );
    
    if (coreFiles.length > 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Detect potential regressions caused by agent's work
   */
  detectRegressions(validationResults, agentInfo) {
    const regressions = [];
    const { validations } = validationResults;
    
    // Check for increased TypeScript errors
    if (validations.typescript?.errorCount > 0) {
      // We'd need historical data to compare, but for now flag high error counts
      if (validations.typescript.errorCount > 100) {
        regressions.push(`High TypeScript error count: ${validations.typescript.errorCount}`);
      }
    }
    
    // Check for build failures
    if (validations.build?.status === 'failed') {
      regressions.push('Build is now failing');
    }
    
    // Check for test failures
    if (validations.tests?.status === 'failed') {
      regressions.push('Test suite is now failing');
    }
    
    // Check for specific error patterns related to agent's work
    if (agentInfo.role === 'CLI Developer' && validations.typescript?.errors) {
      const cliErrors = validations.typescript.errors.filter(error => 
        error.includes('cli/') || error.includes('command')
      );
      if (cliErrors.length > 0) {
        regressions.push(`CLI-related TypeScript errors: ${cliErrors.length}`);
      }
    }
    
    if (agentInfo.role === 'Process Registry Developer' && validations.typescript?.errors) {
      const processErrors = validations.typescript.errors.filter(error => 
        error.includes('process') || error.includes('spawn')
      );
      if (processErrors.length > 0) {
        regressions.push(`Process-related TypeScript errors: ${processErrors.length}`);
      }
    }
    
    return regressions;
  }

  /**
   * Record agent completion for tracking
   */
  async recordCompletion(agentInfo) {
    const timestamp = new Date().toISOString();
    const completionFile = path.join(this.hooksDir, `completions-${new Date().toISOString().split('T')[0]}.jsonl`);
    
    const record = {
      timestamp,
      ...agentInfo,
      hookVersion: '1.0.0'
    };
    
    // Append to daily completion log
    fs.appendFileSync(completionFile, JSON.stringify(record) + '\n');
  }

  /**
   * Notify about regressions
   */
  async notifyRegressions(agentInfo, regressions) {
    const notificationFile = path.join(this.hooksDir, `regressions-${Date.now()}.json`);
    
    const notification = {
      timestamp: new Date().toISOString(),
      agentInfo,
      regressions,
      severity: regressions.length > 3 ? 'critical' : 'warning',
      recommendations: [
        'Review recent changes for potential issues',
        'Run focused tests on modified components',
        'Consider reverting changes if regressions are severe',
        'Coordinate with validation specialist for detailed analysis'
      ]
    };
    
    fs.writeFileSync(notificationFile, JSON.stringify(notification, null, 2));
    
    console.log(`📢 Regression notification saved to: ${notificationFile}`);
  }

  /**
   * Notify about validation failures
   */
  async notifyValidationFailure(agentInfo, error) {
    const failureFile = path.join(this.hooksDir, `validation-failures-${Date.now()}.json`);
    
    const notification = {
      timestamp: new Date().toISOString(),
      agentInfo,
      error: {
        message: error.message,
        stack: error.stack
      },
      recommendations: [
        'Check system prerequisites (Node.js, npm, TypeScript)',
        'Verify all dependencies are installed',
        'Review recent system changes',
        'Contact validation specialist for assistance'
      ]
    };
    
    fs.writeFileSync(failureFile, JSON.stringify(notification, null, 2));
    
    console.log(`📢 Validation failure notification saved to: ${failureFile}`);
  }

  /**
   * Batch validation for multiple agents
   */
  async validateBatch() {
    console.log(`\n🔄 Running batch validation for all recent completions...`);
    
    const today = new Date().toISOString().split('T')[0];
    const completionFile = path.join(this.hooksDir, `completions-${today}.jsonl`);
    
    if (!fs.existsSync(completionFile)) {
      console.log('No completions found for today');
      return;
    }
    
    const completions = fs.readFileSync(completionFile, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    
    console.log(`Found ${completions.length} agent completions to validate`);
    
    // Run comprehensive validation
    const results = await this.validator.validateIncremental(
      'batch-validation',
      `Batch validation of ${completions.length} agent completions`
    );
    
    // Analyze collective impact
    const batchAnalysis = this.analyzeBatchResults(completions, results);
    
    console.log(`\n📊 Batch validation complete:`);
    console.log(`   TypeScript errors: ${results.validations?.typescript?.errorCount || 'unknown'}`);
    console.log(`   Build status: ${results.validations?.build?.status || 'unknown'}`);
    console.log(`   Test status: ${results.validations?.tests?.status || 'unknown'}`);
    
    return { results, batchAnalysis };
  }

  /**
   * Analyze results from batch validation
   */
  analyzeBatchResults(completions, validationResults) {
    const analysis = {
      totalAgents: completions.length,
      agentRoles: [...new Set(completions.map(c => c.role))],
      totalFilesModified: completions.reduce((sum, c) => sum + (c.filesModified?.length || 0), 0),
      highImpactWork: completions.filter(c => c.expectedImpact === 'high' || c.priority === 'high').length,
      recommendations: []
    };
    
    // Generate recommendations based on collective work
    if (analysis.totalFilesModified > 50) {
      analysis.recommendations.push('Large number of files modified - consider incremental commits');
    }
    
    if (analysis.highImpactWork > 0) {
      analysis.recommendations.push(`${analysis.highImpactWork} high-impact changes - monitor closely`);
    }
    
    if (validationResults.validations?.typescript?.errorCount > 0) {
      analysis.recommendations.push('TypeScript errors present - prioritize error resolution');
    }
    
    return analysis;
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const hook = new AgentCompletionHook();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'complete':
      // Parse agent completion info from command line
      const agentInfo = {
        agentId: process.argv[3] || 'unknown',
        role: process.argv[4] || 'unknown',
        workDescription: process.argv[5] || 'Work completed',
        priority: process.argv[6] || 'medium',
        expectedImpact: process.argv[7] || 'unknown'
      };
      
      hook.onAgentComplete(agentInfo)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    case 'batch':
      hook.validateBatch()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    default:
      console.log(`
Usage:
  node agent-completion-hook.js complete <agentId> <role> <description> [priority] [impact]
  node agent-completion-hook.js batch

Examples:
  node agent-completion-hook.js complete agent5 "Process Developer" "Fixed ProcessPool integration" high critical
  node agent-completion-hook.js batch
`);
      process.exit(1);
  }
}

export default AgentCompletionHook;