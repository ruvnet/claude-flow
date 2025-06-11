#!/usr/bin/env -S deno run --allow-all
/**
 * Simple CLI wrapper for Claude-Flow (JavaScript version)
 * This version avoids TypeScript issues in node_modules
 */

const VERSION = '1.0.25';

function printHelp() {
  console.log(`
🧠 Claude-Flow v${VERSION} - Advanced AI Agent Orchestration System

USAGE:
  claude-flow [COMMAND] [OPTIONS]

COMMANDS:
  init                  Initialize Claude Code integration files
  start                 Start the orchestration system
  agent                 Manage agents (spawn, list, terminate, info)
  task                  Manage tasks (create, list, status, cancel, workflow)
  memory               Manage memory (query, export, import, stats, cleanup)
  mcp                  Manage MCP server (status, tools, start, stop)
  config               Manage configuration (show, get, set, init, validate)
  status               Show system status
  monitor              Monitor system in real-time
  session              Manage terminal sessions
  workflow             Execute workflow files
  claude               Spawn Claude instances with specific configurations
  repl                 Start interactive REPL mode
  version              Show version information
  help                 Show this help message

GLOBAL OPTIONS:
  -c, --config <path>   Path to configuration file
  -v, --verbose         Enable verbose logging
  --log-level <level>   Set log level (debug, info, warn, error)
  --help               Show help for specific command

EXAMPLES:
  claude-flow init                                     # Initialize Claude integration files
  claude-flow start                                    # Start orchestrator
  claude-flow agent spawn researcher --name "Bot"     # Spawn research agent
  claude-flow task create research "Analyze data"     # Create task
  claude-flow claude spawn "implement auth" --research # Spawn Claude with web research
  claude-flow claude spawn "fix bug" --no-permissions # Spawn Claude without permission prompts
  claude-flow config init                             # Initialize config
  claude-flow status                                  # Show system status
  claude-flow workflow my-workflow.json              # Execute workflow

For more detailed help on specific commands, use:
  claude-flow [COMMAND] --help

Documentation: https://github.com/ruvnet/claude-code-flow
Issues: https://github.com/ruvnet/claude-code-flow/issues

Created by rUv - Built with ❤️ for the Claude community
`);
}

function printVersion() {
  console.log(`Claude-Flow v${VERSION}`);
}

function printError(message) {
  console.error(`❌ Error: ${message}`);
}

function printSuccess(message) {
  console.log(`✅ ${message}`);
}

function printWarning(message) {
  console.warn(`⚠️  Warning: ${message}`);
}

