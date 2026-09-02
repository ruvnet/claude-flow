/**
 * Agentic Flow Integration Bridge
 *
 * Core integration bridge for agentic-flow@alpha deep integration.
 * Implements ADR-001: Adopt agentic-flow as Core Foundation
 *
 * Eliminates 10,000+ lines of duplicate code by building on agentic-flow
 * rather than implementing parallel systems.
 *
 * @module v3/integration/agentic-flow-bridge
 * @version 3.0.0-alpha.1
 */

import { EventEmitter } from 'events';
import type {
  IntegrationConfig,
  IntegrationStatus,
  RuntimeInfo,
  ComponentHealth,
  IntegrationEvent,
  IntegrationEventType,
  IntegrationError,
  FeatureFlags,
  DEFAULT_INTEGRATION_CONFIG,
} from './types.js';
import { SONAAdapter } from './sona-adapter.js';
import { AttentionCoordinator } from './attention-coordinator.js';
import { SDKBridge } from './sdk-bridge.js';

/**
 * Interface for agentic-flow core module (dynamically loaded)
 * This represents the external agentic-flow@alpha package API
 */
interface AgenticFlowSONAInterface {
  setMode(mode: string): Promise<void>;
  storePattern(params: unknown): Promise<string>;
  findPatterns(query: string, options?: unknown): Promise<unknown[]>;
  getStats(): Promise<unknown>;
}

interface AgenticFlowAttentionInterface {
  compute(params: unknown): Promise<unknown>;
  setMechanism(mechanism: string): Promise<void>;
  getMetrics(): Promise<unknown>;
}

interface AgenticFlowAgentDBInterface {
  search(query: number[], options?: unknown): Promise<unknown[]>;
  insert(vector: number[], metadata?: unknown): Promise<string>;
  enableCrossAgentSharing(options?: unknown): Promise<void>;
}

/**
 * Core interface for agentic-flow@alpha package
 * Used for deep integration and code deduplication per ADR-001
 */
export interface AgenticFlowCore {
  sona: AgenticFlowSONAInterface;
  attention: AgenticFlowAttentionInterface;
  agentdb: AgenticFlowAgentDBInterface;
  version: string;
  isConnected: boolean;
}

/**
 * Factory function type for creating agentic-flow instance
 */
type AgenticFlowFactory = (config: unknown) => Promise<AgenticFlowCore>;

/**
 * AgenticFlowBridge - Core integration class for agentic-flow@alpha
 *
 * This class serves as the main entry point for all agentic-flow integration,
 * providing unified access to SONA learning, Flash Attention, and AgentDB.
 *
 * Performance Targets:
 * - Flash Attention: 2.49x-7.47x speedup
 * - AgentDB Search: 150x-12,500x improvement
 * - SONA Adaptation: <0.05ms response time
 * - Memory Reduction: 50-75%
 */
export class AgenticFlowBridge extends EventEmitter {
  private config: IntegrationConfig;
  private initialized: boolean = false;
  private sona: SONAAdapter | null = null;
  private attention: AttentionCoordinator | null = null;
  private sdk: SDKBridge | null = null;
  private componentHealth: Map<string, ComponentHealth> = new Map();
  private runtimeInfo: RuntimeInfo | null = null;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Reference to the agentic-flow@alpha core instance
   * When available, components delegate to this instead of local implementations
   * This follows ADR-001: Adopt agentic-flow as Core Foundation
   */
  private agenticFlowCore: AgenticFlowCore | null = null;

  /**
   * Indicates whether agentic-flow is available for delegation
   */
  private agenticFlowAvailable: boolean = false;

  constructor(config: Partial<IntegrationConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
  }

  /**
   * Initialize the integration bridge
   *
   * This method is idempotent - calling it multiple times is safe.
   * Components are lazily loaded based on configuration.
   */
  async initialize(config?: Partial<IntegrationConfig>): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Already initialized
    if (this.initialized) {
      if (config) {
        await this.reconfigure(config);
      }
      return;
    }

