/// <reference types="jest" />

/**
 * Integration tests for Memory Manager and Coordination Manager
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertRejects,
  spy,
} from '../test.utils.js';
import { MockMemoryManager, MockCoordinationManager } from '../mocks/index.js';
import { EventBus } from '../../src/core/event-bus.js';
import { Logger } from '../../src/core/logger.js';
import {
  MemoryEntry,
  MemoryQuery,
  Resource,
  Message,
  AgentProfile,
} from '../../src/utils/types.js';
import { cleanupTestEnv, setupTestEnv } from '../test.config.js';
import { delay, generateId } from '../../src/utils/helpers.js';

describe('Memory-Coordination Integration', () => {
  let memoryManager: MockMemoryManager;
  let coordinationManager: MockCoordinationManager;
  let eventBus: EventBus;
  let logger: Logger;

  beforeEach(() => {
    setupTestEnv();

    eventBus = new EventBus();
    logger = new Logger({
      level: 'debug',
      format: 'text',
      destination: 'console',
    });

    memoryManager = new MockMemoryManager();
    coordinationManager = new MockCoordinationManager();
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  describe('distributed memory coordination', () => {
    it('should coordinate memory operations across agents', async () => {
      const agentIds = ['agent-1', 'agent-2', 'agent-3'];
      const sessionId = generateId('session');

      // Simulate multiple agents storing memories simultaneously
      const memoryEntries: MemoryEntry[] = agentIds.map((agentId, index) => ({
        id: generateId('memory'),
        agentId,
        sessionId,
        type: 'observation',
        content: `Agent ${agentId} observation ${index}`,
        context: {
          timestamp: new Date().toISOString(),
          taskId: generateId('task'),
          priority: index + 1,
        },
        timestamp: new Date(),
        tags: [`agent-${index}`, 'test', 'observation'],
        version: 1,
      }));

      // Store entries through coordination
      for (const entry of memoryEntries) {
        // Acquire resource lock for memory region
        const resourceId = `memory:${entry.agentId}`;
        await coordinationManager.acquireResource(resourceId, entry.agentId);

        try {
          await memoryManager.storeEntry(entry);
        } finally {
          await coordinationManager.releaseResource(resourceId, entry.agentId);
        }
      }

      // Verify all entries were stored
      expect(memoryManager.storeEntry.calls.length).toBe( 3);

      // Query memories across agents
      const query: MemoryQuery = {
        type: 'observation',
        tags: ['test'],
        limit: 10,
      };

      const results = await memoryManager.queryEntries(query);
      expect(results.length).toBe( 3);

      // Verify entries from all agents
      const resultAgentIds = results.map(entry => entry.agentId).sort();
      expect(resultAgentIds).toBe( agentIds.sort());
    });

    it('should handle memory conflicts using coordination', async () => {
      const agentId = 'conflict-agent';
      const sessionId = generateId('session');
      const resourceId = `memory:${agentId}`;

      // Create initial memory entry
      const initialEntry: MemoryEntry = {
        id: generateId('memory'),
        agentId,
        sessionId,
        type: 'decision',
        content: 'Initial decision',
        context: { version: 1 },
        timestamp: new Date(),
        tags: ['decision'],
        version: 1,
      };

      await memoryManager.storeEntry(initialEntry);

      // Simulate concurrent updates from different processes
      const updates = [
        { ...initialEntry, content: 'Update from process A', version: 2 },
        { ...initialEntry, content: 'Update from process B', version: 2 },
      ];

      // Use coordination to serialize updates
      for (const update of updates) {
        await coordinationManager.acquireResource(resourceId, agentId);
        
        try {
          // Check current version before update
          const current = await memoryManager.getEntry(update.id);
          if (current && current.version >= update.version) {
            // Conflict detected - increment version
            update.version = current.version + 1;
          }
          
          await memoryManager.updateEntry(update.id, update);
        } finally {
          await coordinationManager.releaseResource(resourceId, agentId);
        }
      }

      // Verify final state
      const finalEntry = await memoryManager.getEntry(initialEntry.id);
      expect(finalEntry);
      expect(finalEntry.version).toBe( 3); // Should be incremented due to conflict
    });

    it('should coordinate cross-agent memory queries', async () => {
      const agents = [
        { id: 'researcher', type: 'researcher' },
        { id: 'implementer', type: 'implementer' },
        { id: 'coordinator', type: 'coordinator' },
      ];
      const sessionId = generateId('session');

      // Each agent stores different types of memories
      const memoryTypes = [
        { agent: 'researcher', type: 'insight', content: 'Research findings' },
        { agent: 'implementer', type: 'artifact', content: 'Code implementation' },
        { agent: 'coordinator', type: 'decision', content: 'Project decisions' },
      ];

      for (const memory of memoryTypes) {
        const entry: MemoryEntry = {
          id: generateId('memory'),
          agentId: memory.agent,
          sessionId,
          type: memory.type as any,
          content: memory.content,
          context: { createdBy: memory.agent },
          timestamp: new Date(),
          tags: [memory.type, memory.agent],
          version: 1,
        };

        await memoryManager.storeEntry(entry);
      }

      // Coordinator queries all memories for synthesis
      const synthesisQuery: MemoryQuery = {
        sessionId,
        limit: 10,
      };

      const allMemories = await memoryManager.queryEntries(synthesisQuery);
      expect(allMemories.length).toBe(3);

      // Verify memories from all agents are accessible
      const agentTypes = allMemories.map(m => m.context.createdBy).sort();
      expect(agentTypes).toEqual(['coordinator', 'implementer', 'researcher']);
    });
  });

  describe('resource coordination with memory backing', () => {
    it('should use memory to track resource allocation history', async () => {
      const resourceId = 'shared-database';
      const agentId = 'database-agent';

      // Store resource acquisition in memory
      const acquisitionEntry: MemoryEntry = {
        id: generateId('memory'),
        agentId,
        sessionId: generateId('session'),
        type: 'observation',
        content: `Acquiring resource ${resourceId}`,
        context: {
          resourceId,
          action: 'acquire',
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date(),
        tags: ['resource', 'acquisition'],
        version: 1,
      };

      await memoryManager.storeEntry(acquisitionEntry);

      // Acquire resource
      await coordinationManager.acquireResource(resourceId, agentId);

      // Store acquisition success
      const successEntry: MemoryEntry = {
        ...acquisitionEntry,
        id: generateId('memory'),
        content: `Successfully acquired resource ${resourceId}`,
        context: {
          ...acquisitionEntry.context,
          action: 'acquired',
          status: 'success',
        },
      };

      await memoryManager.storeEntry(successEntry);

      // Query resource history
      const resourceQuery: MemoryQuery = {
        tags: ['resource'],
        limit: 10,
      };

      const resourceHistory = await memoryManager.queryEntries(resourceQuery);
      expect(resourceHistory.length).toBe( 2);

      const actions = resourceHistory.map(entry => entry.context.action);
      expect(actions.includes('acquire')).toBe( true);
      expect(actions.includes('acquired')).toBe( true);

      // Release resource
      await coordinationManager.releaseResource(resourceId, agentId);
    });

    it('should coordinate deadlock detection with memory logging', async () => {
      const agents = ['agent-A', 'agent-B'];
      const resources = ['resource-1', 'resource-2'];

      // Set up potential deadlock scenario
      // Agent A acquires resource-1, Agent B acquires resource-2
      await coordinationManager.acquireResource(resources[0], agents[0]);
      await coordinationManager.acquireResource(resources[1], agents[1]);

      // Log resource states in memory
      for (const agent of agents) {
        for (const resource of resources) {
          const entry: MemoryEntry = {
            id: generateId('memory'),
            agentId: agent,
            sessionId: generateId('session'),
            type: 'observation',
            content: `Resource state check: ${resource}`,
            context: {
              resourceId: resource,
              requestingAgent: agent,
              action: 'deadlock-check',
            },
            timestamp: new Date(),
            tags: ['deadlock', 'resource'],
            version: 1,
          };

          await memoryManager.storeEntry(entry);
        }
      }

      // Simulate deadlock detection
      const deadlockDetected = coordinationManager.detectDeadlock([
        { agentId: agents[0], resourceId: resources[1] },
        { agentId: agents[1], resourceId: resources[0] },
      ]);

      expect(deadlockDetected).toBe( true);

      // Log deadlock detection in memory
      const deadlockEntry: MemoryEntry = {
        id: generateId('memory'),
        agentId: 'system',
        sessionId: generateId('session'),
        type: 'error',
        content: 'Deadlock detected between agents',
        context: {
          agents,
          resources,
          detectionTime: new Date().toISOString(),
        },
        timestamp: new Date(),
        tags: ['deadlock', 'error', 'system'],
        version: 1,
      };

      await memoryManager.storeEntry(deadlockEntry);

      // Verify deadlock was logged
      const deadlockQuery: MemoryQuery = {
        type: 'error',
        tags: ['deadlock'],
      };

      const deadlockHistory = await memoryManager.queryEntries(deadlockQuery);
      expect(deadlockHistory.length).toBe( 1);
      expect(deadlockHistory[0].context.agents).toBe( agents);

      // Clean up resources
      await coordinationManager.releaseResource(resources[0], agents[0]);
      await coordinationManager.releaseResource(resources[1], agents[1]);
    });
  });

  describe('message coordination with memory persistence', () => {
    it('should persist and coordinate inter-agent messages', async () => {
      const senderAgent = 'coordinator-agent';
      const receiverAgent = 'worker-agent';
      const sessionId = generateId('session');

      const message: Message = {
        id: generateId('message'),
        type: 'task-assignment',
        payload: {
          taskId: generateId('task'),
          description: 'Process data files',
          priority: 1,
          deadline: new Date(Date.now() + 3600000), // 1 hour from now
        },
        timestamp: new Date(),
        priority: 1,
      };

      // Store message sending in memory
      const sendEntry: MemoryEntry = {
        id: generateId('memory'),
        agentId: senderAgent,
        sessionId,
        type: 'observation',
        content: `Sending message to ${receiverAgent}`,
        context: {
          messageId: message.id,
          messageType: message.type,
          recipient: receiverAgent,
          action: 'send',
        },
        timestamp: new Date(),
        tags: ['message', 'send'],
        version: 1,
      };

      await memoryManager.storeEntry(sendEntry);

      // Send message through coordination
      await coordinationManager.sendMessage(senderAgent, receiverAgent, message);

      // Store message receipt in memory
      const receiveEntry: MemoryEntry = {
        id: generateId('memory'),
        agentId: receiverAgent,
        sessionId,
        type: 'observation',
        content: `Received message from ${senderAgent}`,
        context: {
          messageId: message.id,
          messageType: message.type,
          sender: senderAgent,
          action: 'receive',
        },
        timestamp: new Date(),
        tags: ['message', 'receive'],
        version: 1,
      };

      await memoryManager.storeEntry(receiveEntry);

      // Query message history
      const messageQuery: MemoryQuery = {
        tags: ['message'],
        limit: 10,
      };

      const messageHistory = await memoryManager.queryEntries(messageQuery);
      expect(messageHistory.length).toBe( 2);

      const actions = messageHistory.map(entry => entry.context.action);
      expect(actions.includes('send')).toBe( true);
      expect(actions.includes('receive')).toBe( true);

      // Verify message coordination worked
      expect(coordinationManager.sendMessage.calls.length).toBe( 1);
      const sentMessage = coordinationManager.sendMessage.calls[0].args[2];
      expect(sentMessage.id).toBe( message.id);
    });

    it('should handle message delivery failures with memory logging', async () => {
      const senderAgent = 'sender';
      const receiverAgent = 'offline-receiver';
      const sessionId = generateId('session');

      // Mock message delivery failure
      coordinationManager.sendMessage = jest.spyOn(() => {
        throw new Error('Agent not available');
      });

      const message: Message = {
        id: generateId('message'),
        type: 'urgent-notification',
        payload: { alert: 'System maintenance required' },
        timestamp: new Date(),
        priority: 10,
      };

      // Attempt to send message and log failure
      try {
        await coordinationManager.sendMessage(senderAgent, receiverAgent, message);
      } catch (error) {
        // Log delivery failure
        const failureEntry: MemoryEntry = {
          id: generateId('memory'),
          agentId: senderAgent,
          sessionId,
          type: 'error',
          content: `Failed to deliver message to ${receiverAgent}`,
          context: {
            messageId: message.id,
            recipient: receiverAgent,
            error: error.message,
            retryRequired: true,
          },
          timestamp: new Date(),
          tags: ['message', 'error', 'delivery'],
          version: 1,
        };

        await memoryManager.storeEntry(failureEntry);
      }

      // Query failed deliveries
      const failureQuery: MemoryQuery = {
        type: 'error',
        tags: ['delivery'],
      };

      const failures = await memoryManager.queryEntries(failureQuery);
      expect(failures.length).toBe( 1);
      expect(failures[0].context.retryRequired).toBe( true);
    });
  });

  describe('conflict resolution integration', () => {
    it('should resolve memory conflicts using coordination locks', async () => {
      const agentId = 'conflict-resolver';
      const entryId = generateId('memory');
      const lockId = `memory-lock:${entryId}`;

      // Create base entry
      const baseEntry: MemoryEntry = {
        id: entryId,
        agentId,
        sessionId: generateId('session'),
        type: 'decision',
        content: 'Base decision content',
        context: { priority: 1 },
        timestamp: new Date(),
        tags: ['decision'],
        version: 1,
      };

      await memoryManager.storeEntry(baseEntry);

      // Simulate concurrent modification attempts
      const modifications = [
        { content: 'Modification A', context: { priority: 2 } },
        { content: 'Modification B', context: { priority: 3 } },
        { content: 'Modification C', context: { priority: 1 } },
      ];

      let finalVersion = 1;

      for (const modification of modifications) {
        // Acquire lock before modification
        await coordinationManager.acquireResource(lockId, agentId);

        try {
          // Get current state
          const currentEntry = await memoryManager.getEntry(entryId);
          expect(currentEntry);

          // Apply modification
          const updatedEntry = {
            ...currentEntry,
            content: modification.content,
            context: { ...currentEntry.context, ...modification.context },
            version: currentEntry.version + 1,
          };

          await memoryManager.updateEntry(entryId, updatedEntry);
          finalVersion = updatedEntry.version;

          // Log modification in memory
          const logEntry: MemoryEntry = {
            id: generateId('memory'),
            agentId,
            sessionId: baseEntry.sessionId,
            type: 'observation',
            content: `Modified entry ${entryId}`,
            context: {
              originalVersion: currentEntry.version,
              newVersion: updatedEntry.version,
              modification: modification.content,
            },
            timestamp: new Date(),
            tags: ['modification', 'coordination'],
            version: 1,
          };

          await memoryManager.storeEntry(logEntry);

        } finally {
          await coordinationManager.releaseResource(lockId, agentId);
        }
      }

      // Verify final state
      const finalEntry = await memoryManager.getEntry(entryId);
      expect(finalEntry);
      expect(finalEntry.version).toBe( finalVersion);
      expect(finalEntry.context.priority).toBe( 1); // Last modification

      // Verify modification history
      const modificationQuery: MemoryQuery = {
        tags: ['modification'],
        limit: 10,
      };

      const modificationHistory = await memoryManager.queryEntries(modificationQuery);
      expect(modificationHistory.length).toBe( 3);
    });

    it('should coordinate distributed memory cleanup', async () => {
      const sessionId = generateId('session');
      const agents = ['agent-1', 'agent-2', 'agent-3'];

      // Create memories for cleanup
      const entriesToCleanup: MemoryEntry[] = [];
      
      for (const agentId of agents) {
        for (let i = 0; i < 5; i++) {
          const entry: MemoryEntry = {
            id: generateId('memory'),
            agentId,
            sessionId,
            type: 'observation',
            content: `Temporary observation ${i}`,
            context: { temporary: true, index: i },
            timestamp: new Date(Date.now() - (i * 1000)), // Spread over time
            tags: ['temp', agentId],
            version: 1,
          };

          await memoryManager.storeEntry(entry);
          entriesToCleanup.push(entry);
        }
      }

      // Coordinate cleanup across agents
      const cleanupLock = 'memory-cleanup';
      
      for (const agentId of agents) {
        await coordinationManager.acquireResource(cleanupLock, agentId);

        try {
          // Query agent's temporary memories
          const query: MemoryQuery = {
            agentId,
            tags: ['temp'],
            limit: 10,
          };

          const agentMemories = await memoryManager.queryEntries(query);

          // Delete temporary memories
          for (const memory of agentMemories) {
            if (memory.context.temporary) {
              await memoryManager.deleteEntry(memory.id);
            }
          }

          // Log cleanup action
          const cleanupEntry: MemoryEntry = {
            id: generateId('memory'),
            agentId,
            sessionId,
            type: 'observation',
            content: `Cleaned up ${agentMemories.length} temporary memories`,
            context: {
              cleanupAction: true,
              deletedCount: agentMemories.length,
            },
            timestamp: new Date(),
            tags: ['cleanup', 'maintenance'],
            version: 1,
          };

          await memoryManager.storeEntry(cleanupEntry);

        } finally {
          await coordinationManager.releaseResource(cleanupLock, agentId);
        }
      }

      // Verify cleanup was coordinated
      const remainingTemp = await memoryManager.queryEntries({
        tags: ['temp'],
        limit: 50,
      });
      expect(remainingTemp.length).toBe( 0);

      // Verify cleanup was logged
      const cleanupLogs = await memoryManager.queryEntries({
        tags: ['cleanup'],
        limit: 10,
      });
      expect(cleanupLogs.length).toBe( 3); // One per agent
    });
  });

  describe('performance and scalability', () => {
    it('should handle high-volume memory operations with coordination', async () => {
      const agentCount = 5;
      const entriesPerAgent = 20;
      const sessionId = generateId('session');

      // Generate agents
      const agents = Array.from({ length: agentCount }, (_, i) => 
        `performance-agent-${i}`
      );

      // Concurrent memory operations
      const operations = agents.map(async (agentId, agentIndex) => {
        const resourceId = `memory-region:${agentIndex}`;
        
        for (let i = 0; i < entriesPerAgent; i++) {
          await coordinationManager.acquireResource(resourceId, agentId);
          
          try {
            const entry: MemoryEntry = {
              id: generateId('memory'),
              agentId,
              sessionId,
              type: 'observation',
              content: `Performance test entry ${i}`,
              context: {
                agentIndex,
                entryIndex: i,
                batchTest: true,
              },
              timestamp: new Date(),
              tags: ['performance', 'batch'],
              version: 1,
            };

            await memoryManager.storeEntry(entry);
          } finally {
            await coordinationManager.releaseResource(resourceId, agentId);
          }
        }
      });

      // Execute all operations concurrently
      await Promise.all(operations);

      // Verify all entries were stored
      const allEntries = await memoryManager.queryEntries({
        tags: ['performance'],
        limit: 200,
      });

      expect(allEntries.length).toBe( agentCount * entriesPerAgent);

      // Verify entries from all agents
      const uniqueAgents = new Set(allEntries.map(entry => entry.agentId));
      expect(uniqueAgents.size).toBe( agentCount);
    });
  });
});
