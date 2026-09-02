#!/usr/bin/env node
/**
 * Integrated Training and Stream Chaining System
 * Combines real code training with stream-based agent chaining
 */

import fs from 'fs/promises';
import { spawn } from 'child_process';
import { TrainingPipeline } from './training-pipeline.js';

export class TrainAndStreamSystem {
  constructor() {
    this.trainingPipeline = new TrainingPipeline();
    this.streamConfig = '.claude-flow/stream-config.json';
  }

  /**
   * Train agents and then use them in a stream chain
   */
  async trainAndExecute(task, options = {}) {
    console.log('🎯 Integrated Training & Stream Execution');
    console.log('━'.repeat(50));

    // Step 1: Run training to improve agent profiles
    console.log('\n📚 Phase 1: Training Agents with Real Code');
    console.log('─'.repeat(40));
    
    await this.trainingPipeline.initialize();
    const trainingResult = await this.trainingPipeline.runFullPipeline({
      complexity: options.complexity || 'medium',
      iterations: options.iterations || 2,
      validate: true
    });

    // Step 2: Load trained profiles
    const profiles = JSON.parse(
      await fs.readFile('.claude-flow/agents/profiles.json', 'utf8')
    );

    // Step 3: Select best strategy based on task requirements
    const strategy = this.selectOptimalStrategy(profiles, options);
    console.log(`\n🎯 Selected Strategy: ${strategy.name}`);
    console.log(`   Success Rate: ${(strategy.profile.successRate * 100).toFixed(1)}%`);
    console.log(`   Avg Score: ${strategy.profile.avgScore.toFixed(2)}`);
    console.log(`   Execution Time: ${strategy.profile.avgExecutionTime.toFixed(0)}ms`);

    // Step 4: Execute stream chain with trained agents
    console.log('\n🔗 Phase 2: Stream Chain Execution');
    console.log('─'.repeat(40));
    
    const result = await this.executeStreamChain(task, strategy, options);
    
    // Step 5: Learn from execution results
    await this.updateProfilesFromExecution(strategy.name, result);

    return {
      training: trainingResult,
      execution: result,
      strategy: strategy.name,
      performance: {
        trainingImprovement: trainingResult.improvements,
        executionTime: result.duration,
        success: result.success
      }
    };
  }

  /**
   * Select optimal strategy based on task requirements
   */
  selectOptimalStrategy(profiles, options) {
    const priorities = options.priorities || {
      reliability: 0.4,
      speed: 0.3,
      score: 0.3
    };

    let bestScore = -1;
    let bestStrategy = null;

    for (const [name, profile] of Object.entries(profiles)) {
      const score = 
        (profile.successRate * priorities.reliability) +
        ((1 - profile.avgExecutionTime / 5000) * priorities.speed) +
        (profile.avgScore / 100 * priorities.score);

      if (score > bestScore) {
        bestScore = score;
        bestStrategy = { name, profile, score };
      }
    }

    return bestStrategy;
  }

  /**
   * Execute a stream chain with multiple agents
   */
  async executeStreamChain(task, strategy, options) {
    const startTime = Date.now();
    const steps = this.decomposeTask(task, strategy.name);
    
    console.log(`\n📝 Task decomposed into ${steps.length} steps:`);
    steps.forEach((step, i) => {
      console.log(`   ${i + 1}. ${step.description}`);
    });

    let inputStream = null;
    let lastOutput = null;
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`\n🔄 Executing Step ${i + 1}: ${step.description}`);
      
      const output = await this.executeStreamStep(
        step,
        inputStream,
        i === steps.length - 1 // isLast
      );
      
      results.push({
        step: i + 1,
        description: step.description,
        output: output.summary,
        duration: output.duration
      });

