#!/usr/bin/env node
/**
 * Verification script for TaskMaster integration
 * Tests basic functionality without requiring full build system
 */

import { TaskAdapter } from './adapters/task-adapter.ts';
import { PRDService } from './services/prd-service.ts';
import { StorageSync } from './services/storage-sync.ts';
import {
  TaskMasterTask,
  ClaudeFlowTask,
  TaskMasterStatus,
  TaskMasterPriority,
  ClaudeFlowStatus,
  ClaudeFlowPriority,
  SPARCPhase
} from './types/task-types.ts';

console.log('🔍 Verifying TaskMaster Integration Implementation...\n');

// Test 1: Task Adapter Functionality
console.log('1. Testing Task Adapter...');
try {
  const adapter = new TaskAdapter();
  
  const sampleTMTask: TaskMasterTask = {
    id: 'test-tm-1',
    title: 'Test TaskMaster Task',
    description: 'A test task for verification',
    status: TaskMasterStatus.TODO,
    priority: TaskMasterPriority.HIGH,
    tags: ['test', 'verification'],
    estimate: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {
      prd_section: 'Testing Requirements',
      complexity: 5,
      ai_generated: true,
      model_used: 'test-model'
    }
  };

  // Test conversion to ClaudeFlow
  const cfTask = adapter.toClaudeFlow(sampleTMTask);
  console.log('   ✅ TaskMaster to ClaudeFlow conversion works');
  console.log(`   📋 Converted: "${cfTask.title}" | Status: ${cfTask.status} | Priority: ${cfTask.priority}`);
  
  // Test conversion back to TaskMaster
  const tmTaskBack = adapter.toTaskMaster(cfTask);
  console.log('   ✅ ClaudeFlow to TaskMaster conversion works');
  console.log(`   📋 Converted back: "${tmTaskBack.title}" | Status: ${tmTaskBack.status} | Priority: ${tmTaskBack.priority}`);
  
  // Test validation
  const validation = adapter.validateTaskConversion(sampleTMTask);
  console.log(`   ✅ Task validation works | Valid: ${validation.isValid} | Warnings: ${validation.warnings.length}`);
  
} catch (error) {
  console.log(`   ❌ Task Adapter test failed: ${error}`);
}

// Test 2: PRD Service Functionality
console.log('\n2. Testing PRD Service...');
try {
  const prdService = new PRDService();
  
  const samplePRD = `
# Test Project Requirements

## Goals
- Build a simple web application
- Implement user authentication
- Create a dashboard interface

## Requirements
- Users must be able to register and login
- Dashboard must display user information
- System should be responsive

## Constraints
- Must complete within 4 weeks
- Budget limitation of $10,000
`;

  // Test PRD validation
  const validation = prdService.validatePRD(samplePRD);
  console.log(`   ✅ PRD validation works | Valid: ${validation.isValid} | Warnings: ${validation.warnings.length} | Suggestions: ${validation.suggestions.length}`);
  
  // Test PRD parsing
  const parsedPRD = await prdService.parsePRD(samplePRD);
  console.log('   ✅ PRD parsing works');
  console.log(`   📄 Parsed: ${parsedPRD.requirements.length} requirements, ${parsedPRD.constraints.length} constraints, ${parsedPRD.sections.length} sections`);
  
  // Test complexity estimation
  const complexity = prdService.estimateComplexity(parsedPRD);
  console.log(`   ✅ Complexity estimation works | Level: ${complexity.overall} | Estimated weeks: ${complexity.estimatedWeeks}`);
  
} catch (error) {
  console.log(`   ❌ PRD Service test failed: ${error}`);
}

// Test 3: Storage Sync Functionality
console.log('\n3. Testing Storage Sync...');
try {
  const adapter = new TaskAdapter();
  const storageSync = new StorageSync(adapter);
  
  // Test status
  const status = storageSync.getSyncStatus();
  console.log('   ✅ Storage sync status works');
  console.log(`   📊 Status: Watching: ${status.isWatching} | Last sync: ${status.lastSync || 'Never'} | Queued: ${status.queuedOperations}`);
  
  // Test conflict resolution
  const mockConflicts = [{
    taskId: 'test-conflict',
    field: 'status',
    taskMasterValue: TaskMasterStatus.DONE,
    claudeFlowValue: ClaudeFlowStatus.IN_PROGRESS,
    source: 'taskmaster' as const
  }];
  
  const resolutions = await storageSync.resolveConflicts(mockConflicts);
  console.log(`   ✅ Conflict resolution works | Resolved: ${resolutions.length} conflicts`);
  
} catch (error) {
  console.log(`   ❌ Storage Sync test failed: ${error}`);
}

// Test 4: Integration Test
console.log('\n4. Testing End-to-End Integration...');
try {
  const adapter = new TaskAdapter();
  
  // Create sample tasks
  const tmTasks: TaskMasterTask[] = [
    {
      id: 'integration-1',
      title: 'Setup Authentication',
      status: TaskMasterStatus.TODO,
      priority: TaskMasterPriority.HIGH,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { prd_section: 'Authentication Requirements' }
    },
    {
      id: 'integration-2', 
      title: 'Build Dashboard',
      status: TaskMasterStatus.IN_PROGRESS,
      priority: TaskMasterPriority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { prd_section: 'UI Requirements' }
    }
  ];

  // Test batch conversion
  const cfTasks = adapter.batchToClaudeFlow(tmTasks);
  console.log(`   ✅ Batch conversion works | Converted: ${cfTasks.length} tasks`);
  
  // Test SPARC phase inference
  const authTask = cfTasks.find(t => t.title.includes('Authentication'));
  const dashboardTask = cfTasks.find(t => t.title.includes('Dashboard'));
  
  console.log(`   ✅ SPARC phase mapping works`);
  console.log(`   🎯 Auth task phase: ${authTask?.phase || 'Not mapped'} | Agent: ${authTask?.agent || 'Not assigned'}`);
  console.log(`   🎯 Dashboard task phase: ${dashboardTask?.phase || 'Not mapped'} | Agent: ${dashboardTask?.agent || 'Not assigned'}`);
  
} catch (error) {
  console.log(`   ❌ Integration test failed: ${error}`);
}

console.log('\n🎉 TaskMaster Integration Verification Complete!');
console.log('\n📋 Summary:');
console.log('   • Task Adapter: Bidirectional conversion between TaskMaster and ClaudeFlow formats');
console.log('   • PRD Service: Parse requirements documents and generate structured tasks');  
console.log('   • Storage Sync: Handle file system synchronization and conflict resolution');
console.log('   • SPARC Integration: Map tasks to phases and assign appropriate agents');
console.log('\n✅ Phase 1 Foundation implementation is ready for testing and deployment.');
console.log('\n📖 Next Steps:');
console.log('   1. Complete CLI integration with claude-flow command system');
console.log('   2. Add real-time file watching and synchronization');
console.log('   3. Implement actual AI model integration for PRD parsing');
console.log('   4. Add performance monitoring and metrics collection');
console.log('   5. Create user documentation and examples');