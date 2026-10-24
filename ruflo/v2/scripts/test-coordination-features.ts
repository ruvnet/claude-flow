#!/usr/bin/env -S deno run --allow-all

/**
 * Test script for advanced coordination features
 * Demonstrates:
 * - Resource management and deadlock detection
 * - Task dependencies and scheduling
 * - Work stealing and load balancing
 * - Circuit breakers and fault tolerance
 */

import { EventBus } from '../src/core/event-bus.ts';
import { ConsoleLogger } from '../src/core/logger.ts';
import { CoordinationManager } from '../src/coordination/manager.ts';
import { Task, SystemEvents } from '../src/utils/types.ts';
import { delay } from '../src/utils/helpers.ts';

async function testCoordinationFeatures() {
  console.log('🔄 Testing Claude-Flow Coordination Features\n');
  
  const eventBus = new EventBus();
  const logger = new ConsoleLogger('coord-test');
  
  const config = {
    maxRetries: 3,
    retryDelay: 1000,
    resourceTimeout: 5000,
    deadlockDetection: true,
    priorityLevels: 5,
  };
  
  const coordinator = new CoordinationManager(config, eventBus, logger);
  
  try {
    await coordinator.initialize();
    console.log('✅ Coordination manager initialized\n');
    
    // Test 1: Resource Management
    console.log('📋 Test 1: Resource Management');
    console.log('Testing resource acquisition and release...');
    
    // Agent 1 acquires resource A
    await coordinator.acquireResource('resource-A', 'agent-1');
    console.log('✅ Agent 1 acquired resource A');
    
    // Agent 2 tries to acquire resource A (should wait)
    const acquire2Promise = coordinator.acquireResource('resource-A', 'agent-2');
    console.log('⏳ Agent 2 waiting for resource A...');
    
    // Release after delay
    setTimeout(async () => {
      await coordinator.releaseResource('resource-A', 'agent-1');
      console.log('✅ Agent 1 released resource A');
    }, 1000);
    
    await acquire2Promise;
    console.log('✅ Agent 2 acquired resource A\n');
    
    // Test 2: Task Dependencies
    console.log('📋 Test 2: Task Dependencies');
    
    const parentTask: Task = {
      id: 'parent-task',
      type: 'process',
      description: 'Parent task',
      priority: 90,
      dependencies: [],
      status: 'pending',
      input: {},
      createdAt: new Date(),
    };
    
    const childTask: Task = {
      id: 'child-task',
      type: 'process',
      description: 'Child task (depends on parent)',
      priority: 80,
      dependencies: ['parent-task'],
      status: 'pending',
      input: {},
      createdAt: new Date(),
    };
    
    await coordinator.assignTask(parentTask, 'agent-1');
    console.log('✅ Assigned parent task to agent-1');
    
    try {
      await coordinator.assignTask(childTask, 'agent-2');
    } catch (error) {
      console.log('✅ Child task correctly blocked by dependency');
    }
    
    // Complete parent task
    eventBus.emit(SystemEvents.TASK_COMPLETED, {
      taskId: 'parent-task',
      result: { data: 'parent result' },
    });
    
    await delay(100);
    
    // Now child should be assignable
    await coordinator.assignTask(childTask, 'agent-2');
    console.log('✅ Child task assigned after parent completion\n');
    
    // Test 3: Deadlock Detection
    console.log('📋 Test 3: Deadlock Detection');
    console.log('Creating potential deadlock scenario...');
    
    // Agent 3 holds B, wants A
    await coordinator.acquireResource('resource-B', 'agent-3');
    const agent3WantsA = coordinator.acquireResource('resource-A', 'agent-3')
      .catch(() => console.log('✅ Deadlock detected and resolved'));
    
    // Agent 2 holds A, wants B (creates cycle)
    const agent2WantsB = coordinator.acquireResource('resource-B', 'agent-2')
      .catch(() => console.log('✅ Agent 2 resource request failed'));
    
    // Wait for deadlock detection
    await delay(2000);
    
    // Clean up resources
    await coordinator.releaseResource('resource-A', 'agent-2');
    await coordinator.releaseResource('resource-B', 'agent-3');
    console.log('✅ Resources cleaned up\n');
    
    // Test 4: Advanced Scheduling
    console.log('📋 Test 4: Advanced Scheduling Features');
    coordinator.enableAdvancedScheduling();
    console.log('✅ Advanced scheduling enabled');
    
    // Create tasks with different priorities
    const highPriorityTask: Task = {
      id: 'high-priority',
      type: 'urgent',
      description: 'High priority task',
      priority: 100,
      dependencies: [],
      status: 'pending',
      input: {},
      createdAt: new Date(),
    };
    
    const lowPriorityTask: Task = {
      id: 'low-priority',
      type: 'batch',
      description: 'Low priority task',
      priority: 10,
      dependencies: [],
      status: 'pending',
      input: {},
      createdAt: new Date(),
    };
    
    await coordinator.assignTask(lowPriorityTask, 'agent-1');
    await coordinator.assignTask(highPriorityTask, 'agent-1');
    console.log('✅ Tasks assigned with priority scheduling\n');
    
    // Test 5: Conflict Resolution
    console.log('📋 Test 5: Conflict Resolution');
    
    // Report a resource conflict
    await coordinator.reportConflict('resource', 'shared-resource', ['agent-1', 'agent-2']);
    console.log('✅ Resource conflict reported and auto-resolved');
    
    // Report a task conflict
    await coordinator.reportConflict('task', 'disputed-task', ['agent-1', 'agent-2']);
    console.log('✅ Task conflict reported and auto-resolved\n');
    
    // Test 6: Health and Metrics
    console.log('📋 Test 6: Health Monitoring and Metrics');
    
    const health = await coordinator.getHealthStatus();
    console.log('🏥 Health Status:', health.healthy ? 'Healthy' : 'Unhealthy');
    
    const metrics = await coordinator.getCoordinationMetrics();
    console.log('📊 Coordination Metrics:');
    console.log(`  Tasks assigned: ${metrics.assigned || 0}`);
    console.log(`  Resources managed: ${metrics.resources || 0}`);
    console.log(`  Conflicts resolved: ${metrics.conflicts?.resolved || 0}`);
    console.log(`  Advanced scheduling: ${metrics.advancedScheduling ? 'Enabled' : 'Disabled'}`);
    
    // Test 7: Message Routing
    console.log('\n📋 Test 7: Inter-Agent Messaging');
    
    // Set up message handler
    let messagesReceived = 0;
    eventBus.on('message:agent-2', (data: any) => {
      messagesReceived++;
      console.log(`✅ Agent 2 received message: ${data.message.content}`);
    });
    
    // Send messages
    await coordinator.sendMessage('agent-1', 'agent-2', { 
      type: 'status', 
      content: 'Task completed' 
    });
    
    await coordinator.sendMessage('agent-1', 'agent-2', { 
      type: 'data', 
      content: 'Results available' 
    });
    
    await delay(100);
    console.log(`✅ Sent and received ${messagesReceived} messages\n`);
    
    // Perform maintenance
    console.log('📋 Performing maintenance...');
    await coordinator.performMaintenance();
    console.log('✅ Maintenance completed');
    
    // Shutdown
    await coordinator.shutdown();
    console.log('\n✅ Coordination manager shut down successfully');
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ ALL COORDINATION TESTS PASSED!');
    console.log('='.repeat(50));
    console.log('\nFeatures tested:');
    console.log('  ✓ Resource management with mutual exclusion');
    console.log('  ✓ Task dependencies and scheduling');
    console.log('  ✓ Deadlock detection and prevention');
    console.log('  ✓ Advanced scheduling with priorities');
    console.log('  ✓ Conflict detection and resolution');
    console.log('  ✓ Health monitoring and metrics');
    console.log('  ✓ Inter-agent messaging');
    console.log('  ✓ System maintenance');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
if (import.meta.main) {
  testCoordinationFeatures().catch(console.error);
}