      inputStream = output.stream;
      lastOutput = output;
    }

    const totalDuration = Date.now() - startTime;
    
    console.log('\n✅ Stream Chain Complete');
    console.log(`   Total Duration: ${totalDuration}ms`);
    console.log(`   Steps Completed: ${results.length}`);

    return {
      success: true,
      duration: totalDuration,
      steps: results,
      finalOutput: lastOutput.summary
    };
  }

  /**
   * Execute a single step in the stream chain
   */
  async executeStreamStep(step, inputStream, isLast) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Build command arguments
      const args = ['-p'];
      if (inputStream) {
        args.push('--input-format', 'stream-json');
      }
      if (!isLast) {
        args.push('--output-format', 'stream-json');
      }
      args.push(step.prompt);

      // Spawn Claude process
      const claudeProcess = spawn('claude', args, {
        stdio: inputStream ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe']
      });

      let output = '';
      let streamOutput = '';

      // Pipe input if available
      if (inputStream && claudeProcess.stdin) {
        inputStream.pipe(claudeProcess.stdin);
      }

      // Capture output
      claudeProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        if (!isLast) {
          streamOutput += chunk;
        }
      });

      claudeProcess.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        // Parse output for summary
        let summary = 'Step completed';
        try {
          if (output.includes('"type":"message"')) {
            const lines = output.split('\n');
            for (const line of lines) {
              if (line.includes('"type":"message"')) {
                const parsed = JSON.parse(line);
                if (parsed.content && parsed.content[0]) {
                  summary = parsed.content[0].text?.slice(0, 100) || summary;
                  break;
                }
              }
            }
          } else {
            summary = output.slice(0, 100);
          }
        } catch (e) {
          // Fallback to raw output
          summary = output.slice(0, 100);
        }

        resolve({
          success: code === 0,
          duration,
          summary,
          stream: !isLast ? streamOutput : null
        });
      });
    });
  }

  /**
   * Decompose task into stream chain steps
   */
  decomposeTask(task, strategy) {
    // Different decomposition based on strategy
    if (strategy === 'conservative') {
      return [
        {
          description: 'Thorough analysis and validation',
          prompt: `Analyze this task thoroughly and identify all requirements: ${task}`
        },
        {
          description: 'Detailed planning with error handling',
          prompt: 'Create a detailed implementation plan with comprehensive error handling'
        },
        {
          description: 'Safe implementation with validation',
          prompt: 'Implement the solution with extensive validation and safety checks'
        }
      ];
    } else if (strategy === 'aggressive') {
      return [
        {
          description: 'Quick analysis',
          prompt: `Quickly analyze and implement: ${task}`
        },
        {
          description: 'Optimization pass',
          prompt: 'Optimize the implementation for maximum performance'
        }
      ];
    } else {
      // Balanced
      return [
        {
          description: 'Analysis and design',
          prompt: `Analyze and design a solution for: ${task}`
        },
        {
          description: 'Implementation',
          prompt: 'Implement the designed solution'
        },
        {
          description: 'Review and refinement',
          prompt: 'Review the implementation and make necessary refinements'
        }
      ];
    }
  }

  /**
   * Update profiles based on execution results
   */
  async updateProfilesFromExecution(strategy, result) {
    const profiles = JSON.parse(
      await fs.readFile('.claude-flow/agents/profiles.json', 'utf8')
    );

    if (profiles[strategy]) {
      const profile = profiles[strategy];
      const executionScore = result.success ? 80 : 20;
      const timeScore = Math.max(0, 100 - result.duration / 100);
      const overallScore = (executionScore + timeScore) / 2;

      // Update with learning
      const learningRate = 0.2;
      profile.avgScore = profile.avgScore * (1 - learningRate) + overallScore * learningRate;
      profile.avgExecutionTime = profile.avgExecutionTime * (1 - learningRate) + result.duration * learningRate;
      profile.uses++;

      // Add to trend
      if (!profile.trend) profile.trend = [];
      profile.trend.push({
        score: overallScore,
        timestamp: new Date().toISOString(),
        streamExecution: true
      });

      await fs.writeFile(
        '.claude-flow/agents/profiles.json',
        JSON.stringify(profiles, null, 2)
      );
    }
  }
}

/**
 * CLI Command Handler
 */
export async function trainAndStreamCommand(args, flags) {
  const system = new TrainAndStreamSystem();
  const task = args.join(' ') || 'Create a function to validate email addresses';

  console.log('🚀 Train & Stream System');
  console.log(`📋 Task: ${task}`);
  console.log('');

  const options = {
    complexity: flags.complexity || 'medium',
    iterations: parseInt(flags.iterations) || 2,
    priorities: {
      reliability: parseFloat(flags.reliability) || 0.4,
      speed: parseFloat(flags.speed) || 0.3,
      score: parseFloat(flags.score) || 0.3
    }
  };

  try {
    const result = await system.trainAndExecute(task, options);
    
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Final Report');
    console.log('═'.repeat(50));
    
    console.log('\n🎯 Strategy Used:', result.strategy);
    console.log('⏱️  Total Execution Time:', result.performance.executionTime + 'ms');
    console.log('✅ Success:', result.performance.success ? 'Yes' : 'No');
    
    if (result.performance.trainingImprovement) {
      console.log('\n📈 Training Improvements:');
      console.log(`   Success Rate: ${result.performance.trainingImprovement.successRate > 0 ? '+' : ''}${result.performance.trainingImprovement.successRate.toFixed(1)}%`);
      console.log(`   Score: ${result.performance.trainingImprovement.score > 0 ? '+' : ''}${result.performance.trainingImprovement.score.toFixed(1)}%`);
    }

    console.log('\n🔗 Stream Chain Steps:');
    for (const step of result.execution.steps) {
      console.log(`   ${step.step}. ${step.description} (${step.duration}ms)`);
      console.log(`      Output: ${step.output.slice(0, 60)}...`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

export default TrainAndStreamSystem;