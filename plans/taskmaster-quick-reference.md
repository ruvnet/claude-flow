# Claude Task Master Integration - Quick Reference

## Key Benefits for Claude-Flow

### 1. **AI-Powered Task Generation**
- Automatically generate tasks from Product Requirements Documents (PRDs)
- Leverage multiple AI models (Claude, GPT-4, Gemini) for diverse perspectives
- Reduce planning time from hours to minutes

### 2. **Enhanced Project Continuity**
- `.taskmaster` directory maintains persistent task state
- Clear "next task" identification for seamless work resumption
- Historical context preserved across sessions
- No more "where did I leave off?" moments

### 3. **Improved Task Visibility**
- Unified dashboard showing all tasks and their status
- PRD ↔ Task traceability
- Real-time progress tracking
- Dependency visualization

### 4. **Intelligent Task Management**
- Model selection based on task type (architecture → Claude, creative → GPT-4)
- Automatic task distribution to appropriate agents
- Learning system improves estimates over time
- Context-aware task recommendations

## Quick Integration Steps

### 1. Basic Setup (Day 1)
```bash
# Add to claude-flow
npm install @claude-flow/taskmaster

# Initialize in project
claude-flow taskmaster init

# Create PRD
echo "Build a REST API for user management with authentication" > .taskmaster/docs/prd.txt

# Generate tasks
claude-flow task:generate-from-prd .taskmaster/docs/prd.txt --model claude
```

### 2. Import Existing Task Master Project
```bash
# If you have an existing .taskmaster directory
claude-flow task:import-taskmaster /path/to/project/.taskmaster

# Tasks are automatically converted and available
claude-flow task list
```

### 3. Continuous Workflow
```bash
# Get next task with context
claude-flow task:next

# Work on task
claude-flow task start <task-id>

# Complete task
claude-flow task complete <task-id>

# Get next recommendation
claude-flow task:next --smart
```

## Integration Architecture Summary

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   PRD Input     │────▶│  Task Generator  │────▶│  Claude-Flow    │
│ (.taskmaster)   │     │  (Multi-Model)   │     │    Tasks        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                         │
                                ▼                         ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │ Model Selector   │     │ Task Orchestrator│
                        │ (AI Choice)      │     │ (Dependencies)   │
                        └──────────────────┘     └─────────────────┘
                                │                         │
                                ▼                         ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │ Task Storage     │◀───▶│ Memory System   │
                        │ (.taskmaster)    │     │ (Persistence)   │
                        └──────────────────┘     └─────────────────┘
```

## Example Workflow

### Starting a New Project
```bash
# 1. Create PRD
cat > .taskmaster/docs/prd.txt << EOF
E-commerce Platform Requirements:
- User registration and authentication
- Product catalog with search
- Shopping cart functionality
- Order processing
- Payment integration
EOF

# 2. Generate tasks
claude-flow task:generate-from-prd .taskmaster/docs/prd.txt \
  --model claude \
  --depth detailed

# 3. View generated tasks
claude-flow task list --tree

# 4. Start development
claude-flow task:next
# Output: "Recommended: Design authentication system architecture"

# 5. Use SPARC mode for implementation
claude-flow sparc run architect "Design authentication system"
```

### Resuming Work
```bash
# 1. Check where you left off
claude-flow task:status

# 2. Get context-aware next task
claude-flow task:next --with-context
# Output: "Continue with: Implement JWT token generation (depends on: auth-design)"

# 3. View task details
claude-flow task:show <task-id>

# 4. Resume work
claude-flow task:resume <task-id>
```

## Configuration Example

`.claude-flow/taskmaster-config.json`:
```json
{
  "taskmaster": {
    "enabled": true,
    "defaultModel": "claude",
    "autoSync": true,
    "generateSubtasks": true,
    "contextWindow": 3,
    "models": {
      "claude": {
        "tasks": ["architecture", "implementation", "review"]
      },
      "gpt4": {
        "tasks": ["creative", "documentation", "brainstorming"]
      },
      "gemini": {
        "tasks": ["analysis", "optimization", "data"]
      }
    }
  }
}
```

## Why This Integration Matters

1. **Faster Development**: Spend less time planning, more time building
2. **Better Continuity**: Never lose context between sessions
3. **Smarter Planning**: AI helps break down complex requirements
4. **Improved Visibility**: Always know what needs to be done
5. **Learning System**: Gets better at estimating and planning over time

## Next Steps

1. Review the full analysis: `claude-task-master-integration-analysis.md`
2. Check implementation details: `claude-task-master-implementation-plan.md`
3. Start with basic integration and expand based on needs
4. Contribute to the integration development

The combination of Task Master's AI-driven task generation with Claude-Flow's sophisticated orchestration creates a powerful development environment that maintains context, improves planning, and accelerates delivery.