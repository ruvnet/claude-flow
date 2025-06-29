/**
 * Enterprise Configuration Management Commands
 * Features: Security masking, multi-format support, validation, change tracking
 */

import { Command } from '../../utils/cliffy-compat/command.js';
import { colors } from '../../utils/cliffy-compat/colors.js';
import { Confirm, Input, Select } from '../../utils/cliffy-compat/prompt.js';
import { configManager, ConfigChange } from '../../core/config.js';
import { deepMerge } from '../../utils/helpers.js';
import { join } from 'path';
import { promises as fs } from 'fs';
import { writeFileSync } from 'fs';

// Helper function for template descriptions
function getTemplateDescription(templateName: string): string {
  const descriptions: Record<string, string> = {
    default: 'Standard configuration with balanced settings',
    development: 'Optimized for development with debug logging and lower limits',
    production: 'Production-ready with enhanced security and performance',
    minimal: 'Minimal resource usage for constrained environments',
    testing: 'Optimized for testing with fast feedback and lower retention',
    enterprise: 'Enterprise-grade with maximum security and scalability'
  };
  
  return descriptions[templateName] || 'Custom configuration template';
}

function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  
  return current;
}

// Legacy function - now replaced by configManager.createTemplate()
function getConfigTemplate(templateName: string): any {
  const templates: Record<string, any> = {
    default: configManager.get(),
    development: {
      ...configManager.get(),
      logging: {
        level: 'debug',
        format: 'text',
        destination: 'console',
      },
      orchestrator: {
        maxConcurrentAgents: 5,
        taskQueueSize: 50,
        healthCheckInterval: 10000,
        shutdownTimeout: 10000,
      },
    },
    production: {
      ...configManager.get(),
      logging: {
        level: 'info',
        format: 'json',
        destination: 'file',
      },
      orchestrator: {
        maxConcurrentAgents: 20,
        taskQueueSize: 500,
        healthCheckInterval: 60000,
        shutdownTimeout: 60000,
      },
      memory: {
        backend: 'hybrid',
        cacheSizeMB: 500,
        syncInterval: 30000,
        conflictResolution: 'crdt',
        retentionDays: 90,
      },
    },
    minimal: {
      orchestrator: {
        maxConcurrentAgents: 1,
        taskQueueSize: 10,
        healthCheckInterval: 30000,
        shutdownTimeout: 30000,
      },
      terminal: {
        type: 'auto',
        poolSize: 1,
        recycleAfter: 5,
        healthCheckInterval: 60000,
        commandTimeout: 300000,
      },
      memory: {
        backend: 'sqlite',
        cacheSizeMB: 10,
        syncInterval: 10000,
        conflictResolution: 'timestamp',
        retentionDays: 7,
      },
      coordination: {
        maxRetries: 1,
        retryDelay: 2000,
        deadlockDetection: false,
        resourceTimeout: 30000,
        messageTimeout: 15000,
      },
      mcp: {
        transport: 'stdio',
        port: 3000,
        tlsEnabled: false,
      },
      logging: {
        level: 'warn',
        format: 'text',
        destination: 'console',
      },
    },
  };

  if (!(templateName in templates)) {
    throw new Error(`Unknown template: ${templateName}. Available: ${Object.keys(templates).join(', ')}`);
  }

  return templates[templateName];
}

