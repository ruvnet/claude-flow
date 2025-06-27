#!/usr/bin/env node

/**
 * Performance Monitoring System for Phase 2
 * Continuous performance regression detection
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PerformanceMonitor {
  constructor() {
    this.thresholds = {
      startupTime: 100, // ms
      memoryUsage: 15 * 1024 * 1024, // 15MB in bytes
      successRate: 95 // percentage
    };
    
    this.historyFile = join(__dirname, 'performance-history.json');
    this.loadHistory();
  }

  loadHistory() {
    try {
      if (existsSync(this.historyFile)) {
        const data = readFileSync(this.historyFile, 'utf8');
        this.history = JSON.parse(data);
      } else {
        this.history = { measurements: [] };
      }
    } catch (error) {
      console.warn('⚠️  Could not load performance history:', error.message);
      this.history = { measurements: [] };
    }
  }

  saveHistory() {
    try {
      writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      console.error('❌ Could not save performance history:', error.message);
    }
  }

  async measureCLI(cliPath, testCount = 5) {
    console.log(`🔍 Testing CLI: ${cliPath}`);
    
    const measurements = [];
    let successCount = 0;
    
    for (let i = 0; i < testCount; i++) {
      const start = performance.now();
      
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn('node', [cliPath, '--version'], {
            stdio: 'pipe',
            timeout: 5000
          });
          
          let output = '';
          child.stdout.on('data', (data) => {
            output += data.toString();
          });
          
          child.stderr.on('data', (data) => {
            output += data.toString();
          });
          
          child.on('close', (code) => {
            const end = performance.now();
            resolve({
              success: code === 0,
              time: end - start,
              code,
              output: output.trim()
            });
          });
          
          child.on('error', (err) => {
            const end = performance.now();
            resolve({
              success: false,
              time: end - start,
              error: err.message
            });
          });
        });
        
        measurements.push(result);
        if (result.success) successCount++;
        
        console.log(`  Test ${i + 1}: ${result.time.toFixed(2)}ms (${result.success ? '✅' : '❌'})`);
        
      } catch (error) {
        console.log(`  Test ${i + 1}: Failed - ${error.message}`);
        measurements.push({ success: false, time: 0, error: error.message });
      }
    }
    
    const successfulMeasurements = measurements.filter(m => m.success);
    const times = successfulMeasurements.map(m => m.time);
    
    return {
      measurements,
      successCount,
      successRate: (successCount / testCount) * 100,
      averageTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      minTime: times.length > 0 ? Math.min(...times) : 0,
      maxTime: times.length > 0 ? Math.max(...times) : 0
    };
  }

  analyzePerformance(results, label) {
    console.log(`\n📊 Performance Analysis: ${label}`);
    console.log('=' .repeat(50));
    
    const status = {
      startupTime: results.averageTime <= this.thresholds.startupTime ? '✅' : '❌',
      successRate: results.successRate >= this.thresholds.successRate ? '✅' : '❌',
      overall: 'UNKNOWN'
    };
    
    // Determine overall status
    if (results.successRate >= this.thresholds.successRate && 
        results.averageTime <= this.thresholds.startupTime) {
      status.overall = '✅ EXCELLENT';
    } else if (results.successRate >= this.thresholds.successRate) {
      status.overall = '⚠️  FUNCTIONAL (slow)';
    } else {
      status.overall = '❌ FAILING';
    }
    
    console.log(`Startup Time: ${results.averageTime.toFixed(2)}ms ${status.startupTime} (target: <${this.thresholds.startupTime}ms)`);
    console.log(`Success Rate: ${results.successRate.toFixed(1)}% ${status.successRate} (target: >${this.thresholds.successRate}%)`);
    console.log(`Overall Status: ${status.overall}`);
    
    if (results.successCount > 0) {
      console.log(`Min Time: ${results.minTime.toFixed(2)}ms`);
      console.log(`Max Time: ${results.maxTime.toFixed(2)}ms`);
      console.log(`Variance: ${(results.maxTime - results.minTime).toFixed(2)}ms`);
    }
    
    return status;
  }

  detectRegression(current, previous) {
    if (!previous) return null;
    
    const startupRegression = ((current.averageTime - previous.averageTime) / previous.averageTime) * 100;
    const successRegression = previous.successRate - current.successRate;
    
    const isRegression = startupRegression > 10 || successRegression > 5;
    
    return {
      isRegression,
      startupChange: startupRegression,
      successChange: successRegression,
      severity: isRegression ? (startupRegression > 25 || successRegression > 15 ? 'HIGH' : 'MEDIUM') : 'NONE'
    };
  }

  async runMonitoring() {
    console.log('🚀 Phase 2 Performance Monitoring System');
    console.log('=' .repeat(60));
    
    const timestamp = new Date().toISOString();
    const results = {};
    
    // Test minimal CLI
    const minimalCLI = join(__dirname, 'cli-minimal.js');
    if (existsSync(minimalCLI)) {
      results.minimal = await this.measureCLI(minimalCLI);
      this.analyzePerformance(results.minimal, 'Minimal CLI');
    }
    
    // Test standard CLI
    const standardCLI = join(__dirname, 'cli.js');
    if (existsSync(standardCLI)) {
      console.log('\n');
      results.standard = await this.measureCLI(standardCLI);
      this.analyzePerformance(results.standard, 'Standard CLI');
    }
    
    // Memory monitoring
    const memoryUsage = process.memoryUsage();
    results.memory = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss
    };
    
    console.log('\n💾 Memory Status');
    console.log('=' .repeat(30));
    console.log(`Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100}MB`);
    console.log(`RSS: ${Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100}MB`);
    console.log(`Memory Status: ${memoryUsage.heapUsed < this.thresholds.memoryUsage ? '✅ GOOD' : '❌ HIGH'}`);
    
    // Check for regressions
    const latestMeasurement = this.history.measurements[this.history.measurements.length - 1];
    if (latestMeasurement && results.minimal) {
      const regression = this.detectRegression(results.minimal, latestMeasurement.minimal);
      if (regression && regression.isRegression) {
        console.log('\n🚨 PERFORMANCE REGRESSION DETECTED');
        console.log('=' .repeat(40));
        console.log(`Startup time change: ${regression.startupChange.toFixed(1)}%`);
        console.log(`Success rate change: ${regression.successChange.toFixed(1)}%`);
        console.log(`Severity: ${regression.severity}`);
      }
    }
    
    // Save results
    const measurement = {
      timestamp,
      ...results,
      nodeVersion: process.version,
      platform: process.platform
    };
    
    this.history.measurements.push(measurement);
    
    // Keep only last 50 measurements
    if (this.history.measurements.length > 50) {
      this.history.measurements = this.history.measurements.slice(-50);
    }
    
    this.saveHistory();
    
    console.log('\n📈 Performance Trend');
    console.log('=' .repeat(30));
    if (this.history.measurements.length > 1) {
      const recent = this.history.measurements.slice(-5);
      const avgStartup = recent
        .filter(m => m.minimal && m.minimal.averageTime > 0)
        .map(m => m.minimal.averageTime)
        .reduce((a, b) => a + b, 0) / Math.max(1, recent.filter(m => m.minimal && m.minimal.averageTime > 0).length);
      
      console.log(`Recent average startup: ${avgStartup.toFixed(2)}ms`);
      console.log(`Trend: ${avgStartup <= this.thresholds.startupTime ? '✅ STABLE' : '⚠️  DEGRADING'}`);
    } else {
      console.log('Insufficient data for trend analysis');
    }
    
    console.log('\n✅ Performance monitoring complete');
    console.log(`📁 History saved to: ${this.historyFile}`);
    
    return results;
  }

  async generateReport() {
    console.log('📋 Performance Report Generation');
    console.log('=' .repeat(40));
    
    if (this.history.measurements.length === 0) {
      console.log('⚠️  No performance data available');
      return;
    }
    
    const latest = this.history.measurements[this.history.measurements.length - 1];
    const reportPath = join(__dirname, `performance-report-${Date.now()}.json`);
    
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalMeasurements: this.history.measurements.length,
        latestResults: latest,
        thresholds: this.thresholds
      },
      recommendations: []
    };
    
    // Generate recommendations
    if (latest.minimal) {
      if (latest.minimal.averageTime > this.thresholds.startupTime) {
        report.recommendations.push({
          type: 'PERFORMANCE',
          priority: 'HIGH',
          issue: 'Startup time exceeds target',
          current: `${latest.minimal.averageTime.toFixed(2)}ms`,
          target: `<${this.thresholds.startupTime}ms`,
          suggestions: [
            'Profile startup bottlenecks',
            'Lazy load non-essential modules',
            'Optimize CLI bootstrap process'
          ]
        });
      }
      
      if (latest.minimal.successRate < this.thresholds.successRate) {
        report.recommendations.push({
          type: 'RELIABILITY',
          priority: 'CRITICAL',
          issue: 'Success rate below target',
          current: `${latest.minimal.successRate.toFixed(1)}%`,
          target: `>${this.thresholds.successRate}%`,
          suggestions: [
            'Investigate error patterns',
            'Add error recovery mechanisms',
            'Improve system reliability'
          ]
        });
      }
    }
    
    if (report.recommendations.length === 0) {
      report.recommendations.push({
        type: 'STATUS',
        priority: 'INFO',
        issue: 'Performance targets met',
        suggestions: ['Continue monitoring', 'Maintain current performance levels']
      });
    }
    
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log('📊 Report Summary:');
    console.log(`Total measurements: ${report.summary.totalMeasurements}`);
    console.log(`Recommendations: ${report.recommendations.length}`);
    console.log(`Report saved to: ${reportPath}`);
    
    return report;
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const monitor = new PerformanceMonitor();
  
  if (args.includes('--report') || args.includes('-r')) {
    await monitor.generateReport();
  } else {
    await monitor.runMonitoring();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { PerformanceMonitor };