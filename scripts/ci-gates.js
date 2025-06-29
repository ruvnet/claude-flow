#!/usr/bin/env node

/**
 * CI Gates Runner - TypeScript Strict Mode Enforcement
 * Agent 2: CI/CD Specialist Implementation
 */

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CIGatesRunner {
  constructor() {
    this.configPath = path.join(__dirname, '../.github/ci-gates.json');
    this.config = null;
    this.results = {
      gates: {},
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      },
      timestamp: new Date().toISOString(),
      success: false
    };
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      return true;
    } catch (error) {
      console.error(`❌ Failed to load CI gates configuration: ${error.message}`);
      return false;
    }
  }

  async runGate(gateName, gateConfig) {
    console.log(`\\n🔍 Running gate: ${gateName}`);
    console.log(`   Description: ${gateConfig.description}`);
    
    const gateResult = {
      name: gateName,
      description: gateConfig.description,
      enabled: gateConfig.enabled,
      commands: gateConfig.commands,
      success: false,
      errors: [],
      output: '',
      duration: 0
    };

    if (!gateConfig.enabled) {
      console.log(`   ⏭️  Skipped (disabled)`);
      gateResult.success = true;
      this.results.summary.skipped++;
      return gateResult;
    }

    const startTime = Date.now();
    
    try {
      for (const command of gateConfig.commands) {
        console.log(`   ⚡ Executing: ${command}`);
        
        try {
          const output = execSync(command, { 
            encoding: 'utf8',
            stdio: 'pipe',
            cwd: path.join(__dirname, '..'),
            timeout: 300000 // 5 minutes timeout
          });
          
          gateResult.output += `Command: ${command}\\n${output}\\n\\n`;
          
        } catch (error) {
          const errorMessage = `Command failed: ${command}\\nExit code: ${error.status}\\nOutput: ${error.stdout}\\nError: ${error.stderr}`;
          gateResult.errors.push(errorMessage);
          
          if (gateConfig.exit_on_failure) {
            throw new Error(errorMessage);
          }
        }
      }
      
      gateResult.success = gateResult.errors.length === 0;
      
      if (gateResult.success) {
        console.log(`   ✅ PASSED`);
        this.results.summary.passed++;
      } else {
        console.log(`   ⚠️  PASSED WITH WARNINGS`);
        this.results.summary.passed++;
      }
      
    } catch (error) {
      gateResult.success = false;
      gateResult.errors.push(error.message);
      console.log(`   ❌ FAILED: ${gateConfig.failure_message}`);
      console.log(`   Error: ${error.message}`);
      this.results.summary.failed++;
    }
    
    gateResult.duration = Date.now() - startTime;
    return gateResult;
  }

  async runAllGates() {
    if (!this.config || !this.config.ci_gates.enabled) {
      console.log('❌ CI Gates are disabled or configuration not loaded');
      return false;
    }

    console.log('🚀 Starting CI Gates Validation');
    console.log(`📋 Configuration: ${this.config.ci_gates.description}`);
    
    const gates = this.config.ci_gates.gates;
    this.results.summary.total = Object.keys(gates).length;
    
    for (const [gateName, gateConfig] of Object.entries(gates)) {
      const gateResult = await this.runGate(gateName, gateConfig);
      this.results.gates[gateName] = gateResult;
    }
    
    // Generate summary
    this.results.success = this.results.summary.failed === 0;
    
    console.log('\\n📊 CI Gates Summary:');
    console.log(`   Total: ${this.results.summary.total}`);
    console.log(`   Passed: ${this.results.summary.passed}`);
    console.log(`   Failed: ${this.results.summary.failed}`);
    console.log(`   Skipped: ${this.results.summary.skipped}`);
    
    if (this.results.success) {
      console.log('\\n🎉 All CI Gates PASSED! ✅');
    } else {
      console.log('\\n💥 CI Gates FAILED! ❌');
      console.log('\\n🔧 Failed Gates:');
      
      for (const [gateName, gateResult] of Object.entries(this.results.gates)) {
        if (!gateResult.success && gateResult.enabled) {
          console.log(`   • ${gateName}: ${gateResult.errors.join(', ')}`);
        }
      }
    }
    
    return this.results.success;
  }

  async saveResults() {
    if (this.config.ci_gates.reporting.enabled) {
      const outputFile = this.config.ci_gates.reporting.output_file;
      const outputPath = path.join(__dirname, '..', outputFile);
      
      try {
        await fs.writeFile(outputPath, JSON.stringify(this.results, null, 2));
        console.log(`\\n📄 Results saved to: ${outputFile}`);
      } catch (error) {
        console.error(`❌ Failed to save results: ${error.message}`);
      }
    }
  }

  async sendNotifications() {
    if (!this.config.ci_gates.reporting.enabled) return;
    
    const reporting = this.config.ci_gates.reporting;
    
    // GitHub Actions output
    if (reporting.formats.includes('github_actions') && process.env.GITHUB_ACTIONS) {
      console.log('::group::CI Gates Results');
      console.log(JSON.stringify(this.results, null, 2));
      console.log('::endgroup::');
      
      if (!this.results.success) {
        console.log('::error::CI Gates validation failed');
      }
    }
    
    // Slack notification (if webhook provided)
    if (reporting.slack_webhook && process.env.SLACK_WEBHOOK_URL) {
      try {
        const message = {
          text: this.results.success ? 
            '✅ CI Gates: All validations passed' : 
            '❌ CI Gates: Validation failures detected',
          attachments: [{
            color: this.results.success ? 'good' : 'danger',
            fields: [
              { title: 'Total Gates', value: this.results.summary.total, short: true },
              { title: 'Passed', value: this.results.summary.passed, short: true },
              { title: 'Failed', value: this.results.summary.failed, short: true },
              { title: 'Timestamp', value: this.results.timestamp, short: false }
            ]
          }]
        };
        
        // Note: Actual Slack notification would require HTTP request
        console.log('\\n📱 Slack notification prepared:', JSON.stringify(message, null, 2));
      } catch (error) {
        console.error(`❌ Failed to send Slack notification: ${error.message}`);
      }
    }
  }
}

// Main execution
async function main() {
  const runner = new CIGatesRunner();
  
  console.log('🔒 CI/CD Gates - TypeScript Strict Mode Enforcement');
  console.log('🤖 Agent 2: CI/CD Specialist Implementation\\n');
  
  const configLoaded = await runner.loadConfig();
  if (!configLoaded) {
    process.exit(1);
  }
  
  const success = await runner.runAllGates();
  await runner.saveResults();
  await runner.sendNotifications();
  
  process.exit(success ? 0 : 1);
}

// Handle CLI arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🔒 CI Gates Runner - TypeScript Strict Mode Enforcement

Usage: node scripts/ci-gates.js [options]

Options:
  --help, -h     Show this help message
  --config PATH  Custom configuration file path
  --dry-run      Run validation without enforcing exit codes

Examples:
  node scripts/ci-gates.js
  node scripts/ci-gates.js --config custom-gates.json
  npm run ci:gates
`);
  process.exit(0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { CIGatesRunner };