/**
 * Run all agent tests to demonstrate the complete swarm system
 */

const fs = require('fs');
const path = require('path');

console.log('=================================');
console.log('Claude-Flow Swarm Agent Test Suite');
console.log('=================================\n');

// List of all agent test files
const agentTests = [
  './coordinator-agent-test.js',
  './researcher-agent-test.js',
  './developer-agent-test.js',
  './analyzer-agent-test.js',
  './reviewer-agent-test.js',
  './tester-agent-test.js',
  './documenter-agent-test.js',
  './monitor-agent-test.js',
  './specialist-agent-test.js'
];

// Run each test with separation
agentTests.forEach((testFile, index) => {
  console.log('\n' + '='.repeat(50));
  console.log(`Running Test ${index + 1}/${agentTests.length}: ${path.basename(testFile)}`);
  console.log('='.repeat(50) + '\n');
  
  try {
    // Clear the require cache to ensure fresh execution
    delete require.cache[require.resolve(testFile)];
    require(testFile);
  } catch (error) {
    console.error(`Error running ${testFile}:`, error.message);
  }
  
  console.log('\n');
});

console.log('='.repeat(50));
console.log('All Agent Tests Completed!');
console.log('='.repeat(50));

console.log('\nSwarm System Summary:');
console.log('- 9 specialized agent types demonstrated');
console.log('- Each agent has unique capabilities and workflows');
console.log('- Agents work together under Coordinator orchestration');
console.log('- System enables collaborative AI problem-solving');
console.log('\nUse `npx claude-flow swarm "<objective>"` to run a real swarm!');