#!/usr/bin/env -S deno run --allow-all

/**
 * Test runner script for Claude-Flow batch task system
 * Run with: deno run --allow-all scripts/test-batch-tasks.ts
 */

import { runBatchTaskTest } from '../tests/integration/batch-task-test.ts';

console.log('🚀 Claude-Flow Batch Task System Test Runner\n');
console.log('This test will demonstrate:');
console.log('  • Task creation and queuing');
console.log('  • Agent spawning and assignment');
console.log('  • Parallel task execution');
console.log('  • Batch tool usage for efficiency');
console.log('  • Task completion tracking');
console.log('  • System coordination\n');
console.log('Starting test in 3 seconds...\n');

// Give user time to read
await new Promise(resolve => setTimeout(resolve, 3000));

try {
  await runBatchTaskTest();
  Deno.exit(0);
} catch (error) {
  console.error('Test failed:', error);
  Deno.exit(1);
}