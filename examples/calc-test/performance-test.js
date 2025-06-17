const Calculator = require('./calculator');

console.log('=== Calculator Performance Test ===\n');

// Test performance with many operations
function performanceTest(testName, operations) {
  const calc = new Calculator();
  const startTime = process.hrtime.bigint();
  
  for (let i = 0; i < operations; i++) {
    calc.add(i, i + 1);
    calc.subtract(i * 2, i);
  }
  
  const endTime = process.hrtime.bigint();
  const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
  const opsPerMs = operations / duration;
  
  console.log(`${testName}:`);
  console.log(`  Operations: ${operations.toLocaleString()}`);
  console.log(`  Duration: ${duration.toFixed(2)}ms`);
  console.log(`  Operations/ms: ${opsPerMs.toFixed(0)}`);
  console.log('');
}

// Run performance tests
performanceTest('Small test (1,000 operations)', 1000);
performanceTest('Medium test (10,000 operations)', 10000);
performanceTest('Large test (100,000 operations)', 100000);
performanceTest('Extra large test (1,000,000 operations)', 1000000);

// Test memory usage with many calculator instances
console.log('Memory Usage Test:');
const startMemory = process.memoryUsage().heapUsed;
const calculators = [];

for (let i = 0; i < 10000; i++) {
  const calc = new Calculator();
  calc.add(i);
  calculators.push(calc);
}

const endMemory = process.memoryUsage().heapUsed;
const memoryUsed = (endMemory - startMemory) / 1024 / 1024;

console.log(`  Created 10,000 calculator instances`);
console.log(`  Memory used: ${memoryUsed.toFixed(2)} MB`);
console.log(`  Average per instance: ${(memoryUsed * 1024 / 10000).toFixed(2)} KB`);

console.log('\n✅ Performance tests completed successfully!');