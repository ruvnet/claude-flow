# Claude-Flow + Claude-Task-Master-Extension Integration Architecture

## Executive Summary
Integration design for connecting claude-flow's TaskMaster capabilities with the claude-task-master-extension VS Code visual interface, enabling seamless visual task management within the SPARC development workflow.

## Current State Analysis

### Claude-Task-Master-Extension (VS Code)
- **Purpose**: Visual task management interface for VS Code/Cursor
- **Storage**: Uses `.taskmaster/tasks/tasks.json` file format
- **Interface**: Tree view with hierarchical task display
- **Commands**: 20+ VS Code commands for task operations
- **CLI**: Uses `npx task-master-ai` for operations
- **Features**: Real-time updates, progress tracking, AI task expansion

### Claude-Flow TaskMaster Integration
- **Purpose**: AI-powered project management with SPARC methodology
- **Storage**: Currently uses internal task structures
- **Interface**: CLI-based with SPARC phase mapping
- **Commands**: `claude-flow taskmaster` commands
- **Features**: PRD parsing, AI task generation, SPARC integration

## Integration Architecture

### 1. Storage Layer Compatibility

```typescript
// Unified Task Storage Format
interface UnifiedTaskFormat {
  // Compatible with both systems
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'completed' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  subtasks?: UnifiedTaskFormat[];
  parent?: string;
  
  // Claude-Flow specific
  sparcPhase?: SPARCPhase;
  assignedAgent?: string;
  estimatedHours?: number;
  
  // Extension specific  
  progress?: number;
  expanded?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 2. File System Structure

```
project-root/
├── .taskmaster/                    # Shared directory
│   ├── tasks/
│   │   ├── tasks.json             # Primary task storage
│   │   └── tasks.backup.json      # Backup file
│   ├── config/
│   │   ├── claude-flow.json       # Claude-Flow settings
│   │   └── extension.json         # Extension settings
│   └── sparc/
│       ├── phase-mapping.json     # SPARC phase assignments
│       └── agent-assignments.json # Agent task assignments
```

### 3. Integration Components

#### A. Task Storage Adapter
```typescript
class TaskMasterStorageAdapter {
  // Read/write tasks in .taskmaster format
  async readTasks(): Promise<UnifiedTaskFormat[]>
  async writeTasks(tasks: UnifiedTaskFormat[]): Promise<void>
  
  // Convert between formats
  toExtensionFormat(task: ClaudeFlowTask): ExtensionTask
  toClaudeFlowFormat(task: ExtensionTask): ClaudeFlowTask
  
  // Watch for changes
  watchTaskFile(callback: (tasks) => void): void
}
```

#### B. Command Bridge
```typescript
class TaskMasterCommandBridge {
  // Map claude-flow commands to task-master-ai CLI
  async executeCommand(command: string, args: any[]): Promise<any>
  
  // Command mappings
  private commandMap = {
    'claude-flow taskmaster add': 'task-master-ai add',
    'claude-flow taskmaster list': 'task-master-ai list',
    'claude-flow taskmaster update': 'task-master-ai update'
  }
}
```

#### C. SPARC Enhancement Layer
```typescript
class SPARCTaskEnhancer {
  // Add SPARC metadata to tasks
  enhanceWithSPARC(task: UnifiedTaskFormat): UnifiedTaskFormat {
    return {
      ...task,
      sparcPhase: this.inferPhase(task),
      assignedAgent: this.suggestAgent(task),
      metadata: {
        ...task.metadata,
        claudeFlowEnhanced: true
      }
    }
  }
}
```

### 4. Implementation Strategy

#### Phase 1: Storage Compatibility (Week 1)
1. Implement TaskMasterStorageAdapter
2. Add `.taskmaster` directory support to claude-flow
3. Create format conversion utilities
4. Add file watching capabilities

#### Phase 2: Command Integration (Week 2)
1. Create command bridge for basic operations
2. Map claude-flow taskmaster commands to extension format
3. Implement bi-directional sync
4. Add conflict resolution

#### Phase 3: SPARC Enhancement (Week 3)
1. Add SPARC metadata to task format
2. Create visual indicators for SPARC phases
3. Implement agent assignment visualization
4. Add phase-based filtering

#### Phase 4: Advanced Features (Week 4)
1. AI task generation with visual feedback
2. PRD import with automatic task creation
3. SPARC workflow visualization
4. Real-time collaboration features

## Benefits of Integration

### For Claude-Flow Users
1. **Visual Task Management**: See tasks in VS Code sidebar
2. **Real-time Updates**: Visual feedback for task changes
3. **SPARC Visualization**: See phase assignments visually
4. **Easier Navigation**: Click to navigate between tasks

### For Extension Users
1. **AI-Powered Features**: Access claude-flow's AI capabilities
2. **SPARC Methodology**: Benefit from systematic development
3. **PRD Integration**: Generate tasks from requirements
4. **Agent Assignment**: See recommended agents per task

## Technical Requirements

### Dependencies
- **claude-flow**: No additional dependencies needed
- **Extension**: Already compatible with task-master-ai CLI
- **Shared**: chokidar for file watching (already in both)

### Configuration
```json
// .taskmaster/config/claude-flow.json
{
  "enableExtensionSync": true,
  "taskFormat": "unified",
  "sparcIntegration": true,
  "autoAgentAssignment": true
}
```

## Migration Path

### For Existing Claude-Flow Projects
```bash
# Initialize extension compatibility
claude-flow taskmaster init --extension-compatible

# Migrate existing tasks
claude-flow taskmaster migrate --to-extension-format

# Enable file watching
claude-flow taskmaster sync --watch
```

### For Existing Extension Users
```bash
# Add claude-flow capabilities
npx claude-flow taskmaster enhance --existing-project

# Import SPARC methodology
npx claude-flow sparc init --taskmaster-integration
```

## API Design

### REST API (Optional Future Enhancement)
```typescript
// Local API for extension communication
interface TaskMasterAPI {
  // Task operations
  GET    /api/tasks
  POST   /api/tasks
  PUT    /api/tasks/:id
  DELETE /api/tasks/:id
  
  // SPARC operations
  GET    /api/sparc/phases
  POST   /api/sparc/assign-phase
  GET    /api/sparc/agents
  
  // AI operations
  POST   /api/ai/generate-tasks
  POST   /api/ai/expand-task
}
```

## Conclusion

The integration is highly feasible and would provide significant value to both claude-flow and extension users. The shared `.taskmaster` directory approach ensures compatibility while allowing each tool to maintain its unique features. The unified task format supports both visual management and SPARC methodology, creating a powerful development environment.

### Key Advantages:
1. **No Breaking Changes**: Both tools continue to work independently
2. **Progressive Enhancement**: Features can be adopted gradually
3. **Shared Benefits**: Each tool enhances the other
4. **Future-Proof**: Extensible architecture for new features

### Next Steps:
1. Implement basic storage compatibility
2. Create proof-of-concept integration
3. Test with real projects
4. Gather user feedback
5. Refine and optimize

## Answer to Original Questions

**Q: Is it possible to make claude-flow compatible with the task master extension?**
A: Yes, absolutely. The integration is straightforward due to the file-based architecture of both systems.

**Q: Do we still need to install taskmaster separately?**
A: No, claude-flow can directly read/write the `.taskmaster/tasks/tasks.json` format, eliminating the need for a separate task-master-ai installation. However, having it installed provides additional CLI capabilities that complement the visual interface.