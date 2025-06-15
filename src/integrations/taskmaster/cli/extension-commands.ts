/**
 * Extension Commands
 * CLI commands for claude-task-master-extension VS Code integration
 */

import { ExtensionStorageAdapter, ExtensionTask } from '../adapters/extension-storage-adapter.js';
import { TaskAdapter } from '../adapters/task-adapter.js';
import { PRDService } from '../services/prd-service.js';
import { 
  TaskMasterTask, 
  ClaudeFlowTask,
  SPARCPhase,
  TaskMasterStatus,
  TaskMasterPriority
} from '../types/task-types.js';

export interface ExtensionCommandOptions {
  projectRoot?: string;
  watch?: boolean;
  sparcEnhance?: boolean;
  format?: 'json' | 'markdown' | 'csv';
}

export class ExtensionCommands {
  private storageAdapter: ExtensionStorageAdapter;
  private taskAdapter: TaskAdapter;
  private prdService: PRDService;

  constructor(options: ExtensionCommandOptions = {}) {
    this.storageAdapter = new ExtensionStorageAdapter({
      projectRoot: options.projectRoot,
      watchForChanges: options.watch
    });
    this.taskAdapter = new TaskAdapter();
    this.prdService = new PRDService();
  }

  /**
   * Initialize extension compatibility
   */
  async initExtension(options: ExtensionCommandOptions = {}): Promise<void> {
    console.log('🔧 Initializing claude-task-master-extension compatibility...\n');

    // Initialize storage
    await this.storageAdapter.initialize();

    // Create initial structure
    const initialTasks: ExtensionTask[] = [{
      id: 'welcome-task',
      title: 'Welcome to Claude-Flow + TaskMaster Extension',
      description: 'This project is now compatible with the VS Code TaskMaster extension!',
      status: 'completed',
      priority: 'high',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sparcPhase: SPARCPhase.SPECIFICATION,
      assignedAgent: 'spec-pseudocode',
      metadata: {
        claudeFlowEnhanced: true
      },
      subtasks: [
        {
          id: 'install-extension',
          title: 'Install the claude-task-master VS Code extension',
          description: 'Search for "claude-task-master" in VS Code extensions',
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'explore-features',
          title: 'Explore visual task management features',
          description: 'Use the TaskMaster sidebar to manage your tasks visually',
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'sparc-integration',
          title: 'Try SPARC methodology integration',
          description: 'Tasks are automatically enhanced with SPARC phases and agent assignments',
          status: 'todo',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sparcPhase: SPARCPhase.SPECIFICATION,
          assignedAgent: 'spec-pseudocode'
        }
      ]
    }];

    // Check if tasks already exist
    const existingTasks = await this.storageAdapter.readTasks();
    if (existingTasks.length === 0) {
      await this.storageAdapter.writeTasks(initialTasks);
      console.log('✅ Created initial task structure');
    } else {
      console.log(`ℹ️  Found ${existingTasks.length} existing tasks`);
    }

    // Create config files
    console.log('\n📁 Created .taskmaster directory structure:');
    console.log('   .taskmaster/');
    console.log('   ├── tasks/');
    console.log('   │   └── tasks.json');
    console.log('   ├── config/');
    console.log('   └── sparc/');

    console.log('\n✨ Extension compatibility initialized!');
    console.log('\nNext steps:');
    console.log('1. Install the claude-task-master VS Code extension');
    console.log('2. Open VS Code in this directory');
    console.log('3. Use the TaskMaster sidebar to view and manage tasks');
    console.log('4. Run "claude-flow taskmaster sync" to sync with SPARC phases');
  }

  /**
   * Sync existing claude-flow tasks to extension format
   */
  async syncToExtension(tasks: TaskMasterTask[]): Promise<void> {
    console.log(`📤 Syncing ${tasks.length} tasks to extension format...`);

    const extensionTasks = tasks.map(task => 
      this.storageAdapter.toExtensionFormat(task)
    );

    // Enhance with SPARC if requested
    const enhancedTasks = await this.storageAdapter.syncWithSPARC(extensionTasks);

    await this.storageAdapter.writeTasks(enhancedTasks);
    console.log('✅ Tasks synced to extension format');
  }

  /**
   * Import tasks from extension to claude-flow
   */
  async importFromExtension(): Promise<ClaudeFlowTask[]> {
    console.log('📥 Importing tasks from extension...');

    const extensionTasks = await this.storageAdapter.readTasks();
    const claudeFlowTasks = extensionTasks.map(task => 
      this.storageAdapter.toClaudeFlowFormat(task)
    );

    console.log(`✅ Imported ${claudeFlowTasks.length} tasks`);
    return claudeFlowTasks;
  }

  /**
   * Watch for extension changes
   */
  async watchExtension(callback: (tasks: ExtensionTask[]) => void): Promise<void> {
    console.log('👁️  Watching for extension task changes...');

    this.storageAdapter.on('tasksChanged', (tasks: ExtensionTask[]) => {
      console.log(`\n🔄 Tasks updated by extension (${tasks.length} tasks)`);
      callback(tasks);
    });

    await this.storageAdapter.initialize();
    console.log('✅ Watching .taskmaster/tasks/tasks.json for changes');
    console.log('   Press Ctrl+C to stop watching\n');
  }

