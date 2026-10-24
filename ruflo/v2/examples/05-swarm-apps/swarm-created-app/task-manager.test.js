/**
 * Test Suite for Task Manager
 * Created by Swarm Agent: Tester-1
 */

const TaskManager = require('./task-manager.js');
const assert = require('assert');

console.log('🧪 Running Task Manager Tests...\n');

// Test 1: Add tasks
const manager = new TaskManager();
const task1 = manager.addTask('Write documentation', 'high');
assert(task1.id === 1, 'First task should have ID 1');
assert(task1.priority === 'high', 'Priority should be set correctly');
console.log('✅ Test 1 passed: Add tasks');

// Test 2: List tasks
const tasks = manager.listTasks();
assert(tasks.length === 1, 'Should have one task');
console.log('✅ Test 2 passed: List tasks');

// Test 3: Complete tasks
const completed = manager.completeTask(1);
assert(completed.status === 'completed', 'Task should be completed');
console.log('✅ Test 3 passed: Complete tasks');

// Test 4: Statistics
const stats = manager.getStats();
assert(stats.total === 1, 'Total should be 1');
assert(stats.completed === 1, 'Completed should be 1');
assert(stats.completionRate === '100.0%', 'Completion rate should be 100%');
console.log('✅ Test 4 passed: Statistics');

console.log('\n🎉 All tests passed!');
console.log('Quality assured by swarm testing agents.');
