#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
  TextContent,
  ImageContent,
  EmbeddedResource,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SparcMode, loadSparcModes } from './sparc-modes.js';
// Simple ID generation
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SparcContext {
  memoryKey?: string;
  parallel?: boolean;
  timeout?: number;
  workingDirectory?: string;
}

interface SwarmAgent {
  id: string;
  mode: string;
  task: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  result?: any;
}

interface SwarmExecution {
  id: string;
  objective: string;
  strategy: string;
  mode: string;
  agents: SwarmAgent[];
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'failed';
}

export class ClaudeCodeMCPWrapper {
  private server: Server;
  private sparcModes: Map<string, SparcMode> = new Map();
  private swarmExecutions: Map<string, SwarmExecution> = new Map();
  private claudeCodeMCP: any; // Reference to Claude Code MCP client

  constructor() {
    this.server = new Server(
      {
        name: 'claude-flow-wrapper',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
    this.loadSparcModes();
  }

  private async loadSparcModes() {
    try {
      const modes = await loadSparcModes();
      modes.forEach((mode) => {
        this.sparcModes.set(mode.name, mode);
      });
    } catch (error) {
      console.error('Failed to load SPARC modes:', error);
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleToolCall(request.params.name, request.params.arguments || {}),
    );
  }

  private async getTools(): Promise<Tool[]> {
    const tools: Tool[] = [];

    // Add SPARC mode tools
    for (const [name, mode] of this.sparcModes) {
      tools.push({
        name: `sparc_${name}`,
        description: `Execute SPARC ${name} mode: ${mode.description}`,
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task description for the SPARC mode to execute',
            },
            context: {
              type: 'object',
              description: 'Optional context or parameters for the task',
              properties: {
                memoryKey: {
                  type: 'string',
                  description: 'Memory key to store results',
                },
                parallel: {
                  type: 'boolean',
                  description: 'Enable parallel execution',
                },
              },
            },
          },
          required: ['task'],
        },
      });
    }

    // Add meta tools
    tools.push(
      {
        name: 'sparc_list',
        description: 'List all available SPARC modes',
        inputSchema: {
          type: 'object',
          properties: {
            verbose: {
              type: 'boolean',
              description: 'Include detailed information',
            },
          },
        },
      },
      {
        name: 'sparc_swarm',
        description: 'Coordinate multiple SPARC agents in a swarm',
        inputSchema: {
          type: 'object',
          properties: {
            objective: {
              type: 'string',
              description: 'The swarm objective',
            },
            strategy: {
              type: 'string',
              enum: [
                'research',
                'development',
                'analysis',
                'testing',
                'optimization',
                'maintenance',
              ],
              description: 'Swarm execution strategy',
            },
            mode: {
              type: 'string',
              enum: ['centralized', 'distributed', 'hierarchical', 'mesh', 'hybrid'],
              description: 'Coordination mode',
            },
            maxAgents: {
              type: 'number',
              description: 'Maximum number of agents',
              default: 5,
            },
          },
          required: ['objective', 'strategy'],
        },
      },
      {
        name: 'sparc_swarm_status',
        description: 'Check status of running swarms and list created files',
        inputSchema: {
          type: 'object',
          properties: {
            swarmId: {
              type: 'string',
              description: 'Optional swarm ID to check specific swarm',
            },
          },
        },
      },
    );

