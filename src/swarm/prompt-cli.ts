#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import { copyPrompts, copyPromptsEnhanced } from './prompt-copier-enhanced';
import { 
  PromptConfigManager, 
  PromptPathResolver, 
  PromptValidator,
  createProgressBar,
  formatFileSize,
  formatDuration
} from './prompt-utils';
import { logger } from '../logger';

const program = new Command();

program
  .name('prompt-copier')
  .description('Robust prompt copying mechanism for Claude-Flow')
  .version('1.0.0');

program
  .command('copy')
  .description('Copy prompts from source to destination')
  .option('-s, --source <path>', 'Source directory')
  .option('-d, --destination <path>', 'Destination directory')
  .option('-p, --profile <name>', 'Configuration profile to use')
  .option('--no-backup', 'Disable backup creation')
  .option('--no-verify', 'Disable file verification')
  .option('--no-parallel', 'Disable parallel processing')
  .option('--workers <number>', 'Number of worker threads', parseInt)
  .option('--conflict <strategy>', 'Conflict resolution strategy', /^(skip|overwrite|backup|merge)$/)
  .option('--include <patterns>', 'Include patterns (comma-separated)')
  .option('--exclude <patterns>', 'Exclude patterns (comma-separated)')
  .option('--dry-run', 'Show what would be copied without actually copying')
  .option('--enhanced', 'Use enhanced copier with worker threads')
  .action(async (options) => {
    try {
      const configManager = new PromptConfigManager();
      const config = await configManager.loadConfig();
      
      let copyOptions;
      
      if (options.profile) {
        const profileOptions = configManager.getProfile(options.profile);
        copyOptions = {
          source: options.source || config.sourceDirectories[0],
          destination: options.destination || config.destinationDirectory,
          ...profileOptions
        };
      } else {
        copyOptions = {
          source: options.source || config.sourceDirectories[0],
          destination: options.destination || config.destinationDirectory,
          backup: options.backup,
          verify: options.verify,
          parallel: options.parallel,
          maxWorkers: options.workers || config.defaultOptions.maxWorkers,
          conflictResolution: options.conflict || config.defaultOptions.conflictResolution,
          includePatterns: options.include ? options.include.split(',') : config.defaultOptions.includePatterns,
          excludePatterns: options.exclude ? options.exclude.split(',') : config.defaultOptions.excludePatterns,
          dryRun: options.dryRun
        };
      }

      // Create progress bar
      let progressBar: ReturnType<typeof createProgressBar> | null = null;
      
      copyOptions.progressCallback = (progress) => {
        if (!progressBar) {
          progressBar = createProgressBar(progress.total);
        }
        progressBar.update(progress.completed);
        
        if (progress.completed === progress.total) {
          progressBar.complete();
        }
      };

      console.log('Starting prompt copy operation...');
      console.log(`Source: ${copyOptions.source}`);
      console.log(`Destination: ${copyOptions.destination}`);
      console.log(`Options: ${JSON.stringify(copyOptions, null, 2)}`);

      const copyFunction = options.enhanced ? copyPromptsEnhanced : copyPrompts;
      const result = await copyFunction(copyOptions);

      console.log('\n=== Copy Results ===');
      console.log(`Success: ${result.success ? '✅' : '❌'}`);
      console.log(`Total files: ${result.totalFiles}`);
      console.log(`Copied: ${result.copiedFiles}`);
      console.log(`Failed: ${result.failedFiles}`);
      console.log(`Skipped: ${result.skippedFiles}`);
      console.log(`Duration: ${formatDuration(result.duration)}`);

      if (result.backupLocation) {
        console.log(`Backup manifest: ${result.backupLocation}`);
      }

      if (result.errors.length > 0) {
        console.log('\n=== Errors ===');
        result.errors.forEach(error => {
          console.log(`❌ ${error.file}: ${error.error} (${error.phase})`);
        });
      }

    } catch (error) {
      console.error('Copy operation failed:', error);
      process.exit(1);
    }
  });

