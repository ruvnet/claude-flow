const Calculator = require('./calculator');

// Simple test runner
let passedTests = 0;
let failedTests = 0;

function test(description, testFn) {
  try {
    testFn();
    console.log(`✓ ${description}`);
    passedTests++;
  } catch (error) {
    console.log(`✗ ${description}`);
    console.log(`  Error: ${error.message}`);
    failedTests++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, but got ${actual}`);
  }
}

console.log('=== Calculator Test Suite ===\n');

// Test basic addition
console.log('Basic Addition Tests:');
test('should add two positive numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.add(5, 3), 8);
  assertEqual(calc.add(10, 25), 35);
  assertEqual(calc.add(100, 200), 300);
});

test('should add negative numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.add(-5, 3), -2);
  assertEqual(calc.add(-10, -5), -15);
  assertEqual(calc.add(5, -3), 2);
});

test('should add decimal numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.add(0.5, 0.3), 0.8);
  assertEqual(calc.add(1.25, 2.75), 4);
  assertEqual(calc.add(0.1, 0.2), 0.30000000000000004); // JS floating point
});

test('should handle zero addition', () => {
  const calc = new Calculator();
  assertEqual(calc.add(0, 0), 0);
  assertEqual(calc.add(5, 0), 5);
  assertEqual(calc.add(0, -5), -5);
});

// Test basic subtraction
console.log('\nBasic Subtraction Tests:');
test('should subtract two positive numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.subtract(10, 3), 7);
  assertEqual(calc.subtract(50, 25), 25);
  assertEqual(calc.subtract(100, 45), 55);
});

test('should subtract negative numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.subtract(-10, -5), -5);
  assertEqual(calc.subtract(5, -3), 8);
  assertEqual(calc.subtract(-5, 3), -8);
});

test('should subtract decimal numbers', () => {
  const calc = new Calculator();
  // Handle floating point precision
  const result1 = calc.subtract(1.7, 0.9);
  assert(Math.abs(result1 - 0.8) < 0.0000001, `Expected ~0.8, but got ${result1}`);
  assertEqual(calc.subtract(5.5, 2.5), 3);
  assertEqual(calc.subtract(10.25, 0.25), 10);
});

test('should handle zero subtraction', () => {
  const calc = new Calculator();
  assertEqual(calc.subtract(0, 0), 0);
  assertEqual(calc.subtract(5, 0), 5);
  assertEqual(calc.subtract(0, 5), -5);
});

// Test chained operations
console.log('\nChained Operations Tests:');
test('should add to internal result with single argument', () => {
  const calc = new Calculator();
  assertEqual(calc.add(10), 10);
  assertEqual(calc.add(5), 15);
  assertEqual(calc.add(7), 22);
});

test('should subtract from internal result with single argument', () => {
  const calc = new Calculator();
  calc.add(20); // Set result to 20
  assertEqual(calc.subtract(5), 15);
  assertEqual(calc.subtract(3), 12);
  assertEqual(calc.subtract(2), 10);
});

test('should handle mixed chained operations', () => {
  const calc = new Calculator();
  calc.clear();
  assertEqual(calc.add(10), 10);
  assertEqual(calc.subtract(3), 7);
  assertEqual(calc.add(8), 15);
  assertEqual(calc.subtract(5), 10);
  assertEqual(calc.getResult(), 10);
});

// Test result management
console.log('\nResult Management Tests:');
test('should clear the result', () => {
  const calc = new Calculator();
  calc.add(100);
  assertEqual(calc.getResult(), 100);
  calc.clear();
  assertEqual(calc.getResult(), 0);
});

test('should get current result', () => {
  const calc = new Calculator();
  assertEqual(calc.getResult(), 0);
  calc.add(50);
  assertEqual(calc.getResult(), 50);
  calc.subtract(20);
  assertEqual(calc.getResult(), 30);
});

test('should maintain separate results for different instances', () => {
  const calc1 = new Calculator();
  const calc2 = new Calculator();
  
  calc1.add(10);
  calc2.add(20);
  
  assertEqual(calc1.getResult(), 10);
  assertEqual(calc2.getResult(), 20);
});

// Test edge cases
console.log('\nEdge Cases Tests:');
test('should handle very large numbers', () => {
  const calc = new Calculator();
  assertEqual(calc.add(1000000, 2000000), 3000000);
  assertEqual(calc.subtract(5000000, 3000000), 2000000);
});

test('should handle very small decimal numbers', () => {
  const calc = new Calculator();
  const result = calc.add(0.0001, 0.0002);
  assert(Math.abs(result - 0.0003) < 0.00001, 'Should handle small decimals');
});

test('should handle consecutive operations without clear', () => {
  const calc = new Calculator();
  calc.add(5);
  calc.add(10, 20); // Two-argument form shouldn't affect internal result
  assertEqual(calc.getResult(), 5); // Should still be 5
  calc.add(3); // Single argument form
  assertEqual(calc.getResult(), 8);
});

// Summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log(`Total: ${passedTests + failedTests}`);

if (failedTests === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}