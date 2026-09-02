/**
 * Test suite for enhanced session serialization with TypeScript support
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  AdvancedSerializer,
  SessionSerializer,
  createSessionSerializer,
  serializeSessionCheckpoint,
  deserializeSessionCheckpoint
} from '../src/memory/advanced-serializer.js';
import { sessionSerializer } from '../src/memory/enhanced-session-serializer.js';

describe('Enhanced Session Serialization', () => {
  let serializer;

  beforeEach(() => {
    serializer = createSessionSerializer();
  });

  describe('Basic TypeScript Type Support', () => {
    it('should serialize and deserialize Date objects', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const serialized = serializer.serialize(date);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized).toBeInstanceOf(Date);
      expect(deserialized.getTime()).toBe(date.getTime());
    });

    it('should serialize and deserialize Map objects', () => {
      const map = new Map([
        ['key1', 'value1'],
        ['key2', { nested: true }],
        [42, 'number key']
      ]);
      
      const serialized = serializer.serialize(map);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized).toBeInstanceOf(Map);
      expect(deserialized.get('key1')).toBe('value1');
      expect(deserialized.get('key2')).toEqual({ nested: true });
      expect(deserialized.get(42)).toBe('number key');
    });

    it('should serialize and deserialize Set objects', () => {
      const set = new Set(['value1', 42, { object: true }]);
      
      const serialized = serializer.serialize(set);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized).toBeInstanceOf(Set);
      expect(deserialized.has('value1')).toBe(true);
      expect(deserialized.has(42)).toBe(true);
      expect(Array.from(deserialized)[2]).toEqual({ object: true });
    });

    it('should serialize and deserialize RegExp objects', () => {
      const regex = /test[0-9]+/gi;
      
      const serialized = serializer.serialize(regex);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized).toBeInstanceOf(RegExp);
      expect(deserialized.source).toBe('test[0-9]+');
      expect(deserialized.flags).toBe('gi');
    });

    it('should serialize and deserialize Error objects', () => {
      const error = new Error('Test error message');
      error.code = 'TEST_ERROR';
      
      const serialized = serializer.serialize(error);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized).toBeInstanceOf(Error);
      expect(deserialized.message).toBe('Test error message');
      expect(deserialized.name).toBe('Error');
    });

    it('should handle BigInt values', () => {
      const bigInt = BigInt('9007199254740991123456789');
      
      const serialized = serializer.serialize(bigInt);
      const deserialized = serializer.deserialize(serialized);
      
      expect(typeof deserialized).toBe('bigint');
      expect(deserialized).toBe(bigInt);
    });

    it('should handle undefined values', () => {
      const data = { defined: 'value', undefined: undefined };
      
      const serialized = serializer.serialize(data);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized.defined).toBe('value');
      expect(deserialized.undefined).toBeUndefined();
    });

    it('should handle special number values', () => {
      const data = {
        nan: NaN,
        infinity: Infinity,
        negativeInfinity: -Infinity
      };
      
      const serialized = serializer.serialize(data);
      const deserialized = serializer.deserialize(serialized);
      
      expect(Number.isNaN(deserialized.nan)).toBe(true);
      expect(deserialized.infinity).toBe(Infinity);
      expect(deserialized.negativeInfinity).toBe(-Infinity);
    });
  });

  describe('Complex Nested Structures', () => {
    it('should handle deeply nested objects with mixed types', () => {
      const complexData = {
        timestamp: new Date(),
        userMap: new Map([
          ['user1', { id: 1, roles: new Set(['admin', 'user']) }],
          ['user2', { id: 2, roles: new Set(['user']) }]
        ]),
        config: {
          regex: /[a-z]+/g,
          numbers: [1, 2, NaN, Infinity],
          metadata: {
            created: new Date('2024-01-01'),
            tags: new Set(['important', 'config'])
          }
        },
        errors: [
          new Error('First error'),
          new Error('Second error')
        ]
      };
      
      const serialized = serializer.serialize(complexData);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized.timestamp).toBeInstanceOf(Date);
      expect(deserialized.userMap).toBeInstanceOf(Map);
      expect(deserialized.userMap.get('user1').roles).toBeInstanceOf(Set);
      expect(deserialized.config.regex).toBeInstanceOf(RegExp);
      expect(Number.isNaN(deserialized.config.numbers[2])).toBe(true);
      expect(deserialized.config.metadata.created).toBeInstanceOf(Date);
      expect(deserialized.config.metadata.tags).toBeInstanceOf(Set);
      expect(deserialized.errors[0]).toBeInstanceOf(Error);
    });

    it('should handle circular references safely', () => {
      const obj = { name: 'test' };
      obj.self = obj; // Create circular reference
      
      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized.name).toBe('test');
      expect(deserialized.self).toBe('[Circular Reference]');
    });
  });

  describe('Session-Specific Serialization', () => {
    it('should serialize session data with metadata', () => {
      const sessionData = {
        id: 'session-123',
        name: 'Test Session',
        created_at: new Date(),
        metadata: {
          tags: new Set(['test', 'development']),
          config: new Map([['timeout', 5000], ['retries', 3]])
        },
        agents: [
          {
            id: 'agent-1',
            type: 'coder',
            created_at: new Date(),
            config: { maxTasks: 10 }
          }
        ]
      };
      
      const serialized = sessionSerializer.serializeSessionData(sessionData);
      const deserialized = sessionSerializer.deserializeSessionData(serialized);
      
      expect(deserialized.id).toBe('session-123');
      expect(deserialized.created_at).toBeInstanceOf(Date);
      expect(deserialized.metadata.tags).toBeInstanceOf(Set);
      expect(deserialized.metadata.config).toBeInstanceOf(Map);
      expect(deserialized.agents[0].created_at).toBeInstanceOf(Date);
    });

    it('should serialize checkpoint data with complex types', () => {
      const checkpointData = {
        state: 'in_progress',
        timestamp: new Date(),
        data: {
          processedItems: new Set(['item1', 'item2']),
          cache: new Map([
            ['cache1', { value: 'data1', expires: new Date() }]
          ]),
          errors: [new Error('Recoverable error')]
        }
      };
      
      const serialized = sessionSerializer.serializeCheckpointData(checkpointData);
      const deserialized = sessionSerializer.deserializeCheckpointData(serialized);
      
      expect(deserialized.timestamp).toBeInstanceOf(Date);
      expect(deserialized.data.processedItems).toBeInstanceOf(Set);
      expect(deserialized.data.cache).toBeInstanceOf(Map);
      expect(deserialized.data.errors[0]).toBeInstanceOf(Error);
    });

    it('should handle legacy session data gracefully', () => {
      // Simulate legacy JSON serialization
      const legacyData = JSON.stringify({
        id: 'legacy-session',
        created_at: '2024-01-15T10:30:00Z',
        metadata: JSON.stringify({ legacy: true })
      });
      
      const deserialized = sessionSerializer.deserializeSessionData(legacyData, { allowFallback: true });
      
      expect(deserialized.id).toBe('legacy-session');
      // Should handle fallback gracefully without throwing
      expect(typeof deserialized).toBe('object');
    });
  });

  describe('Error Handling', () => {
    it('should handle serialization errors gracefully', () => {
      const problematicData = {
        circularRef: {}
      };
      problematicData.circularRef.self = problematicData;
      
      // Should not throw, but handle circular reference
      expect(() => {
        const serialized = serializer.serialize(problematicData);
        const deserialized = serializer.deserialize(serialized);
        expect(deserialized.circularRef.self).toBe('[Circular Reference]');
      }).not.toThrow();
    });

    it('should handle deserialization of corrupted data', () => {
      const corruptedData = '{"__type__": "__invalid__", "data": "corrupted"}';
      
      expect(() => {
        serializer.deserialize(corruptedData);
      }).toThrow();
    });

    it('should provide fallback for non-serializable data', () => {
      const func = function testFunction() { return 'test'; };
      const symbol = Symbol('test');
      
      const data = {
        func,
        symbol,
        normalData: 'normal'
      };
      
      const serializer = createSessionSerializer({ preserveFunctions: false, preserveSymbols: false });
      const serialized = serializer.serialize(data);
      const deserialized = serializer.deserialize(serialized);
      
      expect(deserialized.normalData).toBe('normal');
      // Functions and symbols should be handled gracefully
      expect(typeof deserialized.func).toBe('object'); // Converted to object marker
    });
  });

  describe('Performance and Compression', () => {
    it('should handle large data structures efficiently', () => {
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          timestamp: new Date(),
          data: `item-${i}`.repeat(10)
        }))
      };
      
      const startTime = Date.now();
      const serialized = serializer.serialize(largeData);
      const deserialized = serializer.deserialize(serialized);
      const endTime = Date.now();
      
      expect(deserialized.items).toHaveLength(1000);
      expect(deserialized.items[0].timestamp).toBeInstanceOf(Date);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should maintain data integrity across serialization cycles', () => {
      const originalData = {
        date: new Date(),
        map: new Map([['key1', 'value1'], [42, { nested: true }]]),
        set: new Set([1, 2, 3, { obj: true }]),
        regex: /test/gi,
        error: new Error('Test error'),
        special: { nan: NaN, inf: Infinity, undef: undefined }
      };
      
      // Multiple serialization cycles
      let data = originalData;
      for (let i = 0; i < 3; i++) {
        const serialized = serializer.serialize(data);
        data = serializer.deserialize(serialized);
      }
      
      expect(data.date).toBeInstanceOf(Date);
      expect(data.map).toBeInstanceOf(Map);
      expect(data.set).toBeInstanceOf(Set);
      expect(data.regex).toBeInstanceOf(RegExp);
      expect(data.error).toBeInstanceOf(Error);
      expect(Number.isNaN(data.special.nan)).toBe(true);
      expect(data.special.inf).toBe(Infinity);
      expect(data.special.undef).toBeUndefined();
    });
  });

  describe('Utility Functions', () => {
    it('should provide convenient checkpoint serialization functions', () => {
      const checkpointData = {
        step: 'processing',
        data: new Map([['processed', new Set(['item1', 'item2'])]])
      };
      
      const serialized = serializeSessionCheckpoint(checkpointData);
      const deserialized = deserializeSessionCheckpoint(serialized);
      
      expect(deserialized.step).toBe('processing');
      expect(deserialized.data).toBeInstanceOf(Map);
      expect(deserialized.data.get('processed')).toBeInstanceOf(Set);
    });
  });
});

describe('Session Serializer Integration Tests', () => {
  it('should work with actual session manager patterns', () => {
    // Test data that mirrors real session manager usage
    const sessionData = {
      id: 'session-test-123',
      swarm_id: 'swarm-456',
      swarm_name: 'Test Swarm',
      objective: 'Complete integration test',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        userPreferences: new Map([
          ['theme', 'dark'],
          ['notifications', true]
        ]),
        tags: new Set(['integration', 'test', 'typescript']),
        config: {
          timeout: 30000,
          retries: 3,
          pattern: /error-\d+/i
        }
      },
      checkpoint_data: {
        currentStep: 'validation',
        completedSteps: new Set(['init', 'setup']),
        cache: new Map([
          ['validation-results', { passed: 15, failed: 2 }],
          ['timestamps', new Map([['start', new Date()], ['checkpoint', new Date()]])]
        ]),
        errors: [
          new Error('Validation warning: deprecated API'),
          new Error('Minor issue: missing optional field')
        ]
      },
      statistics: {
        totalAgents: 5,
        activeAgents: 3,
        completionPercentage: 67.5,
        lastUpdate: new Date()
      }
    };

    // Serialize using session serializer
    const serialized = sessionSerializer.serializeSessionData(sessionData);
    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);

    // Deserialize and verify
    const deserialized = sessionSerializer.deserializeSessionData(serialized);
    
    // Verify basic fields
    expect(deserialized.id).toBe('session-test-123');
    expect(deserialized.swarm_id).toBe('swarm-456');
    expect(deserialized.status).toBe('active');
    
    // Verify date restoration
    expect(deserialized.created_at).toBeInstanceOf(Date);
    expect(deserialized.updated_at).toBeInstanceOf(Date);
    
    // Verify complex metadata
    expect(deserialized.metadata.userPreferences).toBeInstanceOf(Map);
    expect(deserialized.metadata.userPreferences.get('theme')).toBe('dark');
    expect(deserialized.metadata.tags).toBeInstanceOf(Set);
    expect(deserialized.metadata.tags.has('typescript')).toBe(true);
    expect(deserialized.metadata.config.pattern).toBeInstanceOf(RegExp);
    
    // Verify checkpoint data
    expect(deserialized.checkpoint_data.completedSteps).toBeInstanceOf(Set);
    expect(deserialized.checkpoint_data.cache).toBeInstanceOf(Map);
    expect(deserialized.checkpoint_data.cache.get('timestamps')).toBeInstanceOf(Map);
    expect(deserialized.checkpoint_data.errors[0]).toBeInstanceOf(Error);
    
    // Verify statistics
    expect(deserialized.statistics.lastUpdate).toBeInstanceOf(Date);
    expect(deserialized.statistics.completionPercentage).toBe(67.5);
  });
});