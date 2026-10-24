/**
 * Agent CLI Commands - Execute agents with agentic-flow
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { AgentExecutor } from '../../execution/agent-executor.js';
import { ProviderManager } from '../../execution/provider-manager.js';

export function createAgentCommand(): Command {
  const agent = new Command('agent')
    .description('Execute and manage AI agents with multi-provider support');

  // agent run command
  agent
    .command('run')
    .description('Execute an agent with a specific task')
    .argument('<agent-name>', 'Agent to execute (e.g., coder, researcher)')
    .argument('<task>', 'Task description for the agent')
    .option('-p, --provider <provider>', 'Provider to use (anthropic, openrouter, onnx, gemini)')
    .option('-m, --model <model>', 'Model to use')
    .option('-t, --temperature <temp>', 'Temperature (0.0-1.0)', parseFloat)
    .option('--max-tokens <tokens>', 'Maximum tokens', parseInt)
    .option('-f, --format <format>', 'Output format (text, json, markdown)', 'text')
    .option('--stream', 'Enable streaming output')
    .option('-v, --verbose', 'Verbose output')
    .action(async (agentName, task, options) => {
      const spinner = ora('Executing agent...').start();

      try {
        const executor = new AgentExecutor();
        const providerManager = new ProviderManager();

        // Use specified provider or default
        const provider = options.provider || providerManager.getDefaultProvider();

        const result = await executor.execute({
          agent: agentName,
          task: task,
          provider: provider as any,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          outputFormat: options.format,
          stream: options.stream,
          verbose: options.verbose,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓ Agent execution completed\n'));
          console.log(result.output);

          if (options.verbose) {
            console.log(chalk.gray(`\nProvider: ${result.provider}`));
            console.log(chalk.gray(`Duration: ${result.duration}ms`));
            if (result.tokens) console.log(chalk.gray(`Tokens: ${result.tokens}`));
            if (result.cost) console.log(chalk.gray(`Cost: $${result.cost.toFixed(4)}`));
          }
        } else {
          console.error(chalk.red('✗ Agent execution failed'));
          console.error(result.error);
          process.exit(1);
        }
      } catch (error: any) {
        spinner.stop();
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // agent list command
  agent
    .command('list')
    .description('List available agents')
    .option('-s, --source <source>', 'Filter by source (all, package, local)', 'all')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .action(async (options) => {
      const spinner = ora('Loading agents...').start();

      try {
        const executor = new AgentExecutor();
        const agents = await executor.listAgents(options.source as any);

        spinner.stop();

        if (options.format === 'json') {
          console.log(JSON.stringify(agents, null, 2));
        } else {
          console.log(chalk.cyan(`\n📋 Available Agents (${agents.length}):\n`));
          agents.forEach(agent => {
            console.log(chalk.white(`  • ${agent}`));
          });
          console.log('');
        }
      } catch (error: any) {
        spinner.stop();
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // agent info command
  agent
    .command('info')
    .description('Get information about a specific agent')
    .argument('<agent-name>', 'Agent name')
    .action(async (agentName) => {
      const spinner = ora('Loading agent info...').start();

      try {
        const executor = new AgentExecutor();
        const info = await executor.getAgentInfo(agentName);

        spinner.stop();

        if (info) {
          console.log(chalk.cyan(`\n📝 Agent: ${agentName}\n`));
          console.log(chalk.white(`Description: ${info.description || 'N/A'}`));
          console.log(chalk.white(`Category: ${info.category || 'N/A'}`));
          console.log(chalk.white(`Source: ${info.source || 'N/A'}`));
          console.log('');
        } else {
          console.error(chalk.red('✗ Agent not found'));
          process.exit(1);
        }
      } catch (error: any) {
        spinner.stop();
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  return agent;
}
