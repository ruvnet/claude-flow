# TaskMaster Complete Guide

## Overview

TaskMaster is an integrated task generation system within Claude-Flow that automatically converts Product Requirements Documents (PRDs) into structured, actionable tasks mapped to SPARC development phases. It offers both CLI functionality and optional VS Code extension integration for visual task management.

## Table of Contents

1. [What TaskMaster Actually Does](#what-taskmaster-actually-does)
2. [Quick Start](#quick-start)
3. [Installation & Setup](#installation--setup)
4. [Command Reference](#command-reference)
5. [PRD Format Guidelines](#prd-format-guidelines)
6. [Task Generation Process](#task-generation-process)
7. [SPARC Integration](#sparc-integration)
8. [AI Enhancement](#ai-enhancement)
9. [Template System](#template-system)
10. [VS Code Extension Integration](#vs-code-extension-integration)
11. [Export Formats](#export-formats)
12. [Memory Integration](#memory-integration)
13. [Examples & Workflows](#examples--workflows)
14. [Troubleshooting](#troubleshooting)
15. [Current Limitations](#current-limitations)
16. [Future Features](#future-features)

## What TaskMaster Actually Does

### ✅ Currently Implemented
- **PRD Parsing**: Extracts structure from markdown PRDs using regex and section analysis
- **Task Generation**: Creates hierarchical tasks with subtasks and dependencies
- **SPARC Mapping**: Automatically maps tasks to development phases
- **Memory Storage**: Persists PRDs and tasks in Claude-Flow memory
- **Export Options**: Outputs in JSON, Markdown, and CSV formats
- **AI Enhancement**: Optional Claude API integration for better descriptions (requires API key)
- **Basic Templates**: Template structure exists (partially implemented)

### ⚠️ Partially Implemented
- **VS Code Extension**: Server code exists but is NOT connected to CLI commands
- **Template System**: Basic structure present but not fully functional
- **Workflow Automation**: Defined but not operational

### ❌ NOT Implemented (Despite Documentation)
- Autonomous operations or decision-making
- Predictive analytics or ML features
- Real-time team collaboration
- External integrations (Jira, GitHub, Asana)
- Multiple AI providers (only Anthropic works)
- Natural language interface
- Self-improvement capabilities
- Global synchronization
- Enterprise features
- Machine learning platform

## Quick Start

```bash
# 1. Create a PRD file
cat > project.prd << 'EOF'
# E-commerce Platform

## Overview
Build an e-commerce platform with user authentication and payments.

## Requirements
- User registration and login
- Product catalog with search
- Shopping cart functionality
- Payment processing

## Technical Stack
- Frontend: React/TypeScript
- Backend: Node.js
- Database: PostgreSQL
EOF

# 2. Generate tasks (basic - no AI)
./claude-flow taskmaster generate project.prd --sparc-mapping --output tasks.json

# 3. With AI enhancement (requires API key)
export ANTHROPIC_API_KEY='your-api-key'
./claude-flow taskmaster generate project.prd --ai --detailed --enhance

# 4. View and export
./claude-flow taskmaster list
./claude-flow taskmaster export --format markdown --output tasks.md
```

## Installation & Setup

TaskMaster is built into Claude-Flow - no additional installation required.

### Basic Setup
```bash
# Verify TaskMaster is available
./claude-flow taskmaster info

# Initialize for VS Code extension (optional)
./claude-flow taskmaster init
```

### AI Enhancement Setup
```bash
# Set Anthropic API key for AI features
export ANTHROPIC_API_KEY='sk-ant-...'

# Verify AI is configured
./claude-flow taskmaster ai-status
```

## Command Reference

### Getting Help

The TaskMaster CLI includes comprehensive built-in help:

```bash
# Show TaskMaster help (works with no subcommand or --help)
claude-flow taskmaster
claude-flow taskmaster --help

# Get help for specific subcommands
claude-flow taskmaster help generate
claude-flow taskmaster help export
claude-flow taskmaster generate --help
```

### Core Commands

#### `parse <prd-file>`
Parse PRD and display structure.
```bash
claude-flow taskmaster parse requirements.prd
```

#### `generate <prd-file> [options]`
Generate tasks from PRD.
```bash
claude-flow taskmaster generate requirements.prd [options]
```

**Options:**
- `--output <file>` - Output file path (default: stdout)
- `--format <type>` - Output format: json|markdown|csv (default: json)
- `--depth <number>` - Task hierarchy depth (default: 3)
- `--sparc-mapping` - Enable SPARC mode mapping
- `--ai` - Enable AI enhancement (requires API key)
- `--detailed` - Generate detailed descriptions
- `--enhance` - Enhance with AI suggestions
- `--verbose` - Show detailed output

#### `list`
Display stored PRDs and task summaries.
```bash
claude-flow taskmaster list
```

#### `update <task-id> <status>`
Update task status.
```bash
claude-flow taskmaster update task-001 completed
```
Status options: `pending`, `in_progress`, `completed`, `blocked`

#### `export [options]`
Export stored tasks.
```bash
claude-flow taskmaster export --format markdown --output tasks.md
```

**Options:**
- `--format <type>` - Export format: json|markdown|csv
- `--output <file>` - Output file path
- `--filter <status>` - Filter by status

#### `ai-status`
Check AI configuration.
```bash
claude-flow taskmaster ai-status
```

#### `analyze <prd-file>`
Analyze PRD with AI (requires API key).
```bash
claude-flow taskmaster analyze requirements.prd
```

Returns:
- Executive summary
- Complexity assessment
- Feature breakdown
- Effort estimation
- Risk analysis

#### `templates list`
List available templates (partially implemented).
```bash
claude-flow taskmaster templates list
```

#### `info`
Display TaskMaster information and capabilities.
```bash
claude-flow taskmaster info
```

#### `help [subcommand]`
Show comprehensive help for TaskMaster or specific subcommands.
```bash
# General TaskMaster help
claude-flow taskmaster help

# Help for specific subcommand
claude-flow taskmaster help generate
claude-flow taskmaster help export

# Also works with --help flag on any command
claude-flow taskmaster generate --help
```

## PRD Format Guidelines

TaskMaster works best with well-structured markdown PRDs.

### Recommended Structure

```markdown
# Project Name

## Overview
Brief project description and goals.

## Requirements
### Functional Requirements
- User authentication system
- Data management features
- API endpoints

### Non-Functional Requirements
- Performance: <2s page load
- Security: OAuth2 authentication
- Scalability: Support 10k users

## Technical Specifications
- Frontend: React/TypeScript
- Backend: Node.js/Express
- Database: PostgreSQL
- Infrastructure: AWS

## Timeline and Milestones
- Phase 1: Authentication (2 weeks)
- Phase 2: Core Features (4 weeks)
- Phase 3: Testing & Deployment (2 weeks)

## Acceptance Criteria
- All tests passing
- Performance benchmarks met
- Security audit completed
```

### Best Practices

1. **Clear Headings**: Use `##` for main sections, `###` for subsections
2. **Bullet Points**: Use `-` or `*` for lists
3. **Keywords**: Include priority indicators (critical, must-have, optional)
4. **Specificity**: Be specific about technical requirements
5. **Structure**: Maintain consistent section naming

## Task Generation Process

### 1. Document Analysis
TaskMaster analyzes the PRD to identify:
- Main sections and their types
- Feature lists and requirements
- Technical specifications
- Priority indicators

### 2. Task Creation
For each requirement, TaskMaster:
- Creates descriptive task titles
- Assigns appropriate task types
- Determines priority levels
- Maps to SPARC development modes

### 3. Task Hierarchy
Generated structure:
```
├── Architecture Design (always first)
├── Feature Implementation Tasks
│   ├── Core Features
│   └── Subtasks
├── Testing Tasks
└── Documentation Tasks
```

### 4. Task Output Format
```json
{
  "id": "task-001",
  "title": "Implement User Registration",
  "description": "Build registration form with email validation",
  "status": "pending",
  "priority": "high",
  "sparc_mode": "code",
  "parent_id": null,
  "subtasks": ["task-002", "task-003"],
  "dependencies": [],
  "metadata": {
    "source_section": "User Management",
    "complexity": "medium",
    "estimated_hours": 8,
    "ai_enhanced": false
  }
}
```

## SPARC Integration

TaskMaster automatically maps tasks to SPARC development phases based on content analysis:

| Task Content | SPARC Mode | Description |
|-------------|------------|-------------|
| Requirements, Goals | `spec-pseudocode` | Requirements analysis, planning |
| Architecture, Design | `architect` | System design and architecture |
| Algorithm, Logic | `spec-pseudocode` | Pseudocode and logic planning |
| General Implementation | `code` | Standard development tasks |
| API/Endpoints | `code` | API development |
| Database/Schema | `code` | Backend development |
| UI/Interface | `code` | Frontend development |
| Security/Auth | `security-review` | Security-focused tasks |
| Testing | `tdd` | Test-driven development |
| Documentation | `docs-writer` | Documentation creation |
| Integration | `integration` | System integration |

### Using SPARC with Generated Tasks

```bash
# 1. Generate tasks with SPARC mapping
claude-flow taskmaster generate app.prd --sparc-mapping

# 2. Execute SPARC mode for a task
claude-flow sparc run architect "Design system architecture"

# 3. Run TDD workflow
claude-flow sparc tdd "user authentication feature"
```

## AI Enhancement

When configured with an Anthropic API key, TaskMaster provides enhanced capabilities.

### Setup

1. **Get an API Key**
   - Sign up at [Anthropic Console](https://console.anthropic.com)
   - Create a new API key
   - Copy the key for use

2. **Configure the API Key**
   ```bash
   # Option A: Environment Variable (Recommended)
   export ANTHROPIC_API_KEY='sk-ant-...'
   
   # Option B: Command-line Flag
   claude-flow taskmaster generate prd.md --ai --api-key 'your-key'
   ```

3. **Verify Setup**
   ```bash
   claude-flow taskmaster ai-status
   ```

### Enhanced Features
- **Detailed Descriptions**: AI generates comprehensive task descriptions
- **Effort Estimation**: Predicts task complexity and time requirements
- **Smart SPARC Mapping**: AI suggests optimal development phases
- **Feature Extraction**: Identifies acceptance criteria and edge cases
- **Risk Analysis**: Highlights potential challenges

### AI Commands
```bash
# Check AI status
claude-flow taskmaster ai-status

# Analyze PRD with AI
claude-flow taskmaster analyze requirements.prd

# Generate with AI enhancement
claude-flow taskmaster generate requirements.prd \
  --ai \
  --detailed \
  --enhance \
  --sparc-mapping
```

### AI vs Non-AI Comparison

**Without AI (Default):**
- Rule-based parsing using markdown structure
- Keyword-based task generation
- Basic SPARC mode mapping
- Simple priority detection

Example output:
```
Task: **Must have**
Description: **Must have**
SPARC Mode: code
```

**With AI Enhancement:**
- Intelligent content understanding
- Context-aware task generation
- Smart SPARC mode selection
- Detailed task descriptions

Example output:
```
Task: Implement user authentication system
Description: Build a secure authentication system with email/password login, 
including password reset functionality, session management, and JWT token 
generation. Ensure OWASP compliance and implement rate limiting.
SPARC Mode: security-review
```

### Cost Considerations
The AI integration uses Claude 3 Haiku, which is cost-effective:
- ~$0.25 per million input tokens
- ~$1.25 per million output tokens
- Average PRD analysis: ~$0.001-0.005

## Template System

The template system allows for reusable task structures, though it's only partially implemented.

### Available Features
- Basic template structure defined
- Sample templates exist (web app, API service, mobile app)
- Template listing command works partially
- Workflow definitions exist but aren't functional

### Template Structure
```typescript
interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  variables: TemplateVariable[];
  tasks: TemplateTask[];
}
```

### Sample Templates
1. **Modern Web Application**
   - Category: Web Development
   - Features: Frontend, backend, database, authentication

2. **RESTful API Service**
   - Category: API Development
   - Features: REST endpoints, authentication, documentation

3. **Cross-Platform Mobile App**
   - Category: Mobile Development
   - Features: iOS/Android, backend integration

### Template Commands
```bash
# List templates (partially works)
claude-flow taskmaster templates list

# Note: Apply, import, export commands exist but are not functional
```

## VS Code Extension Integration

The [claude-task-master VS Code extension](https://github.com/iaminawe/claude-task-master-extension) provides visual task management.

### Setup

1. **Initialize Extension Support**
```bash
claude-flow taskmaster init
```

This creates:
```
.taskmaster/
├── tasks/
│   └── tasks.json      # Shared task storage
├── config/             # Configuration files
└── sparc/              # SPARC metadata
```

2. **Install VS Code Extension**
- Open VS Code/Cursor
- Go to Extensions (Ctrl+Shift+X)
- Search for "claude-task-master"
- Install and reload

### Visual Features
- **Task Tree View**: Hierarchical display in sidebar
- **Status Indicators**: Color-coded task states
- **Progress Tracking**: Visual progress bars
- **Context Menu**: Right-click actions

### Status Icons
- ⏳ **Todo**: Gray, pending tasks
- 🔄 **In Progress**: Blue, active work
- ✅ **Completed**: Green, finished tasks
- 🚫 **Blocked**: Red, blocked items

### Integration Commands
```bash
# Sync tasks (placeholder - not connected)
claude-flow taskmaster sync

# Watch for changes (not implemented)
claude-flow taskmaster watch

# Export from extension format
claude-flow taskmaster export --format markdown
```

**Note**: VS Code sync features exist in code but are NOT connected to CLI commands.

## Export Formats

### JSON (Default)
```json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Implement User Authentication",
      "description": "...",
      "status": "pending",
      "priority": "high"
    }
  ],
  "metadata": {
    "total_tasks": 15,
    "generated_at": "2024-01-01T10:00:00Z"
  }
}
```

### Markdown
```markdown
# Generated Tasks

## High Priority
- [ ] task-001: Implement User Authentication
  - Description: Build login and registration system
  - SPARC Mode: code
  - Estimated Hours: 8

## Medium Priority
- [ ] task-002: Create Product Catalog
```

### CSV
```csv
ID,Title,Description,Status,Priority,SPARC Mode,Parent ID
task-001,Implement User Authentication,Build login system,pending,high,code,
task-002,Create Product Catalog,Product listing,pending,medium,code,
```

## Memory Integration

TaskMaster uses Claude-Flow's memory system for persistence.

### Storage Namespaces
- `taskmaster_prds` - Stores parsed PRD documents
- `taskmaster_tasks` - Stores generated task lists

### Memory Commands
```bash
# View TaskMaster data
claude-flow memory query taskmaster

# Export TaskMaster memory
claude-flow memory export taskmaster-backup.json

# Check memory stats
claude-flow memory stats
```

## Examples & Workflows

### Basic Workflow
```bash
# 1. Create PRD
cat > app.prd << 'EOF'
# Task Management App

## Overview
Simple task management application.

## Requirements
- User accounts
- Create/edit/delete tasks
- Task categories
- Due dates

## Technical Stack
- Frontend: React
- Backend: Express
- Database: SQLite
EOF

# 2. Generate tasks
claude-flow taskmaster generate app.prd --sparc-mapping

# 3. Export for team
claude-flow taskmaster export --format markdown --output tasks.md
```

### AI-Enhanced Workflow
```bash
# 1. Set API key
export ANTHROPIC_API_KEY='sk-ant-...'

# 2. Analyze PRD first
claude-flow taskmaster analyze app.prd

# 3. Generate enhanced tasks
claude-flow taskmaster generate app.prd \
  --ai \
  --detailed \
  --enhance \
  --output enhanced-tasks.json

# 4. Review AI enhancements
cat enhanced-tasks.json | jq '.tasks[0]'
```

### Team Collaboration Workflow
```bash
# 1. Generate tasks
claude-flow taskmaster generate project.prd --sparc-mapping

# 2. Export for different uses
claude-flow taskmaster export --format markdown --output dev-tasks.md
claude-flow taskmaster export --format csv --output pm-timeline.csv
claude-flow taskmaster export --format json --output ci-tasks.json

# 3. Track progress
claude-flow taskmaster update task-001 in_progress
claude-flow taskmaster update task-002 completed
claude-flow taskmaster list
```

### Integration with SPARC Development
```bash
# 1. Generate SPARC-mapped tasks
claude-flow taskmaster generate app.prd --sparc-mapping

# 2. Execute architecture phase
claude-flow sparc run architect "Design task management system"

# 3. Implement with TDD
claude-flow sparc tdd "task CRUD operations"

# 4. Update task status
claude-flow taskmaster update task-001 completed
```

## Troubleshooting

### Common Issues

**No tasks generated:**
- Ensure PRD is valid markdown
- Check for proper section headers (`##`)
- Verify bullet points for requirements
- Try with `--verbose` for debugging

**AI features not working:**
- Verify `ANTHROPIC_API_KEY` is set
- Check API key validity with `ai-status`
- Ensure you have API credits
- Try without AI flags first

**Export not working:**
- Check output directory permissions
- Verify format is supported
- Try different export format

**VS Code extension issues:**
- Run `taskmaster init` first
- Check `.taskmaster/` directory exists
- Reload VS Code window
- Note: Sync features not implemented

**Template commands not working:**
- Template system is only partially implemented
- Only `templates list` shows basic functionality
- Apply, import, export commands are placeholders

### Debug Commands
```bash
# Verbose output
claude-flow taskmaster generate prd.md --verbose

# Check stored data
claude-flow memory query taskmaster

# Verify setup
claude-flow taskmaster info
```

### Error Messages

| Error | Solution |
|-------|----------|
| "PRD file path is required" | Provide path to PRD file |
| "Failed to parse PRD" | Check file exists and is valid markdown |
| "No requirements found" | Ensure PRD has sections with bullet points |
| "AI features require API key" | Set ANTHROPIC_API_KEY environment variable |
| "API Error 401" | Invalid API key - check in Anthropic Console |
| "API Error 429" | Rate limit exceeded - wait and retry |

## Current Limitations

### Core Limitations
1. **Markdown Only**: PRDs must be in markdown format
2. **Single AI Provider**: Only Anthropic Claude API supported
3. **No Real-time Sync**: VS Code integration incomplete
4. **Basic Templates**: Template system partially implemented
5. **No External Integrations**: No Jira, GitHub, Asana sync
6. **Limited Task Updates**: Only status can be updated

### What's NOT Working (Despite Code/Docs)
1. **Autonomous Features**: No decision-making capabilities
2. **Predictive Analytics**: No ML or forecasting
3. **Team Collaboration**: Single-user only
4. **Natural Language Interface**: No conversational commands
5. **Enterprise Features**: No multi-tenancy or RBAC
6. **Global Sync**: No distributed synchronization

### Code Structure Reality
The `/src/integrations/taskmaster/services/` directory contains files like:
- `autonomous-agents.ts` (1011 lines)
- `intent-based-interface.ts`
- `predictive-intelligence.ts`
- `ml-service.ts`
- `collaboration-service.ts`
- `analytics-service.ts`

**However**, these files are:
- Not imported or used in the actual CLI
- Not referenced in the main TaskMaster bridge
- Contain type definitions and placeholder implementations
- Not connected to any actual AI services

## TaskMaster-Swarm Integration Plan

### Overview
This section outlines the implementation plan to bridge TaskMaster's PRD-driven task generation with Claude-Flow's powerful swarm orchestration capabilities, enabling parallel execution of complex projects by multiple AI agents.

### Why This Integration Matters

1. **Automated Project Execution**: Convert PRDs directly into executable, parallelized workflows
2. **Intelligent Agent Assignment**: Match SPARC modes to specialized agent types
3. **Massive Parallelization**: Execute independent tasks concurrently
4. **Shared Context**: All agents access the same memory namespace
5. **Real-time Coordination**: Dependencies managed automatically

### Implementation Phases

#### Phase 1: Core Integration Infrastructure (Week 1)

**1.1 TaskMaster Execute Command**
```bash
# Execute single task
claude-flow taskmaster execute <task-id>

# Execute with specific agent type
claude-flow taskmaster execute <task-id> --agent-type developer
```

**1.2 SPARC Mode to Agent Mapping**
```typescript
// Automatic agent assignment based on SPARC mode
const SPARC_AGENT_MAP = {
  'architect': 'coordinator',
  'code': 'developer',
  'tdd': 'developer',
  'debug': 'analyzer',
  'security-review': 'analyzer',
  'docs-writer': 'researcher',
  'integration': 'coordinator',
  'devops': 'developer'
};
```

#### Phase 2: Swarm Integration (Week 2)

**2.1 TaskMaster Strategy**
```bash
# Execute all tasks from a PRD with swarm
claude-flow swarm --taskmaster --prd project.prd

# Execute from stored tasks
claude-flow swarm --taskmaster --from-memory
```

**2.2 Parallel Execution**
```bash
# Execute with parallel agents
claude-flow swarm --taskmaster --parallel --max-agents 10
```

#### Phase 3: Enhanced Coordination (Week 3)

**3.1 Dependency Management**
- Automatic task ordering based on dependencies
- Critical path optimization
- Resource allocation based on task priorities

**3.2 Status Synchronization**
- Real-time status updates between systems
- Progress tracking across all agents
- Failure recovery and task reassignment

#### Phase 4: Bulk Execution (Week 4)

**4.1 Execute All Command**
```bash
# Execute entire project
claude-flow taskmaster execute-all --prd-id <id>

# With swarm configuration
claude-flow taskmaster execute-all --swarm --parallel --review
```

**4.2 Progress Monitoring**
- Real-time dashboard showing all active tasks
- Agent utilization metrics
- Estimated completion time

#### Phase 5: Configuration & Optimization (Week 5)

**5.1 Configuration Options**
```json
{
  "integrations": {
    "taskmaster": {
      "enabled": true,
      "autoExecute": false,
      "defaultParallel": true,
      "sparcModeMapping": true,
      "maxConcurrentTasks": 10
    }
  }
}
```

### Example Workflows

#### Complete Project Execution
```bash
# 1. Generate tasks from PRD with SPARC mapping
claude-flow taskmaster generate project.prd --sparc-mapping --ai

# 2. Execute with swarm orchestration
claude-flow taskmaster execute-all --swarm --parallel --max-agents 10

# 3. Monitor progress
claude-flow swarm status --watch
```

#### Selective Execution
```bash
# Execute only high-priority tasks
claude-flow taskmaster execute-all --filter priority=high --swarm

# Execute specific SPARC phase
claude-flow taskmaster execute-all --filter sparc_mode=tdd --swarm
```

## Additional Claude-Flow Feature Integrations

### Memory System Deep Integration

**Current**: TaskMaster stores tasks in memory namespaces
**Enhancement**: Leverage memory for cross-task context sharing

```bash
# Share architectural decisions across all implementation tasks
claude-flow memory store arch_decisions "API will use REST with JWT auth"

# All code generation agents will have access to this context
claude-flow taskmaster execute-all --shared-memory-namespace project_x
```

### Workflow System Integration

**Current**: TaskMaster generates static task lists
**Enhancement**: Convert to dynamic Claude-Flow workflows

```bash
# Convert TaskMaster tasks to workflow
claude-flow taskmaster to-workflow --output project-workflow.json

# Execute as workflow with checkpoints
claude-flow workflow execute project-workflow.json --checkpoint
```

### SPARC Mode Chain Execution

**Current**: Tasks have single SPARC mode
**Enhancement**: Chain multiple SPARC modes per task

```bash
# Define SPARC chains for complex tasks
claude-flow taskmaster generate project.prd --sparc-chains

# Example chain: spec-pseudocode → architect → code → tdd
```

### Agent Capability Evolution

**Current**: Fixed agent types
**Enhancement**: Dynamic agent capability learning

```bash
# Agents learn from successful task completions
claude-flow agent train --from-taskmaster-history

# Improved agent selection based on past performance
claude-flow taskmaster execute-all --smart-agent-selection
```

### Multi-Project Coordination

**Current**: Single PRD/project focus
**Enhancement**: Cross-project dependency management

```bash
# Link projects with dependencies
claude-flow taskmaster link project-a.prd project-b.prd

# Execute with cross-project coordination
claude-flow swarm --multi-project --resolve-dependencies
```

### Real-time Collaboration Features

**Current**: Single-user execution
**Enhancement**: Team coordination capabilities

```bash
# Start collaboration server
claude-flow server start --enable-taskmaster

# Team members can claim tasks
claude-flow taskmaster claim task-001 --assignee @developer1

# Real-time status updates
claude-flow taskmaster watch --team
```

### Advanced Analytics Integration

**Current**: Basic task counts and status
**Enhancement**: Comprehensive project analytics

```bash
# Generate project insights
claude-flow taskmaster analytics --prd project.prd

# Predictive completion estimates
claude-flow taskmaster estimate --use-historical-data
```

### Template Evolution System

**Current**: Static templates (partially implemented)
**Enhancement**: Learning templates from successful projects

```bash
# Extract template from completed project
claude-flow taskmaster extract-template --from-completed project-x

# Apply evolved template to new project
claude-flow taskmaster generate new-project.prd --template evolved-web-app
```

## Future Features

These features are planned but NOT currently available:

### Near-term (Implementable)
- **TaskMaster-Swarm Bridge**: Execute TaskMaster tasks via swarm orchestration
- **SPARC Mode Mapping**: Automatic agent assignment based on task type
- **Parallel Execution**: Multiple agents working on independent tasks
- **Memory Integration**: Shared context across all agents
- **Workflow Conversion**: Transform task lists into executable workflows
- **Progress Monitoring**: Real-time dashboards for multi-agent execution
- Complete VS Code sync integration
- Multiple AI provider support
- Template system completion
- Task dependency visualization
- Effort estimation improvements
- Better task update capabilities

### Long-term Vision (Conceptual)
- **Cross-Project Orchestration**: Manage dependencies across multiple PRDs
- **Agent Learning**: Improve agent selection based on performance
- **Team Collaboration**: Multi-user task assignment and tracking
- **Advanced Analytics**: Predictive project completion estimates
- **Template Evolution**: Learn from successful project patterns
- Autonomous project management
- Predictive analytics
- Natural language interface
- External platform integrations
- Real-time team collaboration
- Self-improvement capabilities
- Machine learning platform
- Enterprise features

## Best Practices

1. **PRD Quality**: Well-structured PRDs produce better tasks
2. **Use SPARC Mapping**: Leverage automatic development phase assignment
3. **Start Simple**: Try without AI first to understand base functionality
4. **Regular Exports**: Export important task data regularly
5. **Memory Backups**: Periodically backup TaskMaster memory
6. **Realistic Expectations**: Focus on actual capabilities, not future promises
7. **AI Usage**: Use AI enhancement for complex PRDs that need detailed breakdowns
8. **Cost Management**: Monitor Anthropic API usage if using AI features

## Summary

TaskMaster is a practical tool for converting PRDs into structured tasks with SPARC mapping. While it lacks the advanced AI autonomy described in some documentation, it provides real value for:

- Parsing markdown PRDs into structured data
- Generating hierarchical task structures
- Mapping tasks to SPARC development phases
- Enhancing tasks with AI when configured with Anthropic API
- Exporting tasks in multiple formats for team use
- Storing tasks persistently in memory

The gap between documentation claims and reality is significant. Focus on these core capabilities for the best experience with TaskMaster.

## Related Documentation

- [SPARC Methodology Guide](./06-sparc-integration.md)
- [Memory System Guide](./11-memory-system.md)
- [Claude-Flow Architecture](./02-architecture.md)

---

For issues or questions, visit: https://github.com/ruvnet/claude-code-flow/issues