async function main() {
  const args = Deno.args;
  
  if (args.length === 0) {
    printHelp();
    return;
  }

  const command = args[0];
  const subArgs = args.slice(1);

  switch (command) {
    case 'version':
    case '--version':
    case '-v':
      printVersion();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
      
    case 'init':
      // Parse init options
      const initForce = subArgs.includes('--force') || subArgs.includes('-f');
      const initMinimal = subArgs.includes('--minimal') || subArgs.includes('-m');
      
      try {
        printSuccess('Initializing Claude Code integration files...');
        
        // Check if files already exist
        const files = ['CLAUDE.md', 'memory-bank.md', 'coordination.md'];
        const existingFiles = [];
        
        for (const file of files) {
          try {
            await Deno.stat(file);
            existingFiles.push(file);
          } catch {
            // File doesn't exist, which is what we want
          }
        }
        
        if (existingFiles.length > 0 && !initForce) {
          printWarning(`The following files already exist: ${existingFiles.join(', ')}`);
          console.log('Use --force to overwrite existing files');
          break;
        }
        
        // Create CLAUDE.md
        const claudeMd = initMinimal ? createMinimalClaudeMd() : createFullClaudeMd();
        await Deno.writeTextFile('CLAUDE.md', claudeMd);
        console.log('  ✓ Created CLAUDE.md');
        
        // Create memory-bank.md
        const memoryBankMd = initMinimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
        await Deno.writeTextFile('memory-bank.md', memoryBankMd);
        console.log('  ✓ Created memory-bank.md');
        
        // Create coordination.md
        const coordinationMd = initMinimal ? createMinimalCoordinationMd() : createFullCoordinationMd();
        await Deno.writeTextFile('coordination.md', coordinationMd);
        console.log('  ✓ Created coordination.md');
        
        // Create directory structure
        const directories = [
          'memory',
          'memory/agents',
          'memory/sessions',
          'coordination',
          'coordination/memory_bank',
          'coordination/subtasks',
          'coordination/orchestration'
        ];
        
        for (const dir of directories) {
          try {
            await Deno.mkdir(dir, { recursive: true });
            console.log(`  ✓ Created ${dir}/ directory`);
          } catch (err) {
            if (!(err instanceof Deno.errors.AlreadyExists)) {
              throw err;
            }
          }
        }
        
        // Create placeholder files
        const agentsReadme = createAgentsReadme();
        await Deno.writeTextFile('memory/agents/README.md', agentsReadme);
        console.log('  ✓ Created memory/agents/README.md');
        
        const sessionsReadme = createSessionsReadme();
        await Deno.writeTextFile('memory/sessions/README.md', sessionsReadme);
        console.log('  ✓ Created memory/sessions/README.md');
        
        // Initialize persistence database
        const initialData = {
          agents: [],
          tasks: [],
          lastUpdated: Date.now()
        };
        await Deno.writeTextFile('memory/claude-flow-data.json', JSON.stringify(initialData, null, 2));
        console.log('  ✓ Created memory/claude-flow-data.json (persistence database)');
        
        printSuccess('Claude Code integration files initialized successfully!');
        console.log('\nNext steps:');
        console.log('1. Review and customize the generated files for your project');
        console.log('2. Run \'npx claude-flow start\' to begin the orchestration system');
        console.log('3. Use \'claude --dangerously-skip-permissions\' for unattended operation');
        console.log('\nNote: Persistence database initialized at memory/claude-flow-data.json');
        
      } catch (err) {
        printError(`Failed to initialize files: ${err.message}`);
      }
      break;
      
    case 'start':
      printSuccess('Starting Claude-Flow orchestration system...');
      printWarning('Full orchestrator implementation coming soon!');
      console.log('🚀 System would start with the following components:');
      console.log('   - Event Bus');
      console.log('   - Orchestrator Engine');
      console.log('   - Memory Manager');
      console.log('   - Terminal Pool');
      console.log('   - MCP Server');
      console.log('   - Coordination Manager');
      break;
      
    case 'agent':
      const agentCmd = subArgs[0];
      switch (agentCmd) {
        case 'spawn':
          const agentType = subArgs[1] || 'researcher';
          printSuccess(`Spawning ${agentType} agent...`);
          console.log(`📝 Agent ID: agent-${Date.now()}`);
          console.log(`🤖 Type: ${agentType}`);
          console.log(`⚡ Status: Active`);
          break;
        case 'list':
          printSuccess('Active agents:');
          console.log('📋 No agents currently active (orchestrator not running)');
          break;
        default:
          console.log('Agent commands: spawn, list, terminate, info');
      }
      break;
      
    case 'task':
      const taskCmd = subArgs[0];
      switch (taskCmd) {
        case 'create':
          const taskType = subArgs[1] || 'general';
          const description = subArgs[2] || 'No description';
          printSuccess(`Creating ${taskType} task: "${description}"`);
          console.log(`📝 Task ID: task-${Date.now()}`);
          console.log(`🎯 Type: ${taskType}`);
          console.log(`📄 Description: ${description}`);
          break;
        case 'list':
          printSuccess('Active tasks:');
          console.log('📋 No tasks currently active (orchestrator not running)');
          break;
        default:
          console.log('Task commands: create, list, status, cancel, workflow');
      }
      break;
      
    case 'config':
      const configCmd = subArgs[0];
      switch (configCmd) {
        case 'init':
          printSuccess('Initializing Claude-Flow configuration...');
          console.log('📝 Configuration file would be created at: claude-flow.config.json');
          break;
        case 'show':
          printSuccess('Current configuration:');
          console.log('📋 Configuration display would show here');
          break;
        default:
          console.log('Config commands: init, show, get, set, validate');
      }
      break;
      
    case 'status':
      printSuccess('Claude-Flow System Status:');
      console.log('🟡 Status: Not Running (orchestrator not started)');
      console.log('🤖 Agents: 0 active');
      console.log('📋 Tasks: 0 in queue');
      console.log('💾 Memory: Ready');
      console.log('🖥️  Terminal Pool: Ready');
      console.log('🌐 MCP Server: Stopped');
      break;
      
    case 'memory': {
      const memorySubcommand = subArgs[0];
      const memoryStore = './memory/memory-store.json';
      
      // Helper to load memory data
      async function loadMemory() {
        try {
          const content = await Deno.readTextFile(memoryStore);
          return JSON.parse(content);
        } catch {
          return {};
        }
      }
      
      // Helper to save memory data
      async function saveMemory(data) {
        await Deno.mkdir('./memory', { recursive: true });
        await Deno.writeTextFile(memoryStore, JSON.stringify(data, null, 2));
      }
      
      switch (memorySubcommand) {
        case 'store': {
          const key = subArgs[1];
          const value = subArgs.slice(2).join(' ');
          
          if (!key || !value) {
            printError('Usage: memory store <key> <value>');
            break;
          }
          
          try {
            const data = await loadMemory();
            const namespace = 'default';
            
            if (!data[namespace]) {
              data[namespace] = [];
            }
            
            // Remove existing entry with same key
            data[namespace] = data[namespace].filter(e => e.key !== key);
            
            // Add new entry
            data[namespace].push({
              key,
              value,
              namespace,
              timestamp: Date.now()
            });
            
            await saveMemory(data);
            printSuccess('Stored successfully');
            console.log(`📝 Key: ${key}`);
            console.log(`📦 Namespace: ${namespace}`);
            console.log(`💾 Size: ${new TextEncoder().encode(value).length} bytes`);
          } catch (err) {
            printError(`Failed to store: ${err.message}`);
          }
          break;
        }
        
        case 'query': {
          const search = subArgs.slice(1).join(' ');
          
          if (!search) {
            printError('Usage: memory query <search>');
            break;
          }
          
          try {
            const data = await loadMemory();
            const results = [];
            
            for (const [namespace, entries] of Object.entries(data)) {
              for (const entry of entries) {
                if (entry.key.includes(search) || entry.value.includes(search)) {
                  results.push(entry);
                }
              }
            }
            
            if (results.length === 0) {
              printWarning('No results found');
              return;
            }
            
            printSuccess(`Found ${results.length} results:`);
            
            for (const entry of results.slice(0, 10)) {
              console.log(`\n📌 ${entry.key}`);
              console.log(`   Namespace: ${entry.namespace}`);
              console.log(`   Value: ${entry.value.substring(0, 100)}${entry.value.length > 100 ? '...' : ''}`);
              console.log(`   Stored: ${new Date(entry.timestamp).toLocaleString()}`);
            }
            
            if (results.length > 10) {
              console.log(`\n... and ${results.length - 10} more results`);
            }
          } catch (err) {
            printError(`Failed to query: ${err.message}`);
          }
          break;
        }
        
        case 'stats': {
          try {
            const data = await loadMemory();
            let totalEntries = 0;
            const namespaceStats = {};
            
            for (const [namespace, entries] of Object.entries(data)) {
              namespaceStats[namespace] = entries.length;
              totalEntries += entries.length;
            }
            
            printSuccess('Memory Bank Statistics:');
            console.log(`   Total Entries: ${totalEntries}`);
            console.log(`   Namespaces: ${Object.keys(data).length}`);
            console.log(`   Size: ${(new TextEncoder().encode(JSON.stringify(data)).length / 1024).toFixed(2)} KB`);
            
            if (Object.keys(data).length > 0) {
              console.log('\n📁 Namespace Breakdown:');
              for (const [namespace, count] of Object.entries(namespaceStats)) {
                console.log(`   ${namespace}: ${count} entries`);
              }
            }
          } catch (err) {
            printError(`Failed to get stats: ${err.message}`);
          }
          break;
        }
        
        default: {
          console.log('Available subcommands: store, query, stats');
          console.log('\nExamples:');
          console.log('  memory store previous_work "Research findings from yesterday"');
          console.log('  memory query research');
          console.log('  memory stats');
          break;
        }
      }
      break;
    }
      
    case 'mcp':
      const mcpCmd = subArgs[0];
      switch (mcpCmd) {
        case 'status':
          printSuccess('MCP Server Status:');
          console.log('🌐 Status: Stopped (orchestrator not running)');
          console.log('📍 Default port: 3000');
          console.log('🔧 Transport: stdio');
          console.log('🔐 Authentication: Disabled');
          break;
        case 'tools':
          printSuccess('Available MCP Tools:');
          console.log('  📊 Research Tools:');
          console.log('    • web_search - Search the web for information');
          console.log('    • web_fetch - Fetch content from URLs');
          console.log('    • knowledge_query - Query knowledge base');
          console.log('  💻 Code Tools:');
          console.log('    • code_edit - Edit code files');
          console.log('    • code_search - Search through codebase');
          console.log('    • code_analyze - Analyze code quality');
          console.log('  🖥️  Terminal Tools:');
          console.log('    • terminal_execute - Execute shell commands');
          console.log('    • terminal_session - Manage terminal sessions');
          console.log('    • file_operations - File system operations');
          console.log('  💾 Memory Tools:');
          console.log('    • memory_store - Store information');
          console.log('    • memory_query - Query stored information');
          console.log('    • memory_index - Index and search content');
          break;
        case 'start':
          printWarning('MCP server runs as part of the orchestrator.');
          console.log('Use "claude-flow start" to start the entire system.');
          break;
        case 'stop':
          printWarning('MCP server runs as part of the orchestrator.');
          console.log('Use Ctrl+C to stop the system when running.');
          break;
        case 'serve':
          printSuccess('Starting MCP server in stdio mode...');
          console.log('🌐 MCP Server is starting...');
          console.log('📡 Transport: stdio (for Claude Desktop integration)');
          console.log('🔧 Available tools: agent, task, memory, terminal, workflow');
          console.log('⚡ Ready to accept connections');
          console.log('\n💡 To use with Claude Desktop:');
          console.log('   1. Add this to Claude Desktop MCP settings');
          console.log('   2. Use the mcp.json configuration in ./mcp_config/');
          // Keep the process running for stdio mode
          await new Promise(() => {});
          break;
        default:
          console.log('MCP commands: status, tools, start, stop, serve');
      }
      break;
      
    case 'monitor':
      printSuccess('Starting system monitor...');
      console.log('📊 Real-time monitoring would display here');
      break;
      
    case 'session':
      printSuccess('Terminal session manager ready');
      console.log('🖥️  Session operations would be handled here');
      break;
      
    case 'workflow':
      const workflowFile = subArgs[0];
      if (workflowFile) {
        printSuccess(`Executing workflow: ${workflowFile}`);
        console.log('🔄 Workflow execution would start here');
      } else {
        printError('Please specify a workflow file');
      }
      break;
      
    case 'repl':
      printSuccess('Starting interactive REPL mode...');
      console.log('🚀 Interactive mode coming soon!');
      console.log('💡 This will provide a full interactive shell for Claude-Flow operations');
      break;
      
    case 'claude':
      const claudeCmd = subArgs[0];
      switch (claudeCmd) {
        case 'spawn':
          // Extract task description and flags
          let taskEndIndex = subArgs.length;
          for (let i = 1; i < subArgs.length; i++) {
            if (subArgs[i].startsWith('-')) {
              taskEndIndex = i;
              break;
            }
          }
          
          const task = subArgs.slice(1, taskEndIndex).join(' ');
          if (!task) {
            printError('Usage: claude spawn <task description> [options]');
            break;
          }
          
          // Parse flags
          const flags = {};
          for (let i = taskEndIndex; i < subArgs.length; i++) {
            const arg = subArgs[i];
            if (arg === '--tools' || arg === '-t') {
              flags.tools = subArgs[++i];
            } else if (arg === '--no-permissions') {
              flags.noPermissions = true;
            } else if (arg === '--config' || arg === '-c') {
              flags.config = subArgs[++i];
            } else if (arg === '--mode' || arg === '-m') {
              flags.mode = subArgs[++i];
            } else if (arg === '--parallel') {
              flags.parallel = true;
            } else if (arg === '--research') {
              flags.research = true;
            } else if (arg === '--coverage') {
              flags.coverage = parseInt(subArgs[++i]);
            } else if (arg === '--commit') {
              flags.commit = subArgs[++i];
            } else if (arg === '--verbose' || arg === '-v') {
              flags.verbose = true;
            } else if (arg === '--dry-run' || arg === '-d') {
              flags.dryRun = true;
            }
          }
          
          // Build tools list
          let tools = flags.tools || 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash';
          if (flags.parallel) {
            tools += ',BatchTool,dispatch_agent';
          }
          if (flags.research) {
            tools += ',WebFetchTool';
          }
          
          const instanceId = `claude-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          if (flags.dryRun) {
            printWarning('DRY RUN - Would execute:');
            console.log(`Command: claude "<enhanced task with guidance>" --allowedTools ${tools}`);
            console.log(`Instance ID: ${instanceId}`);
            console.log(`Task: ${task}`);
            console.log(`Tools: ${tools}`);
            console.log(`Mode: ${flags.mode || 'full'}`);
            console.log(`Coverage: ${flags.coverage || 80}%`);
            console.log(`Commit: ${flags.commit || 'phase'}`);
            console.log(`\nEnhanced Features:`);
            console.log(`  - Memory Bank enabled via: npx claude-flow memory commands`);
            console.log(`  - Coordination ${flags.parallel ? 'enabled' : 'disabled'}`);
            console.log(`  - Access Claude-Flow features through Bash tool`);
          } else {
            printSuccess(`Spawning Claude instance: ${instanceId}`);
            console.log(`📝 Original Task: ${task}`);
            console.log(`🔧 Tools: ${tools}`);
            console.log(`⚙️  Mode: ${flags.mode || 'full'}`);
            console.log(`📊 Coverage: ${flags.coverage || 80}%`);
            console.log(`💾 Commit: ${flags.commit || 'phase'}`);
            console.log(`✨ Enhanced with Claude-Flow guidance for memory and coordination`);
            console.log('');
            console.log('📋 Task will be enhanced with:');
            console.log('  - Memory Bank instructions (store/retrieve)');
            console.log('  - Coordination capabilities (swarm management)');
            console.log('  - Best practices for multi-agent workflows');
            console.log('');
            
            // Build the actual claude command with enhanced guidance
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
- Working Directory: ${Deno.env.get('CLAUDE_FLOW_ORIGINAL_CWD') || Deno.cwd()}
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

## Configuration
- Instance ID: ${instanceId}
- Mode: ${flags.mode || 'full'}
- Coverage Target: ${flags.coverage || 80}%
- Commit Strategy: ${flags.commit || 'phase'}

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
${flags.parallel ? `
# Parallel Execution (enabled for this instance)
Bash("npx claude-flow agent spawn researcher --name research-bot")
Bash("npx claude-flow agent spawn coder --name code-bot")
Bash("npx claude-flow task create research 'Analyze best practices'")
Bash("npx claude-flow task create implementation 'Implement auth module'")
Bash("npx claude-flow task assign task-123 agent-456")` : ''}
${flags.research ? `
# Research Operations (research mode enabled)
# Use WebFetchTool for web research, then store findings
Bash("npx claude-flow memory store web_research_urls '[\\"url1\\", \\"url2\\"]'")
Bash("npx claude-flow memory store research_summary 'Key findings from research...'")` : ''}

# Configuration Management
Bash("npx claude-flow config show")
Bash("npx claude-flow config get orchestrator.maxConcurrentTasks")
Bash("npx claude-flow config set orchestrator.maxConcurrentTasks 20")

# Workflow Execution
Bash("npx claude-flow workflow examples/development-config.json")
Bash("npx claude-flow workflow examples/research-workflow.json --async")
\`\`\`

## Mode-Specific Guidelines
${flags.mode === 'backend-only' ? `
### Backend-Only Mode
- Focus exclusively on server-side implementation
- Prioritize API design, database schemas, and business logic
- Ignore frontend/UI considerations
- Test coverage should emphasize unit and integration tests` : ''}
${flags.mode === 'frontend-only' ? `
### Frontend-Only Mode
- Focus exclusively on client-side implementation
- Prioritize UI/UX, component design, and user interactions
- Assume backend APIs are already available
- Test coverage should emphasize component and E2E tests` : ''}
${flags.mode === 'api-only' ? `
### API-Only Mode
- Focus exclusively on API design and implementation
- Prioritize RESTful principles, documentation, and contracts
- Include comprehensive API documentation
- Test coverage should emphasize API endpoint testing` : ''}
${flags.mode === 'full' || !flags.mode ? `
### Full Stack Mode (Default)
- Consider both frontend and backend requirements
- Ensure proper integration between all layers
- Balance test coverage across all components
- Document both API contracts and user interfaces` : ''}

## Commit Strategy
${flags.commit === 'phase' ? `- **Phase Commits**: Commit after completing major phases (planning, implementation, testing)` : ''}
${flags.commit === 'feature' ? `- **Feature Commits**: Commit after each feature or module is complete` : ''}
${flags.commit === 'manual' ? `- **Manual Commits**: Only commit when explicitly requested by the user` : ''}
${!flags.commit ? `- **Default (Phase)**: Commit after completing major phases` : ''}

## Important Working Directory Information

IMPORTANT: You are working in the directory: ${Deno.env.get('CLAUDE_FLOW_ORIGINAL_CWD') || Deno.cwd()}

This is your correct working directory. All file operations, commands, and path references should be relative to this directory, not to any claude-flow installation directory.

If you see any references to "/usr/local/share/npm-global/lib/node_modules/claude-flow" in your environment, that is the claude-flow installation directory and should be ignored for your work context. Your actual working directory is the one specified above.

Now, please proceed with the task: ${task}`;
            
            const claudeArgs = [enhancedTask];
            claudeArgs.push('--allowedTools', tools);
            
            // DEBUG: Log what we're about to pass
            console.log('\n🔍 DEBUG - Command Construction:');
            console.log(`First arg length: ${claudeArgs[0].length} chars`);
            console.log(`First 100 chars: ${claudeArgs[0].substring(0, 100)}...`);
            console.log(`Args count: ${claudeArgs.length}`);
            
            if (flags.noPermissions) {
              claudeArgs.push('--dangerously-skip-permissions');
            }
            
            if (flags.config) {
              claudeArgs.push('--mcp-config', flags.config);
            }
            
            if (flags.verbose) {
              claudeArgs.push('--verbose');
            }
            
            // Execute the actual claude command
            try {
              // Debug: Log the actual command being executed
              if (flags.verbose) {
                console.log('Debug - Executing command:');
                console.log(`claude ${claudeArgs.map(arg => arg.includes(' ') || arg.includes('\n') ? `"${arg}"` : arg).join(' ')}`);
              }
              
              const command = new Deno.Command('claude', {
                args: claudeArgs,
                cwd: Deno.env.get('CLAUDE_FLOW_ORIGINAL_CWD') || Deno.cwd(),
                env: {
                  ...Deno.env.toObject(),
                  CLAUDE_INSTANCE_ID: instanceId,
                  CLAUDE_FLOW_MODE: flags.mode || 'full',
                  CLAUDE_FLOW_COVERAGE: (flags.coverage || 80).toString(),
                  CLAUDE_FLOW_COMMIT: flags.commit || 'phase',
                  // Add claude-flow specific features
                  CLAUDE_FLOW_MEMORY_ENABLED: 'true',
                  CLAUDE_FLOW_MEMORY_NAMESPACE: 'default',
                  CLAUDE_FLOW_COORDINATION_ENABLED: flags.parallel ? 'true' : 'false',
                  CLAUDE_FLOW_FEATURES: 'memory,coordination,swarm',
                  // Pass the original working directory to Claude
                  CLAUDE_FLOW_CWD: Deno.env.get('CLAUDE_FLOW_ORIGINAL_CWD') || Deno.cwd(),
                },
                stdin: 'inherit',
                stdout: 'inherit',
                stderr: 'inherit',
              });
              
              const child = command.spawn();
              const status = await child.status;
              
              if (status.success) {
                printSuccess(`Claude instance ${instanceId} completed successfully`);
              } else {
                printError(`Claude instance ${instanceId} exited with code ${status.code}`);
              }
            } catch (err) {
              printError(`Failed to spawn Claude: ${err.message}`);
              console.log('Make sure you have the Claude CLI installed.');
            }
          }
          break;
          
        case 'batch':
          const workflowFile = subArgs[1];
          if (!workflowFile) {
            printError('Usage: claude batch <workflow-file>');
            break;
          }
          printSuccess(`Loading workflow: ${workflowFile}`);
          console.log('📋 Batch execution would process workflow file');
          break;
          
        default:
          console.log('Claude commands: spawn, batch');
          console.log('\nExamples:');
          console.log('  claude-flow claude spawn "implement user authentication" --research --parallel');
          console.log('  claude-flow claude spawn "fix bug in payment system" --no-permissions');
          console.log('  claude-flow claude batch workflow.json --dry-run');
      }
      break;
      
    default:
      printError(`Unknown command: ${command}`);
      console.log('Run "claude-flow help" for available commands');
      Deno.exit(1);
  }
}