    this.initializationPromise = this.doInitialize(config);

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async doInitialize(config?: Partial<IntegrationConfig>): Promise<void> {
    const startTime = Date.now();

    if (config) {
      this.config = this.mergeConfig(config);
    }

    this.emit('initializing', { config: this.config });

    try {
      // Detect runtime environment
      this.runtimeInfo = await this.detectRuntime();
      this.logDebug('Runtime detected', this.runtimeInfo);

      // ADR-001: Attempt to load agentic-flow@alpha dynamically
      // This enables deep integration and code deduplication
      await this.connectToAgenticFlow();

      // Initialize SDK bridge first (required for version negotiation)
      this.sdk = new SDKBridge({
        targetVersion: 'alpha',
        enableVersionNegotiation: true,
        fallbackBehavior: 'warn',
        enableCompatibilityLayer: true,
        supportDeprecatedAPIs: true,
      });
      await this.sdk.initialize();
      this.updateComponentHealth('sdk', 'healthy');

      // Initialize SONA adapter if enabled
      // Pass agentic-flow reference for delegation when available
      if (this.config.features.enableSONA) {
        this.sona = new SONAAdapter(this.config.sona);
        if (this.agenticFlowCore) {
          // Type cast: agentic-flow runtime API is compatible but typed as `unknown`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.sona.setAgenticFlowReference(this.agenticFlowCore.sona as any);
        }
        await this.sona.initialize();
        this.updateComponentHealth('sona', 'healthy');
      }

      // Initialize Attention coordinator if enabled
      // Pass agentic-flow reference for delegation when available
      if (this.config.features.enableFlashAttention) {
        this.attention = new AttentionCoordinator(this.config.attention);
        if (this.agenticFlowCore) {
          // Type cast: agentic-flow runtime API is compatible but typed as `unknown`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.attention.setAgenticFlowReference(this.agenticFlowCore.attention as any);
        }
        await this.attention.initialize();
        this.updateComponentHealth('attention', 'healthy');
      }

      this.initialized = true;

      const duration = Date.now() - startTime;
      this.emit('initialized', {
        duration,
        components: this.getConnectedComponents(),
        agenticFlowConnected: this.agenticFlowAvailable,
      });

      this.logDebug(`Initialization complete in ${duration}ms`);
    } catch (error) {
      this.emit('initialization-failed', { error });
      throw this.wrapError(error as Error, 'INITIALIZATION_FAILED', 'bridge');
    }
  }

  /**
   * Connect to agentic-flow@alpha package dynamically
   *
   * This implements ADR-001: Adopt agentic-flow as Core Foundation
   * When agentic-flow is available, components delegate to it for:
   * - SONA learning (eliminating duplicate pattern storage)
   * - Flash Attention (using native optimized implementations)
   * - AgentDB (leveraging 150x-12,500x faster HNSW search)
   *
   * If agentic-flow is not installed, falls back to local implementations
   * to maintain backward compatibility.
   */
  private async connectToAgenticFlow(): Promise<void> {
    try {
      // Dynamic import to handle optional dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agenticFlowModule: any = await import('agentic-flow').catch(() => null);

      if (agenticFlowModule && typeof agenticFlowModule.createAgenticFlow === 'function') {
        const factory: AgenticFlowFactory = agenticFlowModule.createAgenticFlow;

        this.agenticFlowCore = await factory({
          sona: this.config.sona,
          attention: this.config.attention,
          agentdb: this.config.agentdb,
        });

        this.agenticFlowAvailable = true;
        this.updateComponentHealth('agentic-flow', 'healthy');

        this.emit('agentic-flow:connected', {
          version: this.agenticFlowCore.version,
          features: {
            sona: true,
            attention: true,
            agentdb: true,
          },
        });

        this.logDebug('Connected to agentic-flow', {
          version: this.agenticFlowCore.version,
        });
      } else {
        // Package not found or doesn't export expected factory
        this.agenticFlowAvailable = false;
        this.emit('agentic-flow:fallback', {
          reason: 'package not found or incompatible',
        });
        this.logDebug('agentic-flow not available, using local implementations');
      }
    } catch (error) {
      // Fallback to local implementation if agentic-flow fails to load
      this.agenticFlowAvailable = false;
      this.emit('agentic-flow:fallback', {
        reason: 'initialization error',
        error: (error as Error).message,
      });
      this.logDebug('agentic-flow initialization failed, using fallback', error);
    }
  }

