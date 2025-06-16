/**
 * AI Service for Deno - Simple implementation for TaskMaster
 * Provides actual AI integration for enhanced PRD parsing and task generation
 */

export interface AIServiceConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class AIService {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.anthropic.com/v1';
  
  constructor(config: AIServiceConfig = {}) {
    // Try to get API key from environment or config
    this.apiKey = config.apiKey || Deno.env.get('ANTHROPIC_API_KEY') || '';
    this.model = config.model || 'claude-3-haiku-20240307';
    
    if (!this.apiKey) {
      console.warn('No Anthropic API key found. AI features will use fallback mode.');
    }
  }
  
  /**
   * Check if AI service is available
   */
  isAvailable(): boolean {
    return this.apiKey !== '';
  }
  
  /**
   * Make a request to the Anthropic API
   */
  async complete(request: AIRequest): Promise<AIResponse> {
    if (!this.isAvailable()) {
      // Fallback mode - return empty response
      return {
        content: '',
        model: 'fallback',
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature || 0.3,
          messages: [
            ...(request.systemPrompt ? [{
              role: 'system',
              content: request.systemPrompt
            }] : []),
            {
              role: 'user',
              content: request.prompt
            }
          ]
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI API error:', response.status, errorText);
        throw new Error(`AI API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        content: data.content[0].text,
        model: data.model,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens
        }
      };
    } catch (error) {
      console.error('AI service error:', error);
      throw error;
    }
  }
  
  /**
   * Analyze a PRD document using AI
   */
  async analyzePRD(prdContent: string): Promise<{
    summary: string;
    features: string[];
    requirements: string[];
    complexity: string;
    estimatedEffort: string;
  }> {
    if (!this.isAvailable()) {
      // Fallback - return basic analysis
      return {
        summary: 'PRD document analysis',
        features: [],
        requirements: [],
        complexity: 'medium',
        estimatedEffort: 'unknown'
      };
    }
    
    const systemPrompt = `You are an expert product manager and software architect. 
Analyze PRD documents to extract key information for project planning.
Provide structured analysis in JSON format.`;
    
    const prompt = `Analyze this Product Requirements Document and extract:
1. A brief summary (2-3 sentences)
2. List of main features
3. Key technical and business requirements  
4. Overall complexity (low/medium/high/very-high)
5. Rough effort estimate (days/weeks/months)

PRD Content:
${prdContent}

Respond with valid JSON in this format:
{
  "summary": "Brief 2-3 sentence summary",
  "features": ["feature1", "feature2", ...],
  "requirements": ["requirement1", "requirement2", ...],
  "complexity": "medium",
  "estimatedEffort": "3-4 weeks"
}`;
    
    try {
      const response = await this.complete({
        prompt,
        systemPrompt,
        temperature: 0.2
      });
      
      // Parse JSON from response
      const analysis = JSON.parse(response.content);
      return analysis;
    } catch (error) {
      console.error('PRD analysis error:', error);
      // Return fallback analysis
      return {
        summary: 'Failed to analyze PRD',
        features: [],
        requirements: [],
        complexity: 'unknown',
        estimatedEffort: 'unknown'
      };
    }
  }
  
  /**
   * Generate enhanced task descriptions using AI
   */
  async enhanceTaskDescription(
    taskTitle: string, 
    context: string,
    taskType: string
  ): Promise<string> {
    if (!this.isAvailable()) {
      return `${taskTitle} - ${taskType} task`;
    }
    
    const prompt = `Given this task title and context, write a clear, actionable task description.

Task Title: ${taskTitle}
Task Type: ${taskType}
Context: ${context}

Write a 2-3 sentence description that explains what needs to be done, why it's important, and any key considerations.`;
    
    try {
      const response = await this.complete({
        prompt,
        temperature: 0.4,
        maxTokens: 200
      });
      
      return response.content.trim();
    } catch (error) {
      console.error('Task enhancement error:', error);
      return `${taskTitle} - ${taskType} task`;
    }
  }
  
  /**
   * Extract detailed features from PRD section using AI
   */
  async extractDetailedFeatures(sectionContent: string, sectionTitle: string): Promise<{
    features: Array<{
      title: string;
      description: string;
      acceptanceCriteria: string[];
      priority: string;
    }>;
  }> {
    if (!this.isAvailable()) {
      return { features: [] };
    }
    
    const prompt = `Extract detailed features from this PRD section.

Section: ${sectionTitle}
Content:
${sectionContent}

For each feature found, provide:
1. Clear feature title
2. Detailed description
3. Acceptance criteria (testable conditions)
4. Priority (high/medium/low)

Respond with valid JSON:
{
  "features": [
    {
      "title": "Feature name",
      "description": "What the feature does",
      "acceptanceCriteria": ["criteria1", "criteria2"],
      "priority": "high"
    }
  ]
}`;
    
    try {
      const response = await this.complete({
        prompt,
        temperature: 0.3,
        maxTokens: 2000
      });
      
      const result = JSON.parse(response.content);
      return result;
    } catch (error) {
      console.error('Feature extraction error:', error);
      return { features: [] };
    }
  }
  
  /**
   * Suggest SPARC mode based on task description
   */
  async suggestSparcMode(taskDescription: string, taskType: string): Promise<string> {
    if (!this.isAvailable()) {
      // Use basic mapping
      const mappings: Record<string, string> = {
        'architecture': 'architect',
        'design': 'architect',
        'implementation': 'code',
        'api': 'api-only',
        'frontend': 'frontend-only',
        'backend': 'backend-only',
        'testing': 'tdd',
        'documentation': 'docs-writer',
        'security': 'security-review'
      };
      return mappings[taskType] || 'code';
    }
    
    const prompt = `Based on this task, suggest the most appropriate SPARC development mode.

Task Type: ${taskType}
Task Description: ${taskDescription}

Available SPARC modes:
- architect: System design and architecture
- code: General implementation
- api-only: API development
- frontend-only: Frontend/UI development
- backend-only: Backend development
- tdd: Test-driven development
- security-review: Security analysis
- docs-writer: Documentation
- refinement-optimization-mode: Performance optimization

Respond with just the mode name, nothing else.`;
    
    try {
      const response = await this.complete({
        prompt,
        temperature: 0.1,
        maxTokens: 50
      });
      
      const mode = response.content.trim().toLowerCase();
      // Validate it's a real mode
      const validModes = [
        'architect', 'code', 'api-only', 'frontend-only', 
        'backend-only', 'tdd', 'security-review', 'docs-writer',
        'refinement-optimization-mode'
      ];
      
      return validModes.includes(mode) ? mode : 'code';
    } catch (error) {
      console.error('SPARC mode suggestion error:', error);
      return 'code';
    }
  }
}