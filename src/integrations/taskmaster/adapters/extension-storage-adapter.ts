/**
 * Extension Storage Adapter
 * Provides compatibility with claude-task-master-extension VS Code extension
 * Enables reading/writing tasks in .taskmaster/tasks/tasks.json format
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';

import {
  TaskMasterTask,
  ClaudeFlowTask,
  SPARCPhase,
  TaskMasterStatus,
  TaskMasterPriority,
  ClaudeFlowStatus,
  ClaudeFlowPriority
} from '../types/task-types.js';

// Extension-compatible task format
export interface ExtensionTask {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'completed' | 'blocked';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  subtasks?: ExtensionTask[];
  parent?: string;
  progress?: number;
  expanded?: boolean;
  createdAt: string;
  updatedAt: string;
  // Claude-Flow enhancements
  sparcPhase?: SPARCPhase;
  assignedAgent?: string;
  estimatedHours?: number;
  dependencies?: string[];
  metadata?: {
    claudeFlowEnhanced?: boolean;
    aiGenerated?: boolean;
    prdSection?: string;
    complexity?: number;
  };
}

export interface ExtensionTaskFile {
  tasks: ExtensionTask[];
  version: string;
  lastModified: string;
}

export interface StorageConfig {
  projectRoot?: string;
  autoCreateDir?: boolean;
  watchForChanges?: boolean;
  backupBeforeWrite?: boolean;
}

export class ExtensionStorageAdapter extends EventEmitter {
  private projectRoot: string;
  private tasksFilePath: string;
  private backupFilePath: string;
  private configDir: string;
  private watcher: FSWatcher | null = null;
  private config: StorageConfig;

  constructor(config: StorageConfig = {}) {
    super();
    this.config = {
      projectRoot: config.projectRoot || process.cwd(),
      autoCreateDir: config.autoCreateDir !== false,
      watchForChanges: config.watchForChanges !== false,
      backupBeforeWrite: config.backupBeforeWrite !== false
    };

    this.projectRoot = this.config.projectRoot!;
    this.tasksFilePath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.json');
    this.backupFilePath = path.join(this.projectRoot, '.taskmaster', 'tasks', 'tasks.backup.json');
    this.configDir = path.join(this.projectRoot, '.taskmaster', 'config');
  }

  /**
   * Initialize the storage adapter
   */
  public async initialize(): Promise<void> {
    if (this.config.autoCreateDir) {
      await this.ensureDirectoryStructure();
    }

    if (this.config.watchForChanges) {
      await this.startWatching();
    }
  }

  /**
   * Read tasks from the extension format
   */
  public async readTasks(): Promise<ExtensionTask[]> {
    try {
      const exists = await this.fileExists(this.tasksFilePath);
      if (!exists) {
        return [];
      }

      const content = await fs.readFile(this.tasksFilePath, 'utf-8');
      const data: ExtensionTaskFile = JSON.parse(content);
      return data.tasks || [];
    } catch (error) {
      console.error('Error reading tasks file:', error);
      return [];
    }
  }

  /**
   * Write tasks in extension format
   */
  public async writeTasks(tasks: ExtensionTask[]): Promise<void> {
    try {
      // Backup existing file if configured
      if (this.config.backupBeforeWrite) {
        await this.backupTasks();
      }

      // Ensure directory exists
      await this.ensureDirectoryStructure();

      // Prepare file data
      const fileData: ExtensionTaskFile = {
        tasks,
        version: '1.0',
        lastModified: new Date().toISOString()
      };

      // Write to file
      await fs.writeFile(
        this.tasksFilePath,
        JSON.stringify(fileData, null, 2),
        'utf-8'
      );

      this.emit('tasksUpdated', tasks);
    } catch (error) {
      console.error('Error writing tasks file:', error);
      throw error;
    }
  }

  /**
   * Convert TaskMaster task to Extension format
   */
  public toExtensionFormat(task: TaskMasterTask, subtasks: TaskMasterTask[] = []): ExtensionTask {
    const extensionTask: ExtensionTask = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: this.mapTaskMasterStatus(task.status),
      priority: this.mapTaskMasterPriority(task.priority),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      estimatedHours: task.estimate,
      dependencies: task.dependencies,
      assignedAgent: task.assignee,
      metadata: {
        claudeFlowEnhanced: true,
        aiGenerated: task.metadata?.ai_generated,
        prdSection: task.metadata?.prd_section,
        complexity: task.metadata?.complexity
      }
    };

    // Add subtasks if provided
    if (subtasks.length > 0) {
      extensionTask.subtasks = subtasks.map(st => this.toExtensionFormat(st));
    }

    // Calculate progress based on subtasks
    if (extensionTask.subtasks && extensionTask.subtasks.length > 0) {
      const completed = extensionTask.subtasks.filter(st => st.status === 'completed').length;
      extensionTask.progress = Math.round((completed / extensionTask.subtasks.length) * 100);
    }

    return extensionTask;
  }

  /**
   * Convert Extension task to ClaudeFlow format
   */
  public toClaudeFlowFormat(task: ExtensionTask): ClaudeFlowTask {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: this.mapExtensionStatus(task.status),
      priority: this.mapExtensionPriority(task.priority || 'medium'),
      phase: task.sparcPhase,
      agent: task.assignedAgent,
      dependencies: task.dependencies,
      estimatedHours: task.estimatedHours,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
      context: {
        sparc_phase: task.sparcPhase,
        assigned_agent: task.assignedAgent,
        project_context: task.metadata?.prdSection
      }
    };
  }

  /**
   * Convert ClaudeFlow task to Extension format
   */
  public fromClaudeFlowFormat(task: ClaudeFlowTask): ExtensionTask {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: this.mapClaudeFlowStatus(task.status),
      priority: this.mapClaudeFlowPriority(task.priority),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      sparcPhase: task.phase,
      assignedAgent: task.agent,
      estimatedHours: task.estimatedHours,
      dependencies: task.dependencies,
      metadata: {
        claudeFlowEnhanced: true,
        prdSection: task.context?.project_context
      }
    };
  }

  /**
   * Sync tasks with SPARC enhancements
   */
  public async syncWithSPARC(tasks: ExtensionTask[]): Promise<ExtensionTask[]> {
    return tasks.map(task => this.enhanceWithSPARC(task));
  }

  /**
   * Add SPARC metadata to a task
   */
  private enhanceWithSPARC(task: ExtensionTask): ExtensionTask {
    if (!task.sparcPhase) {
      task.sparcPhase = this.inferSPARCPhase(task);
    }

    if (!task.assignedAgent) {
      task.assignedAgent = this.suggestAgent(task);
    }

    task.metadata = {
      ...task.metadata,
      claudeFlowEnhanced: true
    };

    // Enhance subtasks recursively
    if (task.subtasks) {
      task.subtasks = task.subtasks.map(st => this.enhanceWithSPARC(st));
    }

    return task;
  }

  /**
   * Watch for changes to the tasks file
   */
  private async startWatching(): Promise<void> {
    if (this.watcher) {
      await this.stopWatching();
    }

    this.watcher = watch(this.tasksFilePath, {
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', async () => {
      const tasks = await this.readTasks();
      this.emit('tasksChanged', tasks);
    });
  }

  /**
   * Stop watching for changes
   */
  public async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Ensure .taskmaster directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    const dirs = [
      path.join(this.projectRoot, '.taskmaster'),
      path.join(this.projectRoot, '.taskmaster', 'tasks'),
      path.join(this.projectRoot, '.taskmaster', 'config'),
      path.join(this.projectRoot, '.taskmaster', 'sparc')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Backup current tasks file
   */
  private async backupTasks(): Promise<void> {
    try {
      const exists = await this.fileExists(this.tasksFilePath);
      if (exists) {
        await fs.copyFile(this.tasksFilePath, this.backupFilePath);
      }
    } catch (error) {
      console.warn('Failed to backup tasks file:', error);
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Status mapping utilities
   */
  private mapTaskMasterStatus(status: TaskMasterStatus): ExtensionTask['status'] {
    const mapping: Record<TaskMasterStatus, ExtensionTask['status']> = {
      [TaskMasterStatus.TODO]: 'todo',
      [TaskMasterStatus.IN_PROGRESS]: 'in-progress',
      [TaskMasterStatus.DONE]: 'completed',
      [TaskMasterStatus.BLOCKED]: 'blocked',
      [TaskMasterStatus.CANCELLED]: 'blocked'
    };
    return mapping[status] || 'todo';
  }

  private mapExtensionStatus(status: ExtensionTask['status']): ClaudeFlowStatus {
    const mapping: Record<ExtensionTask['status'], ClaudeFlowStatus> = {
      'todo': ClaudeFlowStatus.PENDING,
      'in-progress': ClaudeFlowStatus.IN_PROGRESS,
      'completed': ClaudeFlowStatus.COMPLETED,
      'blocked': ClaudeFlowStatus.BLOCKED
    };
    return mapping[status] || ClaudeFlowStatus.PENDING;
  }

  private mapClaudeFlowStatus(status: ClaudeFlowStatus): ExtensionTask['status'] {
    const mapping: Record<ClaudeFlowStatus, ExtensionTask['status']> = {
      [ClaudeFlowStatus.PENDING]: 'todo',
      [ClaudeFlowStatus.IN_PROGRESS]: 'in-progress',
      [ClaudeFlowStatus.COMPLETED]: 'completed',
      [ClaudeFlowStatus.BLOCKED]: 'blocked',
      [ClaudeFlowStatus.CANCELLED]: 'blocked'
    };
    return mapping[status] || 'todo';
  }

  /**
   * Priority mapping utilities
   */
  private mapTaskMasterPriority(priority: TaskMasterPriority): ExtensionTask['priority'] {
    const mapping: Record<TaskMasterPriority, ExtensionTask['priority']> = {
      [TaskMasterPriority.LOW]: 'low',
      [TaskMasterPriority.MEDIUM]: 'medium',
      [TaskMasterPriority.HIGH]: 'high',
      [TaskMasterPriority.CRITICAL]: 'critical'
    };
    return mapping[priority] || 'medium';
  }

  private mapExtensionPriority(priority: ExtensionTask['priority']): ClaudeFlowPriority {
    const mapping: Record<NonNullable<ExtensionTask['priority']>, ClaudeFlowPriority> = {
      'low': ClaudeFlowPriority.LOW,
      'medium': ClaudeFlowPriority.MEDIUM,
      'high': ClaudeFlowPriority.HIGH,
      'critical': ClaudeFlowPriority.HIGH
    };
    return mapping[priority] || ClaudeFlowPriority.MEDIUM;
  }

  private mapClaudeFlowPriority(priority: ClaudeFlowPriority): ExtensionTask['priority'] {
    const mapping: Record<ClaudeFlowPriority, ExtensionTask['priority']> = {
      [ClaudeFlowPriority.LOW]: 'low',
      [ClaudeFlowPriority.MEDIUM]: 'medium',
      [ClaudeFlowPriority.HIGH]: 'high'
    };
    return mapping[priority] || 'medium';
  }

  /**
   * SPARC inference utilities
   */
  private inferSPARCPhase(task: ExtensionTask): SPARCPhase | undefined {
    const title = task.title.toLowerCase();
    const desc = (task.description || '').toLowerCase();
    const combined = `${title} ${desc}`;

    if (combined.match(/requirement|spec|goal|objective/)) {
      return SPARCPhase.SPECIFICATION;
    } else if (combined.match(/design|architect|structure|pattern/)) {
      return SPARCPhase.ARCHITECTURE;
    } else if (combined.match(/algorithm|logic|pseudo|flow/)) {
      return SPARCPhase.PSEUDOCODE;
    } else if (combined.match(/implement|code|develop|build/)) {
      return SPARCPhase.REFINEMENT;
    } else if (combined.match(/test|validate|deploy|integrate/)) {
      return SPARCPhase.COMPLETION;
    }

    return undefined;
  }

  private suggestAgent(task: ExtensionTask): string | undefined {
    const phase = task.sparcPhase || this.inferSPARCPhase(task);
    
    if (!phase) return undefined;

    const agentMapping: Record<SPARCPhase, string> = {
      [SPARCPhase.SPECIFICATION]: 'spec-pseudocode',
      [SPARCPhase.PSEUDOCODE]: 'spec-pseudocode',
      [SPARCPhase.ARCHITECTURE]: 'architect',
      [SPARCPhase.REFINEMENT]: 'code',
      [SPARCPhase.COMPLETION]: 'integration'
    };

    // Special cases based on task content
    const title = task.title.toLowerCase();
    if (title.includes('test')) return 'tdd';
    if (title.includes('security')) return 'security-review';
    if (title.includes('document')) return 'docs-writer';
    if (title.includes('deploy')) return 'devops';

    return agentMapping[phase];
  }

  /**
   * Export tasks in different formats
   */
  public async exportTasks(format: 'json' | 'markdown' | 'csv' = 'json'): Promise<string> {
    const tasks = await this.readTasks();

    switch (format) {
      case 'markdown':
        return this.exportAsMarkdown(tasks);
      case 'csv':
        return this.exportAsCSV(tasks);
      default:
        return JSON.stringify(tasks, null, 2);
    }
  }

  private exportAsMarkdown(tasks: ExtensionTask[]): string {
    let markdown = '# Task List\n\n';
    
    const renderTask = (task: ExtensionTask, level: number = 0): string => {
      const indent = '  '.repeat(level);
      const status = task.status === 'completed' ? '✅' : 
                    task.status === 'in-progress' ? '🔄' :
                    task.status === 'blocked' ? '🚫' : '⏳';
      
      let result = `${indent}- ${status} **${task.title}**\n`;
      if (task.description) result += `${indent}  ${task.description}\n`;
      if (task.sparcPhase) result += `${indent}  SPARC: ${task.sparcPhase}\n`;
      if (task.assignedAgent) result += `${indent}  Agent: ${task.assignedAgent}\n`;
      
      if (task.subtasks) {
        task.subtasks.forEach(st => {
          result += renderTask(st, level + 1);
        });
      }
      
      return result;
    };

    tasks.forEach(task => {
      markdown += renderTask(task);
    });

    return markdown;
  }

  private exportAsCSV(tasks: ExtensionTask[]): string {
    const headers = ['ID', 'Title', 'Status', 'Priority', 'SPARC Phase', 'Agent', 'Created', 'Updated'];
    const rows: string[][] = [headers];

    const flattenTasks = (tasks: ExtensionTask[], parent?: string): void => {
      tasks.forEach(task => {
        rows.push([
          task.id,
          parent ? `${parent} > ${task.title}` : task.title,
          task.status,
          task.priority || 'medium',
          task.sparcPhase || '',
          task.assignedAgent || '',
          task.createdAt,
          task.updatedAt
        ]);

        if (task.subtasks) {
          flattenTasks(task.subtasks, task.title);
        }
      });
    };

    flattenTasks(tasks);
    return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  }
}

export default ExtensionStorageAdapter;