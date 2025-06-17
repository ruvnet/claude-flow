const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Rollback Mechanism Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('standard');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Transaction Rollback', () => {
    it('should rollback file operations on failure', async () => {
      // Track all file operations for rollback
      const fileOperations = [];
      const originalFiles = new Map();
      
      // Save original state
      for (const [path, content] of harness.mockFS.entries()) {
        originalFiles.set(path, content);
      }

      const operations = [
        {
          id: 1,
          type: 'create',
          path: 'src/new-file1.js',
          content: 'export const feature1 = () => {};'
        },
        {
          id: 2,
          type: 'update',
          path: 'src/index.js',
          content: 'import { feature1 } from "./new-file1";\nconsole.log("Updated");'
        },
        {
          id: 3,
          type: 'create',
          path: 'src/new-file2.js',
          content: 'export const feature2 = () => {};'
        },
        {
          id: 4,
          type: 'delete',
          path: 'src/utils.js'
        },
        {
          id: 5,
          type: 'error',
          message: 'Simulated failure - should trigger rollback'
        }
      ];

      const executeWithRollback = async () => {
        const rollbackStack = [];
        
        try {
          for (const op of operations) {
            if (op.type === 'error') {
              throw new Error(op.message);
            }
            
            switch (op.type) {
              case 'create':
                await harness.mockWriteFile(op.path, op.content);
                rollbackStack.push({
                  action: 'delete',
                  path: op.path
                });
                break;
                
              case 'update':
                const originalContent = await harness.mockReadFile(op.path);
                await harness.mockWriteFile(op.path, op.content);
                rollbackStack.push({
                  action: 'restore',
                  path: op.path,
                  content: originalContent
                });
                break;
                
              case 'delete':
                const deletedContent = await harness.mockReadFile(op.path);
                harness.mockFS.delete(op.path);
                rollbackStack.push({
                  action: 'restore',
                  path: op.path,
                  content: deletedContent
                });
                break;
            }
            
            fileOperations.push({ ...op, status: 'completed' });
          }
        } catch (error) {
          console.log('Error occurred, rolling back changes...');
          
          // Execute rollback in reverse order
          for (const rollback of rollbackStack.reverse()) {
            switch (rollback.action) {
              case 'delete':
                harness.mockFS.delete(rollback.path);
                break;
              case 'restore':
                await harness.mockWriteFile(rollback.path, rollback.content);
                break;
            }
          }
          
          throw error;
        }
      };

      // Execute operations with rollback
      let errorCaught = false;
      try {
        await executeWithRollback();
      } catch (error) {
        errorCaught = true;
        assert(error.message.includes('Simulated failure'));
      }

      assert(errorCaught, 'Error should have been thrown');

      // Verify rollback completed successfully
      assert(!harness.mockFS.has('src/new-file1.js'), 'New file 1 should be rolled back');
      assert(!harness.mockFS.has('src/new-file2.js'), 'New file 2 should be rolled back');
      
      // Verify original files restored
      const indexContent = await harness.mockReadFile('src/index.js');
      assert.strictEqual(indexContent, originalFiles.get('src/index.js'));
      
      assert(harness.mockFS.has('src/utils.js'), 'Deleted file should be restored');
      const utilsContent = await harness.mockReadFile('src/utils.js');
      assert.strictEqual(utilsContent, originalFiles.get('src/utils.js'));
    });

    it('should handle partial rollback failures gracefully', async () => {
      const operations = [
        { id: 1, type: 'create', path: 'file1.txt', content: 'content1' },
        { id: 2, type: 'create', path: 'file2.txt', content: 'content2' },
        { id: 3, type: 'create', path: 'file3.txt', content: 'content3' },
        { id: 4, type: 'fail' }
      ];

      const rollbackLog = [];
      let rollbackWithFailure = false;

      const executeWithFailingRollback = async () => {
        const createdFiles = [];
        
        try {
          for (const op of operations) {
            if (op.type === 'fail') {
              throw new Error('Operation failed');
            }
            
            await harness.mockWriteFile(op.path, op.content);
            createdFiles.push(op.path);
          }
        } catch (error) {
          // Attempt rollback with simulated failure
          for (let i = createdFiles.length - 1; i >= 0; i--) {
            const file = createdFiles[i];
            
            try {
              if (file === 'file2.txt') {
                // Simulate rollback failure for file2
                throw new Error('Rollback failed for file2.txt');
              }
              
              harness.mockFS.delete(file);
              rollbackLog.push({ file, status: 'rolled back' });
            } catch (rollbackError) {
              rollbackLog.push({ file, status: 'rollback failed', error: rollbackError.message });
              rollbackWithFailure = true;
            }
          }
          
          throw error;
        }
      };

      try {
        await executeWithFailingRollback();
      } catch (error) {
        assert(error.message === 'Operation failed');
      }

      // Verify rollback log
      assert.strictEqual(rollbackLog.length, 3);
      assert(rollbackLog.some(entry => entry.status === 'rollback failed'));
      assert(rollbackWithFailure);
      
      // Verify partial rollback state
      assert(!harness.mockFS.has('file3.txt'), 'file3.txt should be rolled back');
      assert(harness.mockFS.has('file2.txt'), 'file2.txt rollback failed, should still exist');
      assert(!harness.mockFS.has('file1.txt'), 'file1.txt should be rolled back');
    });

    it('should implement two-phase commit for distributed operations', async () => {
      // Simulate distributed system with multiple services
      const services = {
        database: { 
          transactions: new Map(),
          prepared: new Set()
        },
        cache: { 
          transactions: new Map(),
          prepared: new Set()
        },
        queue: { 
          transactions: new Map(),
          prepared: new Set()
        }
      };

      const distributedTransaction = async (operations) => {
        const transactionId = `tx_${Date.now()}`;
        const preparedServices = [];
        
        try {
          // Phase 1: Prepare
          console.log(`\nPhase 1: Preparing transaction ${transactionId}`);
          
          for (const op of operations) {
            const service = services[op.service];
            
            // Simulate prepare phase
            service.transactions.set(transactionId, {
              operation: op,
              state: 'prepared',
              rollbackData: op.rollbackData
            });
            service.prepared.add(transactionId);
            preparedServices.push(op.service);
            
            console.log(`  - ${op.service}: prepared`);
            
            // Simulate failure during prepare
            if (op.shouldFailPrepare) {
              throw new Error(`${op.service} failed to prepare`);
            }
          }
          
          // Phase 2: Commit
          console.log(`\nPhase 2: Committing transaction ${transactionId}`);
          
          for (const op of operations) {
            const service = services[op.service];
            const tx = service.transactions.get(transactionId);
            
            // Simulate commit phase
            if (op.shouldFailCommit) {
              throw new Error(`${op.service} failed to commit`);
            }
            
            tx.state = 'committed';
            service.prepared.delete(transactionId);
            console.log(`  - ${op.service}: committed`);
          }
          
          return { transactionId, status: 'committed' };
          
        } catch (error) {
          console.log(`\nError: ${error.message}`);
          console.log('Rolling back prepared services...');
          
          // Rollback all prepared services
          for (const serviceName of preparedServices) {
            const service = services[serviceName];
            
            if (service.prepared.has(transactionId)) {
              const tx = service.transactions.get(transactionId);
              tx.state = 'aborted';
              service.prepared.delete(transactionId);
              console.log(`  - ${serviceName}: rolled back`);
            }
          }
          
          throw error;
        }
      };

      // Test successful two-phase commit
      const successfulOps = [
        { service: 'database', action: 'insert', data: { id: 1, name: 'test' } },
        { service: 'cache', action: 'set', key: 'user:1', value: 'test' },
        { service: 'queue', action: 'publish', message: 'user.created' }
      ];

      const successResult = await distributedTransaction(successfulOps);
      assert(successResult.status === 'committed');

      // Test rollback on prepare failure
      const failPrepareOps = [
        { service: 'database', action: 'insert', data: { id: 2 } },
        { service: 'cache', action: 'set', key: 'user:2', shouldFailPrepare: true }
      ];

      try {
        await distributedTransaction(failPrepareOps);
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('failed to prepare'));
      }

      // Verify rollback
      const dbTransactions = Array.from(services.database.transactions.values());
      const abortedDb = dbTransactions.filter(tx => tx.state === 'aborted');
      assert(abortedDb.length > 0);
    });
  });

  describe('State Recovery', () => {
    it('should create and restore from checkpoints', async () => {
      const stateManager = {
        checkpoints: new Map(),
        currentState: {
          files: new Map(),
          metadata: { version: 1, lastModified: Date.now() }
        }
      };

      const createCheckpoint = (name) => {
        const checkpoint = {
          name,
          timestamp: Date.now(),
          state: {
            files: new Map(harness.mockFS),
            metadata: { ...stateManager.currentState.metadata }
          }
        };
        stateManager.checkpoints.set(name, checkpoint);
        return checkpoint;
      };

      const restoreCheckpoint = (name) => {
        const checkpoint = stateManager.checkpoints.get(name);
        if (!checkpoint) {
          throw new Error(`Checkpoint ${name} not found`);
        }
        
        // Restore file system state
        harness.mockFS.clear();
        for (const [path, content] of checkpoint.state.files) {
          harness.mockFS.set(path, content);
        }
        
        // Restore metadata
        stateManager.currentState.metadata = { ...checkpoint.state.metadata };
        
        return checkpoint;
      };

      // Create initial checkpoint
      createCheckpoint('initial');

      // Make changes
      await harness.mockWriteFile('src/feature1.js', 'export const feature1 = true;');
      await harness.mockWriteFile('src/feature2.js', 'export const feature2 = true;');
      createCheckpoint('after-features');

      // More changes
      harness.mockFS.delete('src/utils.js');
      await harness.mockWriteFile('src/feature3.js', 'export const feature3 = true;');
      createCheckpoint('after-deletion');

      // Simulate error and restore
      try {
        // Attempt risky operation
        await harness.mockWriteFile('src/broken.js', 'syntax error {');
        throw new Error('Build failed due to syntax error');
      } catch (error) {
        console.log('Error detected, restoring from checkpoint...');
        
        // Restore to last known good state
        const restored = restoreCheckpoint('after-features');
        console.log(`Restored to checkpoint: ${restored.name}`);
      }

      // Verify restoration
      assert(harness.mockFS.has('src/feature1.js'));
      assert(harness.mockFS.has('src/feature2.js'));
      assert(!harness.mockFS.has('src/feature3.js')); // Should not exist after restore
      assert(harness.mockFS.has('src/utils.js')); // Should be restored
      assert(!harness.mockFS.has('src/broken.js')); // Error file should not exist

      // Verify checkpoint history
      assert.strictEqual(stateManager.checkpoints.size, 3);
      assert(stateManager.checkpoints.has('initial'));
      assert(stateManager.checkpoints.has('after-features'));
      assert(stateManager.checkpoints.has('after-deletion'));
    });

    it('should implement incremental rollback', async () => {
      const changeLog = [];
      
      const trackChange = (change) => {
        changeLog.push({
          ...change,
          timestamp: Date.now(),
          id: changeLog.length
        });
      };

      const applyChange = async (change) => {
        switch (change.type) {
          case 'create':
            await harness.mockWriteFile(change.path, change.content);
            trackChange({ ...change, oldContent: null });
            break;
            
          case 'update':
            const oldContent = await harness.mockReadFile(change.path);
            await harness.mockWriteFile(change.path, change.content);
            trackChange({ ...change, oldContent });
            break;
            
          case 'delete':
            const deletedContent = await harness.mockReadFile(change.path);
            harness.mockFS.delete(change.path);
            trackChange({ ...change, oldContent: deletedContent });
            break;
        }
      };

      const rollbackToChange = async (changeId) => {
        const targetIndex = changeLog.findIndex(c => c.id === changeId);
        if (targetIndex === -1) {
          throw new Error(`Change ${changeId} not found`);
        }
        
        // Rollback changes in reverse order
        for (let i = changeLog.length - 1; i > targetIndex; i--) {
          const change = changeLog[i];
          
          switch (change.type) {
            case 'create':
              harness.mockFS.delete(change.path);
              break;
              
            case 'update':
            case 'delete':
              if (change.oldContent !== null) {
                await harness.mockWriteFile(change.path, change.oldContent);
              }
              break;
          }
        }
        
        // Remove rolled back changes from log
        changeLog.splice(targetIndex + 1);
      };

      // Apply series of changes
      await applyChange({ type: 'create', path: 'v1.txt', content: 'Version 1' });
      await applyChange({ type: 'create', path: 'v2.txt', content: 'Version 2' });
      await applyChange({ type: 'update', path: 'src/index.js', content: 'Updated index' });
      await applyChange({ type: 'create', path: 'v3.txt', content: 'Version 3' });
      await applyChange({ type: 'delete', path: 'src/utils.js' });

      // Verify all changes applied
      assert.strictEqual(changeLog.length, 5);
      assert(harness.mockFS.has('v3.txt'));
      assert(!harness.mockFS.has('src/utils.js'));

      // Rollback to change 2 (after v2.txt creation)
      await rollbackToChange(1);

      // Verify incremental rollback
      assert(harness.mockFS.has('v1.txt'));
      assert(harness.mockFS.has('v2.txt'));
      assert(!harness.mockFS.has('v3.txt')); // Should be rolled back
      assert(harness.mockFS.has('src/utils.js')); // Should be restored
      
      const indexContent = await harness.mockReadFile('src/index.js');
      assert(indexContent.includes('console.log')); // Original content
      
      assert.strictEqual(changeLog.length, 2); // Only first 2 changes remain
    });
  });

  describe('Compensation Patterns', () => {
    it('should implement saga pattern for complex workflows', async () => {
      const saga = {
        steps: [],
        compensations: [],
        completed: [],
        failed: null
      };

      const executeSaga = async (workflow) => {
        saga.steps = workflow;
        
        try {
          for (let i = 0; i < workflow.length; i++) {
            const step = workflow[i];
            console.log(`Executing step ${i + 1}: ${step.name}`);
            
            // Execute step
            const result = await step.execute();
            saga.completed.push({ step: step.name, result });
            
            // Register compensation
            if (step.compensate) {
              saga.compensations.unshift({
                step: step.name,
                compensate: step.compensate,
                data: result
              });
            }
            
            // Check for failure
            if (step.shouldFail) {
              throw new Error(`Step ${step.name} failed`);
            }
          }
          
          return { status: 'completed', completed: saga.completed };
          
        } catch (error) {
          console.log(`\nSaga failed at step: ${error.message}`);
          console.log('Running compensations...');
          
          saga.failed = error;
          
          // Run compensations in reverse order
          for (const compensation of saga.compensations) {
            try {
              console.log(`  Compensating: ${compensation.step}`);
              await compensation.compensate(compensation.data);
            } catch (compError) {
              console.log(`  Warning: Compensation failed for ${compensation.step}: ${compError.message}`);
            }
          }
          
          throw error;
        }
      };

      // Define a complex workflow
      const orderWorkflow = [
        {
          name: 'reserve-inventory',
          execute: async () => {
            await harness.mockWriteFile('inventory-lock.json', JSON.stringify({
              orderId: 'order-123',
              items: ['item1', 'item2'],
              locked: true
            }));
            return { lockId: 'lock-123' };
          },
          compensate: async (data) => {
            harness.mockFS.delete('inventory-lock.json');
          }
        },
        {
          name: 'charge-payment',
          execute: async () => {
            await harness.mockWriteFile('payment-record.json', JSON.stringify({
              orderId: 'order-123',
              amount: 100,
              status: 'charged'
            }));
            return { paymentId: 'payment-123' };
          },
          compensate: async (data) => {
            await harness.mockWriteFile('payment-record.json', JSON.stringify({
              orderId: 'order-123',
              amount: 100,
              status: 'refunded',
              refundId: 'refund-123'
            }));
          }
        },
        {
          name: 'create-shipment',
          execute: async () => {
            await harness.mockWriteFile('shipment.json', JSON.stringify({
              orderId: 'order-123',
              status: 'pending'
            }));
            return { shipmentId: 'ship-123' };
          },
          compensate: async (data) => {
            harness.mockFS.delete('shipment.json');
          },
          shouldFail: true // Simulate failure at this step
        },
        {
          name: 'send-confirmation',
          execute: async () => {
            await harness.mockWriteFile('confirmation.json', JSON.stringify({
              orderId: 'order-123',
              sent: true
            }));
            return { confirmationId: 'conf-123' };
          }
        }
      ];

      // Execute saga with expected failure
      try {
        await executeSaga(orderWorkflow);
        assert.fail('Saga should have failed');
      } catch (error) {
        assert(error.message.includes('create-shipment failed'));
      }

      // Verify compensations were executed
      assert(!harness.mockFS.has('inventory-lock.json'), 'Inventory should be released');
      assert(harness.mockFS.has('payment-record.json'), 'Payment record should exist');
      
      const paymentRecord = JSON.parse(await harness.mockReadFile('payment-record.json'));
      assert.strictEqual(paymentRecord.status, 'refunded', 'Payment should be refunded');
      
      assert(!harness.mockFS.has('shipment.json'), 'Shipment should not exist');
      assert(!harness.mockFS.has('confirmation.json'), 'Confirmation should not be sent');
      
      // Verify saga state
      assert.strictEqual(saga.completed.length, 2); // Only first 2 steps completed
      assert.strictEqual(saga.compensations.length, 2); // 2 compensations registered
    });

    it('should handle compensation failures with fallback strategies', async () => {
      const compensationLog = [];
      
      const executeWithFallback = async (operations) => {
        const executed = [];
        
        try {
          for (const op of operations) {
            const result = await op.execute();
            executed.push({ operation: op.name, result });
          }
          
          // Simulate failure after all operations
          throw new Error('System failure after operations');
          
        } catch (error) {
          console.log('Attempting compensations with fallback strategies...');
          
          for (const op of operations.reverse()) {
            if (!op.compensate) continue;
            
            try {
              // Try primary compensation
              await op.compensate();
              compensationLog.push({
                operation: op.name,
                status: 'compensated',
                method: 'primary'
              });
            } catch (compError) {
              // Try fallback compensation
              if (op.fallbackCompensate) {
                try {
                  await op.fallbackCompensate();
                  compensationLog.push({
                    operation: op.name,
                    status: 'compensated',
                    method: 'fallback'
                  });
                } catch (fallbackError) {
                  compensationLog.push({
                    operation: op.name,
                    status: 'failed',
                    error: fallbackError.message
                  });
                }
              } else {
                compensationLog.push({
                  operation: op.name,
                  status: 'failed',
                  error: compError.message
                });
              }
            }
          }
          
          throw error;
        }
      };

      const operations = [
        {
          name: 'operation1',
          execute: async () => {
            await harness.mockWriteFile('op1.txt', 'Operation 1 data');
            return { id: 1 };
          },
          compensate: async () => {
            harness.mockFS.delete('op1.txt');
          }
        },
        {
          name: 'operation2',
          execute: async () => {
            await harness.mockWriteFile('op2.txt', 'Operation 2 data');
            return { id: 2 };
          },
          compensate: async () => {
            // Simulate compensation failure
            throw new Error('Primary compensation failed');
          },
          fallbackCompensate: async () => {
            // Fallback: Mark for manual cleanup
            await harness.mockWriteFile('cleanup-required.txt', 
              'Manual cleanup needed for op2.txt');
          }
        },
        {
          name: 'operation3',
          execute: async () => {
            await harness.mockWriteFile('op3.txt', 'Operation 3 data');
            return { id: 3 };
          },
          compensate: async () => {
            harness.mockFS.delete('op3.txt');
          }
        }
      ];

      try {
        await executeWithFallback(operations);
      } catch (error) {
        assert(error.message.includes('System failure'));
      }

      // Verify compensation log
      assert.strictEqual(compensationLog.length, 3);
      assert(compensationLog.some(log => log.method === 'fallback'));
      assert(harness.mockFS.has('cleanup-required.txt'), 'Fallback should create cleanup marker');
      
      // Verify compensations
      assert(!harness.mockFS.has('op1.txt'), 'Operation 1 should be compensated');
      assert(harness.mockFS.has('op2.txt'), 'Operation 2 compensation failed, file remains');
      assert(!harness.mockFS.has('op3.txt'), 'Operation 3 should be compensated');
    });
  });
});