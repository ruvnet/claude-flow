/**
 * Event Store Usage Example
 *
 * Demonstrates how to use the Event Sourcing system in V3 Claude Flow.
 *
 * Usage:
 *   npx tsx v3/@claude-flow/shared/src/events/example-usage.ts
 */

import { EventStore } from './event-store.js';
import { AgentStateProjection, TaskHistoryProjection, MemoryIndexProjection } from './projections.js';
import {
  createAgentSpawnedEvent,
  createAgentStartedEvent,
  createAgentStoppedEvent,
  createAgentTaskAssignedEvent,
  createAgentTaskCompletedEvent,
  createTaskCreatedEvent,
  createTaskStartedEvent,
  createTaskCompletedEvent,
  createTaskFailedEvent,
  createMemoryStoredEvent,
  createMemoryRetrievedEvent,
  createSwarmInitializedEvent,
  createSwarmScaledEvent,
} from './domain-events.js';

async function main() {
  console.log('Event Sourcing Example - V3 Claude Flow\n');

  // =========================================================================
  // 1. Initialize Event Store
  // =========================================================================
  console.log('1. Initializing Event Store...');

  const eventStore = new EventStore({
    databasePath: './event-store-example.db',
    verbose: true,
    autoPersistInterval: 0, // Manual persist for demo
  });

  await eventStore.initialize();
  console.log('   Event Store initialized\n');

  // =========================================================================
  // 2. Record Swarm Initialization Events
  // =========================================================================
  console.log('2. Recording Swarm Events...');

  await eventStore.append(
    createSwarmInitializedEvent('hierarchical-mesh', 15, {
      security: { strict: true },
      memory: { backend: 'agentdb' },
    })
  );

  await eventStore.append(createSwarmScaledEvent(0, 5, 'Initial agent spawn'));

  console.log('   Swarm events recorded\n');

  // =========================================================================
  // 3. Record Agent Lifecycle Events
  // =========================================================================
  console.log('3. Recording Agent Lifecycle Events...');

  // Agent 1: Queen Coordinator
  await eventStore.append(
    createAgentSpawnedEvent('agent-1', 'queen-coordinator', 'coordination', [
      'orchestration',
      'task-assignment',
    ])
  );
  await eventStore.append(createAgentStartedEvent('agent-1'));

  // Agent 2: Security Architect
  await eventStore.append(
    createAgentSpawnedEvent('agent-2', 'security-architect', 'security', [
      'threat-modeling',
      'security-design',
    ])
  );
  await eventStore.append(createAgentStartedEvent('agent-2'));

  // Agent 3: Core Architect
  await eventStore.append(
    createAgentSpawnedEvent('agent-3', 'core-architect', 'core', ['ddd-design', 'architecture'])
  );
  await eventStore.append(createAgentStartedEvent('agent-3'));

  console.log('   Agent events recorded\n');

  // =========================================================================
  // 4. Record Task Execution Events
  // =========================================================================
  console.log('4. Recording Task Execution Events...');

  // Task 1: Security Audit
  await eventStore.append(
    createTaskCreatedEvent(
      'task-1',
      'security-audit',
      'Audit CVE-1 (Command Injection)',
      'Review and fix command injection vulnerability',
      'critical',
      []
    )
  );
  await eventStore.append(createTaskStartedEvent('task-1', 'agent-2'));
  await eventStore.append(
    createAgentTaskAssignedEvent('agent-2', 'task-1', Date.now())
  );

  // Example: Async work gap between task start and completion
  await new Promise((resolve) => setTimeout(resolve, 100));

  await eventStore.append(
    createTaskCompletedEvent('task-1', { vulnerabilitiesFixed: 3, severity: 'high' }, 5234)
  );
  await eventStore.append(
    createAgentTaskCompletedEvent('agent-2', 'task-1', { success: true }, Date.now(), 5234)
  );

  // Task 2: DDD Architecture Design
  await eventStore.append(
    createTaskCreatedEvent(
      'task-2',
      'architecture-design',
      'Design V3 Domain Structure',
      'Implement bounded contexts for V3',
      'high',
      []
    )
  );
  await eventStore.append(createTaskStartedEvent('task-2', 'agent-3'));
  await eventStore.append(
    createAgentTaskAssignedEvent('agent-3', 'task-2', Date.now())
  );

  console.log('   Task events recorded\n');

  // =========================================================================
  // 5. Record Memory Operations Events
  // =========================================================================
  console.log('5. Recording Memory Operations Events...');

  await eventStore.append(
    createMemoryStoredEvent('mem-1', 'agent-context', 'agent-2-state', 'episodic', 2048)
  );
  await eventStore.append(
    createMemoryStoredEvent('mem-2', 'task-results', 'task-1-result', 'semantic', 1024)
  );
  await eventStore.append(createMemoryRetrievedEvent('mem-1', 'agent-context', 'agent-2-state', 1));
  await eventStore.append(createMemoryRetrievedEvent('mem-1', 'agent-context', 'agent-2-state', 2));

  console.log('   Memory events recorded\n');

  // =========================================================================
  // 6. Query Events
  // =========================================================================
  console.log('6. Querying Events...\n');

  const allAgentEvents = await eventStore.query({ aggregateTypes: ['agent'] });
  console.log(`   Total agent events: ${allAgentEvents.length}`);

  const allTaskEvents = await eventStore.query({ aggregateTypes: ['task'] });
  console.log(`   Total task events: ${allTaskEvents.length}`);

  const completedTaskEvents = await eventStore.getEventsByType('task:completed');
  console.log(`   Completed task events: ${completedTaskEvents.length}`);

  console.log();

  // =========================================================================
  // 7. Build Projections
  // =========================================================================
  console.log('7. Building Projections...\n');

  // Agent State Projection
  const agentProjection = new AgentStateProjection(eventStore);
  await agentProjection.initialize();

  console.log('   Agent State Projection:');
  const allAgents = agentProjection.getAllAgents();
  for (const agent of allAgents) {
    console.log(`     - ${agent.id}: ${agent.role} (${agent.status})`);
    console.log(`       Tasks completed: ${agent.completedTasks.length}`);
    console.log(`       Avg duration: ${agent.taskCount > 0 ? agent.totalTaskDuration / agent.taskCount : 0}ms`);
  }

  const activeAgents = agentProjection.getActiveAgentCount();
  console.log(`\n   Active agents: ${activeAgents}`);

  // Task History Projection
  const taskProjection = new TaskHistoryProjection(eventStore);
  await taskProjection.initialize();

  console.log('\n   Task History Projection:');
  const allTasks = taskProjection.getAllTasks();
  for (const task of allTasks) {
    console.log(`     - ${task.id}: ${task.title} (${task.status})`);
    console.log(`       Assigned to: ${task.assignedAgent || 'unassigned'}`);
    console.log(`       Duration: ${task.duration || 'N/A'}ms`);
  }

  const avgTaskDuration = taskProjection.getAverageTaskDuration();
  console.log(`\n   Average task duration: ${avgTaskDuration.toFixed(2)}ms`);

  // Memory Index Projection
  const memoryProjection = new MemoryIndexProjection(eventStore);
  await memoryProjection.initialize();

  console.log('\n   Memory Index Projection:');
  const activeMemories = memoryProjection.getActiveMemories();
  for (const memory of activeMemories) {
    console.log(`     - ${memory.id}: ${memory.namespace}/${memory.key}`);
    console.log(`       Size: ${memory.size} bytes, Accessed: ${memory.accessCount} times`);
  }

  const totalSize = activeMemories.reduce((sum, m) => sum + m.size, 0);
  console.log(`\n   Total memory used: ${totalSize} bytes`);

  // =========================================================================
  // 8. Event Replay
  // =========================================================================
  console.log('\n8. Event Replay Example...\n');

  let replayCount = 0;
  for await (const event of eventStore.replay(0)) {
    replayCount++;
    if (replayCount <= 3) {
      console.log(`   Replaying: ${event.type} (v${event.version})`);
    }
  }
  console.log(`   Total events replayed: ${replayCount}`);

  // =========================================================================
  // 9. Snapshots
  // =========================================================================
  console.log('\n9. Snapshot Example...\n');

  const agent2State = agentProjection.getAgent('agent-2');
  if (agent2State) {
    await eventStore.saveSnapshot({
      aggregateId: 'agent-2',
      aggregateType: 'agent',
      version: 5,
      state: agent2State as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    });
    console.log('   Snapshot saved for agent-2');

    const snapshot = await eventStore.getSnapshot('agent-2');
    console.log(`   Snapshot retrieved: version ${snapshot?.version}`);
  }

  // =========================================================================
  // 10. Statistics
  // =========================================================================
  console.log('\n10. Event Store Statistics...\n');

  const stats = await eventStore.getStats();
  console.log(`   Total events: ${stats.totalEvents}`);
  console.log(`   Events by type:`);
  for (const [type, count] of Object.entries(stats.eventsByType)) {
    console.log(`     - ${type}: ${count}`);
  }
  console.log(`\n   Events by aggregate:`);
  const topAggregates = Object.entries(stats.eventsByAggregate)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [aggregate, count] of topAggregates) {
    console.log(`     - ${aggregate}: ${count}`);
  }
  console.log(`\n   Snapshots: ${stats.snapshotCount}`);

  // =========================================================================
  // Cleanup
  // =========================================================================
  console.log('\n11. Persisting and Shutting Down...\n');

  await eventStore.persist();
  await eventStore.shutdown();

  console.log('   Event Store shutdown complete');
  console.log('\nExample completed successfully!');
  console.log('Database saved to: ./event-store-example.db');
}

// Run the example
main().catch((error) => {
  console.error('Error running example:', error);
  process.exit(1);
});
