# TaskMaster Integration

TaskMaster is an intelligent task generation system that transforms Product Requirements Documents (PRDs) into actionable development tasks with SPARC methodology integration.

## Features

- **Intelligent PRD Parsing**: Automatically extracts structure and requirements from markdown PRDs
- **Smart Task Generation**: Creates hierarchical tasks with appropriate priorities and types
- **SPARC Mode Mapping**: Automatically assigns SPARC development modes to tasks
- **Memory Integration**: Stores PRDs and tasks for historical tracking
- **Task Management**: Update task statuses and track progress
- **Multiple Export Formats**: Export tasks as JSON, Markdown, or CSV

## Quick Start

```bash
# Generate tasks from a PRD
claude-flow taskmaster generate requirements.prd

# List stored PRDs and tasks
claude-flow taskmaster list

# Update task status
claude-flow taskmaster update <task-id> completed

# Export all tasks
claude-flow taskmaster export --format markdown
```

## Architecture

### Directory Structure

```
src/integrations/taskmaster/
├── adapters/                    # Data adapters for different formats
│   ├── extension-storage-adapter.ts
│   └── task-adapter.ts
├── cli/                         # CLI command implementations
│   ├── extension-commands.ts
│   └── taskmaster-commands.ts
├── config/                      # Configuration management
│   └── model-config.ts
├── deno-bridge.ts              # Deno compatibility layer
├── monitoring/                  # Performance and analytics
│   └── performance-tracker.ts
├── services/                    # Core business logic
│   ├── ai-provider.ts          # AI integration service
│   ├── analytics-service.ts    # Usage analytics
│   ├── autonomous-agents.ts    # Agent assignment logic
│   ├── collaboration-service.ts # Team collaboration features
│   ├── enhanced-prd-parser.ts  # Advanced PRD parsing
│   ├── enterprise-integration.ts
│   ├── global-sync-engine.ts   # Cross-platform sync
│   ├── intent-based-interface.ts
│   ├── ml-service.ts           # Machine learning features
│   ├── model-training.ts       # Model improvement
│   ├── prd-service.ts          # PRD processing service
│   ├── predictive-intelligence.ts
│   ├── security-service.ts     # Security features
│   ├── self-improving-engine.ts
│   ├── smart-task-generator.ts # Task generation logic
│   └── storage-sync.ts         # Storage synchronization
├── types/                       # TypeScript type definitions
│   ├── ai-types.ts
│   ├── prd-types.ts
│   └── task-types.ts
└── verify-integration.ts        # Integration testing
```

### Core Components

1. **Deno Bridge** (`deno-bridge.ts`)
   - Provides Deno compatibility for Node.js TaskMaster code
   - Handles PRD parsing and task generation
   - Integrates with Claude-Flow memory system
   - Manages task updates and exports

2. **Task Adapter** (`adapters/task-adapter.ts`)
   - Converts between different task formats
   - Handles task serialization/deserialization
   - Manages task relationships and hierarchies

3. **PRD Service** (`services/prd-service.ts`)
   - Advanced PRD parsing with AI assistance
   - Section identification and classification
   - Requirement extraction and analysis

4. **Smart Task Generator** (`services/smart-task-generator.ts`)
   - Intelligent task creation from requirements
   - Priority assignment based on content
   - SPARC mode mapping logic
   - Task dependency analysis

## Task Structure

```typescript
interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  type: string;              // implementation, api, database, etc.
  priority: string;          // high, medium, low
  status: string;            // pending, in_progress, completed, blocked
  assignee: string | null;
  sparc_mode?: string;       // architect, code, tdd, etc.
  subtasks: TaskMasterTask[];
  createdAt?: string;
  updatedAt?: string;
}
```

## SPARC Mode Mapping

TaskMaster automatically maps tasks to SPARC modes:

- **architect**: System design and architecture tasks
- **code**: General implementation tasks
- **api-only**: API development tasks
- **backend-only**: Database and backend tasks
- **frontend-only**: UI/UX implementation tasks
- **security-review**: Security-related tasks
- **tdd**: Testing tasks
- **docs-writer**: Documentation tasks

## Memory Integration

TaskMaster uses Claude-Flow's memory system with two namespaces:

- **taskmaster_prds**: Stores parsed PRD documents
- **taskmaster_tasks**: Stores generated task lists

## Advanced Features

### AI Integration
- Placeholder for Claude API integration
- Enhanced PRD parsing with AI
- Intelligent task prioritization
- Natural language task queries

### Enterprise Features
- Team collaboration support
- Role-based task assignment
- Progress tracking and analytics
- Integration with project management tools

### Self-Improving Engine
- Learns from task completion patterns
- Improves estimation accuracy over time
- Adapts to team preferences

## Development

### Adding New Features

1. **New Task Types**: Update task type detection in `generateTasksFromSection()`
2. **SPARC Modes**: Add new mode mappings in the task generation logic
3. **Export Formats**: Implement new export methods in `deno-bridge.ts`

### Testing

```bash
# Run integration tests
deno test src/integrations/taskmaster/verify-integration.ts

# Test PRD parsing
claude-flow taskmaster parse test-prd.md --verbose

# Test task generation
claude-flow taskmaster generate test-prd.md --sparc-mapping
```

## Roadmap

1. **Phase 1** (Completed)
   - Basic PRD parsing
   - Task generation
   - Memory integration
   - Task updates

2. **Phase 2** (In Progress)
   - AI-powered parsing
   - VS Code extension sync
   - Advanced analytics

3. **Phase 3** (Planned)
   - Natural language queries
   - Task dependencies
   - Progress visualization
   - Team collaboration features

4. **Phase 4** (Future)
   - ML-based estimation
   - Automated task assignment
   - Integration with external tools
   - Real-time collaboration

## Contributing

1. Follow the existing code structure
2. Add tests for new features
3. Update documentation
4. Use TypeScript strict mode
5. Follow SPARC methodology for development

## License

Part of Claude-Flow project. See main LICENSE file.