/**
 * Template Service for TaskMaster
 * Manages task templates and their application
 */

import { 
  TaskTemplate, 
  TemplateApplication, 
  TemplateApplicationResult,
  TemplateValidationResult,
  TemplateError,
  TemplateVariable,
  VariableType,
  TemplateCategory
} from '../types/template-types.ts';
import { TaskMasterTask, TaskMasterStatus, TaskMasterPriority } from '../../types/task-types.ts';
import { MemoryService } from '../../services/memory-adapter.ts';
import { v4 as uuidv4 } from 'npm:uuid@9.0.0';

export class TemplateService {
  private memoryService: MemoryService;
  private readonly TEMPLATE_NAMESPACE = 'taskmaster:templates';

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
  }

  /**
   * Create a new template
   */
  async createTemplate(template: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskTemplate> {
    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      throw new Error(`Invalid template: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    const newTemplate: TaskTemplate = {
      ...template,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.saveTemplate(newTemplate);
    return newTemplate;
  }

  /**
   * Get template by ID
   */
  async getTemplate(id: string): Promise<TaskTemplate | null> {
    const templates = await this.getAllTemplates();
    return templates.find(t => t.id === id) || null;
  }

  /**
   * Get all templates
   */
  async getAllTemplates(): Promise<TaskTemplate[]> {
    const stored = await this.memoryService.retrieve(`${this.TEMPLATE_NAMESPACE}:all`);
    if (!stored) return [];
    
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  /**
   * Get templates by category
   */
  async getTemplatesByCategory(category: TemplateCategory): Promise<TaskTemplate[]> {
    const templates = await this.getAllTemplates();
    return templates.filter(t => t.category === category);
  }

  /**
   * Update a template
   */
  async updateTemplate(id: string, updates: Partial<TaskTemplate>): Promise<TaskTemplate> {
    const template = await this.getTemplate(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    const updatedTemplate: TaskTemplate = {
      ...template,
      ...updates,
      id, // Preserve original ID
      createdAt: template.createdAt, // Preserve creation date
      updatedAt: new Date()
    };

    const validation = this.validateTemplate(updatedTemplate);
    if (!validation.valid) {
      throw new Error(`Invalid template update: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    await this.saveTemplate(updatedTemplate);
    return updatedTemplate;
  }

  /**
   * Delete a template
   */
  async deleteTemplate(id: string): Promise<boolean> {
    const templates = await this.getAllTemplates();
    const filtered = templates.filter(t => t.id !== id);
    
    if (filtered.length === templates.length) {
      return false; // Template not found
    }

    await this.memoryService.store(
      `${this.TEMPLATE_NAMESPACE}:all`,
      JSON.stringify(filtered)
    );
    return true;
  }

  /**
   * Apply a template to create tasks
   */
  async applyTemplate(application: TemplateApplication): Promise<TemplateApplicationResult> {
    const template = await this.getTemplate(application.templateId);
    if (!template) {
      return {
        templateId: application.templateId,
        success: false,
        tasksCreated: [],
        errors: [`Template ${application.templateId} not found`]
      };
    }

    // Validate variables
    const variableErrors = this.validateVariables(template.variables, application.variables);
    if (variableErrors.length > 0) {
      return {
        templateId: application.templateId,
        success: false,
        tasksCreated: [],
        errors: variableErrors
      };
    }

    // Create tasks from template
    const createdTasks: string[] = [];
    const errors: string[] = [];

    try {
      for (const templateTask of template.tasks) {
        const task = await this.createTaskFromTemplate(
          templateTask, 
          application.variables,
          application.options
        );
        createdTasks.push(task.id);
      }

      return {
        templateId: application.templateId,
        success: true,
        tasksCreated: createdTasks
      };
    } catch (error) {
      return {
        templateId: application.templateId,
        success: false,
        tasksCreated: createdTasks,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Validate a template
   */
  private validateTemplate(template: Partial<TaskTemplate>): TemplateValidationResult {
    const errors: TemplateError[] = [];

    // Required fields
    if (!template.name) {
      errors.push({ field: 'name', message: 'Template name is required', severity: 'error' });
    }

    if (!template.description) {
      errors.push({ field: 'description', message: 'Template description is required', severity: 'error' });
    }

    if (!template.category) {
      errors.push({ field: 'category', message: 'Template category is required', severity: 'error' });
    }

    if (!template.tasks || template.tasks.length === 0) {
      errors.push({ field: 'tasks', message: 'Template must have at least one task', severity: 'error' });
    }

    // Validate variables
    if (template.variables) {
      template.variables.forEach((variable, index) => {
        if (!variable.name) {
          errors.push({ 
            field: `variables[${index}].name`, 
            message: 'Variable name is required', 
            severity: 'error' 
          });
        }
        if (!variable.type) {
          errors.push({ 
            field: `variables[${index}].type`, 
            message: 'Variable type is required', 
            severity: 'error' 
          });
        }
      });
    }

    // Validate task dependencies
    if (template.tasks) {
      const taskIds = new Set(template.tasks.map(t => t.id));
      template.tasks.forEach((task, index) => {
        if (task.dependencies) {
          task.dependencies.forEach(dep => {
            if (!taskIds.has(dep)) {
              errors.push({
                field: `tasks[${index}].dependencies`,
                message: `Task dependency '${dep}' not found in template`,
                severity: 'error'
              });
            }
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * Validate template variables
   */
  private validateVariables(
    templateVars: TemplateVariable[], 
    providedVars: Record<string, any>
  ): string[] {
    const errors: string[] = [];

    for (const variable of templateVars) {
      const value = providedVars[variable.name];

      // Check required variables
      if (variable.required && value === undefined) {
        errors.push(`Required variable '${variable.name}' is missing`);
        continue;
      }

      // Skip validation if not provided and not required
      if (value === undefined) {
        continue;
      }

      // Type validation
      switch (variable.type) {
        case VariableType.STRING:
          if (typeof value !== 'string') {
            errors.push(`Variable '${variable.name}' must be a string`);
          } else if (variable.validation?.pattern) {
            const regex = new RegExp(variable.validation.pattern);
            if (!regex.test(value)) {
              errors.push(`Variable '${variable.name}' does not match pattern ${variable.validation.pattern}`);
            }
          }
          break;

        case VariableType.NUMBER:
          if (typeof value !== 'number') {
            errors.push(`Variable '${variable.name}' must be a number`);
          } else {
            if (variable.validation?.min !== undefined && value < variable.validation.min) {
              errors.push(`Variable '${variable.name}' must be at least ${variable.validation.min}`);
            }
            if (variable.validation?.max !== undefined && value > variable.validation.max) {
              errors.push(`Variable '${variable.name}' must be at most ${variable.validation.max}`);
            }
          }
          break;

        case VariableType.BOOLEAN:
          if (typeof value !== 'boolean') {
            errors.push(`Variable '${variable.name}' must be a boolean`);
          }
          break;

        case VariableType.ENUM:
          if (!variable.options?.includes(value)) {
            errors.push(`Variable '${variable.name}' must be one of: ${variable.options?.join(', ')}`);
          }
          break;

        case VariableType.ARRAY:
          if (!Array.isArray(value)) {
            errors.push(`Variable '${variable.name}' must be an array`);
          }
          break;
      }
    }

    return errors;
  }

  /**
   * Create a task from a template task
   */
  private async createTaskFromTemplate(
    templateTask: any,
    variables: Record<string, any>,
    options?: any
  ): Promise<TaskMasterTask> {
    // Replace variables in task properties
    const processedTask = this.processVariables(templateTask, variables);

    const task: TaskMasterTask = {
      id: uuidv4(),
      title: options?.addPrefix ? `${options.addPrefix}${processedTask.title}` : processedTask.title,
      description: processedTask.description,
      status: options?.overrideStatus || processedTask.status || TaskMasterStatus.TODO,
      priority: processedTask.priority || TaskMasterPriority.MEDIUM,
      tags: processedTask.tags || [],
      dependencies: options?.skipDependencies ? [] : processedTask.dependencies || [],
      estimate: processedTask.estimate,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ai_generated: true,
        prd_section: processedTask.sparcPhase
      }
    };

    if (options?.addSuffix) {
      task.title += options.addSuffix;
    }

    // Store task (implementation would depend on task storage service)
    // For now, we'll store in memory
    await this.memoryService.store(
      `taskmaster:tasks:${task.id}`,
      JSON.stringify(task)
    );

    return task;
  }

  /**
   * Process variables in a template object
   */
  private processVariables(obj: any, variables: Record<string, any>): any {
    if (typeof obj === 'string') {
      // Replace ${variable} patterns
      return obj.replace(/\$\{(\w+)\}/g, (match, varName) => {
        return variables[varName] !== undefined ? String(variables[varName]) : match;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.processVariables(item, variables));
    }

    if (typeof obj === 'object' && obj !== null) {
      const processed: any = {};
      for (const [key, value] of Object.entries(obj)) {
        processed[key] = this.processVariables(value, variables);
      }
      return processed;
    }

    return obj;
  }

  /**
   * Save template to memory
   */
  private async saveTemplate(template: TaskTemplate): Promise<void> {
    const templates = await this.getAllTemplates();
    const index = templates.findIndex(t => t.id === template.id);
    
    if (index >= 0) {
      templates[index] = template;
    } else {
      templates.push(template);
    }

    await this.memoryService.store(
      `${this.TEMPLATE_NAMESPACE}:all`,
      JSON.stringify(templates)
    );
  }

  /**
   * Import templates from JSON
   */
  async importTemplates(json: string): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    try {
      const data = JSON.parse(json);
      const templates = Array.isArray(data) ? data : [data];

      for (const template of templates) {
        try {
          await this.createTemplate(template);
          imported++;
        } catch (error) {
          errors.push(`Failed to import template '${template.name}': ${error}`);
        }
      }
    } catch (error) {
      errors.push(`Invalid JSON: ${error}`);
    }

    return { imported, errors };
  }

  /**
   * Export templates to JSON
   */
  async exportTemplates(ids?: string[]): Promise<string> {
    let templates = await this.getAllTemplates();
    
    if (ids && ids.length > 0) {
      templates = templates.filter(t => ids.includes(t.id));
    }

    return JSON.stringify(templates, null, 2);
  }
}