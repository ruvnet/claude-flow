# Claude Code Configuration

## Build Commands
- `npm run build`: Build the project using Deno compile
- `npm run test`: Run the full test suite
- `npm run lint`: Run ESLint and format checks
- `npm run typecheck`: Run TypeScript type checking
- `npx claude-flow start`: Start the orchestration system
- `npx claude-flow --help`: Show all available commands

## Code Style Preferences
- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (e.g., `import { foo } from 'bar'`)
- Use TypeScript for all new code
- Follow existing naming conventions (camelCase for variables, PascalCase for classes)
- Add JSDoc comments for public APIs
- Use async/await instead of Promise chains
- Prefer const/let over var

## Workflow Guidelines
- Always run typecheck after making code changes
- Run tests before committing changes
- Use meaningful commit messages following conventional commits
- Create feature branches for new functionality
- Ensure all tests pass before merging

## Project Architecture
This is a Claude-Flow AI agent orchestration system with the following components:
- **CLI Interface**: Command-line tools for managing the system
- **Orchestrator**: Core engine for coordinating agents and tasks
- **Memory System**: Persistent storage and retrieval of information
- **Terminal Management**: Automated terminal session handling
- **MCP Integration**: Model Context Protocol server for Claude integration
- **Agent Coordination**: Multi-agent task distribution and management

## Important Notes
- Use `claude --dangerously-skip-permissions` for unattended operation
- The system supports both daemon and interactive modes
- Memory persistence is handled automatically
- All components are event-driven for scalability

## Debugging
- Check logs in `./claude-flow.log`
- Use `npx claude-flow status` to check system health
- Monitor with `npx claude-flow monitor` for real-time updates
- Verbose output available with `--verbose` flag on most commands

## Claude Flow CLI Commands

### Swarm Management
- `npx claude-flow swarm "task"`: Create and execute an agent swarm
- `npx claude-flow swarm --mode distributed`: Use distributed execution
- `npx claude-flow swarm --max-agents 10`: Limit agent count
- `npx claude-flow swarm --monitor`: Enable real-time monitoring

### Agent Operations
- `npx claude-flow agent list`: List all active agents
- `npx claude-flow agent spawn <type>`: Spawn a specific agent type
- `npx claude-flow agent metrics <id>`: View agent performance metrics
- `npx claude-flow agent stop <id>`: Stop a specific agent

### Memory Management
- `npx claude-flow memory store <key> <value>`: Store data in memory
- `npx claude-flow memory get <key>`: Retrieve data from memory
- `npx claude-flow memory list`: List all memory keys
- `npx claude-flow memory clear`: Clear all memory (use with caution)

### GitHub Integration
- `npx claude-flow github issues`: Manage GitHub issues
- `npx claude-flow github pr`: Handle pull requests
- `npx claude-flow github release`: Coordinate releases
- `npx claude-flow github analyze`: Analyze repository

### Performance Monitoring
- `npx claude-flow monitor`: Real-time system monitoring
- `npx claude-flow status`: Current system status
- `npx claude-flow metrics`: Performance metrics
- `npx claude-flow analyze bottlenecks`: Find performance issues

### Task Management
- `npx claude-flow task create <description>`: Create a new task
- `npx claude-flow task list`: List all tasks
- `npx claude-flow task status <id>`: Check task status
- `npx claude-flow task results <id>`: Get task results

### MCP Server
- `npx claude-flow mcp start`: Start MCP server
- `npx claude-flow mcp status`: Check MCP server status
- `npx claude-flow mcp stop`: Stop MCP server
- `npx claude-flow mcp logs`: View MCP server logs

## MCP Tool Usage in Claude Code

Once the MCP server is connected to Claude Code, you can use these tools:

### Coordination Tools
- `mcp__claude-flow__swarm_init`: Initialize a swarm with topology
- `mcp__claude-flow__agent_spawn`: Create specialized agents
- `mcp__claude-flow__task_orchestrate`: Orchestrate complex tasks

### Memory Tools
- `mcp__claude-flow__memory_usage`: Store/retrieve persistent data
- `mcp__claude-flow__memory_search`: Search memory patterns
- `mcp__claude-flow__memory_persist`: Cross-session persistence

