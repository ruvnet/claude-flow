/**
 * Provider Manager - Handles multi-provider configuration and selection
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface ProviderConfig {
  name: 'anthropic' | 'openrouter' | 'onnx' | 'gemini';
  model?: string;
  apiKey?: string;
  enabled: boolean;
  priority?: 'cost' | 'quality' | 'speed' | 'privacy';
}

export interface ExecutionConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  optimization?: {
    strategy: 'balanced' | 'cost' | 'quality' | 'speed' | 'privacy';
    maxCostPerTask?: number;
  };
}

export class ProviderManager {
  private config: ExecutionConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.config = this.loadConfig();
  }

  /**
   * Get default provider
   */
  getDefaultProvider(): string {
    return this.config.defaultProvider || 'anthropic';
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(provider: string): ProviderConfig | null {
    return this.config.providers?.[provider] || null;
  }

  /**
   * Set default provider
   */
  async setDefaultProvider(provider: string): Promise<void> {
    this.config.defaultProvider = provider;
    await this.saveConfig();
  }

  /**
   * Configure a provider
   */
  async configureProvider(
    provider: string,
    config: Partial<ProviderConfig>
  ): Promise<void> {
    if (!this.config.providers) {
      this.config.providers = {};
    }

    this.config.providers[provider] = {
      ...this.config.providers[provider],
      name: provider as any,
      ...config,
    };

    await this.saveConfig();
  }

  /**
   * List available providers
   */
  listProviders(): ProviderConfig[] {
    if (!this.config.providers) {
      return this.getDefaultProviders();
    }

    return Object.values(this.config.providers);
  }

  /**
   * Get optimization strategy
   */
  getOptimizationStrategy(): string {
    return this.config.optimization?.strategy || 'balanced';
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): ExecutionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const settings = JSON.parse(data);
        return settings['claude-flow']?.execution || this.getDefaultConfig();
      }
    } catch (error) {
      console.warn('Failed to load provider config, using defaults');
    }

    return this.getDefaultConfig();
  }

  /**
   * Save configuration to file
   */
  private async saveConfig(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.configPath));

      let settings: any = {};
      if (await fs.pathExists(this.configPath)) {
        const data = await fs.readFile(this.configPath, 'utf-8');
        settings = JSON.parse(data);
      }

      if (!settings['claude-flow']) {
        settings['claude-flow'] = {};
      }

      settings['claude-flow'].execution = this.config;

      await fs.writeFile(
        this.configPath,
        JSON.stringify(settings, null, 2),
        'utf-8'
      );
    } catch (error: any) {
      console.error('Failed to save provider config:', error.message);
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): ExecutionConfig {
    return {
      defaultProvider: 'anthropic',
      providers: {
        anthropic: {
          name: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          enabled: true,
          priority: 'quality',
        },
        openrouter: {
          name: 'openrouter',
          model: 'meta-llama/llama-3.1-8b-instruct',
          enabled: true,
          priority: 'cost',
        },
        onnx: {
          name: 'onnx',
          model: 'Xenova/gpt2',
          enabled: true,
          priority: 'privacy',
        },
        gemini: {
          name: 'gemini',
          enabled: true,
          priority: 'cost',
        },
      },
      optimization: {
        strategy: 'balanced',
        maxCostPerTask: 0.5,
      },
    };
  }

  /**
   * Get default providers list
   */
  private getDefaultProviders(): ProviderConfig[] {
    return Object.values(this.getDefaultConfig().providers);
  }
}

export default ProviderManager;
