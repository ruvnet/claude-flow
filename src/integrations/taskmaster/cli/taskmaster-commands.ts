/**
 * CLI Command Extensions for TaskMaster Integration
 * Provides CLI interface for PRD processing, task generation, and sync operations
 */

import { Command } from 'npm:commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskAdapter } from '../adapters/task-adapter.ts';
import { PRDService } from '../services/prd-service.ts';
import { StorageSync } from '../services/storage-sync.ts';
import { extensionCommands } from './extension-commands.ts';
import syncCommand from './sync-commands.ts';
import { 
  ParseOptions, 
  GenerateOptions, 
  AIModel,
  TaskContext,
  ProjectContext 
} from '../types/prd-types.ts';

export interface TaskMasterCLIOptions {
  model?: string;
  depth?: number;
  sparcMapping?: boolean;
  assignAgents?: boolean;
  output?: string;
  format?: 'json' | 'markdown' | 'csv';
  verbose?: boolean;
  dryRun?: boolean;
}

export class TaskMasterCLI {
  private taskAdapter: TaskAdapter;
  private prdService: PRDService;
  private storageSync: StorageSync;

  constructor() {
    this.taskAdapter = new TaskAdapter();
    this.prdService = new PRDService();
    this.storageSync = new StorageSync(this.taskAdapter);
  }

  public setupCommands(program: Command): void {
    // Main taskmaster command group
    const taskmaster = program
      .command('taskmaster')
      .description('TaskMaster integration commands');

    // PRD-based task generation
    taskmaster
      .command('generate-from-prd <file>')
      .description('Generate tasks from Product Requirements Document')
      .option('-m, --model <model>', 'AI model to use', 'claude-3-haiku')
      .option('-d, --depth <level>', 'Task breakdown depth', '2')
      .option('--sparc-mapping', 'Auto-map tasks to SPARC phases')
      .option('--assign-agents', 'Auto-assign tasks to agents')
      .option('-o, --output <file>', 'Output file for generated tasks')
      .option('-f, --format <format>', 'Output format (json|markdown|csv)', 'json')
      .option('--dry-run', 'Preview tasks without saving')
      .option('-v, --verbose', 'Verbose output')
      .action(async (file: string, options: TaskMasterCLIOptions) => {
        await this.generateFromPRD(file, options);
      });

    // Initialize integration
    taskmaster
      .command('init')
      .description('Initialize TaskMaster integration')
      .option('--force', 'Force initialization even if already configured')
      .action(async (options: { force?: boolean }) => {
        await this.initializeIntegration(options);
      });

    // Import existing project
    taskmaster
      .command('import <directory>')
      .description('Import existing TaskMaster project')
      .option('--merge', 'Merge with existing Claude-Flow tasks')
      .option('--backup', 'Create backup before import')
      .action(async (directory: string, options: { merge?: boolean; backup?: boolean }) => {
        await this.importProject(directory, options);
      });

    // VS Code Extension Sync
    taskmaster.addCommand(syncCommand);

    // Manual task sync (legacy)
    taskmaster
      .command('sync-tasks')
      .description('Manually synchronize tasks (legacy)')
      .option('--direction <direction>', 'Sync direction (to-taskmaster|from-taskmaster|bidirectional)', 'bidirectional')
      .option('--project <id>', 'Specific project ID to sync')
      .action(async (options: { direction?: string; project?: string }) => {
        await this.syncTasks(options);
      });

    // Configuration
    taskmaster
      .command('config')
      .description('Configure TaskMaster integration')
      .option('--set <key=value>', 'Set configuration value')
      .option('--get <key>', 'Get configuration value')
      .option('--list', 'List all configuration')
      .action(async (options: { set?: string; get?: string; list?: boolean }) => {
        await this.configureIntegration(options);
      });

    // Enhanced task commands
    const task = program.command('task');

    task
      .command('next')
      .description('Get next recommended task')
      .option('--smart', 'Use AI-powered recommendations')
      .option('--context <file>', 'Project context file')
      .action(async (options: { smart?: boolean; context?: string }) => {
        await this.getNextTask(options);
      });

    task
      .command('estimate <id>')
      .description('Get AI-powered task estimation')
      .option('--model <model>', 'AI model to use for estimation')
      .option('--breakdown', 'Show estimation breakdown')
      .action(async (id: string, options: { model?: string; breakdown?: boolean }) => {
        await this.estimateTask(id, options);
      });

    task
      .command('expand <id>')
      .description('Break down complex task into subtasks')
      .option('--depth <level>', 'Breakdown depth', '2')
      .option('--model <model>', 'AI model to use')
      .action(async (id: string, options: { depth?: string; model?: string }) => {
        await this.expandTask(id, options);
      });

    task
      .command('dependencies')
      .description('Visualize task dependencies')
      .option('--format <format>', 'Output format (graph|list|mermaid)', 'graph')
      .option('--project <id>', 'Project ID')
      .action(async (options: { format?: string; project?: string }) => {
        await this.visualizeDependencies(options);
      });

    // Status and monitoring
    taskmaster
      .command('status')
      .description('Show TaskMaster integration status')
      .option('--detailed', 'Show detailed status information')
      .action(async (options: { detailed?: boolean }) => {
        await this.showStatus(options);
      });

    taskmaster
      .command('watch')
      .description('Start file system watcher for real-time sync')
      .option('--directory <dir>', 'Directory to watch')
      .action(async (options: { directory?: string }) => {
        await this.startWatcher(options);
      });

    // Extension integration commands
    taskmaster
      .command('init')
      .description('Initialize TaskMaster with VS Code extension compatibility')
      .option('--extension', 'Initialize with extension support (default)', true)
      .option('--no-extension', 'Initialize without extension support')
      .action(async (options) => {
        if (options.extension) {
          await extensionCommands.init();
        } else {
          console.log('Initializing basic TaskMaster configuration...');
          await this.initBasicTaskMaster();
        }
      });

    const extension = taskmaster
      .command('extension')
      .description('VS Code extension integration commands');

    extension
      .command('sync')
      .description('Sync tasks with SPARC enhancements')
      .action(async () => {
        await extensionCommands.sync();
      });

    extension
      .command('watch')
      .description('Watch for extension task changes')
      .action(async () => {
        await extensionCommands.watch();
      });

    extension
      .command('export <format>')
      .description('Export tasks in various formats (json, markdown, csv)')
      .action(async (format: string) => {
        await extensionCommands.export(format as any);
      });

    extension
      .command('stats')
      .description('Show task statistics')
      .action(async () => {
        await extensionCommands.stats();
      });
  }