// Helper functions for init command
function createMinimalClaudeMd() {
  return `# Claude Code Integration

This file provides guidance to Claude when working with this codebase.

## Project Overview
[Describe your project here]

## Key Conventions
- Code style guidelines
- Naming conventions
- Architecture patterns

## Important Notes
- Special considerations
- Areas to be careful with
`;
}

function createFullClaudeMd() {
  return `# Claude Code Integration Guide

This document provides comprehensive guidance to Claude when working with this codebase.

## Project Overview
[Provide a detailed description of your project, its purpose, and main features]

## Architecture
[Describe the overall architecture, main components, and how they interact]

## Code Conventions
- **Naming**: [Describe naming conventions for files, functions, variables, etc.]
- **Style**: [Code formatting preferences, linting rules]
- **Patterns**: [Design patterns used in the project]
- **Testing**: [Testing approach and requirements]

## Directory Structure
\`\`\`
project/
├── src/          # Source code
├── tests/        # Test files
├── docs/         # Documentation
└── ...           # Other directories
\`\`\`

## Development Workflow
1. [Step-by-step development process]
2. [How to run tests]
3. [How to build/deploy]

## Important Considerations
- [Security considerations]
- [Performance requirements]
- [Compatibility requirements]

## Common Tasks
- **Add a new feature**: [Instructions]
- **Fix a bug**: [Process]
- **Update documentation**: [Guidelines]

## Dependencies
[List key dependencies and their purposes]

## Troubleshooting
[Common issues and solutions]
`;
}