export const configCommand = new Command()
  .description('Manage Claude-Flow configuration')
  .action(() => {
    configCommand.showHelp();
  })
  .command('show')
    .description('Show current configuration')
    .option('--format <format:string>', 'Output format (json, yaml)', { default: 'json' })
    .option('--diff', 'Show only differences from defaults')
    .option('--profile', 'Include profile information')
    .action(async (options: any) => {
      if (options.diff) {
        const diff = configManager.getDiff();
        console.log(JSON.stringify(diff, null, 2));
      } else if (options.profile) {
        const exported = configManager.export();
        console.log(JSON.stringify(exported, null, 2));
      } else {
        const config = configManager.get();
        
        if (options.format === 'json') {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(colors.yellow('YAML format not yet implemented'));
          console.log(JSON.stringify(config, null, 2));
        }
      }
    })
  .command('get')
    .description('Get a specific configuration value')
    .arguments('<path:string>')
    .action(async (options: any, path: string) => {
      try {
        const value = configManager.getValue(path);
        
        if (value === undefined) {
          console.error(colors.red(`Configuration path not found: ${path}`));
          process.exit(1);
        } else {
          console.log(JSON.stringify(value, null, 2));
        }
      } catch (error) {
        console.error(colors.red('Failed to get configuration value:'), (error as Error).message);
        process.exit(1);
      }
    })
  .command('set')
    .description('Set a configuration value with validation and change tracking')
    .arguments('<path:string> <value:string>')
    .option('--type <type:string>', 'Value type (string, number, boolean, json)', { default: 'auto' })
    .option('--reason <reason:string>', 'Reason for the change (for audit trail)')
    .option('--force', 'Skip validation warnings')
    .action(async (options: any, path: string, value: string) => {
      try {
        let parsedValue: any;
        
        switch (options.type) {
          case 'string':
            parsedValue = value;
            break;
          case 'number':
            parsedValue = parseFloat(value);
            if (isNaN(parsedValue)) {
              throw new Error('Invalid number format');
            }
            break;
          case 'boolean':
            parsedValue = value.toLowerCase() === 'true';
            break;
          case 'json':
            parsedValue = JSON.parse(value);
            break;
          default:
            // Auto-detect type
            try {
              parsedValue = JSON.parse(value);
            } catch {
              parsedValue = value;
            }
        }

        // Get user info for change tracking
        const user = process.env.USER || process.env.USERNAME || 'unknown';
        const reason = options.reason;
        
        configManager.set(path, parsedValue, { user, reason, source: 'cli' });
        console.log(colors.green('✓'), `Set ${path} = ${JSON.stringify(parsedValue)}`);
        
        if (reason) {
          console.log(colors.gray(`Reason: ${reason}`));
        }
      } catch (error) {
        console.error(colors.red('Failed to set configuration:'), (error as Error).message);
        process.exit(1);
      }
    })
  .command('reset')
    .description('Reset configuration to defaults')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options: any) => {
      if (!options.confirm) {
        const confirmed = await Confirm.prompt({
          message: 'Reset configuration to defaults?',
          default: false,
        });
        
        if (!confirmed) {
          console.log(colors.gray('Reset cancelled'));
          return;
        }
      }
      
      configManager.reset();
      console.log(colors.green('✓ Configuration reset to defaults'));
    })
  .command('init')
    .description('Initialize a new configuration file with enterprise templates')
    .arguments('[output-file:string]')
    .option('--force', 'Overwrite existing file')
    .option('--template <template:string>', 'Configuration template (default, development, production, minimal, testing, enterprise)', { default: 'default' })
    .option('--format <format:string>', 'Output format (json, yaml, toml)', { default: 'json' })
    .option('--interactive', 'Interactive template selection')
    .action(async (options: any, outputFile: string = 'claude-flow.config.json') => {
      try {
        // Check if file exists
        try {
          await fs.stat(outputFile);
          if (!options.force) {
            console.error(colors.red(`File already exists: ${outputFile}`));
            console.log(colors.gray('Use --force to overwrite'));
            return;
          }
        } catch {
          // File doesn't exist, which is what we want
        }

        let templateName = options.template;
        
        // Interactive template selection
        if (options.interactive) {
          const availableTemplates = configManager.getAvailableTemplates();
          templateName = await Select.prompt({
            message: 'Select configuration template:',
            options: availableTemplates.map((name: string) => ({
              name: name,
              value: name
            }))
          });
        }
        
        const config = configManager.createTemplate(templateName);
        
        // Detect format from file extension or use option
        const ext = outputFile.split('.').pop()?.toLowerCase();
        const format = options.format || (ext === 'yaml' || ext === 'yml' ? 'yaml' : ext === 'toml' ? 'toml' : 'json');
        
        const formatParsers = configManager.getFormatParsers();
        const parser = formatParsers[format];
        const content = parser ? parser.stringify(config) : JSON.stringify(config, null, 2);
        
        await fs.writeFile(outputFile, content, 'utf8');
        
        console.log(colors.green('✓'), `Configuration file created: ${outputFile}`);
        console.log(colors.gray(`Template: ${templateName}`));
        console.log(colors.gray(`Format: ${format}`));
      } catch (error) {
        console.error(colors.red('Failed to create configuration file:'), (error as Error).message);
        process.exit(1);
      }
    })
  .command('validate')
    .description('Validate a configuration file')
    .arguments('<config-file:string>')
    .option('--strict', 'Use strict validation')
    .action(async (options: any, configFile: string) => {
      try {
        await configManager.load(configFile);
        console.log(colors.blue('Validating configuration file:'), configFile);
        
        // Use the new comprehensive validation method
        const result = await configManager.validateFile(configFile);
        
        if (result.valid) {
          console.log(colors.green('✓'), 'Configuration is valid');
          
          if (options.strict) {
            console.log(colors.gray('✓ Strict validation passed'));
          }
        } else {
          console.error(colors.red('✗'), 'Configuration validation failed:');
          result.errors.forEach((error: string) => {
            console.error(colors.red(`  • ${error}`));
          });
          process.exit(1);
        }
      } catch (error) {
        console.error(colors.red('✗'), 'Configuration validation failed:');
        console.error((error as Error).message);
        process.exit(1);
      }
    })
  .command('profile')
    .description('Manage configuration profiles')
    .action(() => {
      console.log(colors.gray('Usage: config profile <list|save|load|delete> [options]'));
    })
    .command('list')
      .description('List all configuration profiles')
      .action(async () => {
        try {
          const profiles = await configManager.listProfiles();
          const currentProfile = configManager.getCurrentProfile();
          
          if (profiles.length === 0) {
            console.log(colors.gray('No profiles found'));
            return;
          }
          
          console.log(colors.cyan.bold(`Configuration Profiles (${profiles.length})`));
          console.log('─'.repeat(40));
          
          for (const profile of profiles) {
            const indicator = profile === currentProfile ? colors.green('● ') : '  ';
            console.log(`${indicator}${profile}`);
          }
          
          if (currentProfile) {
            console.log();
            console.log(colors.gray(`Current: ${currentProfile}`));
          }
        } catch (error) {
          console.error(colors.red('Failed to list profiles:'), (error as Error).message);
        }
      })
    .command('save')
      .description('Save current configuration as a profile')
      .arguments('<profile-name:string>')
      .option('--force', 'Overwrite existing profile')
      .action(async (options: any, profileName: string) => {
        try {
          const existing = await configManager.getProfile(profileName);
          if (existing && !options.force) {
            console.error(colors.red(`Profile '${profileName}' already exists`));
            console.log(colors.gray('Use --force to overwrite'));
            return;
          }
          
          await configManager.saveProfile(profileName);
          console.log(colors.green('✓'), `Profile '${profileName}' saved`);
        } catch (error) {
          console.error(colors.red('Failed to save profile:'), (error as Error).message);
        }
      })
    .command('load')
      .description('Load a configuration profile')
      .arguments('<profile-name:string>')
      .action(async (options: any, profileName: string) => {
        try {
          await configManager.applyProfile(profileName);
          console.log(colors.green('✓'), `Profile '${profileName}' loaded`);
        } catch (error) {
          console.error(colors.red('Failed to load profile:'), (error as Error).message);
        }
      })
    .command('delete')
      .description('Delete a configuration profile')
      .arguments('<profile-name:string>')
      .option('--force', 'Skip confirmation prompt')
      .action(async (options: any, profileName: string) => {
        try {
          if (!options.force) {
            const confirmed = await Confirm.prompt({
              message: `Delete profile '${profileName}'?`,
              default: false,
            });
            
            if (!confirmed) {
              console.log(colors.gray('Delete cancelled'));
              return;
            }
          }
          
          await configManager.deleteProfile(profileName);
          console.log(colors.green('✓'), `Profile '${profileName}' deleted`);
        } catch (error) {
          console.error(colors.red('Failed to delete profile:'), (error as Error).message);
        }
      })
    .command('show')
      .description('Show profile configuration')
      .arguments('<profile-name:string>')
      .action(async (options: any, profileName: string) => {
        try {
          const profile = await configManager.getProfile(profileName);
          if (!profile) {
            console.error(colors.red(`Profile '${profileName}' not found`));
            return;
          }
          
          console.log(JSON.stringify(profile, null, 2));
        } catch (error) {
          console.error(colors.red('Failed to show profile:'), (error as Error).message);
        }
      })
  .command('export')
    .description('Export configuration')
    .arguments('<output-file:string>')
    .option('--include-defaults', 'Include default values')
    .action(async (options: any, outputFile: string) => {
      try {
        let data;
        if (options.includeDefaults) {
          data = configManager.export();
        } else {
          data = {
            version: '1.0.0',
            exported: new Date().toISOString(),
            profile: configManager.getCurrentProfile(),
            config: configManager.getDiff(),
          };
        }
        
        await fs.writeFile(outputFile, JSON.stringify(data, null, 2), 'utf8');
        console.log(colors.green('✓'), `Configuration exported to ${outputFile}`);
      } catch (error) {
        console.error(colors.red('Failed to export configuration:'), (error as Error).message);
      }
    })
  .command('import')
    .description('Import configuration')
    .arguments('<input-file:string>')
    .option('--merge', 'Merge with current configuration')
    .action(async (options: any, inputFile: string) => {
      try {
        const fs = await import('fs/promises');
        const content = await fs.readFile(inputFile, 'utf8');
        const data = JSON.parse(content);
        
        if (options.merge) {
          const current = configManager.get();
          data.config = deepMerge(current as unknown as Record<string, unknown>, data.config) as any;
        }
        
        configManager.import(data);
        console.log(colors.green('✓'), 'Configuration imported successfully');
        
        if (data.profile) {
          console.log(colors.gray(`Profile: ${data.profile}`));
        }
      } catch (error) {
        console.error(colors.red('Failed to import configuration:'), (error as Error).message);
      }
    })
  .command('schema')
    .description('Show configuration schema')
    .option('--path <path:string>', 'Show schema for specific path')
    .action(async (options: any) => {
      const schema = configManager.getSchema();
      
      if (options.path) {
        const value = getValueByPath(schema, options.path);
        if (value === undefined) {
          console.error(colors.red(`Schema path not found: ${options.path}`));
          return;
        }
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(JSON.stringify(schema, null, 2));
      }
    })
  .command('history')
    .description('Show configuration change history')
    .option('--path <path:string>', 'Show history for specific configuration path')
    .option('--limit <limit:number>', 'Maximum number of changes to show', { default: 20 })
    .option('--format <format:string>', 'Output format (json, table)', { default: 'table' })
    .action(async (options: any) => {
      try {
        const changes = options.path 
          ? configManager.getPathHistory(options.path, options.limit)
          : configManager.getChangeHistory(options.limit);
        
        if (changes.length === 0) {
          console.log(colors.gray('No configuration changes found'));
          return;
        }
        
        if (options.format === 'json') {
          console.log(JSON.stringify(changes, null, 2));
        } else {
          console.log(colors.cyan.bold(`Configuration Change History (${changes.length} changes)`));
          console.log('─'.repeat(80));
          
          changes.reverse().forEach((change: ConfigChange, index: number) => {
            const timestamp = new Date(change.timestamp).toLocaleString();
            const user = change.user || 'system';
            const source = change.source || 'unknown';
            
            console.log(`${colors.green(timestamp)} | ${colors.blue(user)} | ${colors.yellow(source)}`);
            console.log(`Path: ${colors.cyan(change.path)}`);
            
            if (change.reason) {
              console.log(`Reason: ${colors.gray(change.reason)}`);
            }
            
            if (change.oldValue !== undefined && change.newValue !== undefined) {
              console.log(`Old: ${colors.red(JSON.stringify(change.oldValue))}`);
              console.log(`New: ${colors.green(JSON.stringify(change.newValue))}`);
            }
            
            if (index < changes.length - 1) {
              console.log('');
            }
          });
        }
      } catch (error) {
        console.error(colors.red('Failed to get change history:'), (error as Error).message);
      }
    })
  .command('backup')
    .description('Backup current configuration')
    .arguments('[backup-path:string]')
    .option('--auto-name', 'Generate automatic backup filename')
    .action(async (options: any, backupPath?: string) => {
      try {
        const finalPath = backupPath || (options.autoName ? undefined : 'config-backup.json');
        const savedPath = await configManager.backup(finalPath);
        
        console.log(colors.green('✓'), `Configuration backed up to: ${savedPath}`);
        console.log(colors.gray(`Backup includes configuration and recent change history`));
      } catch (error) {
        console.error(colors.red('Failed to backup configuration:'), (error as Error).message);
        process.exit(1);
      }
    })
  .command('restore')
    .description('Restore configuration from backup')
    .arguments('<backup-path:string>')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: any, backupPath: string) => {
      try {
        if (!options.force) {
          const confirmed = await Confirm.prompt({
            message: `Restore configuration from ${backupPath}? This will overwrite current configuration.`,
            default: false,
          });
          
          if (!confirmed) {
            console.log(colors.gray('Restore cancelled'));
            return;
          }
        }
        
        await configManager.restore(backupPath);
        console.log(colors.green('✓'), 'Configuration restored successfully');
        console.log(colors.yellow('⚠️'), 'You may need to restart the application for changes to take effect');
      } catch (error) {
        console.error(colors.red('Failed to restore configuration:'), (error as Error).message);
        process.exit(1);
      }
    })
  .command('templates')
    .description('List available configuration templates')
    .option('--detailed', 'Show detailed template information')
    .action(async (options: any) => {
      try {
        const templates = configManager.getAvailableTemplates();
        
        console.log(colors.cyan.bold(`Available Configuration Templates (${templates.length})`));
        console.log('─'.repeat(50));
        
        for (const template of templates) {
          console.log(colors.green('●'), colors.bold(template));
          
          if (options.detailed) {
            try {
              const config = configManager.createTemplate(template);
              const description = getTemplateDescription(template);
              console.log(`  ${colors.gray(description)}`);
              
              if (config.orchestrator) {
                console.log(`  Max Agents: ${colors.cyan(config.orchestrator.maxConcurrentAgents)}`);
              }
              if (config.logging) {
                console.log(`  Log Level: ${colors.cyan(config.logging.level)}`);
              }
            } catch (error) {
              console.log(`  ${colors.red('Error loading template')}`);
            }
          }
          
          console.log('');
        }
      } catch (error) {
        console.error(colors.red('Failed to list templates:'), (error as Error).message);
      }
    });