  private async generateFromPRD(file: string, options: TaskMasterCLIOptions): Promise<void> {
    try {
      console.log(`🔍 Reading PRD from: ${file}`);
      const content = await readFile(file, 'utf-8');

      // Validate PRD
      const validation = this.prdService.validatePRD(content);
      if (!validation.isValid) {
        console.error('❌ Invalid PRD:', validation.errors.join(', '));
        return;
      }

      if (validation.warnings.length > 0) {
        console.warn('⚠️  PRD Warnings:', validation.warnings.join(', '));
      }

      // Parse PRD
      console.log('📄 Parsing PRD...');
      const parseOptions: ParseOptions = {
        model: this.getAIModel(options.model),
        generateTasks: true,
        mapToSparc: options.sparcMapping
      };

      const parsedPRD = await this.prdService.parsePRD(content, parseOptions);
      console.log(`✅ PRD parsed: ${parsedPRD.requirements.length} requirements, ${parsedPRD.constraints.length} constraints`);

      // Generate tasks
      console.log('🤖 Generating tasks...');
      const generateOptions: GenerateOptions = {
        model: this.getAIModel(options.model),
        taskDepth: parseInt(options.depth || '2'),
        sparcMapping: options.sparcMapping || false,
        agentAssignment: options.assignAgents || false,
        estimateHours: true,
        includeDependencies: true
      };

      const taskTree = await this.prdService.generateTasks(parsedPRD, generateOptions);
      console.log(`✅ Generated ${taskTree.totalTasks} tasks (${taskTree.estimatedHours} estimated hours)`);

      // Map to SPARC phases if requested
      if (options.sparcMapping) {
        console.log('🎯 Mapping to SPARC phases...');
        const sparcWorkflow = this.prdService.mapToSPARCPhases(taskTree);
        console.log(`✅ Mapped to ${sparcWorkflow.phases.length} SPARC phases`);
        
        if (options.verbose) {
          sparcWorkflow.phases.forEach(phase => {
            console.log(`  ${phase.phase}: ${phase.tasks.length} tasks (${phase.estimatedHours}h)`);
          });
        }
      }

      // Output results
      await this.outputTasks(taskTree, options);

      if (!options.dryRun) {
        console.log('💾 Tasks saved successfully');
      } else {
        console.log('👀 Dry run completed - no tasks were saved');
      }

    } catch (error) {
      console.error('❌ Task generation failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private async initializeIntegration(options: { force?: boolean }): Promise<void> {
    console.log('🚀 Initializing TaskMaster integration...');

    try {
      // Check if already initialized
      const configExists = await this.checkConfigExists();
      if (configExists && !options.force) {
        console.log('✅ TaskMaster integration already initialized');
        console.log('Use --force to reinitialize');
        return;
      }

      // Create default configuration
      const defaultConfig = {
        version: '1.0',
        taskMaster: {
          directory: './tasks',
          format: 'json'
        },
        claudeFlow: {
          integration: true,
          autoSync: false
        },
        ai: {
          defaultModel: 'claude-3-haiku',
          providers: ['anthropic', 'openai']
        }
      };

      await this.saveConfig(defaultConfig);
      console.log('✅ TaskMaster integration initialized');
      console.log('Run `claude-flow taskmaster config --list` to see configuration');

    } catch (error) {
      console.error('❌ Initialization failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private async importProject(directory: string, options: { merge?: boolean; backup?: boolean }): Promise<void> {
    console.log(`📂 Importing TaskMaster project from: ${directory}`);

    try {
      // Create backup if requested
      if (options.backup) {
        const backupFile = `backup-${Date.now()}.json`;
        await this.storageSync.backup(backupFile);
        console.log(`💾 Backup created: ${backupFile}`);
      }

      // Sync from TaskMaster
      const result = await this.storageSync.syncFromTaskMaster(directory);
      
      if (result.success) {
        console.log(`✅ Imported ${result.syncedTasks} tasks`);
        
        if (result.conflicts.length > 0) {
          console.warn(`⚠️  ${result.conflicts.length} conflicts detected and resolved`);
        }
      } else {
        console.error('❌ Import failed:', result.errors.join(', '));
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Import failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private async syncTasks(options: { direction?: string; project?: string }): Promise<void> {
    const direction = options.direction || 'bidirectional';
    console.log(`🔄 Syncing tasks (${direction})${options.project ? ` for project ${options.project}` : ''}`);

    try {
      let result;

      switch (direction) {
        case 'from-taskmaster':
          result = await this.storageSync.syncFromTaskMaster('./tasks');
          break;
        case 'to-taskmaster':
          result = await this.storageSync.syncToTaskMaster(options.project || 'default');
          break;
        case 'bidirectional':
          // Perform both directions
          const fromResult = await this.storageSync.syncFromTaskMaster('./tasks');
          const toResult = await this.storageSync.syncToTaskMaster(options.project || 'default');
          result = {
            success: fromResult.success && toResult.success,
            syncedTasks: fromResult.syncedTasks + toResult.syncedTasks,
            conflicts: [...fromResult.conflicts, ...toResult.conflicts],
            errors: [...fromResult.errors, ...toResult.errors],
            timestamp: new Date()
          };
          break;
        default:
          console.error('❌ Invalid sync direction. Use: to-taskmaster, from-taskmaster, or bidirectional');
          return;
      }

      if (result.success) {
        console.log(`✅ Synced ${result.syncedTasks} tasks`);
        if (result.conflicts.length > 0) {
          console.warn(`⚠️  ${result.conflicts.length} conflicts resolved`);
        }
      } else {
        console.error('❌ Sync failed:', result.errors.join(', '));
      }

    } catch (error) {
      console.error('❌ Sync failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private async getNextTask(options: { smart?: boolean; context?: string }): Promise<void> {
    console.log('🎯 Finding next recommended task...');

    try {
      // Load project context
      let context: ProjectContext = {
        completedTasks: [],
        blockedTasks: [],
        availableAgents: ['code', 'architect', 'tdd', 'integration']
      };

      if (options.context) {
        const contextContent = await readFile(options.context, 'utf-8');
        context = { ...context, ...JSON.parse(contextContent) };
      }

      if (options.smart) {
        const recommendation = await this.prdService.getNextTask(context);
        
        console.log('🎯 Recommended Task:');
        console.log(`  📋 Title: ${recommendation.task.title}`);
        console.log(`  ⏱️  Estimated Duration: ${recommendation.estimatedDuration} hours`);
        console.log(`  🎖️  Priority: ${recommendation.priority}`);
        console.log(`  🤖 Suggested Agent: ${recommendation.suggestedAgent || 'None'}`);
        console.log(`  💭 Reasoning: ${recommendation.reasoning}`);
        console.log(`  📊 Confidence: ${Math.round(recommendation.confidence * 100)}%`);
        
        if (recommendation.prerequisites.length > 0) {
          console.log(`  📝 Prerequisites: ${recommendation.prerequisites.join(', ')}`);
        }
      } else {
        console.log('📋 Use --smart flag for AI-powered recommendations');
      }

    } catch (error) {
      console.error('❌ Failed to get next task:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async estimateTask(id: string, options: { model?: string; breakdown?: boolean }): Promise<void> {
    console.log(`⏱️  Estimating task: ${id}`);

    try {
      // Mock implementation - would integrate with actual task storage
      console.log('🔍 Task not found in current implementation');
      console.log('This would provide AI-powered task estimation with breakdown');

    } catch (error) {
      console.error('❌ Estimation failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async expandTask(id: string, options: { depth?: string; model?: string }): Promise<void> {
    console.log(`🔧 Expanding task: ${id}`);

    try {
      // Mock implementation - would break down complex tasks
      console.log('🔍 Task expansion not implemented yet');
      console.log('This would break down complex tasks into subtasks');

    } catch (error) {
      console.error('❌ Task expansion failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async visualizeDependencies(options: { format?: string; project?: string }): Promise<void> {
    console.log('📊 Visualizing task dependencies...');

    try {
      // Mock implementation - would create dependency visualization
      console.log('📋 Dependency visualization not implemented yet');
      console.log('This would show task dependencies in various formats');

    } catch (error) {
      console.error('❌ Visualization failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async showStatus(options: { detailed?: boolean }): Promise<void> {
    console.log('📊 TaskMaster Integration Status');

    try {
      const status = this.storageSync.getSyncStatus();
      
      console.log(`🔄 Sync Status: ${status.isWatching ? '🟢 Watching' : '🔴 Stopped'}`);
      console.log(`📅 Last Sync: ${status.lastSync ? status.lastSync.toLocaleString() : 'Never'}`);
      console.log(`📝 Queued Operations: ${status.queuedOperations}`);
      console.log(`⚠️  Active Conflicts: ${status.conflicts}`);
      
      if (status.errors.length > 0) {
        console.log('❌ Recent Errors:');
        status.errors.forEach(error => console.log(`   ${error}`));
      }

      if (options.detailed) {
        console.log('\n📋 Detailed Status:');
        console.log('   - Task Adapter: ✅ Loaded');
        console.log('   - PRD Service: ✅ Loaded');
        console.log('   - Storage Sync: ✅ Loaded');
        console.log('   - File Watcher: ' + (status.isWatching ? '✅ Active' : '❌ Inactive'));
      }

    } catch (error) {
      console.error('❌ Status check failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async startWatcher(options: { directory?: string }): Promise<void> {
    const directory = options.directory || './tasks';
    console.log(`👀 Starting file watcher for: ${directory}`);

    try {
      this.storageSync.enableWatcher(directory);
      console.log('✅ File watcher started');
      console.log('Press Ctrl+C to stop watching');
      
      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping file watcher...');
        this.storageSync.disableWatcher();
        console.log('✅ File watcher stopped');
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to start watcher:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private async configureIntegration(options: { set?: string; get?: string; list?: boolean }): Promise<void> {
    try {
      if (options.list) {
        const config = await this.loadConfig();
        console.log('📋 TaskMaster Configuration:');
        console.log(JSON.stringify(config, null, 2));
      } else if (options.get) {
        const config = await this.loadConfig();
        const value = this.getConfigValue(config, options.get);
        console.log(`${options.get}: ${value}`);
      } else if (options.set) {
        const [key, value] = options.set.split('=');
        if (!key || !value) {
          console.error('❌ Invalid format. Use: --set key=value');
          return;
        }
        
        const config = await this.loadConfig();
        this.setConfigValue(config, key, value);
        await this.saveConfig(config);
        console.log(`✅ Set ${key} = ${value}`);
      } else {
        console.log('Use --list, --get <key>, or --set <key=value>');
      }

    } catch (error) {
      console.error('❌ Configuration failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // Helper methods
  private getAIModel(modelName?: string): AIModel {
    return {
      provider: 'anthropic',
      model: modelName || 'claude-3-haiku',
      settings: {
        temperature: 0.3,
        maxTokens: 4000
      }
    };
  }

  private async outputTasks(taskTree: any, options: TaskMasterCLIOptions): Promise<void> {
    const output = options.output || `tasks-${Date.now()}.${options.format || 'json'}`;
    
    let content: string;
    switch (options.format) {
      case 'markdown':
        content = this.formatTasksAsMarkdown(taskTree);
        break;
      case 'csv':
        content = this.formatTasksAsCSV(taskTree);
        break;
      default:
        content = JSON.stringify(taskTree, null, 2);
    }

    if (!options.dryRun) {
      await writeFile(output, content);
    } else {
      console.log(`\n📄 Generated output (${options.format}):`);
      console.log(content.substring(0, 500) + (content.length > 500 ? '...' : ''));
    }
  }

  private formatTasksAsMarkdown(taskTree: any): string {
    // Simple markdown formatting
    let md = `# Generated Tasks\n\n`;
    md += `**Total Tasks:** ${taskTree.totalTasks}\n`;
    md += `**Estimated Hours:** ${taskTree.estimatedHours}\n`;
    md += `**Complexity:** ${taskTree.complexity}\n\n`;
    
    md += `## Tasks\n\n`;
    // Would iterate through tasks and format them
    md += `<!-- Task details would be rendered here -->\n`;
    
    return md;
  }

  private formatTasksAsCSV(taskTree: any): string {
    let csv = 'ID,Title,Status,Priority,Estimate,Tags\n';
    // Would iterate through tasks and format as CSV
    csv += '<!-- CSV task data would be rendered here -->\n';
    return csv;
  }

  private async checkConfigExists(): Promise<boolean> {
    try {
      await readFile('.taskmaster-config.json', 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private async loadConfig(): Promise<any> {
    try {
      const content = await readFile('.taskmaster-config.json', 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async saveConfig(config: any): Promise<void> {
    await writeFile('.taskmaster-config.json', JSON.stringify(config, null, 2));
  }

  private getConfigValue(config: any, key: string): any {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    return value;
  }

  private setConfigValue(config: any, key: string, value: string): void {
    const keys = key.split('.');
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  private async initBasicTaskMaster(): Promise<void> {
    const config = {
      version: '1.0',
      initialized: new Date().toISOString(),
      integration: {
        claudeFlow: true,
        extension: false
      }
    };
    await this.saveConfig(config);
    console.log('✅ Basic TaskMaster configuration initialized');
  }
}

export default TaskMasterCLI;