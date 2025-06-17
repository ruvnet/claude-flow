const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Batch Error Handling Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('standard');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Partial Failure Handling', () => {
    it('should continue processing after individual failures', async () => {
      const operations = [
        { id: 1, shouldFail: false },
        { id: 2, shouldFail: true, error: 'Network timeout' },
        { id: 3, shouldFail: false },
        { id: 4, shouldFail: true, error: 'Permission denied' },
        { id: 5, shouldFail: false }
      ];

      const results = await harness.executeBatch(operations, async (op) => {
        if (op.shouldFail) {
          throw new Error(op.error);
        }
        return { id: op.id, processed: true };
      });

      assert.strictEqual(results.successful.length, 3);
      assert.strictEqual(results.failed.length, 2);
      assert.strictEqual(results.totalProcessed, 5);
      assert.strictEqual(results.successRate, 0.6);

      // Verify successful operations completed
      const successIds = results.successful.map(r => r.id);
      assert.deepStrictEqual(successIds, [1, 3, 5]);

      // Verify error details captured
      assert.strictEqual(results.failed[0].error.message, 'Network timeout');
      assert.strictEqual(results.failed[1].error.message, 'Permission denied');
    });

    it('should handle mixed synchronous and asynchronous errors', async () => {
      const tasks = [
        async () => 'success1',
        () => { throw new Error('Sync error'); },
        async () => { throw new Error('Async error'); },
        async () => 'success2',
        () => { throw new TypeError('Type mismatch'); }
      ];

      const results = await harness.executeBatch(tasks, async (task) => await task());

      assert.strictEqual(results.successful.length, 2);
      assert.strictEqual(results.failed.length, 3);
      
      // Check error types preserved
      const errorTypes = results.failed.map(f => f.error.constructor.name);
      assert(errorTypes.includes('Error'));
      assert(errorTypes.includes('TypeError'));
    });

    it('should handle cascading failures gracefully', async () => {
      // Simulate a scenario where one failure affects subsequent operations
      let sharedResource = { available: true };

      const operations = Array.from({ length: 10 }, (_, i) => async () => {
        if (i === 3) {
          // Operation 3 corrupts the shared resource
          sharedResource.available = false;
          throw new Error('Resource corruption');
        }
        
        if (!sharedResource.available) {
          throw new Error('Resource unavailable due to previous failure');
        }
        
        return { operation: i, status: 'completed' };
      });

      const results = await harness.executeBatch(operations, async (op) => await op());

      // First 3 operations should succeed
      const successfulOps = results.successful.map(r => r.operation);
      assert.deepStrictEqual(successfulOps, [0, 1, 2]);

      // Remaining operations should fail
      assert.strictEqual(results.failed.length, 7);
      
      // Check cascade error messages
      const cascadeErrors = results.failed.filter(f => 
        f.error.message.includes('Resource unavailable')
      );
      assert(cascadeErrors.length >= 6);
    });
  });

  describe('Error Recovery Strategies', () => {
    it('should implement retry logic for transient errors', async () => {
      const operations = Array.from({ length: 5 }, (_, i) => {
        let attempts = 0;
        return {
          id: i,
          operation: async () => {
            attempts++;
            
            // Fail first 2 attempts for some operations
            if (i % 2 === 0 && attempts < 3) {
              throw new Error(`Transient error attempt ${attempts}`);
            }
            
            return { id: i, attempts, success: true };
          }
        };
      });

      // Implement retry wrapper
      const retryWrapper = async (operation, maxRetries = 3) => {
        let lastError;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await operation();
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
              await harness.simulateDelay(50 * (attempt + 1)); // Exponential backoff
            }
          }
        }
        
        throw lastError;
      };

      const results = await harness.executeBatch(operations, async (op) => 
        await retryWrapper(op.operation)
      );

      assert.strictEqual(results.successful.length, 5);
      assert.strictEqual(results.failed.length, 0);
      
      // Verify retry attempts
      const evenResults = results.successful.filter(r => r.id % 2 === 0);
      assert(evenResults.every(r => r.attempts === 3));
    });

    it('should handle timeout errors appropriately', async () => {
      const timeoutMs = 100;
      
      const operations = [
        { id: 1, duration: 50 },   // Should complete
        { id: 2, duration: 150 },  // Should timeout
        { id: 3, duration: 80 },   // Should complete
        { id: 4, duration: 200 },  // Should timeout
        { id: 5, duration: 30 }    // Should complete
      ];

      const withTimeout = async (promise, ms) => {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Operation timeout')), ms);
        });
        
        try {
          return await Promise.race([promise, timeout]);
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const results = await harness.executeBatch(operations, async (op) => {
        const operation = harness.simulateDelay(op.duration).then(() => ({
          id: op.id,
          completed: true
        }));
        
        return await withTimeout(operation, timeoutMs);
      });

      assert.strictEqual(results.successful.length, 3);
      assert.strictEqual(results.failed.length, 2);
      
      // Verify timeout errors
      const timeoutErrors = results.failed.filter(f => 
        f.error.message === 'Operation timeout'
      );
      assert.strictEqual(timeoutErrors.length, 2);
    });

    it('should implement circuit breaker pattern', async () => {
      // Circuit breaker configuration
      const circuitBreaker = {
        failureThreshold: 3,
        resetTimeout: 500,
        state: 'closed',
        failures: 0,
        lastFailureTime: null
      };

      const operations = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        // Operations 2, 3, 4 will fail
        shouldFail: i >= 2 && i <= 4
      }));

      const executeWithCircuitBreaker = async (operation) => {
        // Check if circuit is open
        if (circuitBreaker.state === 'open') {
          const now = Date.now();
          if (now - circuitBreaker.lastFailureTime < circuitBreaker.resetTimeout) {
            throw new Error('Circuit breaker is open');
          } else {
            // Try to reset
            circuitBreaker.state = 'half-open';
          }
        }

        try {
          if (operation.shouldFail) {
            throw new Error('Operation failed');
          }
          
          // Success - reset circuit if needed
          if (circuitBreaker.state === 'half-open') {
            circuitBreaker.state = 'closed';
            circuitBreaker.failures = 0;
          }
          
          return { id: operation.id, status: 'success' };
        } catch (error) {
          circuitBreaker.failures++;
          circuitBreaker.lastFailureTime = Date.now();
          
          if (circuitBreaker.failures >= circuitBreaker.failureThreshold) {
            circuitBreaker.state = 'open';
          }
          
          throw error;
        }
      };

      const results = await harness.executeBatch(operations, executeWithCircuitBreaker);

      // First 2 operations should succeed
      assert(results.successful.some(r => r.id === 0));
      assert(results.successful.some(r => r.id === 1));
      
      // Circuit should open after 3 failures
      const circuitBreakerErrors = results.failed.filter(f => 
        f.error.message === 'Circuit breaker is open'
      );
      assert(circuitBreakerErrors.length > 0);
    });
  });

  describe('Error Aggregation and Reporting', () => {
    it('should aggregate errors by type and severity', async () => {
      const operations = [
        { id: 1, error: new Error('Network error'), severity: 'high' },
        { id: 2, error: new TypeError('Type mismatch'), severity: 'medium' },
        { id: 3, error: new Error('Network error'), severity: 'high' },
        { id: 4, error: new RangeError('Index out of bounds'), severity: 'low' },
        { id: 5, error: new TypeError('Cannot read property'), severity: 'medium' },
        { id: 6, error: null }, // Success
        { id: 7, error: new Error('Network error'), severity: 'high' }
      ];

      const results = await harness.executeBatch(operations, async (op) => {
        if (op.error) {
          op.error.severity = op.severity;
          throw op.error;
        }
        return { id: op.id, success: true };
      });

      // Aggregate errors
      const errorAggregation = results.failed.reduce((acc, failure) => {
        const errorType = failure.error.constructor.name;
        const severity = failure.error.severity || 'unknown';
        
        if (!acc[errorType]) {
          acc[errorType] = { count: 0, severities: {} };
        }
        
        acc[errorType].count++;
        acc[errorType].severities[severity] = (acc[errorType].severities[severity] || 0) + 1;
        
        return acc;
      }, {});

      console.log('\n=== Error Aggregation Report ===');
      console.log('Error Type   | Count | High | Medium | Low');
      console.log('-------------|-------|------|--------|-----');
      
      Object.entries(errorAggregation).forEach(([type, data]) => {
        console.log(`${type.padEnd(12)} | ${data.count.toString().padEnd(5)} | ${(data.severities.high || 0).toString().padEnd(4)} | ${(data.severities.medium || 0).toString().padEnd(6)} | ${(data.severities.low || 0)}`);
      });

      assert.strictEqual(errorAggregation.Error.count, 3);
      assert.strictEqual(errorAggregation.TypeError.count, 2);
      assert.strictEqual(errorAggregation.RangeError.count, 1);
    });

    it('should provide detailed error context', async () => {
      const files = [
        'src/valid.js',
        'src/missing.js',
        'src/corrupt.js',
        'src/locked.js'
      ];

      // Set up test files
      harness.mockFS.set('src/valid.js', 'console.log("valid");');
      harness.mockFS.set('src/corrupt.js', ''); // Empty file to simulate corruption

      const fileOperations = files.map(file => ({
        file,
        operation: async () => {
          if (file.includes('missing')) {
            const error = new Error('File not found');
            error.code = 'ENOENT';
            error.path = file;
            error.syscall = 'open';
            throw error;
          }
          
          if (file.includes('locked')) {
            const error = new Error('Permission denied');
            error.code = 'EACCES';
            error.path = file;
            error.syscall = 'open';
            throw error;
          }
          
          const content = await harness.mockReadFile(file);
          
          if (file.includes('corrupt') && content.length === 0) {
            const error = new Error('File appears to be corrupted');
            error.code = 'CORRUPT';
            error.path = file;
            error.details = { size: 0, expected: '>0' };
            throw error;
          }
          
          return { file, content, size: content.length };
        }
      }));

      const results = await harness.executeBatch(fileOperations, async (op) => 
        await op.operation()
      );

      // Generate detailed error report
      const errorReport = results.failed.map(failure => ({
        file: fileOperations[failure.index].file,
        error: {
          message: failure.error.message,
          code: failure.error.code,
          path: failure.error.path,
          syscall: failure.error.syscall,
          details: failure.error.details
        }
      }));

      console.log('\n=== Detailed Error Report ===');
      errorReport.forEach(report => {
        console.log(`\nFile: ${report.file}`);
        console.log(`Error: ${report.error.message}`);
        console.log(`Code: ${report.error.code || 'N/A'}`);
        if (report.error.syscall) console.log(`Syscall: ${report.error.syscall}`);
        if (report.error.details) console.log(`Details: ${JSON.stringify(report.error.details)}`);
      });

      assert.strictEqual(results.failed.length, 3);
      assert(errorReport.some(r => r.error.code === 'ENOENT'));
      assert(errorReport.some(r => r.error.code === 'EACCES'));
      assert(errorReport.some(r => r.error.code === 'CORRUPT'));
    });
  });

  describe('Error Boundary Testing', () => {
    it('should handle catastrophic failures without crashing', async () => {
      const operations = [
        async () => 'success1',
        async () => {
          // Simulate stack overflow
          const recursiveCall = () => recursiveCall();
          try {
            recursiveCall();
          } catch (e) {
            throw new Error('Stack overflow detected');
          }
        },
        async () => 'success2',
        async () => {
          // Simulate out of memory
          try {
            const huge = new Array(1e9).fill('x');
          } catch (e) {
            throw new Error('Memory allocation failed');
          }
        },
        async () => 'success3'
      ];

      let systemStable = true;
      
      try {
        const results = await harness.executeBatch(operations, async (op) => {
          try {
            return await op();
          } catch (error) {
            // Log catastrophic errors
            if (error.message.includes('Stack overflow') || 
                error.message.includes('Memory allocation')) {
              console.log(`Catastrophic error caught: ${error.message}`);
            }
            throw error;
          }
        });

        assert(results.successful.length >= 3);
        assert(results.failed.length >= 2);
      } catch (systemError) {
        systemStable = false;
      }

      assert(systemStable, 'System should remain stable despite catastrophic failures');
    });

    it('should isolate errors between parallel operations', async () => {
      const sharedState = { counter: 0 };
      
      const operations = Array.from({ length: 10 }, (_, i) => async () => {
        // Each operation tries to modify shared state
        const localCounter = sharedState.counter;
        
        if (i === 5) {
          // Operation 5 tries to corrupt shared state
          throw new Error('Attempting to corrupt shared state');
        }
        
        // Increment counter
        sharedState.counter = localCounter + 1;
        
        return { 
          operation: i, 
          counterBefore: localCounter,
          counterAfter: sharedState.counter
        };
      });

      harness.concurrencyLimit = 5;
      const results = await harness.executeBatch(operations, async (op) => await op());

      // Despite the error, other operations should complete
      assert(results.successful.length >= 9);
      assert.strictEqual(results.failed.length, 1);
      
      // Shared state should reflect successful operations
      assert(sharedState.counter >= 9);
    });
  });

  describe('Error Recovery Validation', () => {
    it('should validate error recovery mechanisms', async () => {
      const recoveryStrategies = {
        retry: async (operation, error) => {
          if (error.code === 'TEMPORARY') {
            await harness.simulateDelay(100);
            return await operation();
          }
          throw error;
        },
        
        fallback: async (operation, error) => {
          if (error.code === 'SERVICE_UNAVAILABLE') {
            return { source: 'fallback', data: 'cached_value' };
          }
          throw error;
        },
        
        skip: async (operation, error) => {
          if (error.code === 'OPTIONAL') {
            return { skipped: true, reason: error.message };
          }
          throw error;
        }
      };

      const operations = [
        { id: 1, errorCode: 'TEMPORARY', attempts: 0 },
        { id: 2, errorCode: 'SERVICE_UNAVAILABLE' },
        { id: 3, errorCode: 'OPTIONAL' },
        { id: 4, errorCode: 'FATAL' },
        { id: 5, errorCode: null } // No error
      ];

      const executeWithRecovery = async (op) => {
        const operation = async () => {
          if (op.errorCode === 'TEMPORARY' && op.attempts === 0) {
            op.attempts++;
            const error = new Error('Temporary failure');
            error.code = op.errorCode;
            throw error;
          }
          
          if (op.errorCode && op.errorCode !== 'TEMPORARY') {
            const error = new Error(`${op.errorCode} error`);
            error.code = op.errorCode;
            throw error;
          }
          
          return { id: op.id, success: true };
        };

        try {
          return await operation();
        } catch (error) {
          // Try recovery strategies in order
          for (const [strategy, handler] of Object.entries(recoveryStrategies)) {
            try {
              return await handler(operation, error);
            } catch (recoveryError) {
              // Continue to next strategy
            }
          }
          throw error;
        }
      };

      const results = await harness.executeBatch(operations, executeWithRecovery);

      // Verify recovery strategies worked
      assert(results.successful.length >= 4); // All except FATAL
      
      const recovered = results.successful;
      assert(recovered.some(r => r.success && r.id === 1)); // Retry worked
      assert(recovered.some(r => r.source === 'fallback')); // Fallback worked
      assert(recovered.some(r => r.skipped === true)); // Skip worked
      
      // FATAL error should not recover
      assert(results.failed.some(f => f.error.code === 'FATAL'));
    });
  });
});