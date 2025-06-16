import { AIProvider, AIModel, ProviderConfig } from '../types/ai-types.ts';

export interface ModelConfigOptions {
  preferredProviders?: string[];
  budgetConstraints?: {
    maxCostPerRequest?: number;
    dailyBudget?: number;
    monthlyBudget?: number;
  };
  performanceRequirements?: {
    maxLatency?: number;
    minReliability?: number;
  };
  capabilities?: {
    required?: string[];
    preferred?: string[];
  };
}

export class ModelConfigManager {
  private providers: Map<string, AIProvider> = new Map();
  private models: Map<string, AIModel> = new Map();
  private config: ModelConfigOptions;

  constructor(config: ModelConfigOptions = {}) {
    this.config = config;
    this.initializeDefaultProviders();
  }

  private initializeDefaultProviders(): void {
    // Anthropic Provider Configuration
    const anthropicProvider: AIProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      models: [
        {
          id: 'claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          providerId: 'anthropic',
          maxTokens: 4000,
          contextWindow: 200000,
          costPer1kTokens: { input: 0.015, output: 0.075 },
          capabilities: ['text-generation', 'analysis', 'reasoning', 'structured-output', 'long-context'],
          isActive: true
        },
        {
          id: 'claude-3-sonnet-20240229',
          name: 'Claude 3 Sonnet',
          providerId: 'anthropic',
          maxTokens: 4000,
          contextWindow: 200000,
          costPer1kTokens: { input: 0.003, output: 0.015 },
          capabilities: ['text-generation', 'analysis', 'reasoning', 'structured-output', 'long-context'],
          isActive: true
        },
        {
          id: 'claude-3-haiku-20240307',
          name: 'Claude 3 Haiku',
          providerId: 'anthropic',
          maxTokens: 4000,
          contextWindow: 200000,
          costPer1kTokens: { input: 0.00025, output: 0.00125 },
          capabilities: ['text-generation', 'structured-output'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.95,
        'analysis': 0.9,
        'reasoning': 0.95,
        'structured-output': 0.9,
        'long-context': 0.95
      },
      rateLimits: {
        requestsPerMinute: 50,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        tokensPerMinute: 40000,
        tokensPerHour: 400000,
        tokensPerDay: 1000000
      },
      costPerToken: 0.003
    };

    // OpenAI Provider Configuration
    const openaiProvider: AIProvider = {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      models: [
        {
          id: 'gpt-4-turbo',
          name: 'GPT-4 Turbo',
          providerId: 'openai',
          maxTokens: 4000,
          contextWindow: 128000,
          costPer1kTokens: { input: 0.01, output: 0.03 },
          capabilities: ['text-generation', 'code-generation', 'analysis', 'reasoning', 'function-calling'],
          isActive: true
        },
        {
          id: 'gpt-4',
          name: 'GPT-4',
          providerId: 'openai',
          maxTokens: 4000,
          contextWindow: 8000,
          costPer1kTokens: { input: 0.03, output: 0.06 },
          capabilities: ['text-generation', 'code-generation', 'analysis', 'reasoning'],
          isActive: true
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          providerId: 'openai',
          maxTokens: 4000,
          contextWindow: 16000,
          costPer1kTokens: { input: 0.0005, output: 0.0015 },
          capabilities: ['text-generation', 'code-generation'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.9,
        'code-generation': 0.95,
        'analysis': 0.85,
        'reasoning': 0.9,
        'function-calling': 0.9
      },
      rateLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 3000,
        requestsPerDay: 10000,
        tokensPerMinute: 90000,
        tokensPerHour: 1000000,
        tokensPerDay: 2000000
      },
      costPerToken: 0.01
    };

    // Google Provider Configuration
    const googleProvider: AIProvider = {
      id: 'google',
      name: 'Google AI',
      type: 'google',
      apiKey: process.env.GOOGLE_AI_API_KEY || '',
      models: [
        {
          id: 'gemini-pro',
          name: 'Gemini Pro',
          providerId: 'google',
          maxTokens: 8192,
          contextWindow: 32768,
          costPer1kTokens: { input: 0.00025, output: 0.0005 },
          capabilities: ['text-generation', 'analysis', 'multi-language'],
          isActive: true
        },
        {
          id: 'gemini-pro-vision',
          name: 'Gemini Pro Vision',
          providerId: 'google',
          maxTokens: 8192,
          contextWindow: 32768,
          costPer1kTokens: { input: 0.00025, output: 0.0005 },
          capabilities: ['text-generation', 'analysis', 'multi-language'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.85,
        'analysis': 0.8,
        'multi-language': 0.9
      },
      rateLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 5000,
        tokensPerMinute: 32000,
        tokensPerHour: 500000,
        tokensPerDay: 1000000
      },
      costPerToken: 0.0005
    };

    // Perplexity Provider Configuration
    const perplexityProvider: AIProvider = {
      id: 'perplexity',
      name: 'Perplexity AI',
      type: 'perplexity',
      apiKey: process.env.PERPLEXITY_API_KEY || '',
      models: [
        {
          id: 'llama-3.1-sonar-small-128k-online',
          name: 'Llama 3.1 Sonar Small 128k Online',
          providerId: 'perplexity',
          maxTokens: 4000,
          contextWindow: 127072,
          costPer1kTokens: { input: 0.0002, output: 0.0002 },
          capabilities: ['text-generation', 'analysis'],
          isActive: true
        },
        {
          id: 'llama-3.1-sonar-large-128k-online',
          name: 'Llama 3.1 Sonar Large 128k Online',
          providerId: 'perplexity',
          maxTokens: 4000,
          contextWindow: 127072,
          costPer1kTokens: { input: 0.001, output: 0.001 },
          capabilities: ['text-generation', 'analysis', 'reasoning'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.8,
        'analysis': 0.85
      },
      rateLimits: {
        requestsPerMinute: 20,
        requestsPerHour: 500,
        requestsPerDay: 2000,
        tokensPerMinute: 10000,
        tokensPerHour: 200000,
        tokensPerDay: 500000
      },
      costPerToken: 0.0002
    };

    // xAI Provider Configuration
    const xaiProvider: AIProvider = {
      id: 'xai',
      name: 'xAI',
      type: 'xai',
      apiKey: process.env.XAI_API_KEY || '',
      models: [
        {
          id: 'grok-beta',
          name: 'Grok Beta',
          providerId: 'xai',
          maxTokens: 4000,
          contextWindow: 8000,
          costPer1kTokens: { input: 0.002, output: 0.002 },
          capabilities: ['text-generation', 'reasoning'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.8,
        'reasoning': 0.8
      },
      rateLimits: {
        requestsPerMinute: 30,
        requestsPerHour: 1000,
        requestsPerDay: 3000,
        tokensPerMinute: 15000,
        tokensPerHour: 300000,
        tokensPerDay: 600000
      },
      costPerToken: 0.002
    };

    // Mistral Provider Configuration
    const mistralProvider: AIProvider = {
      id: 'mistral',
      name: 'Mistral AI',
      type: 'mistral',
      apiKey: process.env.MISTRAL_API_KEY || '',
      models: [
        {
          id: 'mistral-large-latest',
          name: 'Mistral Large',
          providerId: 'mistral',
          maxTokens: 4000,
          contextWindow: 32000,
          costPer1kTokens: { input: 0.008, output: 0.024 },
          capabilities: ['text-generation', 'reasoning', 'multi-language'],
          isActive: true
        },
        {
          id: 'mistral-medium-latest',
          name: 'Mistral Medium',
          providerId: 'mistral',
          maxTokens: 4000,
          contextWindow: 32000,
          costPer1kTokens: { input: 0.0027, output: 0.0081 },
          capabilities: ['text-generation', 'multi-language'],
          isActive: true
        }
      ],
      capabilities: {
        'text-generation': 0.85,
        'reasoning': 0.8,
        'multi-language': 0.85
      },
      rateLimits: {
        requestsPerMinute: 40,
        requestsPerHour: 1000,
        requestsPerDay: 5000,
        tokensPerMinute: 20000,
        tokensPerHour: 400000,
        tokensPerDay: 800000
      },
      costPerToken: 0.008
    };

    // Register providers
    this.registerProvider(anthropicProvider);
    this.registerProvider(openaiProvider);
    this.registerProvider(googleProvider);
    this.registerProvider(perplexityProvider);
    this.registerProvider(xaiProvider);
    this.registerProvider(mistralProvider);
  }

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
    
    // Register all models from this provider
    for (const model of provider.models) {
      this.models.set(model.id, model);
    }
  }

  getProvider(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  getModel(modelId: string): AIModel | undefined {
    return this.models.get(modelId);
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  getActiveProviders(): AIProvider[] {
    return this.getAllProviders().filter(provider => 
      provider.apiKey && provider.apiKey.length > 0
    );
  }

  getAllModels(): AIModel[] {
    return Array.from(this.models.values());
  }

  getModelsForProvider(providerId: string): AIModel[] {
    return this.getAllModels().filter(model => model.providerId === providerId);
  }

  getModelsWithCapability(capability: string): AIModel[] {
    return this.getAllModels().filter(model => 
      model.capabilities.includes(capability as any)
    );
  }

  selectOptimalModel(
    taskType: string,
    requirements?: {
      maxCost?: number;
      maxLatency?: number;
      requiredCapabilities?: string[];
      contextSize?: number;
    }
  ): AIModel | null {
    let candidates = this.getAllModels().filter(model => model.isActive);

    // Filter by required capabilities
    if (requirements?.requiredCapabilities) {
      candidates = candidates.filter(model =>
        requirements.requiredCapabilities!.every(cap =>
          model.capabilities.includes(cap as any)
        )
      );
    }

    // Filter by context size requirements
    if (requirements?.contextSize) {
      candidates = candidates.filter(model =>
        model.contextWindow >= requirements.contextSize!
      );
    }

    // Filter by cost constraints
    if (requirements?.maxCost) {
      candidates = candidates.filter(model => {
        const avgCost = (model.costPer1kTokens.input + model.costPer1kTokens.output) / 2;
        return avgCost <= requirements.maxCost!;
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Score and rank candidates
    const scoredCandidates = candidates.map(model => ({
      model,
      score: this.calculateModelScore(model, taskType, requirements)
    }));

    scoredCandidates.sort((a, b) => b.score - a.score);
    return scoredCandidates[0].model;
  }

  private calculateModelScore(
    model: AIModel,
    taskType: string,
    requirements?: any
  ): number {
    let score = 0;

    // Base capability score
    const provider = this.getProvider(model.providerId);
    if (provider) {
      const relevantCapabilities = this.getRelevantCapabilities(taskType);
      for (const capability of relevantCapabilities) {
        if (model.capabilities.includes(capability as any)) {
          score += (provider.capabilities[capability] || 0) * 10;
        }
      }
    }

    // Cost efficiency score (lower cost = higher score)
    const avgCost = (model.costPer1kTokens.input + model.costPer1kTokens.output) / 2;
    const costScore = Math.max(0, 10 - (avgCost * 1000)); // Normalize to 0-10 scale
    score += costScore * 2;

    // Context window score
    const contextScore = Math.min(10, model.contextWindow / 10000); // Scale to 0-10
    score += contextScore;

    // Apply preferences
    if (this.config.preferredProviders?.includes(model.providerId)) {
      score += 5; // Bonus for preferred providers
    }

    return score;
  }

  private getRelevantCapabilities(taskType: string): string[] {
    const capabilityMap: Record<string, string[]> = {
      'prd-parsing': ['text-generation', 'analysis', 'structured-output'],
      'task-generation': ['text-generation', 'reasoning', 'structured-output'],
      'complexity-analysis': ['analysis', 'reasoning'],
      'code-generation': ['code-generation', 'text-generation'],
      'documentation': ['text-generation', 'structured-output'],
      'testing': ['code-generation', 'analysis'],
      'architecture': ['analysis', 'reasoning', 'structured-output']
    };

    return capabilityMap[taskType] || ['text-generation'];
  }

  updateProviderConfig(providerId: string, updates: Partial<ProviderConfig>): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // Update provider properties
    if (updates.apiKey !== undefined) provider.apiKey = updates.apiKey;
    if (updates.enabled !== undefined) {
      // Enable/disable all models for this provider
      for (const model of provider.models) {
        model.isActive = updates.enabled;
      }
    }
    if (updates.rateLimits) {
      provider.rateLimits = { ...provider.rateLimits, ...updates.rateLimits };
    }
    if (updates.costPerToken !== undefined) {
      provider.costPerToken = updates.costPerToken;
    }

    this.providers.set(providerId, provider);
  }

  getProviderStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [id, provider] of this.providers) {
      const activeModels = provider.models.filter(m => m.isActive).length;
      const totalModels = provider.models.length;
      const hasApiKey = provider.apiKey && provider.apiKey.length > 0;

      stats[id] = {
        name: provider.name,
        isConfigured: hasApiKey,
        activeModels,
        totalModels,
        capabilities: Object.keys(provider.capabilities),
        avgCost: provider.costPerToken,
        rateLimitPerMinute: provider.rateLimits.requestsPerMinute
      };
    }

    return stats;
  }

  validateConfiguration(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    let configuredProviders = 0;

    for (const [id, provider] of this.providers) {
      if (!provider.apiKey || provider.apiKey.length === 0) {
        warnings.push(`Provider ${id} has no API key configured`);
      } else {
        configuredProviders++;
      }

      if (provider.models.length === 0) {
        errors.push(`Provider ${id} has no models configured`);
      }

      const activeModels = provider.models.filter(m => m.isActive);
      if (activeModels.length === 0) {
        warnings.push(`Provider ${id} has no active models`);
      }
    }

    if (configuredProviders === 0) {
      errors.push('No providers are configured with API keys');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  exportConfiguration(): any {
    const config: any = {
      providers: {},
      models: {},
      settings: this.config
    };

    for (const [id, provider] of this.providers) {
      config.providers[id] = {
        ...provider,
        apiKey: provider.apiKey ? '***masked***' : '' // Mask API keys in export
      };
    }

    for (const [id, model] of this.models) {
      config.models[id] = model;
    }

    return config;
  }

  importConfiguration(config: any): void {
    if (config.providers) {
      for (const [id, providerConfig] of Object.entries(config.providers)) {
        const provider = providerConfig as AIProvider;
        if (provider.apiKey !== '***masked***') {
          this.registerProvider(provider);
        }
      }
    }

    if (config.settings) {
      this.config = { ...this.config, ...config.settings };
    }
  }

  getCostEstimate(
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const inputCost = (inputTokens / 1000) * model.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * model.costPer1kTokens.output;

    return inputCost + outputCost;
  }

  getRecommendedModel(
    taskType: 'prd-parsing' | 'task-generation' | 'complexity-analysis' | 'general',
    context?: {
      documentSize?: 'small' | 'medium' | 'large';
      complexity?: 'low' | 'medium' | 'high';
      budget?: 'low' | 'medium' | 'high';
      speed?: 'fast' | 'balanced' | 'quality';
    }
  ): AIModel | null {
    const contextDefaults = {
      documentSize: 'medium',
      complexity: 'medium',
      budget: 'medium',
      speed: 'balanced',
      ...context
    };

    // Task-specific model recommendations
    const recommendations: Record<string, Record<string, string[]>> = {
      'prd-parsing': {
        'small-low': ['claude-3-haiku-20240307', 'gpt-3.5-turbo', 'gemini-pro'],
        'medium-medium': ['claude-3-sonnet-20240229', 'gpt-4-turbo', 'mistral-medium-latest'],
        'large-high': ['claude-3-opus-20240229', 'gpt-4', 'mistral-large-latest']
      },
      'task-generation': {
        'small-low': ['gpt-3.5-turbo', 'claude-3-haiku-20240307', 'gemini-pro'],
        'medium-medium': ['gpt-4-turbo', 'claude-3-sonnet-20240229', 'mistral-medium-latest'],
        'large-high': ['claude-3-opus-20240229', 'gpt-4', 'mistral-large-latest']
      },
      'complexity-analysis': {
        'small-low': ['claude-3-sonnet-20240229', 'gpt-4-turbo'],
        'medium-medium': ['claude-3-opus-20240229', 'gpt-4'],
        'large-high': ['claude-3-opus-20240229']
      },
      'general': {
        'small-low': ['gpt-3.5-turbo', 'claude-3-haiku-20240307'],
        'medium-medium': ['claude-3-sonnet-20240229', 'gpt-4-turbo'],
        'large-high': ['claude-3-opus-20240229', 'gpt-4']
      }
    };

    const key = `${contextDefaults.documentSize}-${contextDefaults.complexity}`;
    const recommendedModelIds = recommendations[taskType]?.[key] || recommendations['general'][key];

    // Find the first available model from recommendations
    for (const modelId of recommendedModelIds) {
      const model = this.getModel(modelId);
      if (model && model.isActive) {
        const provider = this.getProvider(model.providerId);
        if (provider && provider.apiKey) {
          return model;
        }
      }
    }

    // Fallback to any available model
    return this.selectOptimalModel(taskType);
  }
}