  /**
   * Export tasks in various formats
   */
  async exportTasks(format: 'json' | 'markdown' | 'csv' = 'json'): Promise<string> {
    console.log(`📤 Exporting tasks as ${format}...`);
    const exported = await this.storageAdapter.exportTasks(format);
    console.log('✅ Tasks exported successfully');
    return exported;
  }

  /**
   * Add SPARC enhancements to existing tasks
   */
  async enhanceWithSPARC(): Promise<void> {
    console.log('🚀 Enhancing tasks with SPARC methodology...');

    const tasks = await this.storageAdapter.readTasks();
    const enhanced = await this.storageAdapter.syncWithSPARC(tasks);
    
    await this.storageAdapter.writeTasks(enhanced);

    // Count enhancements
    let phaseCount = 0;
    let agentCount = 0;
    
    const countEnhancements = (tasks: ExtensionTask[]): void => {
      tasks.forEach(task => {
        if (task.sparcPhase) phaseCount++;
        if (task.assignedAgent) agentCount++;
        if (task.subtasks) countEnhancements(task.subtasks);
      });
    };

    countEnhancements(enhanced);

    console.log('\n✅ SPARC enhancement complete:');
    console.log(`   - ${phaseCount} tasks assigned to SPARC phases`);
    console.log(`   - ${agentCount} tasks assigned to agents`);
  }

  /**
   * Generate tasks from PRD and save in extension format
   */
  async generateFromPRD(prdPath: string, options: any = {}): Promise<void> {
    console.log('📄 Generating tasks from PRD...');

    // Read PRD content
    const fs = await import('fs');
    const prdContent = await fs.promises.readFile(prdPath, 'utf-8');

    // Parse PRD
    const parsedPRD = await this.prdService.parsePRD(prdContent);

    // Generate tasks
    const taskTree = await this.prdService.generateTasks(parsedPRD, {
      model: { provider: 'anthropic', model: 'claude-3-sonnet' },
      sparcMapping: true,
      taskDepth: 2
    });

    // Convert to flat task list
    const tasks: TaskMasterTask[] = [];
    const extractTasks = (node: any): void => {
      if (node.task && node.task.id !== 'ROOT') {
        tasks.push(node.task);
      }
      if (node.children) {
        node.children.forEach(extractTasks);
      }
    };
    extractTasks(taskTree.root);

    // Convert to extension format and save
    await this.syncToExtension(tasks);

    console.log(`\n✅ Generated ${tasks.length} tasks from PRD`);
    console.log('   Tasks are now available in the VS Code extension');
  }

  /**
   * Show statistics about current tasks
   */
  async showStats(): Promise<void> {
    const tasks = await this.storageAdapter.readTasks();

    console.log('\n📊 Task Statistics:');
    console.log('==================\n');

    // Count by status
    const statusCounts: Record<string, number> = {
      'todo': 0,
      'in-progress': 0,
      'completed': 0,
      'blocked': 0
    };

    // Count by SPARC phase
    const phaseCounts: Record<string, number> = {};

    // Count by agent
    const agentCounts: Record<string, number> = {};

    const countTasks = (tasks: ExtensionTask[]): void => {
      tasks.forEach(task => {
        statusCounts[task.status]++;
        
        if (task.sparcPhase) {
          phaseCounts[task.sparcPhase] = (phaseCounts[task.sparcPhase] || 0) + 1;
        }
        
        if (task.assignedAgent) {
          agentCounts[task.assignedAgent] = (agentCounts[task.assignedAgent] || 0) + 1;
        }

        if (task.subtasks) {
          countTasks(task.subtasks);
        }
      });
    };

    countTasks(tasks);

    // Display stats
    console.log('Task Status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      if (count > 0) {
        const icon = status === 'completed' ? '✅' : 
                    status === 'in-progress' ? '🔄' :
                    status === 'blocked' ? '🚫' : '⏳';
        console.log(`  ${icon} ${status}: ${count}`);
      }
    });

    if (Object.keys(phaseCounts).length > 0) {
      console.log('\nSPARC Phases:');
      Object.entries(phaseCounts).forEach(([phase, count]) => {
        console.log(`  📋 ${phase}: ${count}`);
      });
    }

    if (Object.keys(agentCounts).length > 0) {
      console.log('\nAssigned Agents:');
      Object.entries(agentCounts).forEach(([agent, count]) => {
        console.log(`  🤖 ${agent}: ${count}`);
      });
    }

    const totalTasks = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const completedTasks = statusCounts['completed'] || 0;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    console.log(`\nTotal Tasks: ${totalTasks}`);
    console.log(`Completion Rate: ${completionRate}%`);
  }
}

// CLI command handlers
export const extensionCommands = {
  init: async (options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands(options);
    await commands.initExtension(options);
  },

  sync: async (options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands(options);
    await commands.enhanceWithSPARC();
  },

  watch: async (options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands({ ...options, watch: true });
    await commands.watchExtension((tasks) => {
      // Could trigger additional actions here
      console.log(`Updated task count: ${tasks.length}`);
    });

    // Keep process running
    process.stdin.resume();
  },

  export: async (format: 'json' | 'markdown' | 'csv' = 'json', options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands(options);
    const exported = await commands.exportTasks(format);
    console.log(exported);
  },

  stats: async (options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands(options);
    await commands.showStats();
  },

  'generate-from-prd': async (prdPath: string, options: ExtensionCommandOptions = {}) => {
    const commands = new ExtensionCommands(options);
    await commands.generateFromPRD(prdPath, options);
  }
};

export default ExtensionCommands;