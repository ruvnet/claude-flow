/**
 * Test suite for Hello World functions
 */

const { helloWorld, helloWorldAdvanced } = require('./hello_world');

// Simple test framework (no external dependencies)
function test(description, fn) {
    try {
        fn();
        console.log(`✅ ${description}`);
    } catch (error) {
        console.error(`❌ ${description}`);
        console.error(`   Error: ${error.message}`);
    }
}

function assertEqual(actual, expected) {
    if (actual !== expected) {
        throw new Error(`Expected "${expected}" but got "${actual}"`);
    }
}

console.log('Testing helloWorld function:\n');

// Basic functionality tests
test('Should return "Hello, World!" with no parameters', () => {
    assertEqual(helloWorld(), 'Hello, World!');
});

test('Should greet by name when provided', () => {
    assertEqual(helloWorld('Alice'), 'Hello, Alice!');
});

test('Should handle empty string as default', () => {
    assertEqual(helloWorld(''), 'Hello, World!');
});

test('Should handle whitespace-only string as default', () => {
    assertEqual(helloWorld('   '), 'Hello, World!');
});

test('Should convert numbers to strings', () => {
    assertEqual(helloWorld(42), 'Hello, 42!');
});

test('Should convert boolean to string', () => {
    assertEqual(helloWorld(true), 'Hello, true!');
});

test('Should handle null as string', () => {
    assertEqual(helloWorld(null), 'Hello, null!');
});

test('Should handle undefined as default', () => {
    assertEqual(helloWorld(undefined), 'Hello, World!');
});

test('Should trim whitespace from names', () => {
    assertEqual(helloWorld('  Bob  '), 'Hello, Bob!');
});

console.log('\nTesting helloWorldAdvanced function:\n');

// Advanced function tests
test('Should use default style when not specified', () => {
    assertEqual(helloWorldAdvanced('Charlie'), 'Hello, Charlie!');
});

test('Should use formal greeting style', () => {
    assertEqual(helloWorldAdvanced('Diana', 'formal'), 'Greetings, Diana.');
});

test('Should use casual greeting style', () => {
    assertEqual(helloWorldAdvanced('Eve', 'casual'), 'Hey Eve!');
});

test('Should use enthusiastic greeting style', () => {
    assertEqual(helloWorldAdvanced('Frank', 'enthusiastic'), 'Hello, Frank! 🎉');
});

test('Should use morning greeting style', () => {
    assertEqual(helloWorldAdvanced('Grace', 'morning'), 'Good morning, Grace!');
});

test('Should use evening greeting style', () => {
    assertEqual(helloWorldAdvanced('Henry', 'evening'), 'Good evening, Henry!');
});

test('Should fallback to default for unknown style', () => {
    assertEqual(helloWorldAdvanced('Ivy', 'unknown'), 'Hello, Ivy!');
});

test('Should handle both parameters as defaults', () => {
    assertEqual(helloWorldAdvanced(), 'Hello, World!');
});

console.log('\n✨ Test suite completed!');