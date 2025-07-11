import { Command } from 'commander';
import { ConfigManager } from '../../config/config-manager.js';
import { createCliFeatureAdapter } from '../../features/adapters/CliFeatureAdapter.js';

export function createFeaturesCommand(): Command {
  const features = new Command('features')
    .description('Manage transparent features')
    .addHelpText('after', `
Examples:
  claude-flow features list                    # List all available features
  claude-flow features enable auto-format      # Enable the auto-format feature
  claude-flow features disable auto-format     # Disable the auto-format feature
  claude-flow features status                  # Show status of all features
  claude-flow features config auto-format      # Configure a specific feature
`);

  // List features
  features
    .command('list')
    .description('List all available features')
    .option('-v, --verbose', 'Show detailed feature information')
    .action(async (options) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.listFeatures([], options);
    });

  // Enable feature
  features
    .command('enable <feature>')
    .description('Enable a specific feature')
    .action(async (feature) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.enableFeature([feature], {});
    });

  // Disable feature
  features
    .command('disable <feature>')
    .description('Disable a specific feature')
    .action(async (feature) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.disableFeature([feature], {});
    });

  // Toggle feature
  features
    .command('toggle <feature>')
    .description('Toggle a feature on/off')
    .action(async (feature) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.toggleFeature([feature], {});
    });

  // Configure feature
  features
    .command('config <feature>')
    .alias('configure')
    .description('Configure a specific feature')
    .option('-s, --set <key=value>', 'Set a configuration value')
    .option('-g, --get <key>', 'Get a configuration value')
    .option('-r, --reset', 'Reset to default configuration')
    .action(async (feature, options) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.configureFeature([feature], options);
    });

  // Feature status
  features
    .command('status [feature]')
    .description('Show feature status')
    .option('-d, --detailed', 'Show detailed status information')
    .action(async (feature, options) => {
      const configManager = new ConfigManager();
      const adapter = createCliFeatureAdapter(configManager);
      await adapter.showFeatureStatus(feature ? [feature] : [], options);
    });

  return features;
}