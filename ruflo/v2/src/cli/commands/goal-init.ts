#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { logger } from '../../monitoring/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface InitOptions {
  force?: boolean;
  targetDir?: string;
}

export class GoalInitCommand {
  private readonly sourcePath = path.resolve(__dirname, '../../../.claude/agents/goal');
  
  async execute(options: InitOptions = {}): Promise<void> {
    const targetDir = options.targetDir || '.claude/agents/goal';
    const absoluteTarget = path.resolve(process.cwd(), targetDir);
    
    logger.info(chalk.magenta('🎯 Initializing Claude Flow Goal Module...'));
    
    try {
      // Check if target exists
      const exists = await this.checkExists(absoluteTarget);
      
      if (exists && !options.force) {
        logger.warn(chalk.yellow('⚠️  Goal module already exists. Use --force to overwrite.'));
        const prompt = await this.confirmOverwrite();
        if (!prompt) {
          logger.info(chalk.gray('Installation cancelled.'));
          return;
        }
      }
      
      // Create target directory
      await fs.mkdir(absoluteTarget, { recursive: true });
      
      // Copy goal agent files
      await this.copyGoalFiles(absoluteTarget);
      
      // Initialize configuration
      await this.initializeConfig(absoluteTarget);
      
      // Verify installation
      const verified = await this.verifyInstallation(absoluteTarget);
      
      if (verified) {
        logger.success(chalk.green('✅ Goal module initialized successfully!'));
        this.printUsage();
      } else {
        throw new Error('Installation verification failed');
      }
      
    } catch (error) {
      logger.error(chalk.red('❌ Failed to initialize goal module:'), error);
      throw error;
    }
  }
  
  private async checkExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
  
  private async confirmOverwrite(): Promise<boolean> {
    // In a real implementation, this would use inquirer or similar
    // For now, we'll return false to be safe
    console.log(chalk.yellow('Would you like to overwrite? (y/N)'));
    return false;
  }
  
  private async copyGoalFiles(targetDir: string): Promise<void> {
    // Copy goal-planner agent
    const plannerSource = path.join(this.sourcePath, 'goal-planner.md');
    const plannerTarget = path.join(targetDir, 'goal-planner.md');
    
    // Check if source exists in package
    try {
      // First try to copy from local installation
      await fs.copyFile(plannerSource, plannerTarget);
      logger.info(chalk.gray('  • Copied goal-planner.md'));
    } catch (error) {
      // If not found locally, create from embedded template
      await this.createPlannerTemplate(plannerTarget);
      logger.info(chalk.gray('  • Created goal-planner.md from template'));
    }
    
    // Create additional goal agents if needed
    await this.createGoalAgents(targetDir);
  }
  
  private async createPlannerTemplate(targetPath: string): Promise<void> {
    const template = `---
name: goal-planner
description: "Goal-Oriented Action Planning (GOAP) specialist"
color: purple
---

# Goal-Oriented Action Planning Agent

Uses gaming AI techniques to create intelligent plans for achieving complex objectives.

## Core Capabilities
- Dynamic planning with A* search algorithms
- Precondition analysis and effect prediction
- Adaptive replanning based on execution results
- Mixed execution (LLM + deterministic code)
- Tool group management

## Planning Methodology
1. **State Assessment**: Analyze current vs goal state
2. **Action Analysis**: Inventory available actions
3. **Plan Generation**: A* pathfinding for optimal sequences
4. **Execution Monitoring**: OODA loop (Observe-Orient-Decide-Act)
5. **Dynamic Replanning**: Adapt to changing conditions

## Usage
\`\`\`bash
# Initialize goal planning
npx claude-flow goal plan --objective "deploy application"

# Execute plan
npx claude-flow goal execute --plan deployment-plan
\`\`\`
`;
    await fs.writeFile(targetPath, template);
  }
  
  private async createGoalAgents(targetDir: string): Promise<void> {
    // Create additional goal-oriented agents
    const agents = [
      {
        name: 'goal-executor.md',
        content: this.getExecutorTemplate()
      },
      {
        name: 'goal-monitor.md',
        content: this.getMonitorTemplate()
      },
      {
        name: 'goal-optimizer.md',
        content: this.getOptimizerTemplate()
      }
    ];
    
    for (const agent of agents) {
      const targetPath = path.join(targetDir, agent.name);
      await fs.writeFile(targetPath, agent.content);
      logger.info(chalk.gray(`  • Created ${agent.name}`));
    }
  }
  
  private getExecutorTemplate(): string {
    return `---
name: goal-executor
description: "Executes goal-oriented action plans"
color: green
---

# Goal Executor Agent

Responsible for executing action plans generated by the goal-planner.

## Features
- Sequential and parallel action execution
- Precondition verification
- Effect validation
- Rollback on failure
`;
  }
  
  private getMonitorTemplate(): string {
    return `---
name: goal-monitor
description: "Monitors goal progress and triggers replanning"
color: yellow
---

# Goal Monitor Agent

Tracks plan execution and identifies when replanning is needed.

## Features
- Real-time progress tracking
- Deviation detection
- Performance metrics
- Replanning triggers
`;
  }
  
  private getOptimizerTemplate(): string {
    return `---
name: goal-optimizer
description: "Optimizes action plans for efficiency"
color: blue
---

# Goal Optimizer Agent

Optimizes action sequences for cost, time, and resource efficiency.

## Features
- Cost minimization
- Parallel execution identification
- Resource allocation
- Plan compression
`;
  }
  
  private async initializeConfig(targetDir: string): Promise<void> {
    const config = {
      version: '1.0.0',
      goal: {
        enabled: true,
        algorithm: 'astar',
        maxPlanDepth: 100,
        replanning: {
          enabled: true,
          threshold: 0.3,
          maxRetries: 3
        },
        execution: {
          mode: 'mixed',  // mixed, llm, code
          parallel: true,
          monitoring: true
        }
      },
      agents: [
        'goal-planner',
        'goal-executor',
        'goal-monitor',
        'goal-optimizer'
      ]
    };
    
    const configPath = path.join(targetDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    logger.info(chalk.gray('  • Created goal config.json'));
  }
  
  private async verifyInstallation(targetDir: string): Promise<boolean> {
    const requiredFiles = [
      'goal-planner.md',
      'goal-executor.md',
      'goal-monitor.md',
      'goal-optimizer.md',
      'config.json'
    ];
    
    for (const file of requiredFiles) {
      const filePath = path.join(targetDir, file);
      const exists = await this.checkExists(filePath);
      if (!exists) {
        logger.error(chalk.red(`  ✗ Missing required file: ${file}`));
        return false;
      }
      logger.info(chalk.gray(`  ✓ Verified ${file}`));
    }
    
    return true;
  }
  
  private printUsage(): void {
    console.log('\n' + chalk.magenta('📚 Usage:'));
    console.log(chalk.gray('  npx claude-flow goal plan --objective "your goal"'));
    console.log(chalk.gray('  npx claude-flow goal execute --plan plan-id'));
    console.log(chalk.gray('  @agent-goal-planner "Create deployment plan"'));
    console.log('\n' + chalk.magenta('🔗 Documentation:'));
    console.log(chalk.gray('  https://github.com/ruvnet/claude-flow'));
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = new GoalInitCommand();
  const options: InitOptions = {};
  
  if (process.argv.includes('--force')) {
    options.force = true;
  }
  
  const targetIndex = process.argv.indexOf('--target');
  if (targetIndex !== -1 && process.argv[targetIndex + 1]) {
    options.targetDir = process.argv[targetIndex + 1];
  }
  
  command.execute(options).catch(process.exit);
}

export default GoalInitCommand;