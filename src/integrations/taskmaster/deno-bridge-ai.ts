/**
 * AI-Enhanced Deno Bridge for TaskMaster
 * Integrates AI capabilities for improved PRD parsing and task generation
 */

import { TaskMasterDenoBridge } from './deno-bridge.ts';
import { AIEnhancedPRDParser } from './services/prd-parser-ai-enhanced.ts';
import { AIEnhancedTaskGenerator } from './services/smart-task-generator-ai-enhanced.ts';
import { AIService } from './services/ai-service-deno.ts';

export interface AIEnhancedOptions {
  useAI?: boolean;
  apiKey?: string;
  model?: string;
  enhanceDescriptions?: boolean;
  extractDetailedFeatures?: boolean;
  aiSuggestSparcModes?: boolean;
}

export class TaskMasterAIBridge extends TaskMasterDenoBridge {
  private aiPRDParser: AIEnhancedPRDParser;
  private aiTaskGenerator: AIEnhancedTaskGenerator;
  private aiService: AIService;
  
  constructor(aiConfig?: { apiKey?: string; model?: string }) {
    super();
    
    // Initialize AI services
    this.aiService = new AIService(aiConfig);
    this.aiPRDParser = new AIEnhancedPRDParser(aiConfig);
    this.aiTaskGenerator = new AIEnhancedTaskGenerator(aiConfig);
    
    // Check AI availability
    if (this.aiService.isAvailable()) {
      console.log('✅ AI services initialized successfully');
    } else {
      console.log('⚠️  AI services running in fallback mode (no API key)');
    }
  }
  
  /**
   * Parse PRD with AI enhancement
   */
  async parsePRD(prdPath: string, options?: AIEnhancedOptions): Promise<any> {
    try {
      const content = await Deno.readTextFile(prdPath);
      
      // Use AI-enhanced parser if requested
      if (options?.useAI) {
        console.log('🤖 Using AI-enhanced PRD parsing...');
        const parsedPRD = await this.aiPRDParser.parsePRD(content, {
          useAI: true,
          extractDetailedFeatures: options.extractDetailedFeatures,
          generateAcceptanceCriteria: true
        });
        
        // Convert to PRDDocument format and store
        const prd = {
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
            ...parsedPRD.metadata,
            parsedBy: options?.model || 'ai-enhanced',
            sourcePath: prdPath
          }
        };
        
        // Store enhanced PRD with features
        await this.memory.store(
          `prd_${prd.id}`,
          JSON.stringify({ 
            ...prd, 
            features: parsedPRD.features, 
            requirements: parsedPRD.requirements,
            aiAnalysis: parsedPRD.metadata
          }),
          'taskmaster_prds'
        );
        
        // Store PRD metadata
        await this.memory.store(
          `prd_list_${prd.id}`,
          JSON.stringify({
            id: prd.id,
            title: prd.title,
            path: prdPath,
            created: prd.metadata.created,
            featureCount: parsedPRD.features.length,
            requirementCount: parsedPRD.requirements.length,
            aiEnhanced: true,
            complexity: parsedPRD.metadata.aiComplexity,
            estimatedEffort: parsedPRD.metadata.aiEstimatedEffort
          }),
          'taskmaster_prds'
        );
        
        return prd;
      } else {
        // Fall back to base implementation
        return super.parsePRD(prdPath, options);
      }
    } catch (error) {
      throw new Error(`Failed to parse PRD: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate tasks with AI enhancement
   */
  async generateTasks(prdPath: string, options?: AIEnhancedOptions): Promise<any[]> {
    try {
      const content = await Deno.readTextFile(prdPath);
      
      // Parse PRD first (with or without AI)
      const parsedPRD = await this.aiPRDParser.parsePRD(content, {
        useAI: options?.useAI,
        extractDetailedFeatures: options?.extractDetailedFeatures
      });
      
      // Generate tasks with AI enhancement if requested
      if (options?.useAI) {
        console.log('🤖 Using AI-enhanced task generation...');
        const generatedTasks = await this.aiTaskGenerator.generateTasks(parsedPRD, {
          depth: options?.depth || 3,
          sparcMapping: options?.sparcMapping !== false,
          assignAgents: options?.assignAgents,
          includeEstimates: true,
          generateDependencies: true,
          useAI: true,
          enhanceDescriptions: options.enhanceDescriptions !== false,
          aiSuggestSparcModes: options.aiSuggestSparcModes !== false,
          generateDetailedSubtasks: options.extractDetailedFeatures
        });
        
        // Store tasks
        await this.memory.store(
          `tasks_${parsedPRD.id}`,
          JSON.stringify(generatedTasks),
          'taskmaster_tasks'
        );
        
        // Store enhanced task summary
        await this.memory.store(
          `task_summary_${parsedPRD.id}`,
          JSON.stringify({
            prdId: parsedPRD.id,
            prdTitle: parsedPRD.title,
            taskCount: generatedTasks.length,
            created: new Date().toISOString(),
            priorities: {
              high: generatedTasks.filter(t => t.priority === 'high').length,
              medium: generatedTasks.filter(t => t.priority === 'medium').length,
              low: generatedTasks.filter(t => t.priority === 'low').length
            },
            taskTypes: this.getTaskTypeDistribution(generatedTasks),
            withSubtasks: generatedTasks.filter(t => t.subtasks && t.subtasks.length > 0).length,
            aiEnhanced: true,
            totalSubtasks: generatedTasks.reduce((sum, t) => sum + (t.subtasks?.length || 0), 0)
          }),
          'taskmaster_tasks'
        );
        
        return generatedTasks;
      } else {
        // Fall back to base implementation
        return super.generateTasks(prdPath, options);
      }
    } catch (error) {
      throw new Error(`Failed to generate tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get AI service status
   */
  getAIStatus(): { available: boolean; model?: string; features: string[] } {
    const available = this.aiService.isAvailable();
    return {
      available,
      model: available ? 'claude-3-haiku' : undefined,
      features: available ? [
        'PRD analysis and summarization',
        'Feature extraction with acceptance criteria',
        'Task description enhancement',
        'SPARC mode suggestions',
        'Effort estimation',
        'Requirement classification'
      ] : []
    };
  }
  
  /**
   * Analyze PRD without generating tasks
   */
  async analyzePRD(prdPath: string): Promise<any> {
    if (!this.aiService.isAvailable()) {
      throw new Error('AI service not available. Please set ANTHROPIC_API_KEY environment variable.');
    }
    
    const content = await Deno.readTextFile(prdPath);
    const analysis = await this.aiService.analyzePRD(content);
    
    return {
      path: prdPath,
      analysis,
      timestamp: new Date().toISOString()
    };
  }
}