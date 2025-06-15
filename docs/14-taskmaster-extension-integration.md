# Claude-Flow + Claude-Task-Master-Extension Integration Guide

## Overview

Claude-Flow now seamlessly integrates with the [claude-task-master VS Code extension](https://github.com/iaminawe/claude-task-master-extension), providing a powerful visual interface for managing tasks within your SPARC development workflow.

## Key Benefits

### Visual Task Management
- **Tree View**: Hierarchical task display in VS Code sidebar
- **Real-time Updates**: Changes sync automatically between CLI and extension
- **Progress Tracking**: Visual progress bars and completion statistics
- **Status Indicators**: Color-coded icons for task states

### SPARC Integration
- **Automatic Phase Assignment**: Tasks mapped to SPARC phases (Specification, Architecture, etc.)
- **Agent Recommendations**: Suggested agents based on task type
- **Workflow Visualization**: See your entire SPARC workflow visually
- **Context Preservation**: SPARC metadata preserved across systems

### Unified Experience
- **Single Source of Truth**: `.taskmaster/tasks/tasks.json` shared format
- **Bi-directional Sync**: Changes in either system reflect everywhere
- **No Additional Dependencies**: Works with existing claude-flow installation
- **Progressive Enhancement**: Use visual features when needed

## Quick Start

### 1. Initialize Extension Support

```bash
# Initialize with extension compatibility (recommended)
npx claude-flow taskmaster init

# This creates:
# .taskmaster/
# ├── tasks/
# │   └── tasks.json      # Shared task storage
# ├── config/             # Configuration files
# └── sparc/              # SPARC metadata
```

### 2. Install VS Code Extension

1. Open VS Code/Cursor
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "claude-task-master"
4. Click Install
5. Reload VS Code

### 3. Start Using Visual Tasks

The extension automatically detects `.taskmaster` directories and displays tasks in the sidebar.

## Command Reference

### Basic Commands

```bash
# Initialize extension support
claude-flow taskmaster init

# Sync tasks with SPARC enhancements
claude-flow taskmaster extension sync

# Watch for real-time changes
claude-flow taskmaster extension watch

# Show task statistics
claude-flow taskmaster extension stats
```

### Export Commands

```bash
# Export as JSON
claude-flow taskmaster extension export json

# Export as Markdown
claude-flow taskmaster extension export markdown

# Export as CSV
claude-flow taskmaster extension export csv
```

### PRD Integration

```bash
# Generate tasks from PRD with visual support
claude-flow taskmaster generate-from-prd requirements.md --sparc-mapping

# Tasks automatically appear in VS Code extension
```

## Task Format

Tasks use a unified format compatible with both systems:

```json
{
  "id": "task-123",
  "title": "Implement user authentication",
  "description": "Create login and registration system",
  "status": "in-progress",
  "priority": "high",
  "sparcPhase": "refinement",
  "assignedAgent": "code",
  "estimatedHours": 8,
  "subtasks": [...],
  "metadata": {
    "claudeFlowEnhanced": true,
    "aiGenerated": true
  }
}
```

## SPARC Phase Mapping

Tasks are automatically assigned to SPARC phases:

| Task Content | SPARC Phase | Assigned Agent |
|--------------|-------------|----------------|
| Requirements, Goals | Specification | spec-pseudocode |
| Design, Architecture | Architecture | architect |
| Algorithm, Logic | Pseudocode | spec-pseudocode |
| Implementation | Refinement | code or tdd |
| Testing, Deployment | Completion | integration |

## Visual Features

### Task Tree View
- Expandable parent-child relationships
- Progress indicators for parent tasks
- Drag-and-drop reordering (extension feature)

### Status Indicators
- ⏳ **Todo**: Gray, pending tasks
- 🔄 **In Progress**: Blue, active work
- ✅ **Completed**: Green, finished tasks
- 🚫 **Blocked**: Red, blocked items

### Context Menu
Right-click tasks for quick actions:
- Change status
- Add subtasks
- Edit details
- Delete tasks
- Expand with AI (requires MCP)

## Workflow Examples

### Example 1: Starting a New Project

```bash
# 1. Initialize project with extension support
claude-flow init --sparc
claude-flow taskmaster init

# 2. Generate tasks from PRD
claude-flow taskmaster generate-from-prd project-requirements.md

# 3. Open VS Code to see visual tasks
code .

# 4. Use extension to manage tasks visually
# Changes sync back to claude-flow automatically
```

### Example 2: Enhancing Existing Tasks

```bash
# 1. Add SPARC metadata to existing tasks
claude-flow taskmaster extension sync

# 2. View enhanced tasks in VS Code
# Tasks now show SPARC phases and agent assignments

# 3. Continue development with visual feedback
claude-flow sparc run code "implement authentication"
# Progress updates in real-time in VS Code
```

### Example 3: Real-time Collaboration

```bash
# Terminal 1: Watch for changes
claude-flow taskmaster extension watch

# Terminal 2: Run SPARC workflows
claude-flow sparc tdd "user authentication"

# VS Code: See live updates as tasks complete
# Team members can track progress visually
```

## Configuration

### Claude-Flow Settings
```json
// .taskmaster/config/claude-flow.json
{
  "enableExtensionSync": true,
  "taskFormat": "unified",
  "sparcIntegration": true,
  "autoAgentAssignment": true,
  "watchInterval": 1000
}
```

### Extension Settings
```json
// .taskmaster/config/extension.json
{
  "autoExpandTasks": true,
  "showProgress": true,
  "enableAI": false,
  "theme": "default"
}
```

## Advanced Features

### AI-Powered Task Expansion
When MCP server is configured, the extension can:
- Expand high-level tasks into subtasks
- Generate task descriptions
- Suggest dependencies
- Estimate effort

### Bulk Operations
- Select multiple tasks for status updates
- Bulk assign to SPARC phases
- Export selected tasks
- Archive completed work

### Custom Views
- Filter by SPARC phase
- Group by agent assignment
- Show only blocked tasks
- Focus on current sprint

## Troubleshooting

### Tasks Not Appearing
1. Ensure `.taskmaster/tasks/tasks.json` exists
2. Check file permissions
3. Reload VS Code window
4. Run `claude-flow taskmaster init`

### Sync Issues
1. Stop any running watchers
2. Run `claude-flow taskmaster extension sync`
3. Restart VS Code
4. Check for file locks

### Performance
- Large task lists (1000+) may slow down
- Use filters to focus on active work
- Archive completed tasks periodically
- Disable auto-expand for better performance

## Migration Guide

### From Standalone Claude-Flow
```bash
# No migration needed! Just add extension support:
claude-flow taskmaster init
# Install VS Code extension and start using
```

### From Standalone Extension
```bash
# Add claude-flow capabilities to existing tasks:
npx claude-flow taskmaster extension sync
# Your tasks now have SPARC superpowers!
```

## Best Practices

1. **Use Both Tools**: CLI for automation, extension for visualization
2. **Regular Syncs**: Run sync command after major changes
3. **Descriptive Titles**: Help SPARC phase detection
4. **Hierarchical Structure**: Organize tasks in logical groups
5. **Status Updates**: Keep status current for accurate progress

## Future Enhancements

- [ ] Two-way binding with Claude-Flow memory system
- [ ] Real-time collaboration features
- [ ] SPARC workflow visualization
- [ ] Integration with Claude Code tools
- [ ] Custom task templates
- [ ] Automated status updates

## Conclusion

The integration between claude-flow and claude-task-master-extension creates a powerful development environment that combines:
- AI-powered task generation and management
- Visual task tracking and organization  
- SPARC methodology automation
- Seamless workflow integration

No additional installation of task-master-ai is required - claude-flow handles everything natively while maintaining full compatibility with the VS Code extension.