program
  .command('discover')
  .description('Discover prompt directories in the current project')
  .option('-b, --base <path>', 'Base path to search from', process.cwd())
  .action(async (options) => {
    try {
      const resolver = new PromptPathResolver(options.base);
      const directories = await resolver.discoverPromptDirectories();
      
      console.log('Discovered prompt directories:');
      directories.forEach(dir => {
        console.log(`  📁 ${dir}`);
      });
      
      if (directories.length === 0) {
        console.log('  No prompt directories found');
      }
    } catch (error) {
      console.error('Discovery failed:', error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate prompt files')
  .argument('<path>', 'Path to validate (file or directory)')
  .option('--recursive', 'Validate recursively')
  .action(async (filePath, options) => {
    try {
      const stats = await require('fs').promises.stat(filePath);
      const files: string[] = [];
      
      if (stats.isFile()) {
        files.push(filePath);
      } else if (stats.isDirectory()) {
        // Scan directory for prompt files
        const scanDir = async (dir: string) => {
          const entries = await require('fs').promises.readdir(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isFile() && (
              entry.name.endsWith('.md') || 
              entry.name.endsWith('.txt') || 
              entry.name.endsWith('.prompt')
            )) {
              files.push(fullPath);
            } else if (entry.isDirectory() && options.recursive) {
              await scanDir(fullPath);
            }
          }
        };
        
        await scanDir(filePath);
      }
      
      console.log(`Validating ${files.length} files...`);
      
      let validFiles = 0;
      let invalidFiles = 0;
      
      for (const file of files) {
        const result = await PromptValidator.validatePromptFile(file);
        
        if (result.valid) {
          validFiles++;
          console.log(`✅ ${file}`);
        } else {
          invalidFiles++;
          console.log(`❌ ${file}`);
          result.issues.forEach(issue => {
            console.log(`   - ${issue}`);
          });
        }
        
        if (result.metadata && Object.keys(result.metadata).length > 0) {
          console.log(`   Metadata: ${JSON.stringify(result.metadata)}`);
        }
      }
      
      console.log(`\nValidation complete: ${validFiles} valid, ${invalidFiles} invalid`);
      
    } catch (error) {
      console.error('Validation failed:', error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .option('--init', 'Initialize default configuration')
  .option('--show', 'Show current configuration')
  .option('--profiles', 'List available profiles')
  .action(async (options) => {
    try {
      const configManager = new PromptConfigManager();
      
      if (options.init) {
        await configManager.saveConfig();
        console.log('✅ Configuration initialized');
      } else if (options.show) {
        const config = await configManager.loadConfig();
        console.log(JSON.stringify(config, null, 2));
      } else if (options.profiles) {
        const config = await configManager.loadConfig();
        const profiles = configManager.listProfiles();
        
        console.log('Available profiles:');
        profiles.forEach(profile => {
          console.log(`  📋 ${profile}`);
          const profileOptions = configManager.getProfile(profile);
          Object.entries(profileOptions).forEach(([key, value]) => {
            console.log(`     ${key}: ${JSON.stringify(value)}`);
          });
        });
      } else {
        console.log('Use --init, --show, or --profiles');
      }
    } catch (error) {
      console.error('Configuration operation failed:', error);
      process.exit(1);
    }
  });

program
  .command('rollback')
  .description('Rollback from backup')
  .argument('<manifest>', 'Path to backup manifest file')
  .action(async (manifestPath) => {
    try {
      const { PromptCopier } = await import('./prompt-copier');
      const copier = new PromptCopier({
        source: '',
        destination: ''
      });
      
      await copier.restoreFromBackup(manifestPath);
      console.log('✅ Rollback completed');
    } catch (error) {
      console.error('Rollback failed:', error);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Synchronize prompts between directories')
  .option('-s, --source <path>', 'Source directory')
  .option('-d, --destination <path>', 'Destination directory')
  .option('--bidirectional', 'Enable bidirectional sync')
  .option('--delete', 'Delete files not present in source')
  .action(async (options) => {
    try {
      // This would implement incremental sync functionality
      console.log('Sync functionality not yet implemented');
      console.log('Options:', options);
    } catch (error) {
      console.error('Sync failed:', error);
      process.exit(1);
    }
  });

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

if (require.main === module) {
  program.parse();
}

export { program };