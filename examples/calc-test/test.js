const Calculator = require('./calculator');

console.log('=== Simple Calculator Demo ===\n');

const calc = new Calculator();

// Test basic addition
console.log('Basic Addition:');
console.log('5 + 3 =', calc.add(5, 3));
console.log('10 + 25 =', calc.add(10, 25));
console.log('100 + 200 =', calc.add(100, 200));

console.log('\nBasic Subtraction:');
console.log('10 - 3 =', calc.subtract(10, 3));
console.log('50 - 25 =', calc.subtract(50, 25));
console.log('100 - 45 =', calc.subtract(100, 45));

console.log('\nChained Operations (using internal result):');
calc.clear();
console.log('Starting from 0');
console.log('Add 10:', calc.add(10));
console.log('Add 5:', calc.add(5));
console.log('Subtract 3:', calc.subtract(3));
console.log('Add 8:', calc.add(8));
console.log('Final result:', calc.getResult());

console.log('\nEdge Cases:');
console.log('0 + 0 =', calc.add(0, 0));
console.log('0 - 0 =', calc.subtract(0, 0));
console.log('-5 + 3 =', calc.add(-5, 3));
console.log('-10 - (-5) =', calc.subtract(-10, -5));
console.log('0.5 + 0.3 =', calc.add(0.5, 0.3));
console.log('1.7 - 0.9 =', calc.subtract(1.7, 0.9));

console.log('\n=== Demo Complete ===');