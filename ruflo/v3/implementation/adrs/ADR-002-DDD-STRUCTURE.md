# ADR-002: Implement Domain-Driven Design Structure

**Status:** Implemented
**Date:** 2026-01-03

## Context

Current v2 structure organizes code by technical layer (cli/, core/, mcp/, swarm/), making it difficult to understand complete features and leading to high coupling between layers.

**Problems:**
- Feature code scattered across 5+ directories
- Unclear ownership and boundaries
- Changes require touching many files
- Difficult for new contributors to navigate

**Example: Agent Management Feature**
```
Current (scattered):
├── cli/commands/agent.ts          # CLI interface
├── core/orchestrator.ts           # Orchestration logic
├── agents/agent-manager.ts        # Management logic
├── mcp/tools.ts                   # MCP tools
└── swarm/coordinator.ts           # Coordination logic

Proposed (cohesive):
└── agent-lifecycle/
    ├── api/cli/agent-commands.ts
    ├── api/mcp/agent-tools.ts
    ├── application/agent-service.ts
    ├── domain/agent.ts
    └── infrastructure/agent-repository.ts
```

## Decision

**We will restructure v3 using Domain-Driven Design (DDD) principles with clear bounded contexts.**

**Structure:**
```
src/
├── agent-lifecycle/      # Bounded Context 1
│   ├── domain/          # Business logic, entities
│   ├── application/     # Use cases, services
│   ├── infrastructure/  # Persistence, external systems
│   └── api/            # External interfaces (CLI, MCP)
├── task-execution/      # Bounded Context 2
├── memory-management/   # Bounded Context 3
├── coordination/        # Bounded Context 4
├── shared-kernel/       # Shared types and utilities
└── infrastructure/      # Cross-cutting concerns
```

**Layer Rules:**
1. Domain layer: No external dependencies, pure business logic
2. Application layer: Orchestrates domain, no infrastructure details
3. Infrastructure layer: Implements technical concerns
4. API layer: Thin adapters to external world

## Rationale

**Benefits:**
- Features colocated, easy to find
- Clear boundaries reduce coupling
- Easy to understand and modify
- Enables team scaling (own a domain)
- Facilitates testing (mock boundaries)
- Supports microservices future (extract domains)

**Costs:**
- Migration effort from v2 structure
- Learning curve for DDD concepts
- More directories to navigate
- Requires discipline to maintain boundaries

## Implementation

**Directory Template:**
```
domain-name/
├── domain/
│   ├── models/           # Entities, value objects
│   ├── interfaces/       # Repository interfaces
│   ├── events/          # Domain events
│   └── services/        # Domain services
├── application/
│   ├── services/        # Application services
│   ├── handlers/        # Event handlers
│   └── queries/         # Query services (CQRS)
├── infrastructure/
│   ├── repositories/    # Repository implementations
│   ├── adapters/        # External system adapters
│   └── persistence/     # Persistence implementations
└── api/
    ├── cli/            # CLI commands
    ├── mcp/            # MCP tools
    └── dto/            # Data transfer objects
```

**Example: Task Execution Domain**
```typescript
// domain/models/task.ts
export class Task {
  constructor(
    readonly id: TaskId,
    readonly type: TaskType,
    private status: TaskStatus
  ) {}

  assign(agentId: AgentId): void {
    if (this.status !== TaskStatus.Created) {
      throw new InvalidStateError('Task already assigned');
    }
    this.status = TaskStatus.Assigned;
    this.emit(new TaskAssigned(this.id, agentId));
  }
}

// application/services/task-service.ts
export class TaskExecutionService {
  constructor(
    private taskRepo: ITaskRepository,
    private agentService: AgentLifecycleService,
    private eventBus: IEventBus
  ) {}

  async createTask(spec: TaskSpec): Promise<TaskId> {
    const task = Task.create(spec);
    await this.taskRepo.save(task);
    return task.id;
  }
}

// api/cli/task-commands.ts
export class CreateTaskCommand {
  constructor(private taskService: TaskExecutionService) {}

  async execute(args: CreateTaskArgs): Promise<void> {
    const taskId = await this.taskService.createTask(args);
    console.log(`Task created: ${taskId}`);
  }
}
```

## Success Criteria

- [x] Clear domain boundaries documented
- [x] All features contained within single domain
- [x] No circular dependencies between domains
- [x] Domain models independent of infrastructure
- [x] New features can be added in <3 files

## References

- Domain-Driven Design by Eric Evans
- Implementing Domain-Driven Design by Vaughn Vernon
- Current architecture assessment: docs/architecture/v3-assessment.md

---

**Implementation Date:** 2026-01-04
**Status:** ✅ Complete
