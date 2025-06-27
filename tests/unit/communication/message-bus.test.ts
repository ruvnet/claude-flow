import { MessageBus, Message, MessageHandler, MessagePriority } from '@/communication/message-bus';
import { waitForEvent, createDeferred } from '@test/helpers/test-utils';

describe('MessageBus', () => {
  let messageBus: MessageBus;
  
  beforeEach(() => {
    messageBus = new MessageBus();
  });
  
  afterEach(async () => {
    await messageBus.shutdown();
  });
  
  describe('initialization', () => {
    it('should create message bus instance', () => {
      expect(messageBus).toBeInstanceOf(MessageBus);
    });
    
    it('should start in inactive state', () => {
      expect(messageBus.isActive()).toBe(false);
    });
    
    it('should activate on start', async () => {
      await messageBus.start();
      expect(messageBus.isActive()).toBe(true);
    });
  });
  
  describe('publish/subscribe', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should deliver message to subscriber', async () => {
      const deferred = createDeferred<Message>();
      
      messageBus.subscribe('test.topic', (message) => {
        deferred.resolve(message);
      });
      
      messageBus.publish('test.topic', { data: 'test message' });
      
      const received = await deferred.promise;
      expect(received).toMatchObject({
        topic: 'test.topic',
        payload: { data: 'test message' },
        timestamp: expect.any(Date),
        id: expect.any(String)
      });
    });
    
    it('should support multiple subscribers', async () => {
      const received: Message[] = [];
      const handler1 = jest.fn((msg) => received.push({ ...msg, handler: 1 }));
      const handler2 = jest.fn((msg) => received.push({ ...msg, handler: 2 }));
      
      messageBus.subscribe('multi.topic', handler1);
      messageBus.subscribe('multi.topic', handler2);
      
      messageBus.publish('multi.topic', { value: 42 });
      
      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(received).toHaveLength(2);
    });
    
    it('should support wildcard subscriptions', async () => {
      const received: string[] = [];
      
      messageBus.subscribe('events.*', (message) => {
        received.push(message.topic);
      });
      
      messageBus.publish('events.created', { type: 'user' });
      messageBus.publish('events.updated', { type: 'post' });
      messageBus.publish('events.deleted', { type: 'comment' });
      messageBus.publish('other.event', { type: 'ignored' });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(received).toEqual([
        'events.created',
        'events.updated',
        'events.deleted'
      ]);
    });
    
    it('should support multi-level wildcards', async () => {
      const received: string[] = [];
      
      messageBus.subscribe('system.**.error', (message) => {
        received.push(message.topic);
      });
      
      messageBus.publish('system.app.error', { code: 500 });
      messageBus.publish('system.db.connection.error', { reason: 'timeout' });
      messageBus.publish('system.cache.redis.error', { type: 'connection' });
      messageBus.publish('system.app.info', { msg: 'ignored' });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(received).toEqual([
        'system.app.error',
        'system.db.connection.error',
        'system.cache.redis.error'
      ]);
    });
  });
  
  describe('unsubscribe', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should unsubscribe handler', async () => {
      const handler = jest.fn();
      
      const unsubscribe = messageBus.subscribe('test.unsub', handler);
      
      messageBus.publish('test.unsub', { data: 'first' });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      
      messageBus.publish('test.unsub', { data: 'second' });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });
    
    it('should handle multiple unsubscribes safely', () => {
      const handler = jest.fn();
      const unsubscribe = messageBus.subscribe('test.multi-unsub', handler);
      
      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
    });
  });
  
  describe('request/reply pattern', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should handle request-reply', async () => {
      // Set up reply handler
      messageBus.subscribe('calc.add', (message) => {
        const { a, b } = message.payload;
        if (message.replyTo) {
          messageBus.publish(message.replyTo, { result: a + b });
        }
      });
      
      const result = await messageBus.request('calc.add', { a: 5, b: 3 });
      expect(result).toEqual({ result: 8 });
    });
    
    it('should timeout on no reply', async () => {
      // No handler registered
      await expect(
        messageBus.request('no.handler', { data: 'test' }, { timeout: 100 })
      ).rejects.toThrow(/timeout/i);
    });
    
    it('should handle multiple concurrent requests', async () => {
      // Set up reply handler that delays based on input
      messageBus.subscribe('calc.multiply', async (message) => {
        const { a, b, delay } = message.payload;
        await new Promise(resolve => setTimeout(resolve, delay || 0));
        if (message.replyTo) {
          messageBus.publish(message.replyTo, { result: a * b });
        }
      });
      
      const requests = [
        messageBus.request('calc.multiply', { a: 2, b: 3, delay: 50 }),
        messageBus.request('calc.multiply', { a: 4, b: 5, delay: 10 }),
        messageBus.request('calc.multiply', { a: 6, b: 7, delay: 30 })
      ];
      
      const results = await Promise.all(requests);
      
      expect(results).toEqual([
        { result: 6 },
        { result: 20 },
        { result: 42 }
      ]);
    });
  });
  
  describe('message priority', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should process high priority messages first', async () => {
      const processed: number[] = [];
      
      // Subscribe with a handler that tracks processing order
      messageBus.subscribe('priority.test', (message) => {
        processed.push(message.payload.order);
      });
      
      // Publish messages with different priorities
      messageBus.publish('priority.test', { order: 1 }, { priority: MessagePriority.LOW });
      messageBus.publish('priority.test', { order: 2 }, { priority: MessagePriority.HIGH });
      messageBus.publish('priority.test', { order: 3 }, { priority: MessagePriority.NORMAL });
      messageBus.publish('priority.test', { order: 4 }, { priority: MessagePriority.HIGH });
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // High priority messages (2, 4) should be processed first
      expect(processed.slice(0).toBe( 2)).toEqual(expect.arrayContaining([2, 4]));
    });
  });
  
  describe('error handling', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should handle subscriber errors', async () => {
      const errorHandler = jest.fn();
      messageBus.on('error', errorHandler);
      
      const goodHandler = jest.fn();
      const badHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      
      messageBus.subscribe('error.test', badHandler);
      messageBus.subscribe('error.test', goodHandler);
      
      messageBus.publish('error.test', { data: 'test' });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Handler error'),
          topic: 'error.test'
        })
      );
      
      // Good handler should still be called
      expect(goodHandler).toHaveBeenCalled();
    });
    
    it('should handle async subscriber errors', async () => {
      const errorHandler = jest.fn();
      messageBus.on('error', errorHandler);
      
      messageBus.subscribe('async.error', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async handler error');
      });
      
      messageBus.publish('async.error', { data: 'test' });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(errorHandler).toHaveBeenCalled();
    });
  });
  
  describe('message filtering', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should filter messages based on metadata', async () => {
      const received: Message[] = [];
      
      messageBus.subscribe('filtered.topic', (message) => {
        received.push(message);
      }, {
        filter: (msg) => msg.metadata?.userId === 'user123'
      });
      
      messageBus.publish('filtered.topic', { data: 1 }, { metadata: { userId: 'user123' } });
      messageBus.publish('filtered.topic', { data: 2 }, { metadata: { userId: 'user456' } });
      messageBus.publish('filtered.topic', { data: 3 }, { metadata: { userId: 'user123' } });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(received).toHaveLength(2);
      expect(received.map(m => m.payload.data)).toEqual([1).toBe( 3]);
    });
  });
  
  describe('message persistence', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should persist messages when configured', async () => {
      const persistedMessages: Message[] = [];
      
      // Mock persistence
      (messageBus as any).persistMessage = jest.fn((message) => {
        persistedMessages.push(message);
      });
      
      messageBus.publish('persistent.topic', { important: 'data' }, { 
        persistent: true 
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect((messageBus as any).persistMessage).toHaveBeenCalled();
      expect(persistedMessages[0]).toMatchObject({
        topic: 'persistent.topic',
        payload: { important: 'data' }
      });
    });
  });
  
  describe('metrics and monitoring', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should track message metrics', async () => {
      messageBus.subscribe('metrics.test', () => {});
      
      // Publish multiple messages
      for (let i = 0; i < 10; i++) {
        messageBus.publish('metrics.test', { index: i });
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const metrics = messageBus.getMetrics();
      
      expect(metrics).toMatchObject({
        totalPublished: 10,
        totalDelivered: 10,
        topicStats: {
          'metrics.test': {
            published: 10,
            delivered: 10,
            subscribers: 1
          }
        }
      });
    });
    
    it('should track failed deliveries', async () => {
      messageBus.subscribe('fail.test', () => {
        throw new Error('Delivery failed');
      });
      
      messageBus.publish('fail.test', { data: 'test' });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics = messageBus.getMetrics();
      
      expect(metrics.topicStats['fail.test']).toMatchObject({
        published: 1,
        delivered: 0,
        failed: 1
      });
    });
  });
  
  describe('circuit breaker', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should open circuit after repeated failures', async () => {
      let callCount = 0;
      
      messageBus.subscribe('circuit.test', () => {
        callCount++;
        throw new Error('Handler failure');
      });
      
      // Publish multiple messages to trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        messageBus.publish('circuit.test', { attempt: i });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Circuit should be open, preventing further deliveries
      messageBus.publish('circuit.test', { attempt: 6 });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(callCount).toBeLessThan(6); // Some messages should be blocked
    });
  });
  
  describe('shutdown', () => {
    it('should stop processing on shutdown', async () => {
      await messageBus.start();
      
      const received: number[] = [];
      messageBus.subscribe('shutdown.test', (msg) => {
        received.push(msg.payload.value);
      });
      
      // Publish some messages
      messageBus.publish('shutdown.test', { value: 1 });
      messageBus.publish('shutdown.test', { value: 2 });
      
      // Shutdown immediately
      await messageBus.shutdown();
      
      // Try to publish after shutdown
      messageBus.publish('shutdown.test', { value: 3 });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should not receive message 3
      expect(received).not.toContain(3);
      expect(messageBus.isActive()).toBe(false);
    });
    
    it('should complete pending messages before shutdown', async () => {
      await messageBus.start();
      
      const processed: number[] = [];
      
      messageBus.subscribe('graceful.shutdown', async (msg) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        processed.push(msg.payload.id);
      });
      
      // Publish messages
      for (let i = 1; i <= 3; i++) {
        messageBus.publish('graceful.shutdown', { id: i });
      }
      
      // Graceful shutdown
      await messageBus.shutdown({ graceful: true, timeout: 100 });
      
      expect(processed).toHaveLength(3);
    });
  });
  
  describe('performance optimizations', () => {
    beforeEach(async () => {
      await messageBus.start();
    });
    
    it('should batch message deliveries', async () => {
      const batches: number[] = [];
      
      messageBus.subscribe('batch.test', (messages) => {
        if (Array.isArray(messages)) {
          batches.push(messages.length);
        }
      }, { batched: true });
      
      // Publish many messages quickly
      for (let i = 0; i < 100; i++) {
        messageBus.publish('batch.test', { index: i });
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should have received messages in batches
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.length).toBeLessThan(100); // Batched, not individual
    });
    
    it('should handle high message throughput', async () => {
      const received = new Set<number>();
      
      messageBus.subscribe('throughput.test', (msg) => {
        received.add(msg.payload.id);
      });
      
      const start = Date.now();
      
      // Publish 10000 messages
      for (let i = 0; i < 10000; i++) {
        messageBus.publish('throughput.test', { id: i });
      }
      
      // Wait for all messages to be processed
      while (received.size < 10000 && Date.now() - start < 5000) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const duration = Date.now() - start;
      
      expect(received.size).toBe(10000);
      expect(duration).toBeLessThan(5000); // Should process 10k messages in < 5 seconds
    });
  });
});
