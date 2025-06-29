#!/usr/bin/env node
/**
 * Build Monitor Script for Mega Swarm Operations
 * Created by Build Systems Agent #7
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface BuildStatus {
  timestamp: string;
  totalErrors: number;
  errorByType: Record<string, number>;
  buildSuccess: boolean;
  duration: number;
}

class BuildMonitor {
  private statusFile = join(process.cwd(), 'memory/data/typescript-strict-mega-swarm/build-status.json');
  private lastStatus: BuildStatus | null = null;

  constructor() {
    this.loadLastStatus();
  }

  private loadLastStatus() {
    if (existsSync(this.statusFile)) {
      try {
        this.lastStatus = JSON.parse(readFileSync(this.statusFile, 'utf-8'));
      } catch (error) {
        console.error('Failed to load last build status:', error);
      }
    }
  }

  async checkBuild(): Promise<BuildStatus> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    try {
      // Run build and capture output
      const output = execSync('npm run build 2>&1', { encoding: 'utf-8' });
      
      // Parse errors
      const errorLines = output.split('\n').filter(line => line.includes('error TS'));
      const errorByType: Record<string, number> = {};
      
      errorLines.forEach(line => {
        const match = line.match(/error TS(\d+):/);
        if (match) {
          const errorCode = `TS${match[1]}`;
          errorByType[errorCode] = (errorByType[errorCode] || 0) + 1;
        }
      });
      
      const status: BuildStatus = {
        timestamp,
        totalErrors: errorLines.length,
        errorByType,
        buildSuccess: errorLines.length === 0,
        duration: Date.now() - startTime
      };
      
      // Save status
      writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
      
      // Report changes
      if (this.lastStatus) {
        this.reportChanges(this.lastStatus, status);
      }
      
      this.lastStatus = status;
      return status;
      
    } catch (error: any) {
      // Build failed
      const output = error.stdout || error.toString();
      const errorLines = output.split('\n').filter((line: string) => line.includes('error TS'));
      const errorByType: Record<string, number> = {};
      
      errorLines.forEach((line: string) => {
        const match = line.match(/error TS(\d+):/);
        if (match) {
          const errorCode = `TS${match[1]}`;
          errorByType[errorCode] = (errorByType[errorCode] || 0) + 1;
        }
      });
      
      const status: BuildStatus = {
        timestamp,
        totalErrors: errorLines.length,
        errorByType,
        buildSuccess: false,
        duration: Date.now() - startTime
      };
      
      writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
      
      if (this.lastStatus) {
        this.reportChanges(this.lastStatus, status);
      }
      
      this.lastStatus = status;
      return status;
    }
  }

  private reportChanges(previous: BuildStatus, current: BuildStatus) {
    const diff = current.totalErrors - previous.totalErrors;
    
    if (diff === 0) {
      console.log('✓ Build errors unchanged:', current.totalErrors);
    } else if (diff < 0) {
      console.log(`✅ Build improved! Errors reduced by ${-diff} (${previous.totalErrors} → ${current.totalErrors})`);
    } else {
      console.log(`⚠️  Build degraded! Errors increased by ${diff} (${previous.totalErrors} → ${current.totalErrors})`);
    }
    
    // Report specific error type changes
    const allErrorTypes = new Set([
      ...Object.keys(previous.errorByType),
      ...Object.keys(current.errorByType)
    ]);
    
    allErrorTypes.forEach(errorType => {
      const prevCount = previous.errorByType[errorType] || 0;
      const currCount = current.errorByType[errorType] || 0;
      const typeDiff = currCount - prevCount;
      
      if (typeDiff < 0) {
        console.log(`  ${errorType}: ${prevCount} → ${currCount} (${typeDiff})`);
      } else if (typeDiff > 0) {
        console.log(`  ${errorType}: ${prevCount} → ${currCount} (+${typeDiff})`);
      }
    });
  }

  async monitorContinuously(intervalMs = 30000) {
    console.log('Starting build monitor...');
    console.log(`Checking every ${intervalMs / 1000} seconds`);
    
    // Initial check
    await this.checkBuild();
    
    // Set up interval
    setInterval(async () => {
      console.log('\n--- Build Check ---');
      await this.checkBuild();
    }, intervalMs);
  }
}

// Run monitor if called directly
import { fileURLToPath } from 'url';

if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new BuildMonitor();
  
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    const intervalIndex = args.indexOf('--interval');
    const interval = intervalIndex !== -1 && args[intervalIndex + 1] 
      ? parseInt(args[intervalIndex + 1]) * 1000 
      : 30000;
    monitor.monitorContinuously(interval);
  } else {
    monitor.checkBuild().then(status => {
      console.log('Build Status:', {
        errors: status.totalErrors,
        success: status.buildSuccess,
        duration: `${status.duration}ms`
      });
      process.exit(status.buildSuccess ? 0 : 1);
    });
  }
}

export { BuildMonitor, BuildStatus };