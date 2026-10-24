// batch-manager.js - Batch configuration management utility
import { printSuccess, printError, printInfo, printWarning } from '../utils.js';
import { promises as fs } from 'fs';
import { PROJECT_TEMPLATES, ENVIRONMENT_CONFIGS } from './init/batch-init.js';
import { cwd, exit, existsSync } from '../node-compat.js';

export async function batchManagerCommand(subArgs, flags) {
  const command = subArgs[0];

  switch (command) {
    case 'create-config':
      return await createBatchConfig(subArgs.slice(1), flags);
    case 'validate-config':
      return await validateBatchConfig(subArgs.slice(1), flags);
    case 'list-templates':
      return listTemplates();
    case 'list-environments':
      return listEnvironments();
    case 'estimate':
      return await estimateBatchOperation(subArgs.slice(1), flags);
    case 'help':
    default:
      return showBatchManagerHelp();
  }
}

async function createBatchConfig(args, flags) {
  const outputFile = args[0] || 'batch-config.json';
  const interactive = flags.interactive || flags.i;

  if (interactive) {
    return await createInteractiveConfig(outputFile);
  }

  // Create basic template
  const config = {
    projects: ['project1', 'project2', 'project3'],
    baseOptions: {
      sparc: true,
      parallel: true,
      maxConcurrency: 5,
      template: 'web-api',
      environments: ['dev'],
    },
  };

  try {
    await fs.writeFile(outputFile, JSON.stringify(config, null, 2, 'utf8'));
    printSuccess(`Created batch configuration template: ${outputFile}`);
    console.log('Edit the file to customize your batch initialization setup.');
  } catch (error) {
    printError(`Failed to create config file: ${error.message}`);
  }
}

async function createInteractiveConfig(outputFile) {
  console.log('🚀 Interactive Batch Configuration Creator');
  console.log('==========================================\n');

  // This would require a proper CLI prompt library in a real implementation
  // For now, we'll create a comprehensive template with comments
  const config = {
    _comment: 'Batch initialization configuration',
    _templates: Object.keys(PROJECT_TEMPLATES),
    _environments: Object.keys(ENVIRONMENT_CONFIGS),

    baseOptions: {
      sparc: true,
      parallel: true,
      maxConcurrency: 5,
      force: false,
      minimal: false,
      progressTracking: true,
    },

    projects: {
      _simple_list: ['project1', 'project2', 'project3'],
      _or_use_projectConfigs_below: 'for individual customization',
    },

    projectConfigs: {
      'example-api': {
        template: 'web-api',
        environment: 'dev',
        customConfig: {
          database: 'postgresql',
          auth: 'jwt',
        },
      },
      'example-frontend': {
        template: 'react-app',
        environment: 'dev',
        customConfig: {
          ui: 'material-ui',
          state: 'redux',
        },
      },
    },
  };

  try {
    await fs.writeFile(outputFile, JSON.stringify(config, null, 2, 'utf8'));
    printSuccess(`Created interactive batch configuration: ${outputFile}`);
    console.log('\nNext steps:');
    console.log('1. Edit the configuration file to match your needs');
    console.log('2. Remove the "_comment" and example entries');
    console.log('3. Use either "projects" array OR "projectConfigs" object');
    console.log(`4. Run: claude-flow init --config ${outputFile}`);
  } catch (error) {
    printError(`Failed to create interactive config: ${error.message}`);
  }
}

