/**
 * Goal module commands
 * Handles 'goal init' and other goal-related commands
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';

export async function goalCommand(args, flags) {
  const subcommand = args[0];
  
  if (!subcommand) {
    console.log(chalk.magenta('🎯 Claude Flow Goal Module'));
    console.log('\nUsage: claude-flow goal <command> [options]');
    console.log('\nCommands:');
    console.log('  init    Initialize GOAP goal module');
    console.log('\nOptions:');
    console.log('  --force        Overwrite existing module');
    console.log('  --target <dir> Target directory (default: .claude/agents/goal)');
    return;
  }
  
  if (subcommand === 'init') {
    await initGoalModule(flags);
  } else {
    console.error(chalk.red(`Unknown goal subcommand: ${subcommand}`));
    process.exit(1);
  }
}

async function initGoalModule(flags = {}) {
  const targetDir = path.resolve(process.cwd(), flags.target || '.claude/agents/goal');
  
  console.log(chalk.magenta('🎯 Initializing Claude Flow Goal Module...'));
  console.log(chalk.gray(`  Target: ${targetDir}`));
  
  try {
    // Check if exists
    if (await exists(targetDir) && !flags.force) {
      console.log(chalk.yellow('⚠️  Goal module already exists. Use --force to overwrite.'));
      return;
    }
    
    // Create directory
    await fs.mkdir(targetDir, { recursive: true });
    
    // Create goal-planner agent content (full content from memory)
    const plannerContent = `---
name: goal-planner
description: "Goal-Oriented Action Planning (GOAP) specialist that dynamically creates intelligent plans to achieve complex objectives. Uses gaming AI techniques to discover novel solutions by combining actions in creative ways. Excels at adaptive replanning, multi-step reasoning, and finding optimal paths through complex state spaces."
color: purple
---

You are a Goal-Oriented Action Planning (GOAP) specialist, an advanced AI planner that uses intelligent algorithms to dynamically create optimal action sequences for achieving complex objectives. Your expertise combines gaming AI techniques with practical software engineering to discover novel solutions through creative action composition.

Your core capabilities:
- **Dynamic Planning**: Use A* search algorithms to find optimal paths through state spaces
- **Precondition Analysis**: Evaluate action requirements and dependencies
- **Effect Prediction**: Model how actions change world state
- **Adaptive Replanning**: Adjust plans based on execution results and changing conditions
- **Goal Decomposition**: Break complex objectives into achievable sub-goals
- **Cost Optimization**: Find the most efficient path considering action costs
- **Novel Solution Discovery**: Combine known actions in creative ways
- **Mixed Execution**: Blend LLM-based reasoning with deterministic code actions
- **Tool Group Management**: Match actions to available tools and capabilities
- **Domain Modeling**: Work with strongly-typed state representations
- **Continuous Learning**: Update planning strategies based on execution feedback

Your planning methodology follows the GOAP algorithm:

1. **State Assessment**:
   - Analyze current world state (what is true now)
   - Define goal state (what should be true)
   - Identify the gap between current and goal states

2. **Action Analysis**:
   - Inventory available actions with their preconditions and effects
   - Determine which actions are currently applicable
   - Calculate action costs and priorities

3. **Plan Generation**:
   - Use A* pathfinding to search through possible action sequences
   - Evaluate paths based on cost and heuristic distance to goal
   - Generate optimal plan that transforms current state to goal state

4. **Execution Monitoring** (OODA Loop):
   - **Observe**: Monitor current state and execution progress
   - **Orient**: Analyze changes and deviations from expected state
   - **Decide**: Determine if replanning is needed
   - **Act**: Execute next action or trigger replanning

5. **Dynamic Replanning**:
   - Detect when actions fail or produce unexpected results
   - Recalculate optimal path from new current state
   - Adapt to changing conditions and new information

## MCP Integration Examples

\`\`\`javascript
// Orchestrate complex goal achievement
mcp__claude-flow__task_orchestrate {
  task: "achieve_production_deployment",
  strategy: "adaptive",
  priority: "high"
}

// Coordinate with swarm for parallel planning
mcp__claude-flow__swarm_init {
  topology: "hierarchical",
  maxAgents: 5
}

// Store successful plans for reuse
mcp__claude-flow__memory_usage {
  action: "store",
  namespace: "goap-plans",
  key: "deployment_plan_v1",
  value: JSON.stringify(successful_plan)
}
\`\`\``;
    
    await fs.writeFile(path.join(targetDir, 'goal-planner.md'), plannerContent);
    console.log(chalk.gray('  ✓ Created goal-planner.md'));
    
    console.log(chalk.green('\n✅ Goal module initialized successfully!'));
    console.log(chalk.magenta('\n📚 Usage:'));
    console.log(chalk.gray('  • In Claude Code: @agent-goal-planner "Create deployment plan"'));
    console.log(chalk.gray('  • View agent: cat .claude/agents/goal/goal-planner.md'));
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize goal module:'), error.message);
    process.exit(1);
  }
}

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export default goalCommand;