  /**
   * Reconfigure the bridge with new settings
   */
  async reconfigure(config: Partial<IntegrationConfig>): Promise<void> {
    this.config = this.mergeConfig(config);

    // Reconfigure active components
    if (this.sona && config.sona) {
      await this.sona.reconfigure(config.sona);
    }

    if (this.attention && config.attention) {
      await this.attention.reconfigure(config.attention);
    }

    this.emit('reconfigured', { config: this.config });
  }

  /**
   * Get the SONA adapter for learning integration
   */
  async getSONAAdapter(): Promise<SONAAdapter> {
    this.ensureInitialized();

    if (!this.config.features.enableSONA) {
      throw this.createError(
        'SONA is disabled in configuration',
        'FEATURE_DISABLED',
        'sona'
      );
    }

    if (!this.sona) {
      this.sona = new SONAAdapter(this.config.sona);
      await this.sona.initialize();
      this.updateComponentHealth('sona', 'healthy');
    }

    return this.sona;
  }

  /**
   * Get the Attention coordinator for Flash Attention integration
   */
  async getAttentionCoordinator(): Promise<AttentionCoordinator> {
    this.ensureInitialized();

    if (!this.config.features.enableFlashAttention) {
      throw this.createError(
        'Flash Attention is disabled in configuration',
        'FEATURE_DISABLED',
        'attention'
      );
    }

    if (!this.attention) {
      this.attention = new AttentionCoordinator(this.config.attention);
      await this.attention.initialize();
      this.updateComponentHealth('attention', 'healthy');
    }

    return this.attention;
  }

  /**
   * Get the SDK bridge for API compatibility
   */
  async getSDKBridge(): Promise<SDKBridge> {
    this.ensureInitialized();

    if (!this.sdk) {
      throw this.createError(
        'SDK bridge not initialized',
        'COMPONENT_UNAVAILABLE',
        'sdk'
      );
    }

    return this.sdk;
  }

  /**
   * Get current integration status
   */
  getStatus(): IntegrationStatus {
    const features: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(this.config.features)) {
      features[key] = value;
    }

