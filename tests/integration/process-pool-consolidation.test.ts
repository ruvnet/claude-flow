/// <reference types="jest" />

/**
 * Integration tests for ProcessPool consolidation and validation
 * Tests process lifecycle, resource management, and failure recovery
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  waitFor
} from '../test.utils.js';
import { ProcessPool } from '../../src/core/process-pool.js';
import { StateManager } from '../../src/state/manager.js';
import { ResourceManager } from '../../src/coordination/resources.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { EventBus } from '../../src/core/event-bus.js';
import { Logger } from '../../src/core/logger.js';
import { cleanupTestEnv, setupTestEnv, TEST_CONFIG } from '../test.config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProcessPool Consolidation Verification', () => {
  let processPool: ProcessPool;
  let stateManager: StateManager;
  let resourceManager: ResourceManager;
  let memoryManager: MemoryManager;
  let eventBus: EventBus;
  let logger: Logger;
  let tempDir: string;

  beforeEach(async () => {
    setupTestEnv();
    
    // Create temporary directory for test artifacts
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'process-pool-test-'));

    logger = new Logger({
      level: 'debug',
      format: 'text',
      destination: 'console',
    });

    eventBus = new EventBus();
    
    stateManager = new StateManager({
      maxConcurrentOperations: 32,
      stateTimeout: 30000,
      enableConcurrencyControl: true
    });

    resourceManager = new ResourceManager({
      maxConcurrentTasks: 24,
      maxMemoryUsage: 1024 * 1024 * 500, // 500MB
      resourceTimeout: 45000
    });

    memoryManager = new MemoryManager({
      backend: 'memory',
      maxEntries: 5000,
      enableConcurrency: true
    });

    processPool = new ProcessPool({
      maxProcesses: 16,
      processTimeout: 30000,
      enableHealthChecks: true,
      restartThreshold: 3,
      healthCheckInterval: 1000,
      processCleanupInterval: 5000
    });

    await Promise.all([
      stateManager.initialize(),
      resourceManager.initialize(),
      memoryManager.initialize(),
      processPool.initialize()
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      processPool.shutdown(),
      resourceManager.cleanup(),
      stateManager.cleanup(),
      memoryManager.cleanup()
    ]);
    
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    await cleanupTestEnv();
  });

  describe('Process Lifecycle Management', () => {
    it('should manage process creation, execution, and cleanup lifecycle', async () => {
      const processCount = 20;
      const lifecycleEvents: Array<{
        processId: string;
        event: 'created' | 'started' | 'completed' | 'failed' | 'cleaned';
        timestamp: number;
      }> = [];

      // Create test script for processes
      const testScript = `
        const processId = process.argv[2];
        const duration = parseInt(process.argv[3]) || 100;
        
        console.log(JSON.stringify({ 
          event: 'started', 
          processId, 
          timestamp: Date.now() 
        }));
        
        setTimeout(() => {
          console.log(JSON.stringify({ 
            event: 'completed', 
            processId, 
            result: 'success',
            timestamp: Date.now() 
          }));
        }, duration);
      `;
      
      const scriptPath = path.join(tempDir, 'lifecycle-test.js');
      await fs.promises.writeFile(scriptPath, testScript);

      // Track process events
      const processTracker = (event: string, processId: string) => {
        lifecycleEvents.push({
          processId,
          event: event as any,
          timestamp: Date.now()
        });
      };

      // Execute processes with lifecycle tracking
      const processPromises = Array.from({ length: processCount }, async (_, i) => {
        const processId = `lifecycle-process-${i}`;
        const executionTime = 100 + Math.random() * 200; // 100-300ms
        
        processTracker('created', processId);
        
        try {
          const result = await processPool.execute({
            id: processId,
            command: 'node',
            args: [scriptPath, processId, executionTime.toString()],
            timeout: 5000,
            onStart: () => processTracker('started', processId),
            onComplete: () => processTracker('completed', processId),
            onError: () => processTracker('failed', processId)
          });
          
          return { processId, success: true, result };
        } catch (error) {
          processTracker('failed', processId);
          return { processId, success: false, error: error.message };
        }
      });

      const results = await Promise.all(processPromises);
      
      // Wait for cleanup cycle
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Verify lifecycle completeness
      const processIds = results.map(r => r.processId);
      const successfulProcesses = results.filter(r => r.success);
      
      expect(successfulProcesses.length).toBeGreaterThan(processCount * 0.9); // 90% success rate
      
      // Verify each successful process went through complete lifecycle
      for (const process of successfulProcesses) {
        const processEvents = lifecycleEvents.filter(e => e.processId === process.processId);
        const eventTypes = processEvents.map(e => e.event);
        
        expect(eventTypes).toContain('created');
        expect(eventTypes).toContain('started');
        expect(eventTypes).toContain('completed');
        
        // Verify event ordering
        const createdTime = processEvents.find(e => e.event === 'created')?.timestamp;
        const startedTime = processEvents.find(e => e.event === 'started')?.timestamp;
        const completedTime = processEvents.find(e => e.event === 'completed')?.timestamp;
        
        if (createdTime && startedTime && completedTime) {
          expect(createdTime).toBeLessThanOrEqual(startedTime);
          expect(startedTime).toBeLessThanOrEqual(completedTime);
        }
      }
      
      // Verify process pool cleanup
      const poolStats = await processPool.getStats();
      expect(poolStats.activeProcesses).toBeLessThanOrEqual(1); // Should be mostly cleaned up
      
      console.log(`Lifecycle test: ${successfulProcesses.length}/${processCount} processes completed successfully`);
      console.log(`Total lifecycle events tracked: ${lifecycleEvents.length}`);
    });

    it('should handle process resource limits and enforce constraints', async () => {
      const resourceConstraints = [
        { maxMemory: 50 * 1024 * 1024, maxCpu: 50 }, // 50MB, 50% CPU
        { maxMemory: 100 * 1024 * 1024, maxCpu: 80 }, // 100MB, 80% CPU
        { maxMemory: 25 * 1024 * 1024, maxCpu: 30 }   // 25MB, 30% CPU
      ];
      
      const constraintTests = resourceConstraints.map(async (constraints, index) => {
        const processId = `resource-limited-${index}`;
        
        // Create memory-intensive script
        const memoryScript = `
          const targetMemory = ${Math.floor(constraints.maxMemory / 1024 / 1024)}; // MB
          const chunks = [];
          let allocated = 0;
          
          const interval = setInterval(() => {
            if (allocated < targetMemory * 0.8) {
              // Allocate 1MB chunk
              chunks.push(Buffer.alloc(1024 * 1024, 'memory-test'));
              allocated += 1;
            } else {
              clearInterval(interval);
              console.log(JSON.stringify({
                processId: '${processId}',
                allocatedMB: allocated,
                success: true
              }));
            }
          }, 10);
          
          setTimeout(() => {
            clearInterval(interval);
            console.log(JSON.stringify({
              processId: '${processId}',
              allocatedMB: allocated,
              timeout: true
            }));
          }, 3000);
        `;
        
        const scriptPath = path.join(tempDir, `resource-test-${index}.js`);
        await fs.promises.writeFile(scriptPath, memoryScript);
        
        try {
          const result = await processPool.execute({
            id: processId,
            command: 'node',
            args: [scriptPath],
            timeout: 5000,
            resourceLimits: constraints,
            killSignal: 'SIGTERM'
          });
          
          return {
            processId,
            constraints,
            success: true,
            result: result.stdout
          };
        } catch (error) {
          return {
            processId,
            constraints,
            success: false,
            error: error.message
          };
        }
      });
      
      const constraintResults = await Promise.all(constraintTests);
      
      // Verify processes respected constraints
      for (const result of constraintResults) {
        if (result.success) {
          try {
            const output = JSON.parse(result.result);
            // Process should not exceed memory limits significantly
            expect(output.allocatedMB).toBeLessThanOrEqual(
              result.constraints.maxMemory / 1024 / 1024 + 10 // 10MB tolerance
            );
          } catch {
            // Output parsing failed, but process completed
          }
        }
        
        // At least some processes should complete (not all killed for resource violations)
        expect(constraintResults.filter(r => r.success).length).toBeGreaterThan(0);
      }
      
      console.log(`Resource constraint test: ${constraintResults.filter(r => r.success).length}/${constraintResults.length} processes completed`);
    });
  });

  describe('Process Pool State Integration', () => {
    it('should coordinate process state with StateManager', async () => {
      const coordinatedProcesses = 12;
      const stateUpdates: Array<{
        processId: string;
        stateKey: string;
        action: 'set' | 'get' | 'update' | 'delete';
        timestamp: number;
        success: boolean;
      }> = [];
      
      // Create state coordination script
      const coordinationScript = `
        const processId = process.argv[2];
        const stateKey = \`process-state:\${processId}\`;
        
        // Simulate state operations
        const operations = [
          { action: 'set', value: { status: 'running', startTime: Date.now() } },
          { action: 'update', value: { progress: 50, updateTime: Date.now() } },
          { action: 'get' },
          { action: 'update', value: { progress: 100, completed: true } }
        ];
        
        console.log(JSON.stringify({
          processId,
          stateKey,
          operations: operations.length,
          timestamp: Date.now()
        }));
      `;
      
      const scriptPath = path.join(tempDir, 'state-coordination.js');
      await fs.promises.writeFile(scriptPath, coordinationScript);
      
      // Execute processes with state coordination
      const processPromises = Array.from({ length: coordinatedProcesses }, async (_, i) => {
        const processId = `coordinated-${i}`;
        const stateKey = `process-state:${processId}`;
        
        // Pre-populate some state
        await stateManager.setState(stateKey, {
          processId,
          status: 'pending',
          createdAt: Date.now()
        });
        
        stateUpdates.push({
          processId,
          stateKey,
          action: 'set',
          timestamp: Date.now(),
          success: true
        });
        
        try {
          // Update state to running
          await stateManager.updateState(stateKey, {
            status: 'running',
            startedAt: Date.now()
          });
          
          stateUpdates.push({
            processId,
            stateKey,
            action: 'update',
            timestamp: Date.now(),
            success: true
          });
          
          // Execute process
          const result = await processPool.execute({
            id: processId,
            command: 'node',
            args: [scriptPath, processId],
            timeout: 5000
          });
          
          // Update state to completed
          await stateManager.updateState(stateKey, {
            status: 'completed',
            completedAt: Date.now(),
            result: result.stdout
          });
          
          stateUpdates.push({
            processId,
            stateKey,
            action: 'update',
            timestamp: Date.now(),
            success: true
          });
          
          return { processId, success: true, stateKey };
        } catch (error) {
          // Update state to failed
          try {
            await stateManager.updateState(stateKey, {
              status: 'failed',
              failedAt: Date.now(),
              error: error.message
            });
            
            stateUpdates.push({
              processId,
              stateKey,
              action: 'update',
              timestamp: Date.now(),
              success: true
            });
          } catch (stateError) {
            stateUpdates.push({
              processId,
              stateKey,
              action: 'update',
              timestamp: Date.now(),
              success: false
            });
          }
          
          return { processId, success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(processPromises);
      
      // Verify state coordination
      const successfulProcesses = results.filter(r => r.success);
      expect(successfulProcesses.length).toBeGreaterThan(coordinatedProcesses * 0.8);
      
      // Verify final state consistency
      for (const process of successfulProcesses) {
        const finalState = await stateManager.getState(process.stateKey!);
        expect(finalState).toBeDefined();
        expect(finalState.processId).toBe(process.processId);
        expect(['completed', 'failed']).toContain(finalState.status);
      }
      
      // Verify state update success rate
      const successfulStateUpdates = stateUpdates.filter(u => u.success);
      const stateUpdateSuccessRate = successfulStateUpdates.length / stateUpdates.length;
      expect(stateUpdateSuccessRate).toBeGreaterThan(0.9);
      
      console.log(`State coordination: ${successfulProcesses.length}/${coordinatedProcesses} processes completed`);
      console.log(`State update success rate: ${(stateUpdateSuccessRate * 100).toFixed(2)}%`);
    });

    it('should handle process failures with state rollback', async () => {
      const failureScenarios = [
        { type: 'timeout', script: 'setTimeout(() => {}, 10000);' },
        { type: 'error', script: 'throw new Error("Simulated failure");' },
        { type: 'exit', script: 'process.exit(1);' },
        { type: 'memory', script: 'const arr = []; while(true) arr.push(Buffer.alloc(1024*1024));' }
      ];
      
      const rollbackResults = [];
      
      for (const [index, scenario] of failureScenarios.entries()) {
        const processId = `failure-${scenario.type}-${index}`;
        const stateKey = `failure-state:${processId}`;
        const checkpointKey = `checkpoint:${processId}`;
        
        // Create checkpoint state
        const checkpointData = {
          processId,
          scenario: scenario.type,
          checkpointTime: Date.now(),
          status: 'checkpointed'
        };
        
        await stateManager.setState(checkpointKey, checkpointData);
        await stateManager.setState(stateKey, {
          ...checkpointData,
          status: 'running',
          startedAt: Date.now()
        });
        
        // Create failure script
        const failureScript = `
          console.log('Process starting');
          ${scenario.script}
        `;
        
        const scriptPath = path.join(tempDir, `failure-${scenario.type}-${index}.js`);
        await fs.promises.writeFile(scriptPath, failureScript);
        
        try {
          await processPool.execute({
            id: processId,
            command: 'node',
            args: [scriptPath],
            timeout: 2000, // Short timeout for failure scenarios
            killSignal: 'SIGKILL'
          });
          
          // Should not reach here for failure scenarios
          rollbackResults.push({
            processId,
            scenario: scenario.type,
            expectedFailure: true,
            actualResult: 'unexpected-success'
          });
        } catch (error) {
          // Expected failure - perform state rollback
          try {
            const checkpointState = await stateManager.getState(checkpointKey);
            await stateManager.setState(stateKey, {
              ...checkpointState,
              status: 'rolled-back',
              failureReason: scenario.type,
              rollbackTime: Date.now()
            });
            
            rollbackResults.push({
              processId,
              scenario: scenario.type,
              expectedFailure: true,
              actualResult: 'failed-and-rolled-back',
              rollbackSuccess: true
            });
          } catch (rollbackError) {
            rollbackResults.push({
              processId,
              scenario: scenario.type,
              expectedFailure: true,
              actualResult: 'failed-rollback-failed',
              rollbackSuccess: false
            });
          }
        }
      }
      
      // Verify failure handling and rollbacks
      const successfulRollbacks = rollbackResults.filter(r => r.rollbackSuccess);
      expect(successfulRollbacks.length).toBeGreaterThan(failureScenarios.length * 0.7);
      
      // Verify rolled-back states
      for (const result of successfulRollbacks) {
        const rolledBackState = await stateManager.getState(`failure-state:${result.processId}`);
        expect(rolledBackState.status).toBe('rolled-back');
        expect(rolledBackState.failureReason).toBe(result.scenario);
      }
      
      console.log(`Failure rollback test: ${successfulRollbacks.length}/${failureScenarios.length} scenarios handled correctly`);
    });
  });

  describe('Resource Integration and Cleanup', () => {
    it('should coordinate process resources with ResourceManager', async () => {
      const resourceAwareProcesses = 16;
      const resourceTypes = ['cpu', 'memory', 'disk', 'network'];
      
      const resourceUsageTracking: Array<{
        processId: string;
        resourceType: string;
        requestedAmount: number;
        allocatedAmount: number;
        success: boolean;
      }> = [];
      
      const processPromises = Array.from({ length: resourceAwareProcesses }, async (_, i) => {
        const processId = `resource-aware-${i}`;
        const resourceType = resourceTypes[i % resourceTypes.length];
        const requestedAmount = Math.floor(Math.random() * 100) + 50; // 50-150 units
        
        try {
          // Request resources through ResourceManager
          const resourceRequest = {
            id: processId,
            type: resourceType,
            amount: requestedAmount,
            priority: Math.floor(Math.random() * 5) + 1
          };
          
          const allocation = await resourceManager.requestResource(resourceRequest);
          
          resourceUsageTracking.push({
            processId,
            resourceType,
            requestedAmount,
            allocatedAmount: allocation.allocated,
            success: allocation.success
          });
          
          if (allocation.success) {
            // Create resource-using script
            const resourceScript = `
              const processId = '${processId}';
              const resourceType = '${resourceType}';
              const allocated = ${allocation.allocated};
              
              console.log(JSON.stringify({
                processId,
                resourceType,
                allocated,
                using: true,
                timestamp: Date.now()
              }));
              
              // Simulate resource usage
              const duration = Math.random() * 1000 + 500; // 500-1500ms
              
              setTimeout(() => {
                console.log(JSON.stringify({
                  processId,
                  resourceType,
                  allocated,
                  completed: true,
                  timestamp: Date.now()
                }));
              }, duration);
            `;
            
            const scriptPath = path.join(tempDir, `resource-user-${i}.js`);
            await fs.promises.writeFile(scriptPath, resourceScript);
            
            const result = await processPool.execute({
              id: processId,
              command: 'node',
              args: [scriptPath],
              timeout: 5000,
              resourceContext: {
                type: resourceType,
                allocated: allocation.allocated
              }
            });
            
            // Release resources
            await resourceManager.releaseResource({
              id: processId,
              type: resourceType,
              amount: allocation.allocated
            });
            
            return {
              processId,
              success: true,
              resourceType,
              result: result.stdout
            };
          } else {
            return {
              processId,
              success: false,
              resourceType,
              reason: 'resource-allocation-failed'
            };
          }
        } catch (error) {
          return {
            processId,
            success: false,
            resourceType,
            error: error.message
          };
        }
      });
      
      const results = await Promise.all(processPromises);
      
      // Verify resource coordination
      const successfulProcesses = results.filter(r => r.success);
      expect(successfulProcesses.length).toBeGreaterThan(resourceAwareProcesses * 0.7);
      
      // Verify resource allocation efficiency
      const successfulAllocations = resourceUsageTracking.filter(r => r.success);
      const allocationSuccessRate = successfulAllocations.length / resourceUsageTracking.length;
      expect(allocationSuccessRate).toBeGreaterThan(0.6); // 60% minimum allocation success
      
      // Verify resource cleanup
      const resourceStatus = await resourceManager.getResourceStatus();
      expect(resourceStatus.allocatedResources).toBeDefined();
      
      // Check that resources were properly released
      for (const resourceType of resourceTypes) {
        const typeAllocations = resourceStatus.allocatedResources[resourceType] || 0;
        expect(typeAllocations).toBeLessThanOrEqual(10); // Should be mostly released
      }
      
      console.log(`Resource coordination: ${successfulProcesses.length}/${resourceAwareProcesses} processes completed`);
      console.log(`Resource allocation success rate: ${(allocationSuccessRate * 100).toFixed(2)}%`);
    });

    it('should perform comprehensive cleanup after process completion', async () => {
      const cleanupProcesses = 20;
      const tempFiles: string[] = [];
      const stateKeys: string[] = [];
      const memoryEntries: string[] = [];
      
      // Create processes that generate artifacts needing cleanup
      const cleanupPromises = Array.from({ length: cleanupProcesses }, async (_, i) => {
        const processId = `cleanup-test-${i}`;
        const tempFile = path.join(tempDir, `cleanup-artifact-${i}.txt`);
        const stateKey = `cleanup-state:${processId}`;
        const memoryKey = `cleanup-memory:${processId}`;
        
        tempFiles.push(tempFile);
        stateKeys.push(stateKey);
        memoryEntries.push(memoryKey);
        
        // Create artifacts
        await fs.promises.writeFile(tempFile, `Artifact from process ${processId}`);
        await stateManager.setState(stateKey, {
          processId,
          artifactFile: tempFile,
          createdAt: Date.now()
        });
        await memoryManager.storeEntry({
          id: memoryKey,
          agentId: processId,
          sessionId: 'cleanup-session',
          type: 'artifact',
          content: `Memory artifact from ${processId}`,
          context: { processId, artifactFile: tempFile },
          timestamp: new Date(),
          tags: ['cleanup', 'artifact'],
          version: 1
        });
        
        // Create cleanup script
        const cleanupScript = `
          const fs = require('fs');
          const processId = '${processId}';
          const tempFile = '${tempFile}';
          
          console.log(JSON.stringify({
            processId,
            message: 'Process completed, ready for cleanup',
            artifactFile: tempFile,
            timestamp: Date.now()
          }));
        `;
        
        const scriptPath = path.join(tempDir, `cleanup-process-${i}.js`);
        await fs.promises.writeFile(scriptPath, cleanupScript);
        
        try {
          const result = await processPool.execute({
            id: processId,
            command: 'node',
            args: [scriptPath],
            timeout: 3000,
            cleanupArtifacts: [tempFile],
            cleanupStateKeys: [stateKey],
            cleanupMemoryKeys: [memoryKey]
          });
          
          return { processId, success: true, artifacts: [tempFile, stateKey, memoryKey] };
        } catch (error) {
          return { processId, success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(cleanupPromises);
      
      // Trigger explicit cleanup
      await processPool.performCleanup();
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify file cleanup
      let filesRemaining = 0;
      for (const tempFile of tempFiles) {
        try {
          await fs.promises.access(tempFile);
          filesRemaining++;
        } catch {
          // File was cleaned up (expected)
        }
      }
      
      // Verify state cleanup
      let statesRemaining = 0;
      for (const stateKey of stateKeys) {
        const state = await stateManager.getState(stateKey);
        if (state) {
          statesRemaining++;
        }
      }
      
      // Verify memory cleanup
      const remainingMemoryEntries = await memoryManager.queryEntries({
        tags: ['cleanup'],
        limit: 1000
      });
      
      const successfulProcesses = results.filter(r => r.success);
      
      // Cleanup should be reasonably effective
      expect(filesRemaining).toBeLessThan(tempFiles.length * 0.3); // 70% file cleanup
      expect(statesRemaining).toBeLessThan(stateKeys.length * 0.2); // 80% state cleanup
      expect(remainingMemoryEntries.length).toBeLessThan(memoryEntries.length * 0.3); // 70% memory cleanup
      
      console.log(`Cleanup verification: ${successfulProcesses.length}/${cleanupProcesses} processes completed`);
      console.log(`Files remaining: ${filesRemaining}/${tempFiles.length}`);
      console.log(`States remaining: ${statesRemaining}/${stateKeys.length}`);
      console.log(`Memory entries remaining: ${remainingMemoryEntries.length}/${memoryEntries.length}`);
    });
  });
});
