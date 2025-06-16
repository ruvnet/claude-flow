/**
 * AI-Enhanced Smart Task Generator Service
 * Generates intelligent task hierarchies with AI assistance
 */

import { SmartTaskGeneratorService, GenerationOptions } from './smart-task-generator-deno.ts';
import { ParsedPRD, Feature, Requirement } from './prd-parser-deno.ts';
import { TaskMasterTask } from '../adapters/task-adapter-deno.ts';
import { AIService } from './ai-service-deno.ts';

export interface AIEnhancedGenerationOptions extends GenerationOptions {
  useAI?: boolean;
  enhanceDescriptions?: boolean;
  aiSuggestSparcModes?: boolean;
  generateDetailedSubtasks?: boolean;
}

export class AIEnhancedTaskGenerator extends SmartTaskGeneratorService {
  private aiService: AIService;
  
  constructor(aiConfig?: { apiKey?: string; model?: string }) {
    super();
    this.aiService = new AIService(aiConfig);
  }
  
  /**
   * Generate tasks with optional AI enhancement
   */
  async generateTasks(prd: ParsedPRD, options: AIEnhancedGenerationOptions = {}): Promise<TaskMasterTask[]> {
    // Generate base tasks using parent class
    const baseTasks = await super.generateTasks(prd, options);
    
    // If AI is not available or not requested, return base tasks
    if (!options.useAI || !this.aiService.isAvailable()) {
      if (options.useAI && !this.aiService.isAvailable()) {
        console.warn('AI enhancement requested but no API key available. Using traditional generation.');
      }
      return baseTasks;
    }
    
    console.log('Enhancing tasks with AI...');
    
    // Enhance tasks with AI
    const enhancedTasks = await this.enhanceTasksWithAI(baseTasks, prd, options);
    
    return enhancedTasks;
  }
  
  /**
   * Enhance tasks using AI capabilities
   */
  private async enhanceTasksWithAI(
    tasks: TaskMasterTask[],
    prd: ParsedPRD,
    options: AIEnhancedGenerationOptions
  ): Promise<TaskMasterTask[]> {
    const enhanced: TaskMasterTask[] = [];
    
    for (const task of tasks) {
      let enhancedTask = { ...task };
      
      // Enhance task description
      if (options.enhanceDescriptions) {
        enhancedTask.description = await this.enhanceTaskDescription(
          task,
          prd.title
        );
      }
      
      // AI-suggest SPARC mode
      if (options.aiSuggestSparcModes && options.sparcMapping) {
        const suggestedMode = await this.aiService.suggestSparcMode(
          enhancedTask.description,
          task.type
        );
        if (suggestedMode) {
          enhancedTask.sparc_mode = suggestedMode;
        }
      }
      
      // Enhance subtasks recursively
      if (task.subtasks && task.subtasks.length > 0) {
        enhancedTask.subtasks = await this.enhanceTasksWithAI(
          task.subtasks,
          prd,
          options
        );
      }
      
      // Add AI-generated metadata
      enhancedTask.metadata = {
        ...enhancedTask.metadata,
        aiEnhanced: true,
        enhancementDate: new Date().toISOString()
      };
      
      enhanced.push(enhancedTask);
    }
    
    return enhanced;
  }
  
  /**
   * Enhance task description using AI
   */
  private async enhanceTaskDescription(
    task: TaskMasterTask,
    projectTitle: string
  ): Promise<string> {
    try {
      const context = `Project: ${projectTitle}. Task type: ${task.type}. Priority: ${task.priority}.`;
      const enhanced = await this.aiService.enhanceTaskDescription(
        task.title,
        context,
        task.type
      );
      
      return enhanced || task.description;
    } catch (error) {
      console.error('Failed to enhance task description:', task.title);
      return task.description;
    }
  }
  
  /**
   * Override createFeatureTask to use AI enhancements
   */
  protected async createFeatureTask(feature: Feature, options: AIEnhancedGenerationOptions): Promise<TaskMasterTask> {
    // Get base task from parent
    const baseTask = super.createFeatureTask(feature, options);
    
    if (!options.useAI || !this.aiService.isAvailable()) {
      return baseTask;
    }
    
    // Enhance with AI
    if (options.enhanceDescriptions) {
      baseTask.description = await this.aiService.enhanceTaskDescription(
        baseTask.title,
        `Feature: ${feature.category || 'General'}. Priority: ${feature.priority}.`,
        baseTask.type
      );
    }
    
    if (options.aiSuggestSparcModes && options.sparcMapping) {
      baseTask.sparc_mode = await this.aiService.suggestSparcMode(
        baseTask.description,
        baseTask.type
      );
    }
    
    return baseTask;
  }
  
  /**
   * Generate AI-powered subtasks for complex features
   */
  async generateAISubtasks(
    feature: Feature,
    parentTask: TaskMasterTask,
    options: AIEnhancedGenerationOptions
  ): Promise<TaskMasterTask[]> {
    if (!this.aiService.isAvailable()) {
      return [];
    }
    
    const prompt = `Given this feature, suggest 3-5 specific implementation subtasks.

Feature: ${feature.title}
Description: ${feature.description}
Type: ${parentTask.type}
Priority: ${feature.priority}

For each subtask provide:
1. Clear task title
2. Task type (backend/frontend/api/testing/documentation)
3. Brief description

Respond with valid JSON:
{
  "subtasks": [
    {
      "title": "Task title",
      "type": "backend",
      "description": "What needs to be done"
    }
  ]
}`;
    
    try {
      const response = await this.aiService.complete({
        prompt,
        temperature: 0.4,
        maxTokens: 1000
      });
      
      const result = JSON.parse(response.content);
      const subtasks: TaskMasterTask[] = [];
      
      for (const st of result.subtasks) {
        const subtask: TaskMasterTask = {
          id: crypto.randomUUID(),
          title: st.title,
          description: st.description,
          type: st.type,
          priority: feature.priority || 'medium',
          status: 'pending',
          assignee: null,
          subtasks: [],
          createdAt: new Date().toISOString(),
          metadata: {
            aiGenerated: true,
            parentFeature: feature.id
          }
        };
        
        if (options.sparcMapping) {
          subtask.sparc_mode = await this.aiService.suggestSparcMode(
            subtask.description,
            subtask.type
          );
        }
        
        subtasks.push(subtask);
      }
      
      return subtasks;
    } catch (error) {
      console.error('Failed to generate AI subtasks:', error);
      return [];
    }
  }
  
  /**
   * Estimate task effort using AI
   */
  async estimateTaskEffort(task: TaskMasterTask, context: string): Promise<number> {
    if (!this.aiService.isAvailable()) {
      // Fallback to basic estimation
      const baseHours = {
        'architecture': 16,
        'implementation': 8,
        'testing': 6,
        'documentation': 4,
        'api': 8,
        'frontend': 10,
        'backend': 10,
        'security': 12
      };
      return baseHours[task.type] || 8;
    }
    
    const prompt = `Estimate the effort in hours for this software development task.

Task: ${task.title}
Type: ${task.type}
Description: ${task.description}
Context: ${context}

Consider complexity, dependencies, and typical development time.
Respond with just a number (hours), nothing else.`;
    
    try {
      const response = await this.aiService.complete({
        prompt,
        temperature: 0.3,
        maxTokens: 10
      });
      
      const hours = parseInt(response.content.trim());
      return isNaN(hours) ? 8 : Math.min(Math.max(hours, 1), 80); // Cap between 1-80 hours
    } catch (error) {
      console.error('Failed to estimate effort:', error);
      return 8;
    }
  }
}