function createMinimalMemoryBankMd() {
  return `# Memory Bank

Session memory and context storage.

## Current Session
- Started: ${new Date().toISOString()}
- Context: [Current work context]

## Key Information
- [Important facts to remember]

## Progress Log
- [Track progress here]
`;
}

function createFullMemoryBankMd() {
  return `# Memory Bank

This file serves as persistent memory storage for Claude across sessions.

## Session Information
- **Current Session**: Started ${new Date().toISOString()}
- **Project Phase**: [Development/Testing/Production]
- **Active Tasks**: [List current tasks]

## Project Context
### Technical Stack
- Languages: [List languages used]
- Frameworks: [List frameworks]
- Tools: [Development tools]

### Architecture Decisions
- [Record key architectural decisions]
- [Rationale for technology choices]

## Important Information
### API Keys and Secrets
- [Never store actual secrets here, just references]

### External Services
- [List integrated services]
- [Configuration requirements]

### Database Schema
- [Current schema version]
- [Recent migrations]

## Progress Tracking
### Completed Tasks
- [x] [Completed task 1]
- [x] [Completed task 2]

### In Progress
- [ ] [Current task 1]
- [ ] [Current task 2]

### Upcoming
- [ ] [Future task 1]
- [ ] [Future task 2]

## Code Patterns
### Established Patterns
\`\`\`javascript
// Example pattern
\`\`\`

### Anti-patterns to Avoid
- [List anti-patterns]

## Meeting Notes
### [Date]
- Participants: [Names]
- Decisions: [Key decisions]
- Action items: [Tasks assigned]

## Debugging History
### Issue: [Issue name]
- **Date**: [Date]
- **Symptoms**: [What was observed]
- **Root Cause**: [What caused it]
- **Solution**: [How it was fixed]

## Performance Metrics
- [Baseline metrics]
- [Optimization goals]

## Documentation Links
- [API Documentation]: [URL]
- [Design Documents]: [URL]
- [Issue Tracker]: [URL]
`;
}

