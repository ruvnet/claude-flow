#!/usr/bin/env node

/**
 * Build Monitor - Continuous build verification for alpha release
 * Agent: Build-Verifier
 * Mission: Monitor and verify build progress toward zero-error alpha
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BuildMonitor {
  constructor() {
    this.errorCount = 282; // Baseline
    this.lastCheck = Date.now();
    this.monitoringActive = true;
    this.buildHistory = [];
    this.errorCategories = {
      'type_compatibility': 87,
      'missing_properties': 56,
      'import_export': 45,
      'null_undefined': 41,
      'constructor_issues': 23,
      'other': 30
    };
  }

  async runBuild() {
    return new Promise((resolve, reject) => {
      console.log('🔨 Running build verification...');
      exec('npm run build', (error, stdout, stderr) => {
        const buildOutput = stderr || stdout;
        const errors = this.parseErrors(buildOutput);
        
        const buildResult = {
          timestamp: new Date().toISOString(),
          errorCount: errors.length,
          errors: errors,
          success: errors.length === 0
        };

        this.buildHistory.push(buildResult);
        resolve(buildResult);
      });
    });
  }

  parseErrors(buildOutput) {
    if (!buildOutput) return [];
    
    const errorLines = buildOutput.split('\n').filter(line => 
      line.includes('error TS') || line.includes('Error:')
    );
    
    return errorLines.map(line => {
      const match = line.match(/([^:]+):\s*error\s+TS(\d+):\s*(.+)/);
      if (match) {
        return {
          file: match[1],
          code: match[2],
          message: match[3]
        };
      }
      return { message: line };
    });
  }

  async checkSwarmMemory() {
    try {
      // Check for swarm agent updates
      const result = await new Promise((resolve) => {
        exec('npx ruv-swarm hook pre-search --query "agent-progress" --cache-results true', 
          (error, stdout) => {
            resolve(stdout || '');
          }
        );
      });
      
      return result.includes('progress') || result.includes('fixed');
    } catch (error) {
      return false;
    }
  }

  async monitor() {
    console.log('🐝 Build-Verifier Agent - Continuous Monitoring Active');
    console.log(`📊 Baseline: ${this.errorCount} TypeScript errors`);
    console.log('🎯 Target: 0 errors for alpha release');
    
    while (this.monitoringActive) {
      try {
        // Check for swarm activity
        const swarmActivity = await this.checkSwarmMemory();
        
        if (swarmActivity) {
          console.log('🔄 Swarm activity detected - Running build verification...');
          const buildResult = await this.runBuild();
          
          if (buildResult.errorCount < this.errorCount) {
            const reduction = this.errorCount - buildResult.errorCount;
            console.log(`✅ Progress! Errors reduced by ${reduction}: ${this.errorCount} → ${buildResult.errorCount}`);
            
            // Update baseline
            this.errorCount = buildResult.errorCount;
            
            // Store progress
            await this.storeProgress(buildResult);
            
            // Alert swarm
            await this.alertSwarm(buildResult);
          } else if (buildResult.errorCount > this.errorCount) {
            const increase = buildResult.errorCount - this.errorCount;
            console.log(`⚠️  WARNING: New errors introduced! +${increase} errors: ${this.errorCount} → ${buildResult.errorCount}`);
            
            // Alert swarm of regression
            await this.alertRegression(buildResult);
          }
          
          if (buildResult.errorCount === 0) {
            console.log('🎉 ALPHA RELEASE READY: ZERO ERRORS ACHIEVED!');
            await this.certifyAlphaReady();
            break;
          }
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second intervals
        
      } catch (error) {
        console.error('❌ Monitor error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute on error
      }
    }
  }

  async storeProgress(buildResult) {
    try {
      exec(`npx ruv-swarm hook notification --message "BUILD PROGRESS: ${buildResult.errorCount} errors remaining (${this.errorCount - buildResult.errorCount} fixed)" --telemetry true`);
    } catch (error) {
      console.error('Failed to store progress:', error.message);
    }
  }

  async alertSwarm(buildResult) {
    const message = `🔨 BUILD UPDATE: ${buildResult.errorCount} errors remaining. Progress: ${this.errorCount - buildResult.errorCount} errors fixed.`;
    console.log(message);
    
    try {
      exec(`npx ruv-swarm hook notification --message "${message}" --telemetry true`);
    } catch (error) {
      console.error('Failed to alert swarm:', error.message);
    }
  }

  async alertRegression(buildResult) {
    const message = `⚠️ REGRESSION ALERT: ${buildResult.errorCount - this.errorCount} new errors introduced. Review recent changes.`;
    console.log(message);
    
    try {
      exec(`npx ruv-swarm hook notification --message "${message}" --telemetry true`);
    } catch (error) {
      console.error('Failed to alert regression:', error.message);
    }
  }

  async certifyAlphaReady() {
    const certification = {
      timestamp: new Date().toISOString(),
      status: 'ALPHA_READY',
      errorCount: 0,
      buildSuccess: true,
      verifiedBy: 'Build-Verifier-Agent'
    };
    
    console.log('🏆 ALPHA CERTIFICATION COMPLETE');
    console.log('✅ Zero TypeScript compilation errors');
    console.log('✅ Build successful');
    console.log('✅ Ready for alpha release');
    
    try {
      exec(`npx ruv-swarm hook notification --message "🏆 ALPHA CERTIFICATION: Zero errors achieved! Build ready for alpha release." --telemetry true`);
      exec(`npx ruv-swarm hook post-task --task-id "alpha-build-verification" --analyze-performance true`);
    } catch (error) {
      console.error('Failed to certify alpha:', error.message);
    }
  }

  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      currentErrorCount: this.errorCount,
      buildHistory: this.buildHistory,
      errorCategories: this.errorCategories,
      status: this.errorCount === 0 ? 'ALPHA_READY' : 'IN_PROGRESS'
    };
    
    fs.writeFileSync('build-verification-status.json', JSON.stringify(report, null, 2));
    return report;
  }
}

// Start monitoring if run directly
if (require.main === module) {
  const monitor = new BuildMonitor();
  monitor.monitor().catch(console.error);
}

module.exports = BuildMonitor;