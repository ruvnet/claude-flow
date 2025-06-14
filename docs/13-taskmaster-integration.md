# Claude Task Master Integration Guide

## Overview

The Claude Task Master integration provides AI-powered task management capabilities, enabling you to generate structured task hierarchies from Product Requirements Documents (PRDs), synchronize tasks between TaskMaster and ClaudeFlow formats, and leverage the SPARC methodology for systematic development.

## Quick Start

### 1. Initialize TaskMaster Integration

```bash
# Initialize TaskMaster integration in your project
claude-flow taskmaster init

# Check integration status
claude-flow taskmaster status --detailed
```

### 2. Generate Tasks from PRD

```bash
# Generate tasks from a PRD file with SPARC mapping
claude-flow taskmaster generate-from-prd requirements.md \
  --sparc-mapping \
  --assign-agents \
  --model claude-3-haiku \
  --depth 2 \
  --output tasks.json

# Preview tasks without saving (dry run)
claude-flow taskmaster generate-from-prd requirements.md \
  --dry-run \
  --format markdown
```

### 3. Import Existing TaskMaster Project

```bash
# Import existing TaskMaster project with backup
claude-flow taskmaster import ./existing-tasks \
  --merge \
  --backup

# Sync tasks bidirectionally
claude-flow taskmaster sync --direction bidirectional
```

### 4. Real-time Synchronization

```bash
# Start file system watcher for automatic sync
claude-flow taskmaster watch --directory ./tasks

# Check sync status
claude-flow taskmaster status
```

## Core Features

### AI-Powered Task Generation

The TaskMaster integration can parse Product Requirements Documents and generate structured task hierarchies:

```bash
# Generate tasks with different AI models
claude-flow taskmaster generate-from-prd spec.md --model claude-3-opus
claude-flow taskmaster generate-from-prd spec.md --model gpt-4

# Customize task depth and structure
claude-flow taskmaster generate-from-prd spec.md \
  --depth 3 \
  --sparc-mapping \
  --assign-agents

# Export in different formats
claude-flow taskmaster generate-from-prd spec.md \
  --format markdown \
  --output project-tasks.md
```

### SPARC Methodology Integration

Tasks are automatically mapped to SPARC development phases:

- **Specification**: Requirements analysis and user story creation
- **Pseudocode**: Algorithm design and logic planning
- **Architecture**: System design and component structure
- **Refinement**: Implementation with TDD and testing
- **Completion**: Integration, documentation, and deployment

### Bidirectional Task Synchronization

Seamlessly sync tasks between TaskMaster and ClaudeFlow formats:

```bash
# Sync from TaskMaster to ClaudeFlow
claude-flow taskmaster sync --direction from-taskmaster

# Sync from ClaudeFlow to TaskMaster
claude-flow taskmaster sync --direction to-taskmaster

# Bidirectional sync (default)
claude-flow taskmaster sync --direction bidirectional
```

### Enhanced Task Operations

Use AI-powered task management features:

```bash
# Get intelligent next task recommendation
claude-flow task next --smart

# Estimate task effort with AI
claude-flow task estimate TASK-123 --breakdown

# Break down complex tasks into subtasks
claude-flow task expand TASK-456 --depth 3

# Visualize task dependencies
claude-flow task dependencies --format mermaid
```

## Configuration

### TaskMaster Configuration File

The integration creates a `.taskmaster-config.json` file:

```json
{
  "version": "1.0",
  "taskMaster": {
    "directory": "./tasks",
    "format": "json"
  },
  "claudeFlow": {
    "integration": true,
    "autoSync": false
  },
  "ai": {
    "defaultModel": "claude-3-haiku",
    "providers": ["anthropic", "openai", "gemini"]
  },
  "sync": {
    "watchDirectory": true,
    "conflictResolution": "merge",
    "backupEnabled": true
  }
}
```

### Configuration Management

```bash
# View current configuration
claude-flow taskmaster config --list

# Set configuration values
claude-flow taskmaster config --set ai.defaultModel=claude-3-opus
claude-flow taskmaster config --set sync.autoSync=true

# Get specific configuration value
claude-flow taskmaster config --get ai.defaultModel
```

## PRD Format Guidelines

### Recommended PRD Structure

