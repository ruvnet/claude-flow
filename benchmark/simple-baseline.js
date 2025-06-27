#!/usr/bin/env node

/**
 * Simple Performance Baseline for Phase 2
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function measureStartup() {
  console.log('🚀 Measuring CLI startup time...');
  
  const cliPath = path.join(__dirname, '..', 'cli.js');
  const measurements = [];
  
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    
    const result = await new Promise((resolve) => {
      const child = spawn('node', [cliPath, '--help'], { 
        stdio: 'pipe',
        timeout: 5000
      });
      
      child.on('close', (code) => {
        const end = performance.now();
        resolve({ 
          success: code === 0, 
          time: end - start,
          code 
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
    console.log(`  Run ${i + 1}: ${result.time.toFixed(2)}ms (${result.success ? 'success' : 'failed'})`);
  }
  
  const successful = measurements.filter(m => m.success);
  const times = successful.map(m => m.time);
  
  if (times.length > 0) {
    console.log('\n📊 Startup Performance:');
    console.log(`  Average: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms`);
    console.log(`  Min: ${Math.min(...times).toFixed(2)}ms`);
    console.log(`  Max: ${Math.max(...times).toFixed(2)}ms`);
    console.log(`  Success Rate: ${(successful.length / measurements.length * 100).toFixed(1)}%`);
  }
  
  return {
    measurements,
    successful: successful.length,
    average: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
  };
}

async function measureMemory() {
  console.log('\n💾 Measuring memory usage...');
  
  const baseline = process.memoryUsage();
  console.log(`  Baseline heap: ${Math.round(baseline.heapUsed / 1024 / 1024 * 100) / 100}MB`);
  
  return baseline;
}

async function main() {
  console.log('🎯 Phase 2 Performance Baseline - Simple Test');
  console.log('=' .repeat(50));
  
  const memory = await measureMemory();
  const startup = await measureStartup();
  
  console.log('\n🎯 PERFORMANCE TARGETS vs CURRENT:');
  console.log('  Startup Time:');
  console.log(`    Target: <100ms`);
  console.log(`    Current: ${startup.average.toFixed(2)}ms`);
  console.log(`    Status: ${startup.average < 100 ? '✅ MEETS TARGET' : '❌ NEEDS OPTIMIZATION'}`);
  
  console.log(`\n  Memory Usage:`);
  console.log(`    Current heap: ${Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100}MB`);
  console.log(`    Target: <15MB`);
  
  const results = {
    timestamp: new Date().toISOString(),
    startup,
    memory,
    nodeVersion: process.version,
    platform: process.platform
  };
  
  const fs = await import('fs');
  fs.writeFileSync(
    path.join(__dirname, `baseline-${Date.now()}.json`), 
    JSON.stringify(results, null, 2)
  );
  
  console.log('\n✅ Baseline measurement complete');
}

main().catch(console.error);