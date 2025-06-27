#!/usr/bin/env node

/**
 * Performance Baseline Measurement Suite
 * Phase 2 CLI Consolidation & Runtime Migration
 * 
 * Measures current system performance for:
 * - CLI startup times
 * - Memory usage patterns
 * - Command execution latency
 * - File system operations
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { performance } from 'perf_hooks';
import { writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PerformanceBaseline {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      system: {},
      cli: {},
      commands: {},
      memory: {},
      runtime: {}
    };
  }

  async collectSystemInfo() {
    console.log('📊 Collecting system information...');
    
    try {
      const { stdout: nodeVersion } = await execAsync('node --version');
      const { stdout: npmVersion } = await execAsync('npm --version');
      const { stdout: platform } = await execAsync('uname -a').catch(() => ({ stdout: process.platform }));
      
      this.results.system = {
        nodeVersion: nodeVersion.trim(),
        npmVersion: npmVersion.trim(),
        platform: platform.trim(),
        arch: process.arch,
        cpuCount: require('os').cpus().length,
        totalMemory: Math.round(require('os').totalmem() / 1024 / 1024) + 'MB'
      };
    } catch (error) {
      console.warn('⚠️  Could not collect full system info:', error.message);
    }
  }

  async measureCliStartup() {
    console.log('⏱️  Measuring CLI startup times...');
    
    const cliPath = join(__dirname, '..', 'cli.js');
    const measurements = [];
    
    // Measure cold starts
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      
      try {
        await new Promise((resolve, reject) => {
          const child = spawn('node', [cliPath, '--version'], {
            stdio: 'pipe'
          });
          
          let output = '';
          child.stdout.on('data', (data) => {
            output += data.toString();
          });
          
          child.on('close', (code) => {
            if (code === 0) resolve(output);
            else reject(new Error(`Exit code: ${code}`));
          });
          
          child.on('error', reject);
          
          // Timeout after 5 seconds
          setTimeout(() => {
            child.kill();
            reject(new Error('Timeout'));
          }, 5000);
        });
        
        const end = performance.now();
        measurements.push(end - start);
      } catch (error) {
        console.warn(`⚠️  Startup measurement ${i + 1} failed:`, error.message);
        measurements.push(null);
      }
    }
    
    const validMeasurements = measurements.filter(m => m !== null);
    
    this.results.cli.startup = {
      measurements: validMeasurements,
      average: validMeasurements.reduce((a, b) => a + b, 0) / validMeasurements.length,
      min: Math.min(...validMeasurements),
      max: Math.max(...validMeasurements),
      median: validMeasurements.sort((a, b) => a - b)[Math.floor(validMeasurements.length / 2)],
      successRate: (validMeasurements.length / measurements.length) * 100
    };
  }

  async measureCommandLatency() {
    console.log('🔍 Measuring command execution latency...');
    
    const commands = [
      ['--help'],
      ['status'],
      ['config', 'show'],
      ['memory', 'list']
    ];
    
    for (const cmd of commands) {
      const measurements = [];
      const commandName = cmd.join(' ');
      
      console.log(`  Testing: ${commandName}`);
      
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        
        try {
          await new Promise((resolve, reject) => {
            const child = spawn('node', [join(__dirname, '..', 'cli.js'), ...cmd], {
              stdio: 'pipe'
            });
            
            child.on('close', (code) => {
              resolve(code);
            });
            
            child.on('error', reject);
            
            setTimeout(() => {
              child.kill();
              reject(new Error('Timeout'));
            }, 10000);
          });
          
          const end = performance.now();
          measurements.push(end - start);
        } catch (error) {
          measurements.push(null);
        }
      }
      
      const validMeasurements = measurements.filter(m => m !== null);
      
      this.results.commands[commandName] = {
        measurements: validMeasurements,
        average: validMeasurements.length > 0 ? 
          validMeasurements.reduce((a, b) => a + b, 0) / validMeasurements.length : 0,
        successRate: (validMeasurements.length / measurements.length) * 100
      };
    }
  }

  async measureMemoryUsage() {
    console.log('💾 Measuring memory usage patterns...');
    
    const start = process.memoryUsage();
    
    // Import major modules to measure loading impact
    const modules = [
      '../src/config/config-manager.js',
      '../src/core/orchestrator.js'
    ];
    
    const moduleMemory = {};
    
    for (const modulePath of modules) {
      const beforeImport = process.memoryUsage();
      
      try {
        const fullPath = join(__dirname, modulePath);
        if (existsSync(fullPath)) {
          await import(fullPath);
          const afterImport = process.memoryUsage();
          
          moduleMemory[modulePath] = {
            heapUsed: afterImport.heapUsed - beforeImport.heapUsed,
            heapTotal: afterImport.heapTotal - beforeImport.heapTotal,
            external: afterImport.external - beforeImport.external
          };
        }
      } catch (error) {
        console.warn(`⚠️  Could not measure memory for ${modulePath}:`, error.message);
        moduleMemory[modulePath] = { error: error.message };
      }
    }
    
    const end = process.memoryUsage();
    
    this.results.memory = {
      baseline: start,
      afterModuleLoading: end,
      moduleImpact: moduleMemory,
      totalIncrease: {
        heapUsed: end.heapUsed - start.heapUsed,
        heapTotal: end.heapTotal - start.heapTotal,
        external: end.external - start.external
      }
    };
  }

  async measureFileSystemOperations() {
    console.log('📁 Measuring file system operation performance...');
    
    const testPath = join(__dirname, '..', 'cli.js');
    const measurements = {
      existsCheck: [],
      readPackageJson: [],
      configLoad: []
    };
    
    // Test file existence checks
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      existsSync(testPath);
      const end = performance.now();
      measurements.existsCheck.push(end - start);
    }
    
    // Test package.json reading
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      try {
        const fs = await import('fs/promises');
        await fs.readFile(join(__dirname, '..', 'package.json'), 'utf8');
        const end = performance.now();
        measurements.readPackageJson.push(end - start);
      } catch (error) {
        measurements.readPackageJson.push(null);
      }
    }
    
    this.results.runtime.fileSystem = {
      existsCheck: {
        average: measurements.existsCheck.reduce((a, b) => a + b, 0) / measurements.existsCheck.length,
        min: Math.min(...measurements.existsCheck),
        max: Math.max(...measurements.existsCheck)
      },
      readPackageJson: {
        measurements: measurements.readPackageJson.filter(m => m !== null),
        average: measurements.readPackageJson.filter(m => m !== null)
          .reduce((a, b) => a + b, 0) / measurements.readPackageJson.filter(m => m !== null).length
      }
    };
  }

  async runFullBaseline() {
    console.log('🚀 Starting Performance Baseline Measurement Suite');
    console.log('=' .repeat(60));
    
    try {
      await this.collectSystemInfo();
      await this.measureCliStartup();
      await this.measureCommandLatency();
      await this.measureMemoryUsage();
      await this.measureFileSystemOperations();
      
      // Save results
      const outputPath = join(__dirname, `performance-baseline-${Date.now()}.json`);
      writeFileSync(outputPath, JSON.stringify(this.results, null, 2));
      
      console.log('\n📊 Baseline Measurement Complete');
      console.log('=' .repeat(60));
      this.printSummary();
      console.log(`\n💾 Full results saved to: ${outputPath}`);
      
      return this.results;
    } catch (error) {
      console.error('❌ Baseline measurement failed:', error);
      throw error;
    }
  }

  printSummary() {
    const cli = this.results.cli;
    const memory = this.results.memory;
    
    console.log('\n📈 PERFORMANCE SUMMARY');
    console.log('-'.repeat(40));
    
    if (cli.startup) {
      console.log(`CLI Startup (avg): ${cli.startup.average?.toFixed(2)}ms`);
      console.log(`CLI Startup (min): ${cli.startup.min?.toFixed(2)}ms`);
      console.log(`CLI Startup (max): ${cli.startup.max?.toFixed(2)}ms`);
      console.log(`Success Rate: ${cli.startup.successRate?.toFixed(1)}%`);
    }
    
    if (memory.totalIncrease) {
      console.log(`Memory Impact: ${Math.round(memory.totalIncrease.heapUsed / 1024 / 1024 * 100) / 100}MB`);
    }
    
    console.log('\n🎯 OPTIMIZATION TARGETS');
    console.log('-'.repeat(40));
    console.log('• CLI Startup: Target <100ms');
    console.log('• Memory Usage: Target <15MB');
    console.log('• Success Rate: Target 100%');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const baseline = new PerformanceBaseline();
  baseline.runFullBaseline().catch(console.error);
}

export { PerformanceBaseline };