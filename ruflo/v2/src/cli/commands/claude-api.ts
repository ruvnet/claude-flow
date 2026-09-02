/**
 * Claude API management commands
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { Command } from '../commander-fix.js';
import { ConfigManager } from '../../config/config-manager.js';
import { ClaudeAPIClient, ClaudeModel } from '../../api/claude-client.js';
import { Logger } from '../../core/logger.js';
import { getErrorMessage } from '../../utils/error-handler.js';

export const claudeApiCommand = new Command()
  .name('claude-api')
  .description('Manage Claude API configuration and test connectivity')
  .action(() => {
    claudeApiCommand.help();
  });

// Configure command
claudeApiCommand
  .command('configure')
  .description('Configure Claude API settings')
  .option('--api-key <key>', 'Claude API key')
  .option('--model <model>', 'Claude model to use')
  .option('--temperature <temp>', 'Temperature (0.0-1.0)', parseFloat)
  .option('--max-tokens <tokens>', 'Maximum tokens', parseInt)
  .option('--interactive', 'Interactive configuration')
  .action(async (options: any) => {
    try {
      const configManager = ConfigManager.getInstance();
      let config = configManager.getClaudeConfig();

      if (options.interactive) {
        console.log(chalk.blue('🤖 Claude API Configuration'));
        console.log('Configure your Claude API settings.\n');

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'apiKey',
            message: 'Enter your Claude API key:',
            default: config.apiKey || process.env.ANTHROPIC_API_KEY,
            validate: (input) => (input ? true : 'API key is required'),
          },
          {
            type: 'list',
            name: 'model',
            message: 'Select Claude model:',
            choices: [
              { name: 'Claude 3 Opus (Most capable)', value: 'claude-3-opus-20240229' },
              { name: 'Claude 3 Sonnet (Balanced)', value: 'claude-3-sonnet-20240229' },
              { name: 'Claude 3 Haiku (Fastest)', value: 'claude-3-haiku-20240307' },
              { name: 'Claude 2.1', value: 'claude-2.1' },
              { name: 'Claude 2.0', value: 'claude-2.0' },
              { name: 'Claude Instant 1.2', value: 'claude-instant-1.2' },
            ],
            default: config.model || 'claude-3-sonnet-20240229',
          },
          {
            type: 'input',
            name: 'temperature',
            message: 'Temperature (0.0-1.0):',
            default: config.temperature?.toString() || '0.7',
            validate: (input) => {
              const num = parseFloat(input);
              return num >= 0 && num <= 1 ? true : 'Temperature must be between 0.0 and 1.0';
            },
            filter: (input) => parseFloat(input),
          },
          {
            type: 'input',
            name: 'maxTokens',
            message: 'Maximum tokens:',
            default: config.maxTokens?.toString() || '4096',
            validate: (input) => {
              const num = parseInt(input);
              return num > 0 && num <= 100000 ? true : 'Max tokens must be between 1 and 100000';
            },
            filter: (input) => parseInt(input),
          },
        ]);

        config = { ...config, ...answers };
      } else {
        // Non-interactive mode
        if (options.apiKey) config.apiKey = options.apiKey;
        if (options.model) config.model = options.model;
        if (options.temperature !== undefined) config.temperature = options.temperature;
        if (options.maxTokens !== undefined) config.maxTokens = options.maxTokens;
      }

      // Update configuration
      configManager.setClaudeConfig(config);
      await configManager.save();

      console.log(chalk.green('✅ Claude API configuration saved'));
      console.log(chalk.gray(`Model: ${config.model}`));
      console.log(chalk.gray(`Temperature: ${config.temperature}`));
      console.log(chalk.gray(`Max tokens: ${config.maxTokens}`));
    } catch (error) {
      console.error(chalk.red('❌ Failed to configure Claude API:'), getErrorMessage(error));
      process.exit(1);
    }
  });

// Test command
claudeApiCommand
  .command('test')
  .description('Test Claude API connectivity')
  .option('--model <model>', 'Model to test')
  .option('--temperature <temp>', 'Temperature for test', parseFloat)
  .option(
    '--prompt <prompt>',
    'Test prompt',
    'Hello, Claude! Please respond with a brief greeting.',
  )
  .action(async (options: any) => {
    try {
      const configManager = ConfigManager.getInstance();

      if (!configManager.isClaudeAPIConfigured()) {
        console.error(chalk.red('❌ Claude API not configured. Run "claude-api configure" first.'));
        process.exit(1);
      }

      console.log(chalk.blue('🧪 Testing Claude API connectivity...'));

      const logger = new Logger({ level: 'info', format: 'text', destination: 'console' });
      const client = new ClaudeAPIClient(logger, configManager);

      const testOptions: any = {};
      if (options.model) testOptions.model = options.model;
      if (options.temperature !== undefined) testOptions.temperature = options.temperature;

      const start = Date.now();
      const response = await client.complete(options.prompt, testOptions);
      const duration = Date.now() - start;

      console.log(chalk.green('✅ Claude API test successful!'));
      console.log(chalk.gray(`Duration: ${duration}ms`));
      console.log(chalk.cyan('\nResponse:'));
      console.log(response);
    } catch (error) {
      console.error(chalk.red('❌ Claude API test failed:'), getErrorMessage(error));
      process.exit(1);
    }
  });

// Status command
claudeApiCommand
  .command('status')
  .description('Show Claude API configuration status')
  .action(async () => {
    try {
      const configManager = ConfigManager.getInstance();
      const config = configManager.getClaudeConfig();
      const isConfigured = configManager.isClaudeAPIConfigured();

      console.log(chalk.blue('🤖 Claude API Status\n'));

      if (isConfigured) {
        console.log(chalk.green('✅ Configured'));
        console.log(chalk.gray(`Model: ${config.model || 'claude-3-sonnet-20240229'}`));
        console.log(chalk.gray(`Temperature: ${config.temperature ?? 0.7}`));
        console.log(chalk.gray(`Max tokens: ${config.maxTokens || 4096}`));
        console.log(chalk.gray(`API key: ${config.apiKey ? '***masked***' : 'Not set'}`));

        if (process.env.ANTHROPIC_API_KEY && !config.apiKey) {
          console.log(
            chalk.yellow('⚠️  Using API key from ANTHROPIC_API_KEY environment variable'),
          );
        }
      } else {
        console.log(chalk.red('❌ Not configured'));
        console.log(chalk.gray('Run "claude-api configure" to set up Claude API.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Failed to get status:'), getErrorMessage(error));
      process.exit(1);
    }
  });

// Models command
claudeApiCommand
  .command('models')
  .description('List available Claude models')
  .action(() => {
    console.log(chalk.blue('📋 Available Claude Models\n'));

    const models = [
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        description: 'Most capable model, best for complex tasks',
        contextWindow: '200K tokens',
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        description: 'Balanced performance and speed',
        contextWindow: '200K tokens',
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        description: 'Fastest model, best for simple tasks',
        contextWindow: '200K tokens',
      },
      {
        id: 'claude-2.1',
        name: 'Claude 2.1',
        description: 'Previous generation, enhanced capabilities',
        contextWindow: '200K tokens',
      },
      {
        id: 'claude-2.0',
        name: 'Claude 2.0',
        description: 'Previous generation model',
        contextWindow: '100K tokens',
      },
      {
        id: 'claude-instant-1.2',
        name: 'Claude Instant 1.2',
        description: 'Fast, cost-effective model',
        contextWindow: '100K tokens',
      },
    ];

    models.forEach((model) => {
      console.log(chalk.cyan(`${model.name} (${model.id})`));
      console.log(chalk.gray(`  ${model.description}`));
      console.log(chalk.gray(`  Context: ${model.contextWindow}\n`));
    });
  });

// Update command
claudeApiCommand
  .command('update')
  .description('Update specific Claude API settings')
  .option('--model <model>', 'Update model')
  .option('--temperature <temp>', 'Update temperature', parseFloat)
  .option('--max-tokens <tokens>', 'Update max tokens', parseInt)
  .action(async (options: any) => {
    try {
      const configManager = ConfigManager.getInstance();

      if (!configManager.isClaudeAPIConfigured()) {
        console.error(chalk.red('❌ Claude API not configured. Run "claude-api configure" first.'));
        process.exit(1);
      }

      const updates: any = {};
      if (options.model) updates.model = options.model;
      if (options.temperature !== undefined) updates.temperature = options.temperature;
      if (options.maxTokens !== undefined) updates.maxTokens = options.maxTokens;

      if (Object.keys(updates).length === 0) {
        console.log(
          chalk.yellow('⚠️  No updates specified. Use --model, --temperature, or --max-tokens.'),
        );
        return;
      }

      configManager.setClaudeConfig(updates);
      await configManager.save();

      console.log(chalk.green('✅ Claude API configuration updated'));
      Object.entries(updates).forEach(([key, value]) => {
        console.log(chalk.gray(`${key}: ${value}`));
      });
    } catch (error) {
      console.error(chalk.red('❌ Failed to update configuration:'), getErrorMessage(error));
      process.exit(1);
    }
  });
