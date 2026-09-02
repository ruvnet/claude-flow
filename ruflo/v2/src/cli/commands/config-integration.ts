/**
 * Configuration integration commands for ruv-swarm
 *
 * These commands provide enhanced configuration management
 * specifically for ruv-swarm integration with Claude Code.
 */

import { success, error, warning, info } from '../cli-core.js';
import type { CommandContext } from '../cli-core.js';
import { configManager } from '../../config/config-manager.js';
import {
  getRuvSwarmIntegration,
  RuvSwarmConfigHelpers,
  initializeRuvSwarmIntegration,
} from '../../config/ruv-swarm-integration.js';

/**
 * Enhanced configuration command with ruv-swarm integration
 */
export async function configIntegrationAction(ctx: CommandContext) {
  if (ctx.flags.help || ctx.flags.h || ctx.args.length === 0) {
    showConfigIntegrationHelp();
    return;
  }

  const subcommand = ctx.args[0];
  const subArgs = ctx.args.slice(1);

  try {
    switch (subcommand) {
      case 'setup':
        await handleSetup(ctx);
        break;
      case 'sync':
        await handleSync(ctx);
        break;
      case 'status':
        await handleStatus(ctx);
        break;
      case 'validate':
        await handleValidate(ctx);
        break;
      case 'preset':
        await handlePreset(ctx);
        break;
      case 'export':
        await handleExport(ctx);
        break;
      case 'import':
        await handleImport(ctx);
        break;
      default:
        error(`Unknown config-integration subcommand: ${subcommand}`);
        showConfigIntegrationHelp();
        break;
    }
  } catch (err) {
    error(`Configuration integration command failed: ${(err as Error).message}`);
  }
}

/**
 * Show configuration integration help
 */
function showConfigIntegrationHelp() {
  console.log('config-integration - Enhanced configuration management with ruv-swarm\\n');

  console.log('Usage:');
  console.log('  claude-flow config-integration <command> [options]\\n');

  console.log('Commands:');
  console.log('  setup                      Initialize ruv-swarm integration');
  console.log('  sync                       Synchronize configurations');
  console.log('  status                     Show integration status');
  console.log('  validate                   Validate all configurations');
  console.log('  preset <type>              Apply configuration preset');
  console.log('  export <file>              Export unified configuration');
  console.log('  import <file>              Import and apply configuration\\n');

  console.log('Presets:');
  console.log('  development                Optimized for development workflows');
  console.log('  research                   Optimized for research and analysis');
  console.log('  production                 Optimized for production environments\\n');

  console.log('Examples:');
  console.log('  claude-flow config-integration setup --enable-ruv-swarm');
  console.log('  claude-flow config-integration preset development');
  console.log('  claude-flow config-integration sync --force');
  console.log('  claude-flow config-integration export my-config.json');
  console.log('  claude-flow config-integration status --verbose');
}

/**
 * Handle setup command
 */
async function handleSetup(ctx: CommandContext) {
  const enableRuvSwarm =
    (ctx.flags.enableRuvSwarm as boolean) || (ctx.flags['enable-ruv-swarm'] as boolean) || true;
  const force = (ctx.flags.force as boolean) || (ctx.flags.f as boolean);

  info('Setting up ruv-swarm integration...');

  try {
    // Enable ruv-swarm in main config if requested
    if (enableRuvSwarm) {
      configManager.setRuvSwarmConfig({ enabled: true });
      await configManager.save();
      success('ruv-swarm enabled in main configuration');
    }

    // Initialize integration
    const result = await initializeRuvSwarmIntegration();

    if (result.success) {
      success('ruv-swarm integration setup completed successfully!');
      console.log(`✅ ${result.message}`);

      // Show quick status
      const integration = getRuvSwarmIntegration();
      const status = integration.getStatus();

      console.log('\\n📋 Integration Status:');
      console.log(`  Enabled: ${status.enabled ? '✅' : '❌'}`);
      console.log(`  Synchronized: ${status.synchronized ? '✅' : '⚠️'}`);
      console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
      console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
      console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
    } else {
      error('ruv-swarm integration setup failed');
      console.log(`❌ ${result.message}`);

      if (force) {
        warning('Continuing despite errors due to --force flag');
      }
    }
  } catch (err) {
    error(`Setup failed: ${(err as Error).message}`);
  }
}

/**
 * Handle sync command
 */
async function handleSync(ctx: CommandContext) {
  const force = (ctx.flags.force as boolean) || (ctx.flags.f as boolean);

  info('Synchronizing configurations...');

  try {
    const integration = getRuvSwarmIntegration();

    // Check current sync status
    const statusBefore = integration.getStatus();
    if (statusBefore.synchronized && !force) {
      success('Configurations are already synchronized');
      return;
    }

    // Perform sync
    integration.syncConfiguration();

    // Verify sync
    const statusAfter = integration.getStatus();

    if (statusAfter.synchronized) {
      success('Configuration synchronization completed');
      console.log('✅ Main config and ruv-swarm config are now synchronized');
    } else {
      warning('Synchronization completed but configurations may still differ');
      console.log('⚠️  Manual review recommended');
    }
  } catch (err) {
    error(`Synchronization failed: ${(err as Error).message}`);
  }
}