```markdown
# Project Name

## Overview
Brief project description and goals.

## Goals and Objectives
- Primary goal 1
- Primary goal 2
- Success criteria

## Functional Requirements
### Feature 1: User Authentication
- Users must be able to register with email and password
- Users must be able to login securely
- Password reset functionality is required

### Feature 2: Data Management
- System must support CRUD operations
- Data validation is required
- Audit logging must be implemented

## Technical Requirements
- Use React for frontend
- Implement REST API with Node.js
- Use PostgreSQL for data storage
- Implement JWT authentication

## Constraints
- Must complete within 12 weeks
- Budget constraint of $50,000
- Must comply with GDPR
- Performance requirement: page load < 2s

## Acceptance Criteria
- All authentication flows work correctly
- Data operations complete without errors
- System passes security audit
- Performance targets are met
```

### PRD Parsing Features

The AI-powered parser can identify:

- **Requirements**: Functional, non-functional, technical, and business requirements
- **Constraints**: Time, budget, technical, regulatory constraints
- **Acceptance Criteria**: Testable conditions for completion
- **Dependencies**: Task and feature dependencies
- **Complexity Analysis**: Effort estimation and team size recommendations

## Task Structure

### TaskMaster Format

```json
{
  "id": "task-001",
  "title": "Implement User Registration",
  "description": "Build user registration with email validation",
  "status": "todo",
  "priority": 3,
  "tags": ["authentication", "backend"],
  "dependencies": ["task-000"],
  "estimate": 6,
  "assignee": "backend-dev",
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z",
  "metadata": {
    "prd_section": "User Authentication",
    "complexity": 5,
    "ai_generated": true,
    "model_used": "claude-3-haiku"
  }
}
```

### ClaudeFlow Format

```json
{
  "id": "task-001",
  "title": "Implement User Registration",
  "description": "Build user registration with email validation",
  "status": "pending",
  "priority": "high",
  "phase": "refinement",
  "agent": "code",
  "dependencies": ["task-000"],
  "estimatedHours": 6,
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:00:00Z",
  "context": {
    "sparc_phase": "refinement",
    "assigned_agent": "code",
    "project_context": "Authentication | Backend"
  }
}
```

## Monitoring and Performance

### Status Monitoring

```bash
# Check integration status
claude-flow taskmaster status

# Detailed status with metrics
claude-flow taskmaster status --detailed
```

Status includes:
- Sync operations (successful/failed)
- File watcher status
- Conflict resolution statistics
- Performance metrics
- Error logs

### Performance Metrics

The integration tracks:
- Task conversion times
- PRD processing duration
- Sync operation performance
- Memory usage
- Error rates

### Real-time Monitoring

```bash
# Start file watcher for real-time sync
claude-flow taskmaster watch --directory ./tasks

# Monitor with verbose output
claude-flow taskmaster watch --directory ./tasks --verbose
```

## Conflict Resolution

### Automatic Conflict Resolution

The system automatically resolves common conflicts:

- **Status conflicts**: Most recent change wins
- **Priority conflicts**: Higher priority wins
- **Content conflicts**: Merge strategy with user preference

### Manual Conflict Resolution

For complex conflicts, the system prompts for user input:

```bash
# View pending conflicts
claude-flow taskmaster status --conflicts

# Resolve conflicts manually
claude-flow taskmaster sync --resolve-conflicts
```

### Conflict Resolution Strategies

```json
{
  "conflictResolution": {
    "strategy": "merge",
    "rules": {
      "status": "most_recent",
      "priority": "higher_wins",
      "content": "user_prompt"
    }
  }
}
```

## Integration Workflows

### Complete Development Workflow

```bash
# 1. Initialize project with TaskMaster integration
claude-flow init --sparc
claude-flow taskmaster init

# 2. Generate tasks from PRD
claude-flow taskmaster generate-from-prd requirements.md \
  --sparc-mapping \
  --assign-agents \
  --output project-tasks.json

# 3. Start sync monitoring
claude-flow taskmaster watch --directory ./tasks

# 4. Work with SPARC methodology
claude-flow sparc run spec-pseudocode "analyze requirements"
claude-flow sparc run architect "design system"
claude-flow sparc run code "implement features"
claude-flow sparc run tdd "create tests"

# 5. Monitor progress
claude-flow taskmaster status --detailed
claude-flow monitor
```

### Team Collaboration Workflow

