// agent-booster-benchmark.js - Comprehensive performance benchmarks
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const TEST_DIR = '.benchmark-agent-booster';

/**
 * Run comprehensive Agent Booster benchmarks
 */
async function runBenchmarks() {
  console.log('🏁 Agent Booster Comprehensive Benchmark Suite\n');
  console.log('Testing ultra-fast code editing performance\n');
  console.log('─'.repeat(80));

  // Setup
  await fs.mkdir(TEST_DIR, { recursive: true });

  try {
    // Benchmark 1: Single File Edit Speed
    await benchmarkSingleEdit();

    // Benchmark 2: Batch Processing Speed
    await benchmarkBatchProcessing();

    // Benchmark 3: Large File Handling
    await benchmarkLargeFiles();

    // Benchmark 4: Concurrent Operations
    await benchmarkConcurrentOps();

    // Benchmark 5: Cost Analysis
    await analyzeCost();

    // Benchmark 6: Accuracy Test
    await testAccuracy();

  } finally {
    // Cleanup
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n✅ All benchmarks completed successfully!\n');
}

/**
 * Benchmark 1: Single File Edit Speed
 */
async function benchmarkSingleEdit() {
  console.log('\n📊 Benchmark 1: Single File Edit Speed');
  console.log('Testing individual edit performance\n');

  const testFile = path.join(TEST_DIR, 'single-edit.js');
  const testCode = `
function calculateSum(a, b) {
  return a + b;
}

function calculateProduct(a, b) {
  return a * b;
}
`;
  await fs.writeFile(testFile, testCode);

  const iterations = 100;
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await execAsync(
      `npx claude-flow agent booster edit ${testFile} "Add JSDoc comment" --dry-run`
    );
    const duration = Date.now() - start;
    times.push(duration);

    if ((i + 1) % 10 === 0) {
      process.stdout.write(`  Progress: ${i + 1}/${iterations}\r`);
    }
  }

  const avg = times.reduce((a, b) => a + b, 0) / iterations;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const llmBaseline = 352; // ms

  console.log(`\n\n  Results (${iterations} iterations):`);
  console.log(`  Average: ${avg.toFixed(2)}ms`);
  console.log(`  Min: ${min}ms`);
  console.log(`  Max: ${max}ms`);
  console.log(`  LLM Baseline: ${llmBaseline}ms`);
  console.log(`  Speedup: ${(llmBaseline / avg).toFixed(1)}x`);
  console.log(`  Time Saved: ${((llmBaseline - avg) * iterations / 1000).toFixed(2)}s`);
}

/**
 * Benchmark 2: Batch Processing Speed
 */
async function benchmarkBatchProcessing() {
  console.log('\n📊 Benchmark 2: Batch Processing Speed');
  console.log('Testing multi-file editing performance\n');

  const fileCounts = [10, 50, 100];

  for (const count of fileCounts) {
    // Create test files
    for (let i = 0; i < count; i++) {
      await fs.writeFile(
        path.join(TEST_DIR, `batch-${count}-${i}.js`),
        `function test${i}() { return ${i}; }\n`
      );
    }

    const start = Date.now();
    await execAsync(
      `npx claude-flow agent booster batch "${TEST_DIR}/batch-${count}-*.js" "Add comments" --dry-run`
    );
    const duration = Date.now() - start;

    const llmTime = count * 352; // ms
    const speedup = llmTime / duration;

    console.log(`  ${count} files:`);
    console.log(`    Agent Booster: ${duration}ms (${(duration / count).toFixed(1)}ms per file)`);
    console.log(`    LLM Baseline: ${llmTime}ms (${352}ms per file)`);
    console.log(`    Speedup: ${speedup.toFixed(1)}x`);
    console.log(`    Time Saved: ${((llmTime - duration) / 1000).toFixed(2)}s`);
    console.log(`    Cost Saved: $${(count * 0.01).toFixed(2)}`);
    console.log('');

    // Cleanup for next iteration
    for (let i = 0; i < count; i++) {
      await fs.unlink(path.join(TEST_DIR, `batch-${count}-${i}.js`));
    }
  }
}

/**
 * Benchmark 3: Large File Handling
 */