/**
 * Handle status command
 */
async function handleStatus(ctx: CommandContext) {
  const verbose = (ctx.flags.verbose as boolean) || (ctx.flags.v as boolean);
  const json = ctx.flags.json as boolean;

  try {
    const integration = getRuvSwarmIntegration();
    const status = integration.getStatus();

    if (json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log('🔧 Configuration Integration Status\\n');

    // Main status
    console.log('📊 Overview:');
    console.log(`  ruv-swarm Enabled: ${status.enabled ? '✅ Yes' : '❌ No'}`);
    console.log(`  Configurations Synchronized: ${status.synchronized ? '✅ Yes' : '⚠️  No'}`);

    // Main configuration
    console.log('\\n⚙️  Main Configuration:');
    console.log(`  Default Topology: ${status.mainConfig.defaultTopology}`);
    console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
    console.log(`  Default Strategy: ${status.mainConfig.defaultStrategy}`);
    console.log(`  Auto Init: ${status.mainConfig.autoInit ? '✅' : '❌'}`);
    console.log(`  Hooks Enabled: ${status.mainConfig.enableHooks ? '✅' : '❌'}`);
    console.log(`  Persistence Enabled: ${status.mainConfig.enablePersistence ? '✅' : '❌'}`);
    console.log(`  Neural Training: ${status.mainConfig.enableNeuralTraining ? '✅' : '❌'}`);

    if (verbose) {
      console.log('\\n🧠 ruv-swarm Configuration:');
      console.log(`  Swarm Max Agents: ${status.ruvSwarmConfig.swarm.maxAgents}`);
      console.log(
        `  Memory Persistence: ${status.ruvSwarmConfig.memory.enablePersistence ? '✅' : '❌'}`,
      );
      console.log(
        `  Neural Training: ${status.ruvSwarmConfig.neural.enableTraining ? '✅' : '❌'}`,
      );
      console.log(`  MCP Tools: ${status.ruvSwarmConfig.integration.enableMCPTools ? '✅' : '❌'}`);
      console.log(
        `  CLI Commands: ${status.ruvSwarmConfig.integration.enableCLICommands ? '✅' : '❌'}`,
      );

      console.log('\\n📈 Monitoring:');
      console.log(
        `  Metrics Enabled: ${status.ruvSwarmConfig.monitoring.enableMetrics ? '✅' : '❌'}`,
      );
      console.log(
        `  Alerts Enabled: ${status.ruvSwarmConfig.monitoring.enableAlerts ? '✅' : '❌'}`,
      );
      console.log(`  CPU Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.cpu}%`);
      console.log(
        `  Memory Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.memory}%`,
      );
    }
  } catch (err) {
    error(`Failed to get status: ${(err as Error).message}`);
  }
}

/**
 * Handle validate command
 */
async function handleValidate(ctx: CommandContext) {
  const fix = (ctx.flags.fix as boolean) || (ctx.flags.f as boolean);

  info('Validating configurations...');

  try {
    const integration = getRuvSwarmIntegration();

    // Validate main config
    console.log('🔍 Validating main configuration...');
    try {
      const mainConfig = configManager.show();
      configManager.validate(mainConfig);
      success('Main configuration is valid');
    } catch (err) {
      error(`Main configuration validation failed: ${(err as Error).message}`);
      if (fix) {
        warning('Auto-fix for main configuration not implemented');
      }
      return;
    }

    // Validate ruv-swarm config
    console.log('🔍 Validating ruv-swarm configuration...');
    const ruvSwarmManager = integration['ruvSwarmManager'];
    const ruvSwarmValidation = ruvSwarmManager.validateConfig();

    if (ruvSwarmValidation.valid) {
      success('ruv-swarm configuration is valid');
    } else {
      error('ruv-swarm configuration validation failed:');
      ruvSwarmValidation.errors.forEach((err) => console.log(`  - ${err}`));

      if (fix) {
        warning('Auto-fix for ruv-swarm configuration not implemented');
      }
      return;
    }

    // Check synchronization
    console.log('🔍 Checking synchronization...');
    const status = integration.getStatus();

    if (status.synchronized) {
      success('Configurations are synchronized');
    } else {
      warning('Configurations are not synchronized');
      if (fix) {
        info('Attempting to synchronize...');
        integration.syncConfiguration();
        success('Synchronization completed');
      }
    }

    success('All validations passed');
  } catch (err) {
    error(`Validation failed: ${(err as Error).message}`);
  }
}

/**
 * Handle preset command
 */
async function handlePreset(ctx: CommandContext) {
  if (ctx.args.length < 2) {
    error('Preset type is required');
    console.log('Available presets: development, research, production');
    return;
  }

  const presetType = ctx.args[1] as 'development' | 'research' | 'production';
  const dryRun = (ctx.flags.dryRun as boolean) || (ctx.flags['dry-run'] as boolean);

  if (!['development', 'research', 'production'].includes(presetType)) {
    error('Invalid preset type');
    console.log('Available presets: development, research, production');
    return;
  }

  try {
    if (dryRun) {
      info(`Showing ${presetType} preset configuration (dry run):`);
      const config = RuvSwarmConfigHelpers.getConfigForUseCase(presetType);
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    info(`Applying ${presetType} preset...`);

    switch (presetType) {
      case 'development':
        RuvSwarmConfigHelpers.setupDevelopmentConfig();
        break;
      case 'research':
        RuvSwarmConfigHelpers.setupResearchConfig();
        break;
      case 'production':
        RuvSwarmConfigHelpers.setupProductionConfig();
        break;
    }

    // Save configuration
    await configManager.save();

    success(`${presetType} preset applied successfully`);

    // Show applied configuration
    const integration = getRuvSwarmIntegration();
    const status = integration.getStatus();

    console.log('\\n📋 Applied Configuration:');
    console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
    console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
    console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
    console.log(
      `  Features: ${Object.entries(status.mainConfig)
        .filter(([key, value]) => key.startsWith('enable') && value)
        .map(([key]) => key.replace('enable', '').toLowerCase())
        .join(', ')}`,
    );
  } catch (err) {
    error(`Failed to apply preset: ${(err as Error).message}`);
  }
}

/**
 * Handle export command
 */
async function handleExport(ctx: CommandContext) {
  if (ctx.args.length < 2) {
    error('Export file path is required');
    console.log('Usage: config-integration export <file>');
    return;
  }

  const filePath = ctx.args[1];
  const format = (ctx.flags.format as string) || 'json';

  try {
    const integration = getRuvSwarmIntegration();
    const status = integration.getStatus();

    const exportData = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      main: status.mainConfig,
      ruvSwarm: status.ruvSwarmConfig,
      unified: integration.getUnifiedCommandArgs(),
    };

    const { writeFile } = await import('fs/promises');

    if (format === 'yaml') {
      // Simple YAML export (basic implementation)
      const yamlContent = `# Claude-Flow Configuration Export
# Generated: ${exportData.timestamp}

main:
${JSON.stringify(exportData.main, null, 2)
  .split('\\n')
  .map((line) => '  ' + line)
  .join('\\n')}

ruvSwarm:
${JSON.stringify(exportData.ruvSwarm, null, 2)
  .split('\\n')
  .map((line) => '  ' + line)
  .join('\\n')}

unified:
${JSON.stringify(exportData.unified, null, 2)
  .split('\\n')
  .map((line) => '  ' + line)
  .join('\\n')}
`;
      await writeFile(filePath, yamlContent, 'utf8');
    } else {
      await writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8');
    }

    success(`Configuration exported to: ${filePath}`);
    console.log(`📄 Format: ${format}`);
    console.log(`📊 Size: ${JSON.stringify(exportData).length} bytes`);
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
  }
}

/**
 * Handle import command
 */
async function handleImport(ctx: CommandContext) {
  if (ctx.args.length < 2) {
    error('Import file path is required');
    console.log('Usage: config-integration import <file>');
    return;
  }

  const filePath = ctx.args[1];
  const dryRun = (ctx.flags.dryRun as boolean) || (ctx.flags['dry-run'] as boolean);
  const force = (ctx.flags.force as boolean) || (ctx.flags.f as boolean);

  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(filePath, 'utf8');

    let importData;
    try {
      importData = JSON.parse(content);
    } catch {
      error('Invalid JSON format in import file');
      return;
    }

    if (!importData.main || !importData.ruvSwarm) {
      error('Import file does not contain required configuration sections');
      return;
    }

    if (dryRun) {
      info('Import preview (dry run):');
      console.log('\\n📋 Main Configuration Changes:');
      console.log(JSON.stringify(importData.main, null, 2));
      console.log('\\n🧠 ruv-swarm Configuration Changes:');
      console.log(JSON.stringify(importData.ruvSwarm, null, 2));
      return;
    }

    if (!force) {
      warning('This will overwrite current configuration');
      console.log('Use --force to proceed or --dry-run to preview changes');
      return;
    }

    info('Importing configuration...');

    const integration = getRuvSwarmIntegration();

    // Update configurations
    integration.updateConfiguration({
      main: importData.main,
      ruvSwarm: importData.ruvSwarm,
    });

    // Save changes
    await configManager.save();

    success('Configuration imported successfully');
    console.log(`📄 Source: ${filePath}`);
    console.log(`📅 Imported: ${importData.timestamp || 'Unknown timestamp'}`);
  } catch (err) {
    error(`Import failed: ${(err as Error).message}`);
  }
}

export default {
  configIntegrationAction,
};
