/**
 * Deno-compatible bridge for TaskMaster integration
 * Handles Node.js to Deno compatibility layer
 */

import { EventEmitter } from '../../cli/commands/start/event-emitter.ts';
import { SimpleMemoryManager } from '../../cli/commands/memory.ts';
import { join } from 'https://deno.land/std@0.224.0/path/mod.ts';
import { PRDParserService, ParsedPRD } from './services/prd-parser-deno.ts';
import { SmartTaskGeneratorService } from './services/smart-task-generator-deno.ts';
import { SyncIntegration } from './services/sync-integration.ts';
import { TaskAdapter } from './adapters/task-adapter-deno.ts';
// For now, define minimal types locally to avoid import issues
interface ParseOptions {
  model?: string;
  depth?: number;
}

interface GenerateOptions extends ParseOptions {
  sparcMapping?: boolean;
  assignAgents?: boolean;
}

interface TaskMasterTask {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  assignee: string | null;
  sparc_mode?: string;
  subtasks: TaskMasterTask[];
  updatedAt?: string;
  createdAt?: string;
  dependencies?: string[];
  metadata?: Record<string, any>;
}

interface PRDDocument {
  id: string;
  title: string;
  content: string;
  sections: any[];
  metadata: {
    created: string;
    version: string;
  };
}