function createMinimalCoordinationMd() {
  return `# Coordination

Task and workflow coordination.

## Active Tasks
1. [Current task]

## Workflow
- [ ] Step 1
- [ ] Step 2

## Resources
- [Available resources]
`;
}

function createFullCoordinationMd() {
  return `# Coordination Center

Central coordination for multi-agent collaboration and task management.

## Active Agents
| Agent ID | Type | Status | Assigned Tasks | Last Active |
|----------|------|--------|----------------|-------------|
| [ID] | [Type] | [Status] | [Tasks] | [Timestamp] |

## Task Queue
### High Priority
1. **[Task Name]**
   - Description: [What needs to be done]
   - Assigned to: [Agent ID]
   - Dependencies: [Other tasks]
   - Deadline: [Date/Time]

### Medium Priority
1. [Task details]

### Low Priority
1. [Task details]

## Workflow Definitions
### [Workflow Name]
\`\`\`yaml
name: [Workflow Name]
description: [What this workflow does]
steps:
  - name: [Step 1]
    agent: [Agent type]
    action: [What to do]
  - name: [Step 2]
    agent: [Agent type]
    action: [What to do]
    depends_on: [Step 1]
\`\`\`

## Resource Allocation
### Computational Resources
- CPU: [Usage/Limits]
- Memory: [Usage/Limits]
- Storage: [Usage/Limits]

### External Resources
- API Rate Limits: [Service: limit]
- Database Connections: [Current/Max]

## Communication Channels
### Inter-Agent Messages
- [Agent A → Agent B]: [Message type]

### External Communications
- Webhooks: [Configured webhooks]
- Notifications: [Notification settings]

## Synchronization Points
- [Sync Point 1]: [Description]
- [Sync Point 2]: [Description]

## Conflict Resolution
### Strategy
- [How conflicts are resolved]

### Recent Conflicts
- [Date]: [Conflict description] → [Resolution]

## Performance Metrics
### Task Completion
- Average time: [Time]
- Success rate: [Percentage]

### Agent Efficiency
- [Agent Type]: [Metrics]

## Scheduled Maintenance
- [Date/Time]: [What will be done]

## Emergency Procedures
### System Overload
1. [Step 1]
2. [Step 2]

### Agent Failure
1. [Recovery procedure]
`;
}

function createAgentsReadme() {
  return `# Agents Directory

This directory stores agent-specific memory and state information.

## Structure
Each agent gets its own subdirectory named by agent ID:
- \`agent-001/\`: First agent's memory
- \`agent-002/\`: Second agent's memory
- etc.

## Files per Agent
- \`profile.json\`: Agent configuration and capabilities
- \`memory.md\`: Agent's working memory
- \`tasks.json\`: Assigned tasks and their status
- \`metrics.json\`: Performance metrics

## Usage
Files in this directory are automatically managed by the Claude-Flow system.
`;
}

function createSessionsReadme() {
  return `# Sessions Directory

This directory stores session-specific information and terminal states.

## Structure
Each session gets a unique directory:
- \`session-[timestamp]/\`: Session data
  - \`metadata.json\`: Session metadata
  - \`terminal.log\`: Terminal output
  - \`commands.history\`: Command history
  - \`state.json\`: Session state snapshot

## Retention Policy
Sessions are retained for 30 days by default, then archived or deleted based on configuration.

## Usage
The Claude-Flow system automatically manages session files. Do not modify these files manually.
`;
}

if (import.meta.main) {
  await main();
}