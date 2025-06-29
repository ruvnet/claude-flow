swarm-analysis-hierarchical-1751166352507/state/consolidation-plan

## 1. STATE MANAGEMENT AUDIT RESULTS
• 62+ files rely on Map-based state
• Major repositories: state/types.ts (UnifiedSystemState), core/orchestrator.ts, coordination/swarm-coordinator.ts, memory/manager.ts, task/engine.ts, agents/agent-manager.ts
• Duplications: Agent (x4), Task (x3), Memory (x3), Session (x2)
• Inconsistencies: mixed Map vs. classes, EventEmitter vs. custom buses, disparate persistence, uneven cleanup
• Bottlenecks: no global subscriptions, redundant events, fragmented memory state, missing change-tracking

## 2. UNIFIED CONSOLIDATION PLAN
1. Treat UnifiedSystemState as the single source-of-truth root object.
2. Carve the root into typed "slices" (agents, tasks, sessions, memory, config).
3. Provide a thin SliceAdapter per legacy module that proxies to the root slice while emitting deprecation warnings; maintain backward compatibility for one minor version.
4. Introduce a shared EventBus (extends Node.js EventEmitter) exposed via state.events; all subsystems publish/subscribe through it.
5. Persist the entire root (or deltas) through a single PersistenceStrategy interface (file, DB, remote); plug existing strategies into it.
6. Standardise cleanup via a unified TTL manager driven from state.meta.cleaner.

## 3. CONCRETE IMPLEMENTATION STEPS
Step 1 – Add UnifiedSystemStateRoot in /src/state/root.ts exporting getRoot(), with internal singleton Map.
Step 2 – Implement typed slices in /src/state/slices/*.ts (e.g. agentsSlice.ts) returning mutable views into the root map.
Step 3 – Create EventBus in /src/state/event-bus.ts and attach to root.events.
Step 4 – Write SliceAdapter classes for orchestrator, swarm-coordinator, agent-manager, task-engine; each forwards CRUD ops to its slice.
Step 5 – Refactor duplicate state holders to use their adapter; remove direct Maps.
Step 6 – Add PersistenceStrategy interface + FileStrategy + RedisStrategy; plug into root.persistence.
Step 7 – Implement change-tracking middleware that diffs previous/next root snapshots and logs patches.
Step 8 – Add TTL manager scanning slices for expired keys every N seconds (configurable).
Step 9 – Backwards-compat tests: run regression suite with adapters + feature flags.
Step 10 – After one minor version, remove adapters & legacy feature flag.

## 4. PERFORMANCE & ARCHITECTURE RECOMMENDATIONS
• Keep slices as plain JS objects backed by a single Map → O(1) look-ups, zero copying.
• Batch event emissions using micro-task queue to prevent storming when thousands of keys change.
• Persist deltas, not full snapshots (e.g. JSON Patch or Immer diffs) to reduce I/O.
• Wrap heavy read paths with memoised selectors.
• Consider worker-thread off-loading for expensive diff + persistence work if CPU spikes appear.
• Maintain TypeScript exhaustive type-checking by re-exporting slice types from root.ts.
• Document migration guide for external plugin authors.
• Add metrics hooks to EventBus (events/sec, queue lag) to detect hot spots early.