```bash
# 1. Import existing team project
claude-flow taskmaster import ./team-tasks --merge

# 2. Sync with team repository
claude-flow taskmaster sync --direction bidirectional

# 3. Get next task recommendation
claude-flow task next --smart

# 4. Update task status
claude-flow task update TASK-123 --status in_progress

# 5. Sync changes back to team
claude-flow taskmaster sync
```

## Troubleshooting

### Common Issues

#### Sync Failures

```bash
# Check sync status and errors
claude-flow taskmaster status --detailed

# Force manual sync
claude-flow taskmaster sync --force

# Reset sync state
claude-flow taskmaster sync --reset
```

#### File Permission Issues

```bash
# Check directory permissions
ls -la ./tasks

# Fix permissions
chmod -R 755 ./tasks
```

#### Configuration Issues

```bash
# Validate configuration
claude-flow taskmaster config --validate

# Reset to defaults
claude-flow taskmaster init --force
```

### Debug Mode

```bash
# Enable verbose logging
claude-flow taskmaster generate-from-prd spec.md --verbose

# Debug sync operations
claude-flow taskmaster sync --debug

# Monitor with detailed output
claude-flow taskmaster watch --directory ./tasks --verbose
```

## Best Practices

### PRD Writing

1. **Clear Structure**: Use consistent heading hierarchy
2. **Specific Requirements**: Write testable, measurable requirements
3. **Complete Context**: Include constraints, dependencies, and acceptance criteria
4. **Realistic Scope**: Break large features into manageable components

### Task Management

1. **Regular Sync**: Enable auto-sync or sync regularly
2. **Consistent Naming**: Use clear, descriptive task titles
3. **Proper Dependencies**: Define task dependencies clearly
4. **Status Updates**: Keep task status current

### Integration Maintenance

1. **Monitor Performance**: Check status regularly
2. **Backup Data**: Enable automatic backups
3. **Update Configuration**: Keep AI models and settings current
4. **Review Conflicts**: Address conflicts promptly

## API Integration

### Programmatic Usage

```typescript
import { TaskMasterIntegration } from 'claude-flow';

// Initialize integration
await TaskMasterIntegration.initialize({
  directory: './tasks',
  autoSync: true,
  conflictResolution: 'merge'
});

// Generate tasks from PRD
const tasks = await TaskMasterIntegration.generateTasksFromPRD(
  './requirements.md',
  {
    model: 'claude-3-haiku',
    sparcMapping: true,
    agentAssignment: true
  }
);

// Sync tasks
const result = await TaskMasterIntegration.syncTasks('bidirectional');

// Get next task recommendation
const nextTask = await TaskMasterIntegration.getNextTask({
  currentPhase: 'architecture',
  completedTasks: ['task-001', 'task-002']
});
```

## Advanced Features

### Custom AI Models

```bash
# Use different AI providers
claude-flow taskmaster generate-from-prd spec.md --model gpt-4
claude-flow taskmaster generate-from-prd spec.md --model gemini-pro

# Custom model configuration
claude-flow taskmaster config --set ai.customModels='[
  {
    "provider": "anthropic",
    "model": "claude-3-opus",
    "settings": {
      "temperature": 0.3,
      "maxTokens": 4000
    }
  }
]'
```

### Batch Operations

```bash
# Process multiple PRDs
for prd in *.md; do
  claude-flow taskmaster generate-from-prd "$prd" \
    --output "${prd%.md}-tasks.json"
done

# Batch sync multiple projects
claude-flow taskmaster sync --batch --projects project1,project2,project3
```

### Integration with CI/CD

```yaml
# GitHub Actions example
- name: Generate Tasks from PRD
  run: |
    npx claude-flow taskmaster generate-from-prd requirements.md \
      --sparc-mapping \
      --output tasks.json \
      --format json

- name: Validate Task Structure
  run: |
    npx claude-flow task validate tasks.json

- name: Sync to Task Management System
  run: |
    npx claude-flow taskmaster sync --direction to-taskmaster
```

## Related Documentation

- [SPARC Methodology Guide](./sparc-methodology.md)
- [Task Coordination](./05-task-coordination.md)
- [Memory Bank Usage](./06-memory-bank-usage.md)
- [Agent Management](./04-agent-management.md)
- [CLI Reference](./cli-reference.md)