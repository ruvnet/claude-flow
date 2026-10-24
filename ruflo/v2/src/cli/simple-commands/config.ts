/**
 * Config CLI Commands - Manage provider configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ProviderManager } from '../../execution/provider-manager.js';

export function createConfigCommand(): Command {
  const config = new Command('config')
    .description('Manage provider configuration');

  // config set-provider command
  config
    .command('set-provider')
    .description('Set default provider')
    .argument('<provider>', 'Provider name (anthropic, openrouter, onnx, gemini)')
    .option('-m, --model <model>', 'Default model for provider')
    .action(async (provider, options) => {
      try {
        const manager = new ProviderManager();

        await manager.setDefaultProvider(provider);

        if (options.model) {
          await manager.configureProvider(provider, {
            model: options.model,
            enabled: true,
          } as any);
        }

        console.log(chalk.green(`✓ Default provider set to: ${provider}`));
        if (options.model) {
          console.log(chalk.green(`✓ Default model set to: ${options.model}`));
        }
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // config list-providers command
  config
    .command('list-providers')
    .alias('list')
    .description('List configured providers')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .action(async (options) => {
      try {
        const manager = new ProviderManager();
        const providers = manager.listProviders();
        const defaultProvider = manager.getDefaultProvider();

        if (options.format === 'json') {
          console.log(JSON.stringify({ defaultProvider, providers }, null, 2));
        } else {
          console.log(chalk.cyan('\n📋 Configured Providers:\n'));
          console.log(chalk.white(`Default: ${chalk.bold(defaultProvider)}\n`));

          providers.forEach(provider => {
            const isDefault = provider.name === defaultProvider;
            const prefix = isDefault ? chalk.green('●') : chalk.gray('○');
            const status = provider.enabled ? chalk.green('enabled') : chalk.gray('disabled');

            console.log(`${prefix} ${chalk.bold(provider.name)}`);
            console.log(`  Model: ${provider.model || 'default'}`);
            console.log(`  Priority: ${provider.priority || 'balanced'}`);
            console.log(`  Status: ${status}`);
            console.log('');
          });
        }
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // config wizard command
  config
    .command('wizard')
    .description('Interactive provider configuration wizard')
    .action(async () => {
      try {
        const manager = new ProviderManager();

        console.log(chalk.cyan('\n🧙 Provider Configuration Wizard\n'));

        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'defaultProvider',
            message: 'Select default provider:',
            choices: [
              { name: 'Anthropic (Highest quality)', value: 'anthropic' },
              { name: 'OpenRouter (99% cost savings)', value: 'openrouter' },
              { name: 'ONNX (Free local inference)', value: 'onnx' },
              { name: 'Gemini (Free tier)', value: 'gemini' },
            ],
          },
          {
            type: 'list',
            name: 'optimization',
            message: 'Optimization priority:',
            choices: [
              { name: 'Balanced (recommended)', value: 'balanced' },
              { name: 'Cost (cheapest)', value: 'cost' },
              { name: 'Quality (best results)', value: 'quality' },
              { name: 'Speed (fastest)', value: 'speed' },
              { name: 'Privacy (local only)', value: 'privacy' },
            ],
          },
        ]);

        await manager.setDefaultProvider(answers.defaultProvider);

        console.log(chalk.green('\n✓ Configuration saved successfully!'));
        console.log(chalk.gray(`\nDefault provider: ${answers.defaultProvider}`));
        console.log(chalk.gray(`Optimization: ${answers.optimization}`));
      } catch (error: any) {
        console.error(chalk.red('\n✗ Error:'), error.message);
        process.exit(1);
      }
    });

  return config;
}
