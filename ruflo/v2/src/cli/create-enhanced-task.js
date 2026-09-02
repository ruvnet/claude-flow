/**
 * Creates an enhanced task prompt with Claude-Flow guidance
 * @param {string} task - The original task description
 * @param {Object} flags - Command flags/options
 * @param {string} instanceId - Unique instance identifier
 * @param {string} tools - Comma-separated list of available tools
 * @returns {string} Enhanced task prompt
 */
export function createEnhancedTask(task, flags, instanceId, tools) {
  let enhancedTask = `# Claude-Flow Enhanced Task

## Your Task
${task}

## Claude-Flow System Context

You are running within the Claude-Flow orchestration system, which provides powerful features for complex task management.

### Configuration
- Instance ID: ${instanceId}
- Mode: ${flags.mode || 'full'}
- Coverage Target: ${flags.coverage || 80}%
- Commit Strategy: ${flags.commit || 'phase'}
${flags.config ? `- MCP Config: ${flags.config}` : ''}

### Available Features

1. **Memory Bank** (Always Available)
   - Store data: \`npx claude-flow memory store <key> "<value>"\` - Save important data, findings, or progress
   - Retrieve data: \`npx claude-flow memory query <key>\` - Access previously stored information
   - Export memory: \`npx claude-flow memory export <file>\` - Export memory to file
   - Import memory: \`npx claude-flow memory import <file>\` - Import memory from file
   - Memory stats: \`npx claude-flow memory stats\` - Show memory usage statistics

2. **System Management**
   - Check status: \`npx claude-flow status\` - View current system/task status
   - Monitor system: \`npx claude-flow monitor\` - Real-time system monitoring
   - List agents: \`npx claude-flow agent list\` - See active agents
   - List tasks: \`npx claude-flow task list\` - See active tasks

3. **Tool Access**
   - You have access to these tools: ${tools}
   ${flags.tools ? `- Custom tools specified: ${flags.tools}` : ''}`;

  if (flags.parallel) {
    enhancedTask += `
   - **Parallel Execution Enabled**: Use \`npx claude-flow agent spawn <type> --name <name>\` to spawn sub-agents
   - Create tasks: \`npx claude-flow task create <type> "<description>"\`
   - Assign tasks: \`npx claude-flow task assign <task-id> <agent-id>\`
   - Break down complex tasks and delegate to specialized agents`;
  }

  if (flags.research) {
    enhancedTask += `
   - **Research Mode**: Use \`WebFetchTool\` for web research and information gathering`;
  }

  enhancedTask += `

### Workflow Guidelines

1. **Before Starting**:
   - Check memory: \`npx claude-flow memory query previous_work\`
   - Check memory stats: \`npx claude-flow memory stats\`
   - Check system status: \`npx claude-flow status\`
   - List active agents: \`npx claude-flow agent list\`
   - List active tasks: \`npx claude-flow task list\`
   ${flags.mode === 'backend-only' ? '- Focus on backend implementation without frontend concerns' : ''}
   ${flags.mode === 'frontend-only' ? '- Focus on frontend implementation without backend concerns' : ''}
   ${flags.mode === 'api-only' ? '- Focus on API design and implementation' : ''}

2. **During Execution**:
   - Store findings: \`npx claude-flow memory store findings "your data here"\`
   - Save checkpoints: \`npx claude-flow memory store progress_${task.replace(/\s+/g, '_')} "current status"\`
   ${flags.parallel ? '- Spawn agents: `npx claude-flow agent spawn researcher --name "research-agent"`' : ''}
   ${flags.parallel ? '- Create tasks: `npx claude-flow task create implementation "implement feature X"`' : ''}
   ${flags.parallel ? '- Assign tasks: `npx claude-flow task assign <task-id> <agent-id>`' : ''}
   ${flags.coverage ? `- Ensure test coverage meets ${flags.coverage}% target` : ''}
   ${flags.commit === 'phase' ? '- Commit changes after completing each major phase' : ''}
   ${flags.commit === 'feature' ? '- Commit changes after each feature is complete' : ''}
   ${flags.commit === 'manual' ? '- Only commit when explicitly requested' : ''}

3. **Best Practices**:
   - Use the Bash tool to run \`npx claude-flow\` commands
   - Store data as JSON strings for complex structures
   - Query memory before starting to check for existing work
   - Use descriptive keys for memory storage
   - Monitor progress: \`npx claude-flow monitor\`
   ${flags.parallel ? '- Coordinate with other agents through shared memory' : ''}
   ${flags.research ? '- Store research findings: `npx claude-flow memory store research_findings "data"`' : ''}
   ${flags.noPermissions ? '- Running with --no-permissions, all operations will execute without prompts' : ''}
   ${flags.verbose ? '- Verbose mode enabled, provide detailed output and explanations' : ''}

## Example Commands

To interact with Claude-Flow, use the Bash tool:

\`\`\`bash
# Memory Operations
Bash("npx claude-flow memory query previous_work")
Bash("npx claude-flow memory store task_analysis '{\\"status\\": \\"completed\\", \\"findings\\": [...]}'")
Bash("npx claude-flow memory stats")
Bash("npx claude-flow memory export backup.json")

# System Management
Bash("npx claude-flow status")
Bash("npx claude-flow monitor")  # Real-time monitoring
Bash("npx claude-flow agent list")
Bash("npx claude-flow task list --verbose")
${
  flags.parallel
    ? `
# Parallel Execution (enabled for this instance)
Bash("npx claude-flow agent spawn researcher --name research-bot")
Bash("npx claude-flow agent spawn coder --name code-bot")
Bash("npx claude-flow task create research 'Analyze best practices'")
Bash("npx claude-flow task create implementation 'Implement auth module'")
Bash("npx claude-flow task assign task-123 agent-456")`
    : ''
}
${
  flags.research
    ? `
# Research Operations (research mode enabled)
# Use WebFetchTool for web research, then store findings
Bash("npx claude-flow memory store web_research_urls '[\\"url1\\", \\"url2\\"]'")
Bash("npx claude-flow memory store research_summary 'Key findings from research...'")`
    : ''
}

# Configuration Management
Bash("npx claude-flow config show")
Bash("npx claude-flow config get orchestrator.maxConcurrentTasks")
Bash("npx claude-flow config set orchestrator.maxConcurrentTasks 20")

# Workflow Execution
Bash("npx claude-flow workflow examples/development-config.json")
Bash("npx claude-flow workflow examples/research-workflow.json --async")
\`\`\`

## Mode-Specific Guidelines
${
  flags.mode === 'backend-only'
    ? `
### Backend-Only Mode
- Focus exclusively on server-side implementation
- Prioritize API design, database schemas, and business logic
- Ignore frontend/UI considerations
- Test coverage should emphasize unit and integration tests`
    : ''
}
${
  flags.mode === 'frontend-only'
    ? `
### Frontend-Only Mode
- Focus exclusively on client-side implementation
- Prioritize UI/UX, component design, and user interactions
- Assume backend APIs are already available
- Test coverage should emphasize component and E2E tests`
    : ''
}
${
  flags.mode === 'api-only'
    ? `
### API-Only Mode
- Focus exclusively on API design and implementation
- Prioritize RESTful principles, documentation, and contracts
- Include comprehensive API documentation
- Test coverage should emphasize API endpoint testing`
    : ''
}
${
  flags.mode === 'full' || !flags.mode
    ? `
### Full Stack Mode (Default)
- Consider both frontend and backend requirements
- Ensure proper integration between all layers
- Balance test coverage across all components
- Document both API contracts and user interfaces`
    : ''
}

## Commit Strategy
${flags.commit === 'phase' ? `- **Phase Commits**: Commit after completing major phases (planning, implementation, testing)` : ''}
${flags.commit === 'feature' ? `- **Feature Commits**: Commit after each feature or module is complete` : ''}
${flags.commit === 'manual' ? `- **Manual Commits**: Only commit when explicitly requested by the user` : ''}
${!flags.commit ? `- **Default (Phase)**: Commit after completing major phases` : ''}

## Additional Guidelines
${
  flags.noPermissions
    ? `
### No-Permissions Mode
- All file operations will execute without confirmation prompts
- Be extra careful with destructive operations
- Ensure all changes are intentional and well-tested`
    : ''
}
${
  flags.verbose
    ? `
### Verbose Mode
- Provide detailed explanations for all actions
- Include reasoning behind technical decisions
- Show intermediate steps and thought processes
- Log all command outputs comprehensively`
    : ''
}

Now, please proceed with the task: ${task}`;

  return enhancedTask;
}
