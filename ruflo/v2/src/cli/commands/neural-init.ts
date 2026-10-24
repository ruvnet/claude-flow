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

export class NeuralInitCommand {
  private readonly sourcePath = path.resolve(__dirname, '../../../.claude/agents/neural');
  
  async execute(options: InitOptions = {}): Promise<void> {
    const targetDir = options.targetDir || '.claude/agents/neural';
    const absoluteTarget = path.resolve(process.cwd(), targetDir);
    
    logger.info(chalk.cyan('🧠 Initializing Claude Flow Neural Module...'));
    
    try {
      // Check if target exists
      const exists = await this.checkExists(absoluteTarget);
      
      if (exists && !options.force) {
        logger.warn(chalk.yellow('⚠️  Neural module already exists. Use --force to overwrite.'));
        const prompt = await this.confirmOverwrite();
        if (!prompt) {
          logger.info(chalk.gray('Installation cancelled.'));
          return;
        }
      }
      
      // Create target directory
      await fs.mkdir(absoluteTarget, { recursive: true });
      
      // Copy neural agent files
      await this.copyNeuralFiles(absoluteTarget);
      
      // Initialize configuration
      await this.initializeConfig(absoluteTarget);
      
      // Verify installation
      const verified = await this.verifyInstallation(absoluteTarget);
      
      if (verified) {
        logger.success(chalk.green('✅ Neural module initialized successfully!'));
        this.printUsage();
      } else {
        throw new Error('Installation verification failed');
      }
      
    } catch (error) {
      logger.error(chalk.red('❌ Failed to initialize neural module:'), error);
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
  
  private async copyNeuralFiles(targetDir: string): Promise<void> {
    // Copy SAFLA neural agent
    const saflaSource = path.join(this.sourcePath, 'safla-neural.md');
    const saflaTarget = path.join(targetDir, 'safla-neural.md');
    
    // Check if source exists in package
    try {
      // First try to copy from local installation
      await fs.copyFile(saflaSource, saflaTarget);
      logger.info(chalk.gray('  • Copied safla-neural.md'));
    } catch (error) {
      // If not found locally, create from embedded template
      await this.createSaflaTemplate(saflaTarget);
      logger.info(chalk.gray('  • Created safla-neural.md from template'));
    }
    
    // Create additional neural agents if needed
    await this.createNeuralAgents(targetDir);
  }
  
  private async createSaflaTemplate(targetPath: string): Promise<void> {
    const template = `---
name: safla-neural
description: "Self-Aware Feedback Loop Algorithm (SAFLA) neural specialist"
color: cyan
---

# SAFLA Neural Agent

Integrated with Claude Flow neural system for persistent memory and self-learning capabilities.

## Core Features
- 4-tier memory architecture (Vector, Episodic, Semantic, Working)
- Feedback loop engineering for continuous improvement
- 172,000+ operations per second
- 60% memory compression
- WASM SIMD optimization

## Usage
\`\`\`bash
# Initialize SAFLA neural training
npx claude-flow neural train --type safla

# Run inference
npx claude-flow neural predict --model safla
\`\`\`
`;
    await fs.writeFile(targetPath, template);
  }
  
  private async createNeuralAgents(targetDir: string): Promise<void> {
    // Create additional neural agent templates
    const agents = [
      {
        name: 'neural-trainer.md',
        content: this.getTrainerTemplate()
      },
      {
        name: 'neural-predictor.md',
        content: this.getPredictorTemplate()
      }
    ];
    
    for (const agent of agents) {
      const targetPath = path.join(targetDir, agent.name);
      await fs.writeFile(targetPath, agent.content);
      logger.info(chalk.gray(`  • Created ${agent.name}`));
    }
  }
  
  private getTrainerTemplate(): string {
    return `---
name: neural-trainer
description: "Neural network training specialist"
color: purple
---

# Neural Trainer Agent

Manages distributed neural network training with Claude Flow.
`;
  }
  
  private getPredictorTemplate(): string {
    return `---
name: neural-predictor  
description: "Neural inference and prediction specialist"
color: blue
---

# Neural Predictor Agent

Handles neural network inference and predictions.
`;
  }
  
  private async initializeConfig(targetDir: string): Promise<void> {
    const config = {
      version: '1.0.0',
      neural: {
        enabled: true,
        defaultModel: 'safla',
        wasmOptimization: true,
        memoryCompression: 0.6,
        operationsPerSecond: 172000
      },
      agents: [
        'safla-neural',
        'neural-trainer',
        'neural-predictor'
      ]
    };
    
    const configPath = path.join(targetDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    logger.info(chalk.gray('  • Created neural config.json'));
  }
  
  private async verifyInstallation(targetDir: string): Promise<boolean> {
    const requiredFiles = [
      'safla-neural.md',
      'neural-trainer.md',
      'neural-predictor.md',
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
    console.log('\n' + chalk.cyan('📚 Usage:'));
    console.log(chalk.gray('  npx claude-flow neural train --type safla'));
    console.log(chalk.gray('  npx claude-flow neural predict --model safla'));
    console.log(chalk.gray('  @agent-safla-neural "Create self-improving system"'));
    console.log('\n' + chalk.cyan('🔗 Documentation:'));
    console.log(chalk.gray('  https://github.com/ruvnet/SAFLA'));
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = new NeuralInitCommand();
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

export default NeuralInitCommand;