#!/usr/bin/env ts-node

/**
 * Quick Integration Test Runner
 * Applies fixes from Memory and validates TypeScript compilation
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

interface TestResult {
  success: boolean;
  errorCount: number;
  errors: string[];
  duration: number;
}

async function runTypeCheck(): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let errorCount = 0;

  try {
    const { stdout, stderr } = await execAsync('npm run typecheck', {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    // If we get here, typecheck passed!
    return {
      success: true,
      errorCount: 0,
      errors: [],
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    // TypeScript errors are expected
    if (error.stderr) {
      const lines = error.stderr.split('\n');
      for (const line of lines) {
        if (line.includes('error TS')) {
          errors.push(line.trim());
          errorCount++;
        }
      }
    }
    
    return {
      success: false,
      errorCount,
      errors: errors.slice(0, 10), // First 10 errors for brevity
      duration: Date.now() - startTime
    };
  }
}

async function compareResults(baseline: TestResult, current: TestResult): Promise<void> {
  console.log('\n📊 Comparison Results:');
  console.log(`Baseline errors: ${baseline.errorCount}`);
  console.log(`Current errors: ${current.errorCount}`);
  
  const improvement = baseline.errorCount - current.errorCount;
  const percentImprovement = baseline.errorCount > 0 
    ? ((improvement / baseline.errorCount) * 100).toFixed(1)
    : '0';
    
  if (improvement > 0) {
    console.log(`✅ Fixed ${improvement} errors (${percentImprovement}% improvement)`);
  } else if (improvement < 0) {
    console.log(`❌ Introduced ${Math.abs(improvement)} new errors`);
  } else {
    console.log(`➖ No change in error count`);
  }
  
  console.log(`\nTest duration: ${current.duration}ms`);
}

async function main() {
  console.log('🧪 Quick Integration Test Runner\n');
  
  // Get baseline
  console.log('📈 Running baseline test...');
  const baseline = await runTypeCheck();
  console.log(`Baseline: ${baseline.errorCount} errors found`);
  
  // Show sample errors
  if (baseline.errors.length > 0) {
    console.log('\nSample baseline errors:');
    baseline.errors.slice(0, 5).forEach(err => {
      console.log(`  - ${err}`);
    });
  }
  
  // Placeholder for when fixes are available
  console.log('\n⏳ Waiting for fixes from other agents...');
  console.log('(In production, this would monitor Memory for fixes)');
  
  // For demonstration, let's check current state
  console.log('\n📈 Running current test...');
  const current = await runTypeCheck();
  
  // Compare results
  await compareResults(baseline, current);
  
  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    baseline,
    current,
    improvement: baseline.errorCount - current.errorCount
  };
  
  const resultsPath = path.join(process.cwd(), 'integration-test-results.json');
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${resultsPath}`);
}

if (require.main === module) {
  main().catch(console.error);
}

export { runTypeCheck, compareResults };
export type { TestResult };