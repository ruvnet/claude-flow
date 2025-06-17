// Simple test file for the greeter module
const { greet, greetFormal } = require('./lib/greeter');

console.log('Running tests...\n');

// Test 1: Basic greeting
const test1 = greet('World');
console.log('Test 1 - Basic greeting:');
console.log(`  Expected: "Hello, World!"`);
console.log(`  Actual: "${test1}"`);
console.log(`  ${test1 === 'Hello, World!' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 2: Custom name
const test2 = greet('Alice');
console.log('Test 2 - Custom name:');
console.log(`  Expected: "Hello, Alice!"`);
console.log(`  Actual: "${test2}"`);
console.log(`  ${test2 === 'Hello, Alice!' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 3: Formal greeting
const test3 = greetFormal('Dr.', 'Smith');
console.log('Test 3 - Formal greeting:');
console.log(`  Expected: "Good day, Dr. Smith."`);
console.log(`  Actual: "${test3}"`);
console.log(`  ${test3 === 'Good day, Dr. Smith.' ? '✓ PASS' : '✗ FAIL'}\n`);

console.log('Tests complete!');