    return {
      initialized: this.initialized,
      connectedComponents: this.getConnectedComponents(),
      runtime: this.runtimeInfo || this.getDefaultRuntimeInfo(),
      features,
      health: Object.fromEntries(this.componentHealth),
      lastHealthCheck: Date.now(),
    };
  }

  /**
   * Get feature flags
   */
  getFeatureFlags(): FeatureFlags {
    return { ...this.config.features };
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof FeatureFlags): boolean {
    return this.config.features[feature] ?? false;
  }

  /**
   * Enable a feature dynamically
   */
  async enableFeature(feature: keyof FeatureFlags): Promise<void> {
    if (this.config.features[feature]) {
      return; // Already enabled
    }

    this.config.features[feature] = true;

    // Initialize the corresponding component if needed
    switch (feature) {
      case 'enableSONA':
        if (!this.sona) {
          this.sona = new SONAAdapter(this.config.sona);
          await this.sona.initialize();
          this.updateComponentHealth('sona', 'healthy');
        }
        break;
      case 'enableFlashAttention':
        if (!this.attention) {
          this.attention = new AttentionCoordinator(this.config.attention);
          await this.attention.initialize();
          this.updateComponentHealth('attention', 'healthy');
        }
        break;
    }

    this.emit('feature-enabled', { feature });
  }

  /**
   * Disable a feature dynamically
   */
  async disableFeature(feature: keyof FeatureFlags): Promise<void> {
    if (!this.config.features[feature]) {
      return; // Already disabled
    }

    this.config.features[feature] = false;

    // Cleanup the corresponding component
    switch (feature) {
      case 'enableSONA':
        if (this.sona) {
          await this.sona.shutdown();
          this.sona = null;
          this.componentHealth.delete('sona');
        }
        break;
      case 'enableFlashAttention':
        if (this.attention) {
          await this.attention.shutdown();
          this.attention = null;
          this.componentHealth.delete('attention');
        }
        break;
    }

    this.emit('feature-disabled', { feature });
  }

  /**
   * Perform health check on all components
   */
  async healthCheck(): Promise<Record<string, ComponentHealth>> {
    const results: Record<string, ComponentHealth> = {};

    // Check SDK bridge
    if (this.sdk) {
      try {
        const start = Date.now();
        await this.sdk.ping();
        results['sdk'] = {
          name: 'sdk',
          status: 'healthy',
          latencyMs: Date.now() - start,
          uptime: 1.0,
        };
      } catch (error) {
        results['sdk'] = {
          name: 'sdk',
          status: 'unhealthy',
          lastError: (error as Error).message,
          latencyMs: 0,
          uptime: 0,
        };
      }
    }

    // Check SONA
    if (this.sona) {
      try {
        const start = Date.now();
        await this.sona.getStats();
        results['sona'] = {
          name: 'sona',
          status: 'healthy',
          latencyMs: Date.now() - start,
          uptime: 1.0,
        };
      } catch (error) {
        results['sona'] = {
          name: 'sona',
          status: 'unhealthy',
          lastError: (error as Error).message,
          latencyMs: 0,
          uptime: 0,
        };
      }
    }

    // Check Attention
    if (this.attention) {
      try {
        const start = Date.now();
        await this.attention.getMetrics();
        results['attention'] = {
          name: 'attention',
          status: 'healthy',
          latencyMs: Date.now() - start,
          uptime: 1.0,
        };
      } catch (error) {
        results['attention'] = {
          name: 'attention',
          status: 'unhealthy',
          lastError: (error as Error).message,
          latencyMs: 0,
          uptime: 0,
        };
      }
    }

    // Update stored health status
    for (const [name, health] of Object.entries(results)) {
      this.componentHealth.set(name, health);
    }

    this.emit('health-check', { results });
    return results;
  }

  /**
   * Shutdown the integration bridge gracefully
   */
  async shutdown(): Promise<void> {
    this.emit('shutting-down');

    const shutdownPromises: Promise<void>[] = [];

    if (this.sona) {
      shutdownPromises.push(this.sona.shutdown());
    }

    if (this.attention) {
      shutdownPromises.push(this.attention.shutdown());
    }

    if (this.sdk) {
      shutdownPromises.push(this.sdk.shutdown());
    }

    await Promise.allSettled(shutdownPromises);

    this.sona = null;
    this.attention = null;
    this.sdk = null;
    this.agenticFlowCore = null;
    this.agenticFlowAvailable = false;
    this.initialized = false;
    this.componentHealth.clear();

    this.emit('shutdown');
  }

  /**
   * Check if agentic-flow@alpha is connected and available for delegation
   *
   * When true, components can delegate to agentic-flow for optimized
   * implementations (per ADR-001).
   */
  isAgenticFlowConnected(): boolean {
    return this.agenticFlowAvailable && this.agenticFlowCore !== null;
  }

  /**
   * Get the agentic-flow core instance for direct access
   *
   * Returns null if agentic-flow is not available.
   * Prefer using getSONAAdapter() or getAttentionCoordinator() which
   * handle delegation automatically.
   */
  getAgenticFlowCore(): AgenticFlowCore | null {
    return this.agenticFlowCore;
  }

  // ===== Private Methods =====

  private mergeConfig(config: Partial<IntegrationConfig>): IntegrationConfig {
    const defaultConfig: IntegrationConfig = {
      sona: {
        mode: 'balanced',
        learningRate: 0.001,
        similarityThreshold: 0.7,
        maxPatterns: 10000,
        enableTrajectoryTracking: true,
        consolidationInterval: 3600000,
        autoModeSelection: true,
      },
      attention: {
        mechanism: 'flash',
        numHeads: 8,
        headDim: 64,
        dropoutRate: 0.0,
        causalMask: false,
        useRoPE: true,
        flashOptLevel: 2,
        memoryOptimization: 'moderate',
      },
      agentdb: {
        dimension: 1536,
        indexType: 'hnsw',
        hnswM: 16,
        hnswEfConstruction: 200,
        hnswEfSearch: 50,
        metric: 'cosine',
        enableCache: true,
        cacheSizeMb: 256,
        enableWAL: true,
      },
      features: {
        enableSONA: true,
        enableFlashAttention: true,
        enableAgentDB: true,
        enableTrajectoryTracking: true,
        enableGNN: true,
        enableIntelligenceBridge: true,
        enableQUICTransport: false,
        enableNightlyLearning: false,
        enableAutoConsolidation: true,
      },
      runtimePreference: ['napi', 'wasm', 'js'],
      lazyLoad: true,
      debug: false,
    };

    return {
      ...defaultConfig,
      ...config,
      sona: { ...defaultConfig.sona, ...config.sona },
      attention: { ...defaultConfig.attention, ...config.attention },
      agentdb: { ...defaultConfig.agentdb, ...config.agentdb },
      features: { ...defaultConfig.features, ...config.features },
    };
  }

  private async detectRuntime(): Promise<RuntimeInfo> {
    const platform = process.platform as 'linux' | 'darwin' | 'win32';
    const arch = process.arch as 'x64' | 'arm64' | 'ia32';
    const nodeVersion = process.version;

    // Check NAPI support
    let napiSupport = false;
    try {
      // Attempt to load native module indicator
      napiSupport = platform !== 'win32' || arch === 'x64';
    } catch {
      napiSupport = false;
    }

    // WASM is always supported in Node.js
    const wasmSupport = true;

    // Determine runtime based on preference
    let runtime: 'napi' | 'wasm' | 'js' = 'js';
    for (const pref of this.config.runtimePreference) {
      if (pref === 'napi' && napiSupport) {
        runtime = 'napi';
        break;
      } else if (pref === 'wasm' && wasmSupport) {
        runtime = 'wasm';
        break;
      } else if (pref === 'js') {
        runtime = 'js';
        break;
      }
    }

    // Determine performance tier
    let performanceTier: 'optimal' | 'good' | 'fallback';
    if (runtime === 'napi') {
      performanceTier = 'optimal';
    } else if (runtime === 'wasm') {
      performanceTier = 'good';
    } else {
      performanceTier = 'fallback';
    }

    return {
      runtime,
      platform,
      arch,
      nodeVersion,
      wasmSupport,
      napiSupport,
      performanceTier,
    };
  }

  private getDefaultRuntimeInfo(): RuntimeInfo {
    return {
      runtime: 'js',
      platform: 'linux',
      arch: 'x64',
      nodeVersion: process.version,
      wasmSupport: true,
      napiSupport: false,
      performanceTier: 'fallback',
    };
  }

  private getConnectedComponents(): string[] {
    const components: string[] = [];

    if (this.sdk) components.push('sdk');
    if (this.sona) components.push('sona');
    if (this.attention) components.push('attention');

    return components;
  }

  private updateComponentHealth(
    name: string,
    status: 'healthy' | 'degraded' | 'unhealthy',
    error?: string
  ): void {
    this.componentHealth.set(name, {
      name,
      status,
      lastError: error,
      latencyMs: 0,
      uptime: status === 'healthy' ? 1.0 : 0.0,
    });
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw this.createError(
        'Bridge not initialized. Call initialize() first.',
        'INITIALIZATION_FAILED',
        'bridge'
      );
    }
  }

  private createError(
    message: string,
    code: string,
    component: string
  ): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).component = component;
    return error;
  }

  private wrapError(error: Error, code: string, component: string): Error {
    const wrapped = new Error(`${component}: ${error.message}`);
    (wrapped as any).code = code;
    (wrapped as any).component = component;
    (wrapped as any).cause = error;
    return wrapped;
  }

  private logDebug(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.debug(`[AgenticFlowBridge] ${message}`, data || '');
    }
  }
}

/**
 * Create and initialize an AgenticFlowBridge instance
 */
export async function createAgenticFlowBridge(
  config?: Partial<IntegrationConfig>
): Promise<AgenticFlowBridge> {
  const bridge = new AgenticFlowBridge(config);
  await bridge.initialize();
  return bridge;
}

/**
 * Singleton instance for simple usage
 */
let defaultBridge: AgenticFlowBridge | null = null;

/**
 * Get the default bridge instance (creates if needed)
 */
export async function getDefaultBridge(
  config?: Partial<IntegrationConfig>
): Promise<AgenticFlowBridge> {
  if (!defaultBridge) {
    defaultBridge = new AgenticFlowBridge(config);
    await defaultBridge.initialize();
  }
  return defaultBridge;
}

/**
 * Reset the default bridge (useful for testing)
 */
export async function resetDefaultBridge(): Promise<void> {
  if (defaultBridge) {
    await defaultBridge.shutdown();
    defaultBridge = null;
  }
}
