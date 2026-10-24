/**
 * Import test to identify memory issue
 */

console.log('Starting imports...');

console.log('1. Importing chunking...');
const chunking = await import('../dist/chunking.js');
console.log('   chunking ok');

console.log('2. Importing normalization...');
const normalization = await import('../dist/normalization.js');
console.log('   normalization ok');

console.log('3. Importing hyperbolic...');
const hyperbolic = await import('../dist/hyperbolic.js');
console.log('   hyperbolic ok');

console.log('4. Importing embedding-service...');
const embedding = await import('../dist/embedding-service.js');
console.log('   embedding-service ok');

console.log('All imports complete!');
process.exit(0);
