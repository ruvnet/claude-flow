const Calculator = require('./calculator');
const assert = require('assert');

const calc = new Calculator();

// Test addition
assert.strictEqual(calc.add(2, 3), 5);
assert.strictEqual(calc.add(-1, 1), 0);

// Test subtraction
assert.strictEqual(calc.subtract(5, 3), 2);
assert.strictEqual(calc.subtract(0, 5), -5);

// Test multiplication
assert.strictEqual(calc.multiply(3, 4), 12);
assert.strictEqual(calc.multiply(-2, 3), -6);

// Test division
assert.strictEqual(calc.divide(10, 2), 5);
assert.strictEqual(calc.divide(7, 2), 3.5);

// Test division by zero
assert.throws(() => calc.divide(5, 0), /Division by zero/);

// Test power
assert.strictEqual(calc.power(2, 3), 8);
assert.strictEqual(calc.power(5, 0), 1);

// Test square root
assert.strictEqual(calc.sqrt(16), 4);
assert.strictEqual(calc.sqrt(2), Math.sqrt(2));

// Test negative square root
assert.throws(() => calc.sqrt(-1), /Cannot calculate square root of negative number/);

console.log('All tests passed! ✅');