async function validateBatchConfig(args, flags) {
  const configFile = args[0];

  if (!configFile) {
    printError('Please specify a configuration file to validate');
    return;
  }

  try {
    const content = await fs.readFile(configFile, 'utf8');
    const config = JSON.parse(content);

    console.log(`📋 Validating batch configuration: ${configFile}`);
    console.log('================================================\n');

    const issues = [];
    const warnings = [];

    // Validate structure
    if (!config.projects && !config.projectConfigs) {
      issues.push('Missing "projects" array or "projectConfigs" object');
    }

    if (config.projects && config.projectConfigs) {
      warnings.push(
        'Both "projects" and "projectConfigs" specified. "projectConfigs" will take precedence.',
      );
    }

    // Validate base options
    if (config.baseOptions) {
      const { maxConcurrency, template, environments } = config.baseOptions;

      if (maxConcurrency && (maxConcurrency < 1 || maxConcurrency > 20)) {
        issues.push('maxConcurrency must be between 1 and 20');
      }

      if (template && !PROJECT_TEMPLATES[template]) {
        issues.push(
          `Unknown template: ${template}. Available: ${Object.keys(PROJECT_TEMPLATES).join(', ')}`,
        );
      }

      if (environments) {
        for (const env of environments) {
          if (!ENVIRONMENT_CONFIGS[env]) {
            issues.push(
              `Unknown environment: ${env}. Available: ${Object.keys(ENVIRONMENT_CONFIGS).join(', ')}`,
            );
          }
        }
      }
    }

    // Validate project configs
    if (config.projectConfigs) {
      for (const [projectName, projectConfig] of Object.entries(config.projectConfigs)) {
        if (projectConfig.template && !PROJECT_TEMPLATES[projectConfig.template]) {
          issues.push(`Project ${projectName}: Unknown template ${projectConfig.template}`);
        }

        if (projectConfig.environment && !ENVIRONMENT_CONFIGS[projectConfig.environment]) {
          issues.push(`Project ${projectName}: Unknown environment ${projectConfig.environment}`);
        }
      }
    }

    // Report results
    if (issues.length === 0) {
      printSuccess('✅ Configuration is valid!');

      if (warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        warnings.forEach((warning) => console.log(`  - ${warning}`));
      }

      // Summary
      console.log('\n📊 Configuration Summary:');
      const projectCount = config.projects
        ? config.projects.length
        : config.projectConfigs
          ? Object.keys(config.projectConfigs).length
          : 0;
      console.log(`  Projects: ${projectCount}`);

      if (config.baseOptions) {
        console.log(`  Parallel: ${config.baseOptions.parallel ? 'Yes' : 'No'}`);
        console.log(`  Max Concurrency: ${config.baseOptions.maxConcurrency || 5}`);
        console.log(`  SPARC: ${config.baseOptions.sparc ? 'Enabled' : 'Disabled'}`);
        console.log(`  Template: ${config.baseOptions.template || 'default'}`);
      }
    } else {
      printError('❌ Configuration has issues:');
      issues.forEach((issue) => console.error(`  - ${issue}`));

      if (warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        warnings.forEach((warning) => console.log(`  - ${warning}`));
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      printError(`Configuration file not found: ${configFile}`);
    } else if (error instanceof SyntaxError) {
      printError(`Invalid JSON in configuration file: ${error.message}`);
    } else {
      printError(`Failed to validate configuration: ${error.message}`);
    }
  }
}

function listTemplates() {
  console.log('📋 Available Project Templates');
  console.log('==============================\n');

  for (const [key, template] of Object.entries(PROJECT_TEMPLATES)) {
    console.log(`🏗️  ${key}`);
    console.log(`   Name: ${template.name}`);
    console.log(`   Description: ${template.description}`);
    console.log(`   Extra Directories: ${template.extraDirs ? template.extraDirs.length : 0}`);
    console.log(
      `   Extra Files: ${template.extraFiles ? Object.keys(template.extraFiles).length : 0}`,
    );
    console.log();
  }
}

function listEnvironments() {
  console.log('🌍 Available Environment Configurations');
  console.log('=======================================\n');

  for (const [key, env] of Object.entries(ENVIRONMENT_CONFIGS)) {
    console.log(`⚙️  ${key}`);
    console.log(`   Name: ${env.name}`);
    console.log(`   Features: ${env.features.join(', ')}`);
    console.log(`   Config Variables: ${Object.keys(env.config).length}`);
    console.log();
  }
}

async function estimateBatchOperation(args, flags) {
  const configFile = args[0];

  if (!configFile) {
    printError('Please specify a configuration file to estimate');
    return;
  }

  try {
    const content = await fs.readFile(configFile, 'utf8');
    const config = JSON.parse(content);

    console.log('⏱️  Batch Operation Estimation');
    console.log('=============================\n');

    let projectCount = 0;
    let totalEnvironments = 0;

    if (config.projects) {
      projectCount = config.projects.length;
      const environments = config.baseOptions?.environments || ['dev'];
      totalEnvironments = projectCount * environments.length;
    } else if (config.projectConfigs) {
      projectCount = Object.keys(config.projectConfigs).length;
      totalEnvironments = projectCount; // Each project has its own environment
    }

    const parallel = config.baseOptions?.parallel !== false;
    const maxConcurrency = config.baseOptions?.maxConcurrency || 5;
    const avgTimePerProject = 15; // seconds estimate

    const sequentialTime = totalEnvironments * avgTimePerProject;
    const parallelTime = parallel
      ? Math.ceil(totalEnvironments / maxConcurrency) * avgTimePerProject
      : sequentialTime;

    console.log(`📊 Project Count: ${projectCount}`);
    console.log(`🌍 Total Environments: ${totalEnvironments}`);
    console.log(`⚡ Parallel Processing: ${parallel ? 'Enabled' : 'Disabled'}`);
    console.log(`🔄 Max Concurrency: ${maxConcurrency}`);
    console.log();
    console.log(`⏱️  Estimated Time:`);
    console.log(`   Sequential: ~${Math.ceil(sequentialTime / 60)} minutes`);
    console.log(`   Parallel: ~${Math.ceil(parallelTime / 60)} minutes`);
    console.log(`   Time Savings: ${Math.ceil((sequentialTime - parallelTime) / 60)} minutes`);
    console.log();
    console.log(`💾 Estimated Disk Usage:`);
    console.log(`   Per Project: ~50-200 MB`);
    console.log(`   Total: ~${Math.ceil((totalEnvironments * 125) / 1024)} GB`);
  } catch (error) {
    printError(`Failed to estimate batch operation: ${error.message}`);
  }
}

function showBatchManagerHelp() {
  console.log('🛠️  Batch Manager - Configuration and Estimation Tools');
  console.log('====================================================\n');

  console.log('USAGE:');
  console.log('  claude-flow batch <command> [options]\n');

  console.log('COMMANDS:');
  console.log('  create-config [file]     Create batch configuration template');
  console.log('  validate-config <file>   Validate batch configuration file');
  console.log('  list-templates          Show available project templates');
  console.log('  list-environments       Show available environment configs');
  console.log('  estimate <config>       Estimate time and resources for batch operation');
  console.log('  help                    Show this help message\n');

  console.log('OPTIONS:');
  console.log('  --interactive, -i       Create interactive configuration');
  console.log('  --help, -h             Show command help\n');

  console.log('EXAMPLES:');
  console.log('  claude-flow batch create-config my-batch.json');
  console.log('  claude-flow batch create-config --interactive');
  console.log('  claude-flow batch validate-config my-batch.json');
  console.log('  claude-flow batch estimate my-batch.json');
  console.log('  claude-flow batch list-templates');
  console.log('  claude-flow batch list-environments\n');

  console.log('INTEGRATION:');
  console.log('  Use created configs with: claude-flow init --config <file>');
  console.log('  Or batch init directly: claude-flow init --batch-init project1,project2');
}