    return tools;
  }

  private async handleToolCall(toolName: string, args: any): Promise<CallToolResult> {
    try {
      if (toolName.startsWith('sparc_')) {
        return await this.handleSparcTool(toolName, args);
      }

      // Pass through to Claude Code MCP
      return this.forwardToClaudeCode(toolName, args);
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSparcTool(toolName: string, args: any): Promise<CallToolResult> {
    const mode = toolName.replace('sparc_', '');

    // Handle special tools
    if (mode === 'list') {
      return this.listModes(args.verbose);
    }
    if (mode === 'swarm') {
      return this.handleSwarm(args);
    }
    if (mode === 'swarm_status') {
      return this.getSwarmStatus(args.swarmId);
    }

    // Standard SPARC mode execution
    const sparcMode = this.sparcModes.get(mode);
    if (!sparcMode) {
      throw new Error(`Unknown SPARC mode: ${mode}`);
    }

    // Execute the SPARC mode directly
    try {
      // Import the execution function dynamically to avoid circular dependencies
      // const { executeSparcMode } = await import('../cli/mcp-stdio-server.js');
      // TODO: Implement proper SPARC mode execution or fix import path
      const executeSparcMode = (mode: string, task: string, tools: any[], context: any) => {
        throw new Error('SPARC mode execution not yet implemented in wrapper');
      };

      const result = await executeSparcMode(
        mode,
        args.task,
        sparcMode.tools || [],
        args.context || {},
      );

      return {
        content: [
          {
            type: 'text',
            text: result.output,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing SPARC ${mode}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private buildEnhancedPrompt(mode: SparcMode, task: string, context?: SparcContext): string {
    const parts: string[] = [];

    // Add SPARC mode header
    parts.push(`SPARC: ${mode.name}\n`);
    parts.push(`## Mode Description\n${mode.description}\n`);

    // Add available tools
    if (mode.tools && mode.tools.length > 0) {
      parts.push(`## Available Tools`);
      mode.tools.forEach((tool) => {
        parts.push(`- **${tool}**: ${this.getToolDescription(tool)}`);
      });
      parts.push('');
    }

    // Add usage pattern
    if (mode.usagePattern) {
      parts.push(`## Usage Pattern\n\`\`\`javascript\n${mode.usagePattern}\n\`\`\`\n`);
    }

    // Add best practices
    if (mode.bestPractices) {
      parts.push(`## Best Practices`);
      mode.bestPractices.forEach((practice) => {
        parts.push(`- ${practice}`);
      });
      parts.push('');
    }

    // Add integration capabilities
    if (mode.integrationCapabilities) {
      parts.push(`## Integration Capabilities\nThis mode integrates with:`);
      mode.integrationCapabilities.forEach((capability) => {
        parts.push(`- ${capability}`);
      });
      parts.push('');
    }

    // Add instructions
    if (mode.instructions) {
      parts.push(`## Instructions\n${mode.instructions}\n`);
    }

    // Add the actual task
    parts.push(`## TASK: ${task}\n`);

    // Add SPARC methodology
    parts.push(this.getSparcMethodology(mode.name, task, context));

    // Add context if provided
    if (context) {
      if (context.memoryKey) {
        parts.push(`**Memory Key:** \`${context.memoryKey}\``);
      }
      if (context.parallel) {
        parts.push(`**Parallel Execution:** Enabled`);
      }
      if (context.workingDirectory) {
        parts.push(`**Working Directory:** ${context.workingDirectory}`);
      }
    }

    return parts.join('\n');
  }

  private getToolDescription(tool: string): string {
    const descriptions: Record<string, string> = {
      TodoWrite: 'Create and manage task coordination',
      TodoRead: 'Monitor task progress and status',
      Task: 'Spawn and manage specialized agents',
      Memory: 'Store and retrieve coordination data',
      Bash: 'Execute system commands',
      Read: 'Read file contents',
      Write: 'Write files',
      Edit: 'Edit existing files',
      MultiEdit: 'Make multiple edits to a file',
      Glob: 'Search for files by pattern',
      Grep: 'Search file contents',
      WebSearch: 'Search the web',
      WebFetch: 'Fetch web content',
    };
    return descriptions[tool] || `${tool} tool`;
  }

  private getSparcMethodology(mode: string, task: string, context?: SparcContext): string {
    return `
# 🎯 SPARC METHODOLOGY EXECUTION FRAMEWORK

You are operating in **SPARC ${mode} mode**. Follow the SPARC Workflow precisely:

## SPARC Workflow Steps

### 1️⃣ SPECIFICATION - Clarify goals, scope, constraints
**Your Task:** ${task}

**Analysis Required:**
- Break down into clear, measurable objectives
- Identify all requirements and constraints  
- Define acceptance criteria
- Never hard-code environment variables

**Use TodoWrite to capture specifications:**
\`\`\`javascript
TodoWrite([
  {
    id: "specification",
    content: "Clarify goals, scope, and constraints for: ${task}",
    status: "pending",
    priority: "high"
  },
  {
    id: "acceptance_criteria", 
    content: "Define clear acceptance criteria and success metrics",
    status: "pending",
    priority: "high"
  }
]);
\`\`\`

### 2️⃣ PSEUDOCODE - High-level logic with TDD anchors
**Design Approach:**
- Identify core functions and data structures
- Create TDD test anchors before implementation
- Map out component interactions

### 3️⃣ ARCHITECTURE - Design extensible systems
**Architecture Requirements:**
- Clear service boundaries
- Define interfaces between components
- Design for extensibility and maintainability
- Mode-specific architecture: ${this.getModeSpecificArchitecture(mode)}

### 4️⃣ REFINEMENT - Iterate with TDD and security
**Refinement Process:**
- TDD implementation cycles
- Security vulnerability checks (injection, XSS, CSRF)
- Performance optimization
- Code review and refactoring
- All files must be ≤ 500 lines

### 5️⃣ COMPLETION - Integrate and verify
**Completion Checklist:**
- [ ] All acceptance criteria met
- [ ] Tests passing (comprehensive test suite)
- [ ] Security review completed
- [ ] Documentation updated
- [ ] Results stored in Memory: \`sparc_${mode}_${Date.now()}\`
- [ ] No hard-coded secrets or env vars
- [ ] Proper error handling in all code paths

## 🚀 Execution Configuration

**Mode:** ${mode}
**Strategy:** ${this.getModeStrategy(mode)}
**Memory Key:** \`sparc_${mode}_${Date.now()}\`
**Batch Operations:** ${context?.parallel ? 'Enabled' : 'Standard operations'}
**Primary Tools:** ${this.sparcModes.get(mode)?.tools?.join(', ') || 'Standard tools'}

## 📋 Must Block (Non-negotiable)
- Every file ≤ 500 lines
- No hard-coded secrets or env vars
- All user inputs validated
- No security vulnerabilities
- Proper error handling in all paths
- Each subtask ends with completion check

## 🎯 IMMEDIATE ACTION REQUIRED

**START NOW with SPARC Step 1 - SPECIFICATION:**

1. Create comprehensive TodoWrite task breakdown following SPARC workflow
2. Set "specification" task to "in_progress"
3. Analyze requirements and define acceptance criteria
4. Store initial analysis in Memory: \`sparc_${mode}_${Date.now()}\`

**Remember:** You're in **${mode}** mode. Follow the SPARC workflow systematically:
Specification → Pseudocode → Architecture → Refinement → Completion

Use the appropriate tools for each phase and maintain progress in TodoWrite.`;
  }

  private getModeSpecificArchitecture(mode: string): string {
    const architectures: Record<string, string> = {
      orchestrator: 'Design for parallel agent coordination with clear task boundaries',
      coder: 'Focus on clean code architecture with proper abstractions',
      researcher: 'Structure for data collection and analysis pipelines',
      tdd: 'Test-first design with comprehensive test coverage',
      architect: 'System-wide design patterns and component interactions',
      reviewer: 'Code quality gates and review checkpoints',
      debugger: 'Diagnostic and monitoring integration points',
      tester: 'Test framework integration and coverage analysis',
    };
    return architectures[mode] || 'Design for the specific mode requirements';
  }

  private getModeStrategy(mode: string): string {
    const strategies: Record<string, string> = {
      orchestrator: 'Parallel coordination',
      coder: 'Iterative development',
      researcher: 'Deep analysis',
      tdd: 'Test-driven cycles',
      architect: 'System design',
      reviewer: 'Quality assurance',
      debugger: 'Systematic debugging',
      tester: 'Comprehensive validation',
    };
    return strategies[mode] || 'Mode-specific execution';
  }

  private listModes(verbose: boolean): CallToolResult {
    const modes = Array.from(this.sparcModes.values());

    if (verbose) {
      const content = modes.map((mode) => ({
        name: mode.name,
        description: mode.description,
        tools: mode.tools,
        bestPractices: mode.bestPractices,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(content, null, 2),
          },
        ],
      };
    }

    const list = modes.map((m) => `- **${m.name}**: ${m.description}`).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `Available SPARC modes:\n\n${list}`,
        },
      ],
    };
  }

  private async handleSwarm(args: any): Promise<CallToolResult> {
    const { objective, strategy, mode = 'distributed', maxAgents = 5 } = args;
    const swarmId = generateId();

    // Plan swarm agents
    const agents = this.planSwarmAgents(objective, strategy, maxAgents);

    // Create swarm execution record
    const execution: SwarmExecution = {
      id: swarmId,
      objective,
      strategy,
      mode,
      agents,
      startTime: new Date(),
      status: 'active',
    };

    this.swarmExecutions.set(swarmId, execution);

    // Launch agents based on coordination mode
    if (mode === 'distributed' || mode === 'mesh') {
      // Parallel execution
      await Promise.all(agents.map((agent) => this.launchSwarmAgent(agent, execution)));
    } else {
      // Sequential execution
      for (const agent of agents) {
        await this.launchSwarmAgent(agent, execution);
      }
    }

    execution.status = 'completed';
    execution.endTime = new Date();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              swarmId,
              objective,
              strategy,
              mode,
              agentCount: agents.length,
              status: 'launched',
              message: 'Swarm coordination initiated',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private planSwarmAgents(objective: string, strategy: string, maxAgents: number): SwarmAgent[] {
    const agents: SwarmAgent[] = [];

    // Strategy-based agent planning
    switch (strategy) {
      case 'research':
        agents.push(
          {
            id: generateId(),
            mode: 'researcher',
            task: `Research: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'analyst',
            task: `Analyze findings for: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'documenter',
            task: `Document research results: ${objective}`,
            status: 'pending',
          },
        );
        break;

      case 'development':
        agents.push(
          {
            id: generateId(),
            mode: 'architect',
            task: `Design architecture: ${objective}`,
            status: 'pending',
          },
          { id: generateId(), mode: 'coder', task: `Implement: ${objective}`, status: 'pending' },
          {
            id: generateId(),
            mode: 'tester',
            task: `Test implementation: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'reviewer',
            task: `Review code: ${objective}`,
            status: 'pending',
          },
        );
        break;

      case 'analysis':
        agents.push(
          { id: generateId(), mode: 'analyst', task: `Analyze: ${objective}`, status: 'pending' },
          {
            id: generateId(),
            mode: 'optimizer',
            task: `Optimize based on analysis: ${objective}`,
            status: 'pending',
          },
        );
        break;

      case 'testing':
        agents.push(
          {
            id: generateId(),
            mode: 'tester',
            task: `Create test suite: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'debugger',
            task: `Debug issues: ${objective}`,
            status: 'pending',
          },
        );
        break;

      case 'optimization':
        agents.push(
          {
            id: generateId(),
            mode: 'analyst',
            task: `Performance analysis: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'optimizer',
            task: `Optimize: ${objective}`,
            status: 'pending',
          },
        );
        break;

      case 'maintenance':
        agents.push(
          {
            id: generateId(),
            mode: 'reviewer',
            task: `Code review: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'debugger',
            task: `Fix issues: ${objective}`,
            status: 'pending',
          },
          {
            id: generateId(),
            mode: 'documenter',
            task: `Update documentation: ${objective}`,
            status: 'pending',
          },
        );
        break;
    }

    // Limit to maxAgents
    return agents.slice(0, maxAgents);
  }

  private async launchSwarmAgent(agent: SwarmAgent, execution: SwarmExecution): Promise<void> {
    agent.status = 'active';

    try {
      // Use the SPARC mode handler
      const result = await this.handleSparcTool(`sparc_${agent.mode}`, {
        task: agent.task,
        context: {
          memoryKey: `swarm_${execution.id}_${agent.id}`,
          parallel: execution.mode === 'distributed',
        },
      });

      agent.status = 'completed';
      agent.result = result;
    } catch (error) {
      agent.status = 'failed';
      agent.result = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getSwarmStatus(swarmId?: string): CallToolResult {
    if (swarmId) {
      const execution = this.swarmExecutions.get(swarmId);
      if (!execution) {
        return {
          content: [
            {
              type: 'text',
              text: `No swarm found with ID: ${swarmId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(execution, null, 2),
          },
        ],
      };
    }

    // Return all swarms
    const swarms = Array.from(this.swarmExecutions.values()).map((e) => ({
      id: e.id,
      objective: e.objective,
      status: e.status,
      agentCount: e.agents.length,
      startTime: e.startTime,
      endTime: e.endTime,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(swarms, null, 2),
        },
      ],
    };
  }

  private async forwardToClaudeCode(toolName: string, args: any): Promise<CallToolResult> {
    // For SPARC tools that were already handled, this shouldn't be called
    // For other tools, we execute them using the existing logic

    if (toolName === 'Task') {
      // This is a SPARC task that's been enhanced with prompts
      // Extract the mode from the description if possible
      const modeMatch = args.description?.match(/SPARC (\w+)/);
      if (modeMatch) {
        const modeName = modeMatch[1];
        const mode = this.sparcModes.get(modeName);
        if (mode) {
          // Execute using the existing SPARC execution logic
          try {
            const result = await executeSparcMode(
              modeName,
              args.prompt || '',
              mode.tools || [],
              {},
            );

            return {
              content: [
                {
                  type: 'text',
                  text: result.output,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error executing SPARC ${modeName}: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      }
    }

    // For non-SPARC tools, return a message
    return {
      content: [
        {
          type: 'text',
          text: `Tool ${toolName} is not available in this MCP server.`,
        },
      ],
      isError: true,
    };
  }

  async run() {
    const transport = new StdioServerTransport();

    // Log startup message
    console.error('🚀 Claude-Flow MCP Server (Wrapper Mode)');
    console.error('📦 Using Claude Code MCP pass-through with SPARC prompt injection');
    console.error('🔧 All SPARC tools available with enhanced AI capabilities');
    console.error('ℹ️  To use legacy mode, set CLAUDE_FLOW_LEGACY_MCP=true');
    console.error('');

    await this.server.connect(transport);
  }
}

// Run the server if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const wrapper = new ClaudeCodeMCPWrapper();
  wrapper.run().catch(console.error);
}