### Performance Tools
- `mcp__claude-flow__performance_report`: Generate performance reports
- `mcp__claude-flow__bottleneck_analyze`: Find bottlenecks
- `mcp__claude-flow__token_usage`: Analyze token consumption

### GitHub Tools
- `mcp__claude-flow__github_repo_analyze`: Repository analysis
- `mcp__claude-flow__github_pr_manage`: PR management
- `mcp__claude-flow__github_issue_track`: Issue tracking

## Best Practices

### 1. Always Use Batch Operations
When performing multiple operations, batch them in a single message:
```javascript
// CORRECT - Single message with multiple operations
[BatchTool]:
  mcp__claude-flow__swarm_init { topology: "mesh", maxAgents: 5 }
  mcp__claude-flow__agent_spawn { type: "researcher" }
  mcp__claude-flow__agent_spawn { type: "coder" }
  mcp__claude-flow__task_orchestrate { task: "implement feature" }
  TodoWrite { todos: [...] }
```

### 2. Memory for Context
Always store important context in memory:
```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  key: "project/decisions/architecture",
  value: { decision: "microservices", rationale: "..." }
}
```

### 3. Monitor Performance
Regularly check system health:
```bash
npx claude-flow monitor --interval 5s
npx claude-flow metrics --export performance.json
```

### 4. GitHub Integration
Use GitHub tools for repository management:
```bash
# Analyze issues and create action plan
npx claude-flow github issues analyze --repo owner/name
npx claude-flow github issues triage --auto-label
```

## Hooks Configuration

Claude Flow supports automated hooks in `.claude/settings.json`:

### Pre-Operation Hooks
- Auto-assign agents based on file type
- Validate commands before execution
- Load context from memory

### Post-Operation Hooks
- Format code automatically
- Update memory with results
- Track performance metrics

### Example Hook Configuration
```json
{
  "hooks": {
    "onEdit": ["npx claude-flow hook post-edit --file {file}"],
    "onTask": ["npx claude-flow hook pre-task --description {task}"],
    "onSessionEnd": ["npx claude-flow hook session-end --summary"]
  }
}
```

## Environment Variables

- `CLAUDE_FLOW_MCP_PORT`: MCP server port (default: 3000)
- `CLAUDE_FLOW_LOG_LEVEL`: Logging level (debug, info, warn, error)
- `CLAUDE_FLOW_MEMORY_PATH`: Custom memory storage path
- `CLAUDE_FLOW_MAX_AGENTS`: Maximum concurrent agents
- `CLAUDE_FLOW_GITHUB_TOKEN`: GitHub API token for integrations

## Troubleshooting

### Common Issues

1. **MCP Connection Failed**
   - Check if MCP server is running: `npx claude-flow mcp status`
   - Verify port availability: `lsof -i :3000`
   - Restart server: `npx claude-flow mcp restart`

2. **Agent Spawn Failures**
   - Check agent limits: `npx claude-flow config get max-agents`
   - View agent logs: `npx claude-flow agent logs <id>`
   - Clear stuck agents: `npx claude-flow agent cleanup`

3. **Memory Issues**
   - Check memory usage: `npx claude-flow memory stats`
   - Compact memory: `npx claude-flow memory compact`
   - Export/backup: `npx claude-flow memory export backup.json`

4. **Performance Problems**
   - Run diagnostics: `npx claude-flow diagnose`
   - Check bottlenecks: `npx claude-flow analyze bottlenecks`
   - View metrics: `npx claude-flow metrics --detailed`

## Quick Start Examples

### 1. Simple Task Execution
```bash
npx claude-flow swarm "refactor authentication module" --max-agents 5
```

### 2. GitHub Issue Management
```bash
npx claude-flow github issues create --title "Bug: Login fails" --label bug
npx claude-flow github issues assign 123 --to @username
```

### 3. Performance Analysis
```bash
npx claude-flow analyze performance --last 24h --export report.html
```

### 4. Memory-Driven Development
```bash
npx claude-flow memory store project/context "e-commerce platform"
npx claude-flow swarm "implement shopping cart" --use-memory project/context
```

---

Remember: Claude Flow is an orchestration layer that coordinates Claude Code's actions. The MCP tools handle coordination, memory, and monitoring while Claude Code performs all actual implementation work.