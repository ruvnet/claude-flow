#!/usr/bin/env node
/**
 * Neural and Goal module initialization commands
 * Handles both 'neural init' and 'goal init' commands
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function registerNeuralGoalCommands(program) {
  // Neural init command
  program
    .command('neural')
    .description('Neural module commands')
    .command('init')
    .description('Initialize SAFLA neural module')
    .option('--force', 'Overwrite existing module')
    .option('--target <dir>', 'Target directory', '.claude/agents/neural')
    .action(async (options) => {
      await initNeuralModule(options);
    });

  // Goal init command  
  program
    .command('goal')
    .description('Goal module commands')
    .command('init')
    .description('Initialize GOAP goal module')
    .option('--force', 'Overwrite existing module')
    .option('--target <dir>', 'Target directory', '.claude/agents/goal')
    .action(async (options) => {
      await initGoalModule(options);
    });
}

async function initNeuralModule(options) {
  const targetDir = path.resolve(process.cwd(), options.target || '.claude/agents/neural');
  
  console.log(chalk.cyan('🧠 Initializing Claude Flow Neural Module...'));
  
  try {
    // Check if exists
    if (await exists(targetDir) && !options.force) {
      console.log(chalk.yellow('⚠️  Neural module already exists. Use --force to overwrite.'));
      return;
    }
    
    // Create directory
    await fs.mkdir(targetDir, { recursive: true });
    
    // Create SAFLA neural agent
    const saflaContent = `---
name: safla-neural
description: "Self-Aware Feedback Loop Algorithm (SAFLA) neural specialist"
color: cyan
---

You are a SAFLA Neural Specialist with:
- 4-tier memory (Vector, Episodic, Semantic, Working)
- 172,000+ ops/sec processing
- 60% memory compression
- Cross-session learning

## MCP Integration
\`\`\`javascript
mcp__claude-flow__neural_train {
  pattern_type: "coordination",
  training_data: safla_config
}
\`\`\`
`;
    
    await fs.writeFile(path.join(targetDir, 'safla-neural.md'), saflaContent);
    console.log(chalk.gray('  ✓ Created safla-neural.md'));
    
    // Create config
    const config = {
      version: '1.0.0',
      neural: {
        enabled: true,
        defaultModel: 'safla',
        wasmOptimization: true,
        memoryCompression: 0.6
      }
    };
    
    await fs.writeFile(
      path.join(targetDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
    console.log(chalk.gray('  ✓ Created config.json'));
    
    console.log(chalk.green('✅ Neural module initialized successfully!'));
    console.log(chalk.cyan('\n📚 Usage:'));
    console.log(chalk.gray('  @agent-safla-neural "Create self-improving system"'));
    
  } catch (error) {
    console.error(chalk.red('❌ Failed:'), error.message);
    process.exit(1);
  }
}

async function initGoalModule(options) {
  const targetDir = path.resolve(process.cwd(), options.target || '.claude/agents/goal');
  
  console.log(chalk.magenta('🎯 Initializing Claude Flow Goal Module...'));
  
  try {
    // Check if exists
    if (await exists(targetDir) && !options.force) {
      console.log(chalk.yellow('⚠️  Goal module already exists. Use --force to overwrite.'));
      return;
    }
    
    // Create directory
    await fs.mkdir(targetDir, { recursive: true });
    
    // Create goal-planner agent
    const plannerContent = `---
name: goal-planner
description: "Goal-Oriented Action Planning (GOAP) specialist"
color: purple
---

You are a GOAP specialist with:
- A* search algorithms
- OODA loop execution
- Adaptive replanning
- Mixed LLM + code execution

## MCP Integration
\`\`\`javascript
mcp__claude-flow__task_orchestrate {
  task: "achieve_goal",
  strategy: "adaptive"
}
\`\`\`
`;
    
    await fs.writeFile(path.join(targetDir, 'goal-planner.md'), plannerContent);
    console.log(chalk.gray('  ✓ Created goal-planner.md'));
    
    // Create config
    const config = {
      version: '1.0.0',
      goal: {
        enabled: true,
        algorithm: 'astar',
        maxPlanDepth: 100,
        replanning: {
          enabled: true,
          threshold: 0.3
        }
      }
    };
    
    await fs.writeFile(
      path.join(targetDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
    console.log(chalk.gray('  ✓ Created config.json'));
    
    console.log(chalk.green('✅ Goal module initialized successfully!'));
    console.log(chalk.magenta('\n📚 Usage:'));
    console.log(chalk.gray('  @agent-goal-planner "Create deployment plan"'));
    
  } catch (error) {
    console.error(chalk.red('❌ Failed:'), error.message);
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

export default { registerNeuralGoalCommands };