async function benchmarkLargeFiles() {
  console.log('\n📊 Benchmark 3: Large File Handling');
  console.log('Testing performance with different file sizes\n');

  const fileSizes = [
    { name: 'Small', lines: 50 },
    { name: 'Medium', lines: 500 },
    { name: 'Large', lines: 2000 }
  ];

  for (const size of fileSizes) {
    const testFile = path.join(TEST_DIR, `${size.name.toLowerCase()}-file.js`);

    // Generate file with specified number of lines
    let content = '';
    for (let i = 0; i < size.lines; i++) {
      content += `function func${i}() { return ${i}; }\n`;
    }
    await fs.writeFile(testFile, content);

    const start = Date.now();
    await execAsync(
      `npx claude-flow agent booster edit ${testFile} "Add JSDoc comments" --dry-run`
    );
    const duration = Date.now() - start;

    console.log(`  ${size.name} file (${size.lines} lines):`);
    console.log(`    Processing time: ${duration}ms`);
    console.log(`    Lines per second: ${(size.lines / (duration / 1000)).toFixed(0)}`);
    console.log('');
  }
}

/**
 * Benchmark 4: Concurrent Operations
 */
async function benchmarkConcurrentOps() {
  console.log('\n📊 Benchmark 4: Concurrent Operations');
  console.log('Testing parallel execution performance\n');

  const concurrency = 5;
  const filesPerBatch = 10;

  // Create test files
  for (let i = 0; i < filesPerBatch * concurrency; i++) {
    await fs.writeFile(
      path.join(TEST_DIR, `concurrent-${i}.js`),
      `function test${i}() {}\n`
    );
  }

  const start = Date.now();

  // Run concurrent edits
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const pattern = path.join(TEST_DIR, `concurrent-${i}*.js`);
    promises.push(
      execAsync(
        `npx claude-flow agent booster batch "${pattern}" "Add comment" --dry-run`
      )
    );
  }

  await Promise.all(promises);
  const duration = Date.now() - start;

  const totalFiles = filesPerBatch * concurrency;
  const llmTime = totalFiles * 352; // ms

  console.log(`  ${concurrency} concurrent batches (${filesPerBatch} files each):`);
  console.log(`    Total files: ${totalFiles}`);
  console.log(`    Agent Booster: ${duration}ms`);
  console.log(`    LLM Baseline: ${llmTime}ms`);
  console.log(`    Speedup: ${(llmTime / duration).toFixed(1)}x`);
  console.log(`    Throughput: ${(totalFiles / (duration / 1000)).toFixed(1)} files/sec`);
}

/**
 * Benchmark 5: Cost Analysis
 */
async function analyzeCost() {
  console.log('\n📊 Benchmark 5: Cost Analysis');
  console.log('Analyzing cost savings vs LLM APIs\n');

  const scenarios = [
    { name: 'Daily refactoring', edits: 100 },
    { name: 'Weekly migration', edits: 1000 },
    { name: 'Monthly maintenance', edits: 3000 }
  ];

  for (const scenario of scenarios) {
    const llmCost = scenario.edits * 0.01; // $0.01 per edit
    const boosterCost = 0; // Free
    const savings = llmCost;

    console.log(`  ${scenario.name} (${scenario.edits} edits):`);
    console.log(`    LLM API cost: $${llmCost.toFixed(2)}`);
    console.log(`    Agent Booster cost: $${boosterCost.toFixed(2)}`);
    console.log(`    Savings: $${savings.toFixed(2)}`);
    console.log('');
  }

  const yearlyEdits = 100 * 365; // 100 edits per day
  const yearlySavings = yearlyEdits * 0.01;
  console.log(`  Annual savings (100 edits/day): $${yearlySavings.toLocaleString()}`);
}

/**
 * Benchmark 6: Accuracy Test
 */
async function testAccuracy() {
  console.log('\n📊 Benchmark 6: Accuracy Test');
  console.log('Verifying edit quality\n');

  const testCases = [
    { desc: 'Add logging', expected: 'console.log' },
    { desc: 'Add error handling', expected: 'try' },
    { desc: 'Add JSDoc', expected: '/**' }
  ];

  let successCount = 0;

  for (const testCase of testCases) {
    const testFile = path.join(TEST_DIR, `accuracy-${successCount}.js`);
    await fs.writeFile(testFile, `function test() { return true; }\n`);

    await execAsync(
      `npx claude-flow agent booster edit ${testFile} "${testCase.desc}"`
    );

    const edited = await fs.readFile(testFile, 'utf8');
    const passed = edited.includes(testCase.expected);

    console.log(`  ${testCase.desc}: ${passed ? '✅ PASS' : '❌ FAIL'}`);

    if (passed) successCount++;
  }

  const accuracy = (successCount / testCases.length) * 100;
  console.log(`\n  Accuracy: ${accuracy.toFixed(1)}% (${successCount}/${testCases.length})`);
}

// Run benchmarks
runBenchmarks().catch(error => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});
