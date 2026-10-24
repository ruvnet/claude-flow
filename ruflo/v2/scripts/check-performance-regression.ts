#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Performance Regression Checker
 * Compares current performance metrics against baseline
 */

interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  threshold: number; // Maximum allowed regression percentage
}

interface PerformanceReport {
  timestamp: string;
  gitHash: string;
  metrics: PerformanceMetric[];
}

const BASELINE_FILE = 'performance-baseline.json';
const CURRENT_RESULTS_FILE = 'performance-results.json';
const REGRESSION_THRESHOLD = 20; // 20% regression threshold

async function loadBaseline(): Promise<PerformanceReport | null> {
  try {
    const baselineData = await Deno.readTextFile(BASELINE_FILE);
    return JSON.parse(baselineData);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.log('No baseline found, creating initial baseline...');
      return null;
    }
    throw error;
  }
}

async function loadCurrentResults(): Promise<PerformanceReport> {
  try {
    const currentData = await Deno.readTextFile(CURRENT_RESULTS_FILE);
    return JSON.parse(currentData);
  } catch (error) {
    console.error('Failed to load current performance results:', error.message);
    Deno.exit(1);
  }
}

async function saveBaseline(report: PerformanceReport): Promise<void> {
  await Deno.writeTextFile(BASELINE_FILE, JSON.stringify(report, null, 2));
  console.log('Baseline updated successfully');
}

function calculateRegression(baseline: number, current: number): number {
  return ((current - baseline) / baseline) * 100;
}

function checkRegressions(baseline: PerformanceReport, current: PerformanceReport): {
  regressions: Array<{ metric: string; regression: number; threshold: number }>;
  hasRegressions: boolean;
} {
  const regressions: Array<{ metric: string; regression: number; threshold: number }> = [];
  
  for (const currentMetric of current.metrics) {
    const baselineMetric = baseline.metrics.find(m => m.name === currentMetric.name);
    
    if (!baselineMetric) {
      console.log(`New metric detected: ${currentMetric.name}`);
      continue;
    }
    
    const regression = calculateRegression(baselineMetric.value, currentMetric.value);
    const threshold = currentMetric.threshold || REGRESSION_THRESHOLD;
    
    if (regression > threshold) {
      regressions.push({
        metric: currentMetric.name,
        regression,
        threshold,
      });
    }
  }
  
  return {
    regressions,
    hasRegressions: regressions.length > 0,
  };
}

function generateReport(
  baseline: PerformanceReport,
  current: PerformanceReport,
  regressions: Array<{ metric: string; regression: number; threshold: number }>
): void {
  console.log('\n=== Performance Regression Report ===\n');
  
  console.log(`Baseline: ${baseline.timestamp} (${baseline.gitHash})`);
  console.log(`Current:  ${current.timestamp} (${current.gitHash})\n`);
  
  if (regressions.length === 0) {
    console.log('✅ No performance regressions detected!\n');
  } else {
    console.log('❌ Performance regressions detected:\n');
    
    for (const regression of regressions) {
      const baselineMetric = baseline.metrics.find(m => m.name === regression.metric)!;
      const currentMetric = current.metrics.find(m => m.name === regression.metric)!;
      
      console.log(`  ${regression.metric}:`);
      console.log(`    Baseline: ${baselineMetric.value} ${baselineMetric.unit}`);
      console.log(`    Current:  ${currentMetric.value} ${currentMetric.unit}`);
      console.log(`    Regression: ${regression.regression.toFixed(2)}% (threshold: ${regression.threshold}%)`);
      console.log('');
    }
  }
  
  // Show all metrics for reference
  console.log('📊 All Performance Metrics:\n');
  
  for (const currentMetric of current.metrics) {
    const baselineMetric = baseline.metrics.find(m => m.name === currentMetric.name);
    
    if (baselineMetric) {
      const regression = calculateRegression(baselineMetric.value, currentMetric.value);
      const status = regression > (currentMetric.threshold || REGRESSION_THRESHOLD) ? '❌' : '✅';
      
      console.log(`  ${status} ${currentMetric.name}: ${currentMetric.value} ${currentMetric.unit} (${regression > 0 ? '+' : ''}${regression.toFixed(2)}%)`);
    } else {
      console.log(`  🆕 ${currentMetric.name}: ${currentMetric.value} ${currentMetric.unit} (new metric)`);
    }
  }
  
  console.log('');
}

async function main(): Promise<void> {
  console.log('Checking for performance regressions...\n');
  
  const baseline = await loadBaseline();
  const current = await loadCurrentResults();
  
  if (!baseline) {
    console.log('No baseline found, establishing current results as baseline...');
    await saveBaseline(current);
    console.log('Baseline established successfully');
    return;
  }
  
  const { regressions, hasRegressions } = checkRegressions(baseline, current);
  
  generateReport(baseline, current, regressions);
  
  if (hasRegressions) {
    console.error('Performance regressions detected! Please investigate and fix before merging.');
    Deno.exit(1);
  } else {
    console.log('Performance check passed! 🎉');
    
    // Update baseline if this is a main branch build
    const branch = Deno.env.get('GITHUB_REF');
    if (branch === 'refs/heads/main') {
      await saveBaseline(current);
    }
  }
}

if (import.meta.main) {
  await main();
}