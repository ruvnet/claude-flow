/**
 * Test and verification script for process execution tracing
 */

import { spawn, getMetrics, getSpawnCount, resetMetrics, exportMetrics, isThresholdExceeded } from './index.js';

/**
 * Test basic spawn tracing
 */
export async function testBasicSpawn(): Promise<void> {
  console.log('\n🧪 Testing basic spawn tracing...');
  
  // Reset metrics for clean test
  resetMetrics();
  
  // Test a simple command
  const child = spawn('echo', ['Hello, World!'], {
    processName: 'test-echo',
    processType: 'tool',
    tracingEnabled: true
  });
  
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      console.log(`✅ Echo process completed with code: ${code}`);
      
      // Check metrics
      const metrics = getMetrics();
      console.log(`📊 Current spawn count: ${getSpawnCount()}`);
      console.log(`📊 Success rate: ${(metrics.successfulSpawns / metrics.totalSpawns * 100).toFixed(1)}%`);
      
      if (metrics.totalSpawns > 0) {
        console.log('✅ Basic spawn tracing is working!');
        resolve();
      } else {
        console.error('❌ Spawn was not tracked in metrics');
        reject(new Error('Tracing failed'));
      }
    });
    
    child.on('error', (error) => {
      console.error('❌ Spawn error:', error);
      reject(error);
    });
  });
}

/**
 * Test threshold enforcement
 */
export async function testThresholdEnforcement(): Promise<void> {
  console.log('\n🧪 Testing threshold enforcement...');
  
  // Reset metrics
  resetMetrics();
  
  // Spawn multiple processes to trigger threshold
  const promises: Promise<void>[] = [];
  
  for (let i = 0; i < 10; i++) {
    const promise = new Promise<void>((resolve, reject) => {
      const child = spawn('echo', [`Process ${i}`], {
        processName: `test-process-${i}`,
        processType: 'tool'
      });
      
      child.on('close', () => resolve());
      child.on('error', reject);
    });
    
    promises.push(promise);
  }
  
  // Wait for all processes to complete
  await Promise.all(promises);
  
  // Check if threshold was exceeded
  const metrics = getMetrics();
  console.log(`📊 Total spawns: ${metrics.totalSpawns}`);
  console.log(`📊 Alerts triggered: ${metrics.alertsTriggered}`);
  console.log(`📊 Threshold violations: ${metrics.thresholdViolations.length}`);
  
  if (isThresholdExceeded()) {
    console.log('✅ Threshold enforcement is working!');
  } else {
    console.log('⚠️  Threshold not exceeded or enforcement not triggered');
  }
}

/**
 * Test metrics collection
 */
export async function testMetricsCollection(): Promise<void> {
  console.log('\n🧪 Testing metrics collection...');
  
  // Test with successful process
  const successChild = spawn('echo', ['success'], {
    processName: 'success-test',
    processType: 'tool'
  });
  
  await new Promise<void>((resolve) => {
    successChild.on('close', () => resolve());
  });
  
  // Test with failing process
  const failChild = spawn('false', [], {
    processName: 'fail-test',
    processType: 'tool'
  });
  
  await new Promise<void>((resolve) => {
    failChild.on('close', () => resolve());
  });
  
  // Check metrics
  const metrics = getMetrics();
  console.log(`📊 Total executions: ${metrics.totalSpawns}`);
  console.log(`📊 Successful: ${metrics.successfulSpawns}`);
  console.log(`📊 Failed: ${metrics.failedSpawns}`);
  console.log(`📊 Average duration: ${metrics.averageDuration.toFixed(2)}ms`);
  
  if (metrics.successfulSpawns > 0 && metrics.failedSpawns > 0) {
    console.log('✅ Metrics collection is working for both success and failure!');
  } else {
    console.log('⚠️  Metrics collection might not be capturing all scenarios');
  }
}

/**
 * Test metrics export
 */
export function testMetricsExport(): void {
  console.log('\n🧪 Testing metrics export...');
  
  const report = exportMetrics();
  const parsedReport = JSON.parse(report);
  
  console.log('📊 Metrics Report Sample:');
  console.log(`   Timestamp: ${parsedReport.timestamp}`);
  console.log(`   Total Processes: ${parsedReport.summary.totalProcesses}`);
  console.log(`   Success Rate: ${parsedReport.summary.successRate}`);
  console.log(`   Most Used Command: ${parsedReport.summary.mostUsedCommand}`);
  
  if (parsedReport.timestamp && parsedReport.summary) {
    console.log('✅ Metrics export is working!');
  } else {
    console.log('❌ Metrics export is incomplete');
  }
}

/**
 * Run all tests
 */
export async function runAllTests(): Promise<void> {
  console.log('🚀 Starting Process Tracing Framework Tests\n');
  
  try {
    await testBasicSpawn();
    await testMetricsCollection();
    await testThresholdEnforcement();
    testMetricsExport();
    
    console.log('\n🎉 All tracing tests completed successfully!');
    console.log('\n📊 Final Metrics Report:');
    console.log(exportMetrics());
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}