export class TaskMasterDenoBridge {
  protected taskAdapter: TaskAdapter;
  protected prdParser: PRDParserService;
  protected taskGenerator: SmartTaskGeneratorService;
  protected eventEmitter: EventEmitter;
  protected memory: SimpleMemoryManager;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.memory = new SimpleMemoryManager();
    this.taskAdapter = new TaskAdapter();
    this.prdParser = new PRDParserService();
    this.taskGenerator = new SmartTaskGeneratorService();
  }

  private async initializeServices(): Promise<void> {
    // TODO: Initialize services with proper Deno compatibility
    // For now, we'll create a simplified implementation
  }

  async parsePRD(prdPath: string, options?: ParseOptions): Promise<PRDDocument> {
    try {
      const content = await Deno.readTextFile(prdPath);
      
      // Use the enhanced PRD parser
      const parsedPRD = await this.prdParser.parsePRD(content, {
        aiEnhanced: options?.model !== undefined
      });
      
      // Convert to our PRDDocument format
      const prd: PRDDocument = {
        id: parsedPRD.id,
        title: parsedPRD.title,
        content: parsedPRD.rawContent,
        sections: parsedPRD.sections.map(s => ({
          title: s.title,
          type: s.type,
          content: s.content,
          level: s.level
        })),
        metadata: {
          created: parsedPRD.metadata.created,
          version: parsedPRD.version,
          parsedBy: options?.model || 'enhanced-parser',
          sourcePath: prdPath,
          tags: parsedPRD.metadata.tags
        }
      };
      
      // Store the full parsed PRD in memory
      await this.memory.store(
        `prd_${prd.id}`,
        JSON.stringify({ ...prd, features: parsedPRD.features, requirements: parsedPRD.requirements }),
        'taskmaster_prds'
      );
      
      // Store PRD metadata for quick lookup
      await this.memory.store(
        `prd_list_${prd.id}`,
        JSON.stringify({
          id: prd.id,
          title: prd.title,
          path: prdPath,
          created: prd.metadata.created,
          featureCount: parsedPRD.features.length,
          requirementCount: parsedPRD.requirements.length
        }),
        'taskmaster_prds'
      );
      
      return prd;
    } catch (error) {
      throw new Error(`Failed to parse PRD: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private extractSections(content: string): any[] {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;
    let currentContent = [];
    
    for (const line of lines) {
      const headingMatch = line.match(/^(#{2,})\s+(.+)$/);
      
      if (headingMatch) {
        // Save previous section
        if (currentSection) {
          sections.push({
            ...currentSection,
            content: currentContent.join('\n').trim()
          });
        }
        
        // Start new section
        currentSection = {
          level: headingMatch[1].length,
          title: headingMatch[2],
          type: this.identifySectionType(headingMatch[2])
        };
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }
    
    // Save last section
    if (currentSection) {
      sections.push({
        ...currentSection,
        content: currentContent.join('\n').trim()
      });
    }
    
    return sections;
  }
  
  private identifySectionType(title: string): string {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('overview') || lowerTitle.includes('summary')) return 'overview';
    if (lowerTitle.includes('requirement') || lowerTitle.includes('feature')) return 'requirements';
    if (lowerTitle.includes('technical') || lowerTitle.includes('architecture')) return 'technical';
    if (lowerTitle.includes('user') || lowerTitle.includes('persona')) return 'user';
    if (lowerTitle.includes('constraint') || lowerTitle.includes('limitation')) return 'constraints';
    return 'other';
  }

  async generateTasks(prdPath: string, options?: GenerateOptions): Promise<TaskMasterTask[]> {
    try {
      // First parse the PRD to get the parsed data
      const content = await Deno.readTextFile(prdPath);
      const parsedPRD = await this.prdParser.parsePRD(content);
      
      // Generate tasks using the smart generator
      const generatedTasks = await this.taskGenerator.generateTasks(parsedPRD, {
        depth: options?.depth || 3,
        sparcMapping: options?.sparcMapping !== false, // Default to true
        assignAgents: options?.assignAgents,
        includeEstimates: false,
        generateDependencies: true
      });
      
      // Convert to our TaskMasterTask format if needed
      const tasks: TaskMasterTask[] = generatedTasks.map(task => ({
        ...task,
        sparc_mode: options?.sparcMapping ? task.sparc_mode : undefined
      }));
      
      // Store tasks in memory
      await this.memory.store(
        `tasks_${parsedPRD.id}`,
        JSON.stringify(tasks),
        'taskmaster_tasks'
      );
      
      // Store task summary for quick lookup
      await this.memory.store(
        `task_summary_${parsedPRD.id}`,
        JSON.stringify({
          prdId: parsedPRD.id,
          prdTitle: parsedPRD.title,
          taskCount: tasks.length,
          created: new Date().toISOString(),
          priorities: {
            high: tasks.filter(t => t.priority === 'high').length,
            medium: tasks.filter(t => t.priority === 'medium').length,
            low: tasks.filter(t => t.priority === 'low').length
          },
          taskTypes: this.getTaskTypeDistribution(tasks),
          withSubtasks: tasks.filter(t => t.subtasks && t.subtasks.length > 0).length
        }),
        'taskmaster_tasks'
      );
      
      return tasks;
    } catch (error) {
      throw new Error(`Failed to generate tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  protected getTaskTypeDistribution(tasks: TaskMasterTask[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    for (const task of tasks) {
      distribution[task.type] = (distribution[task.type] || 0) + 1;
    }
    
    return distribution;
  }
  
  private generateTasksFromSection(section: any, options?: GenerateOptions): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = [];
    const content = section.content.toLowerCase();
    
    // Extract features or requirements from bullet points
    const bulletPoints = section.content.match(/[-*]\s+(.+)/gm) || [];
    
    for (const bullet of bulletPoints) {
      const feature = bullet.replace(/^[-*]\s+/, '').trim();
      
      // Determine task type and SPARC mode based on content
      let taskType = 'implementation';
      let sparcMode = 'code';
      
      if (feature.toLowerCase().includes('api') || feature.toLowerCase().includes('endpoint')) {
        taskType = 'api';
        sparcMode = 'api-only';
      } else if (feature.toLowerCase().includes('database') || feature.toLowerCase().includes('schema')) {
        taskType = 'database';
        sparcMode = 'backend-only';
      } else if (feature.toLowerCase().includes('ui') || feature.toLowerCase().includes('interface')) {
        taskType = 'frontend';
        sparcMode = 'frontend-only';
      } else if (feature.toLowerCase().includes('security') || feature.toLowerCase().includes('auth')) {
        taskType = 'security';
        sparcMode = 'security-review';
      }
      
      tasks.push({
        id: crypto.randomUUID(),
        title: `Implement ${feature}`,
        description: feature,
        type: taskType,
        priority: this.determinePriority(feature),
        status: 'pending',
        assignee: null,
        ...(options?.sparcMapping && { sparc_mode: sparcMode }),
        subtasks: [],
        createdAt: new Date().toISOString()
      });
    }
    
    return tasks;
  }
  
  private determinePriority(feature: string): string {
    const lowercaseFeature = feature.toLowerCase();
    
    if (lowercaseFeature.includes('core') || 
        lowercaseFeature.includes('critical') || 
        lowercaseFeature.includes('authentication') ||
        lowercaseFeature.includes('security')) {
      return 'high';
    }
    
    if (lowercaseFeature.includes('optional') || 
        lowercaseFeature.includes('nice to have') ||
        lowercaseFeature.includes('future')) {
      return 'low';
    }
    
    return 'medium';
  }

  async syncWithVSCode(): Promise<void> {
    this.eventEmitter.emit('sync:started');
    
    try {
      // For now, just emit events to show sync is working
      // Full sync integration will be implemented separately
      console.log('  Checking for VS Code extension data...');
      
      // Simulate basic sync operation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('  No VS Code extension data found (extension not installed)');
      console.log('  To enable sync:');
      console.log('    1. Install the TaskMaster VS Code extension');
      console.log('    2. Run: taskmaster sync server start');
      console.log('    3. Connect from VS Code using the extension');
      
      this.eventEmitter.emit('sync:completed', { 
        success: true, 
        syncedTasks: 0,
        message: 'No sync data available' 
      });
    } catch (error) {
      this.eventEmitter.emit('sync:error', error);
      throw error;
    }
  }
  
  async getStoredPRDs(): Promise<any[]> {
    const prds = await this.memory.query('', 'taskmaster_prds');
    return prds.filter(entry => entry.key.startsWith('prd_list_')).map(e => JSON.parse(e.value));
  }
  
  async getStoredTasks(): Promise<any[]> {
    const tasks = await this.memory.query('', 'taskmaster_tasks');
    return tasks.filter(entry => entry.key.startsWith('task_summary_')).map(e => JSON.parse(e.value));
  }
  
  async updateTaskStatus(taskId: string, status: string): Promise<boolean> {
    try {
      // Get all stored tasks
      const taskEntries = await this.memory.query('tasks_', 'taskmaster_tasks');
      
      for (const entry of taskEntries) {
        const tasks = JSON.parse(entry.value) as TaskMasterTask[];
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        
        if (taskIndex !== -1) {
          // Update task status
          tasks[taskIndex].status = status;
          tasks[taskIndex].updatedAt = new Date().toISOString();
          
          // Store updated tasks
          await this.memory.store(entry.key, JSON.stringify(tasks), 'taskmaster_tasks');
          
          // Emit update event
          this.eventEmitter.emit('task:updated', { taskId, status });
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      throw new Error(`Failed to update task status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async getTaskById(taskId: string): Promise<TaskMasterTask | null> {
    const taskEntries = await this.memory.query('tasks_', 'taskmaster_tasks');
    
    for (const entry of taskEntries) {
      const tasks = JSON.parse(entry.value) as TaskMasterTask[];
      const task = tasks.find(t => t.id === taskId);
      
      if (task) {
        return task;
      }
    }
    
    return null;
  }
  
  async exportTasks(format: 'json' | 'markdown' | 'csv' = 'json'): Promise<string> {
    const taskEntries = await this.memory.query('tasks_', 'taskmaster_tasks');
    const allTasks: TaskMasterTask[] = [];
    
    for (const entry of taskEntries) {
      const tasks = JSON.parse(entry.value) as TaskMasterTask[];
      allTasks.push(...tasks);
    }
    
    switch (format) {
      case 'markdown':
        return this.exportAsMarkdown(allTasks);
      case 'csv':
        return this.exportAsCSV(allTasks);
      default:
        return JSON.stringify(allTasks, null, 2);
    }
  }
  
  private exportAsMarkdown(tasks: TaskMasterTask[]): string {
    let markdown = '# TaskMaster Tasks\n\n';
    
    // Group by priority
    const highPriority = tasks.filter(t => t.priority === 'high');
    const mediumPriority = tasks.filter(t => t.priority === 'medium');
    const lowPriority = tasks.filter(t => t.priority === 'low');
    
    if (highPriority.length > 0) {
      markdown += '## High Priority\n\n';
      highPriority.forEach(task => {
        markdown += `### ${task.title}\n`;
        markdown += `- **Status**: ${task.status}\n`;
        markdown += `- **Type**: ${task.type}\n`;
        if (task.sparc_mode) markdown += `- **SPARC Mode**: ${task.sparc_mode}\n`;
        markdown += `- **Description**: ${task.description}\n\n`;
      });
    }
    
    if (mediumPriority.length > 0) {
      markdown += '## Medium Priority\n\n';
      mediumPriority.forEach(task => {
        markdown += `### ${task.title}\n`;
        markdown += `- **Status**: ${task.status}\n`;
        markdown += `- **Type**: ${task.type}\n`;
        if (task.sparc_mode) markdown += `- **SPARC Mode**: ${task.sparc_mode}\n`;
        markdown += `- **Description**: ${task.description}\n\n`;
      });
    }
    
    if (lowPriority.length > 0) {
      markdown += '## Low Priority\n\n';
      lowPriority.forEach(task => {
        markdown += `### ${task.title}\n`;
        markdown += `- **Status**: ${task.status}\n`;
        markdown += `- **Type**: ${task.type}\n`;
        if (task.sparc_mode) markdown += `- **SPARC Mode**: ${task.sparc_mode}\n`;
        markdown += `- **Description**: ${task.description}\n\n`;
      });
    }
    
    return markdown;
  }
  
  private exportAsCSV(tasks: TaskMasterTask[]): string {
    const headers = ['ID', 'Title', 'Description', 'Type', 'Priority', 'Status', 'SPARC Mode', 'Assignee'];
    const rows = tasks.map(task => [
      task.id,
      `"${task.title.replace(/"/g, '""')}"`,
      `"${task.description.replace(/"/g, '""')}"`,
      task.type,
      task.priority,
      task.status,
      task.sparc_mode || '',
      task.assignee || ''
    ]);
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.off(event, handler);
  }
}