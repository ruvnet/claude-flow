/**
 * SDK Bridge for agentic-flow API Compatibility
 *
 * Provides API compatibility layer between claude-flow v3 and
 * agentic-flow@alpha, handling version negotiation, feature
 * detection, and fallback behavior.
 *
 * Key Responsibilities:
 * - Version negotiation and compatibility checking
 * - API translation for v2 -> v3 migration
 * - Feature detection and graceful degradation
 * - Deprecated API support with warnings
 *
 * @module v3/integration/sdk-bridge
 * @version 3.0.0-alpha.1
 */

import { EventEmitter } from 'events';
import type {
  SDKBridgeConfig,
  SDKVersion,
  SDKCompatibility,
} from './types.js';

/**
 * Feature availability by SDK version
 */
const FEATURE_MATRIX: Record<string, { minVersion: string; optional: boolean }> = {
  'sona-learning': { minVersion: '2.0.0', optional: false },
  'flash-attention': { minVersion: '2.0.0', optional: false },
  'agentdb-hnsw': { minVersion: '2.0.0', optional: false },
  'gnn-refinement': { minVersion: '2.0.0', optional: true },
  'trajectory-tracking': { minVersion: '2.0.0', optional: false },
  'intelligence-bridge': { minVersion: '2.0.1', optional: false },
  'quic-transport': { minVersion: '2.0.1', optional: true },
  'nightly-learning': { minVersion: '2.0.1', optional: true },
  'micro-lora': { minVersion: '2.0.1', optional: true },
};

/**
 * Deprecated API mappings (old -> new)
 */
const DEPRECATED_API_MAP: Record<string, {
  replacement: string;
  since: string;
  removed?: string;
  transformer?: (args: unknown[]) => unknown[];
}> = {
  'ReasoningBank.initialize': {
    replacement: 'HybridReasoningBank.initialize',
    since: '2.0.0',
  },
  'AgentDB.store': {
    replacement: 'AgentDBFast.store',
    since: '2.0.0',
    transformer: (args) => args, // Same signature
  },
  'computeEmbedding': {
    replacement: 'EmbeddingService.compute',
    since: '2.0.0',
  },
};

/**
 * SDKBridge - API Compatibility Layer
 *
 * This bridge handles version compatibility, feature detection,
 * and API translation between claude-flow and agentic-flow.
 */
export class SDKBridge extends EventEmitter {
  private config: SDKBridgeConfig;
  private initialized: boolean = false;
  private currentVersion: SDKVersion | null = null;
  private availableFeatures: Set<string> = new Set();
  private deprecationWarnings: Set<string> = new Set();

  constructor(config: Partial<SDKBridgeConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
  }

  /**
   * Initialize the SDK bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.emit('initializing');

    try {
      // Detect SDK version
      this.currentVersion = await this.detectVersion();

      // Check compatibility
      const compatibility = await this.checkCompatibility();
      if (!compatibility.compatible) {
        throw new Error(
          `SDK version ${this.currentVersion.full} is not compatible. ` +
          `Required: ${compatibility.minVersion.full} - ${compatibility.maxVersion.full}`
        );
      }

      // Detect available features
      await this.detectFeatures();

      this.initialized = true;
      this.emit('initialized', {
        version: this.currentVersion,
        features: Array.from(this.availableFeatures)
      });
    } catch (error) {
      this.emit('initialization-failed', { error });
      throw error;
    }
  }

  /**
   * Ping to check if SDK is available
   */
  async ping(): Promise<boolean> {
    // Simple health check
    return this.initialized;
  }

  /**
   * Get current SDK version
   */
  getVersion(): SDKVersion | null {
    return this.currentVersion;
  }

  /**
   * Check if a feature is available
   */
  isFeatureAvailable(feature: string): boolean {
    return this.availableFeatures.has(feature);
  }

  /**
   * Get all available features
   */
  getAvailableFeatures(): string[] {
    return Array.from(this.availableFeatures);
  }

  /**
   * Get compatibility information
   */
  async checkCompatibility(): Promise<SDKCompatibility> {
    const current = this.currentVersion || await this.detectVersion();

    const minVersion = this.parseVersion('2.0.0-alpha.0');
    const maxVersion = this.parseVersion('3.0.0');

    const compatible =
      this.compareVersions(current, minVersion) >= 0 &&
      this.compareVersions(current, maxVersion) < 0;

    const requiredFeatures = Object.entries(FEATURE_MATRIX)
      .filter(([_, info]) => !info.optional)
      .map(([name]) => name);

    const optionalFeatures = Object.entries(FEATURE_MATRIX)
      .filter(([_, info]) => info.optional)
      .map(([name]) => name);

    return {
      minVersion,
      maxVersion,
      currentVersion: current,
      compatible,
      requiredFeatures,
      optionalFeatures,
    };
  }

  /**
   * Translate deprecated API call to new API
   */
  translateDeprecatedAPI(
    oldAPI: string,
    args: unknown[]
  ): { newAPI: string; args: unknown[] } | null {
    const mapping = DEPRECATED_API_MAP[oldAPI];
    if (!mapping) {
      return null;
    }

    // Emit deprecation warning (once per API)
    if (!this.deprecationWarnings.has(oldAPI)) {
      this.deprecationWarnings.add(oldAPI);
      const message = `'${oldAPI}' is deprecated since ${mapping.since}. ` +
        `Use '${mapping.replacement}' instead.`;

      switch (this.config.fallbackBehavior) {
        case 'error':
          throw new Error(message);
        case 'warn':
          console.warn(`[DEPRECATED] ${message}`);
          this.emit('deprecation-warning', { oldAPI, mapping });
          break;
        case 'silent':
          // Log but don't warn
          break;
      }
    }

    const newArgs = mapping.transformer ? mapping.transformer(args) : args;
    return { newAPI: mapping.replacement, args: newArgs };
  }

  /**
   * Wrap an API call with compatibility handling
   */
  async wrapAPICall<T>(
    apiName: string,
    apiCall: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    this.ensureInitialized();

    try {
      return await apiCall();
    } catch (error) {
      // Check if this is a version-related error
      if (this.isVersionError(error)) {
        if (fallback) {
          this.emit('fallback-used', { apiName, error });
          return await fallback();
        }
      }
      throw error;
    }
  }

  /**
   * Get feature requirements for a capability
   */
  getFeatureRequirements(capability: string): {
    required: string[];
    optional: string[];
    satisfied: boolean;
  } {
    const capabilityFeatures: Record<string, { required: string[]; optional: string[] }> = {
      'learning': {
        required: ['sona-learning', 'trajectory-tracking'],
        optional: ['nightly-learning', 'micro-lora'],
      },
      'attention': {
        required: ['flash-attention'],
        optional: [],
      },
      'search': {
        required: ['agentdb-hnsw'],
        optional: ['gnn-refinement'],
      },
      'coordination': {
        required: ['sona-learning', 'flash-attention'],
        optional: ['quic-transport'],
      },
    };

    const features = capabilityFeatures[capability] || { required: [], optional: [] };
    const satisfied = features.required.every(f => this.availableFeatures.has(f));

    return {
      ...features,
      satisfied,
    };
  }

  /**
   * Negotiate version with remote SDK
   */
  async negotiateVersion(preferredVersion?: string): Promise<SDKVersion> {
    // In a real implementation, this would communicate with the SDK
    // to determine the best compatible version to use

    const preferred = preferredVersion
      ? this.parseVersion(preferredVersion)
      : this.currentVersion;

    if (!preferred) {
      return this.currentVersion || this.parseVersion('2.0.1-alpha.50');
    }

    // Return the negotiated version
    return preferred;
  }

  /**
   * Get migration guide for deprecated APIs
   */
  getMigrationGuide(): Record<string, {
    old: string;
    new: string;
    example: string;
  }> {
    const guide: Record<string, { old: string; new: string; example: string }> = {};

    for (const [oldAPI, mapping] of Object.entries(DEPRECATED_API_MAP)) {
      guide[oldAPI] = {
        old: oldAPI,
        new: mapping.replacement,
        example: this.generateMigrationExample(oldAPI, mapping.replacement),
      };
    }

    return guide;
  }

  /**
   * Shutdown the bridge
   */
  async shutdown(): Promise<void> {
    this.initialized = false;
    this.availableFeatures.clear();
    this.deprecationWarnings.clear();
    this.emit('shutdown');
  }

  // ===== Private Methods =====

  private mergeConfig(config: Partial<SDKBridgeConfig>): SDKBridgeConfig {
    return {
      targetVersion: config.targetVersion || 'alpha',
      enableVersionNegotiation: config.enableVersionNegotiation ?? true,
      fallbackBehavior: config.fallbackBehavior || 'warn',
      enableCompatibilityLayer: config.enableCompatibilityLayer ?? true,
      supportDeprecatedAPIs: config.supportDeprecatedAPIs ?? true,
    };
  }

  private async detectVersion(): Promise<SDKVersion> {
    // Detect agentic-flow version dynamically
    try {
      const af = await import('agentic-flow');
      if (af.VERSION) {
        return this.parseVersion(af.VERSION);
      }
    } catch {
      // agentic-flow not available, use fallback version
    }
    return this.parseVersion('2.0.1-alpha.50');
  }

  private async detectFeatures(): Promise<void> {
    if (!this.currentVersion) {
      return;
    }

    for (const [feature, info] of Object.entries(FEATURE_MATRIX)) {
      const minVersion = this.parseVersion(info.minVersion);
      if (this.compareVersions(this.currentVersion, minVersion) >= 0) {
        this.availableFeatures.add(feature);
      }
    }

    this.emit('features-detected', {
      features: Array.from(this.availableFeatures)
    });
  }

  private parseVersion(version: string): SDKVersion {
    // Handle versions like "2.0.1-alpha.50" or "2.0.0"
    const parts = version.split('-');
    const core = parts[0].split('.');
    const prerelease = parts[1] || undefined;

    return {
      major: parseInt(core[0] || '0', 10),
      minor: parseInt(core[1] || '0', 10),
      patch: parseInt(core[2] || '0', 10),
      prerelease,
      full: version,
    };
  }

  private compareVersions(a: SDKVersion, b: SDKVersion): number {
    // Compare major, minor, patch
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;

    // Compare prerelease (alpha < beta < rc < release)
    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && !b.prerelease) return -1;
    if (!a.prerelease && !b.prerelease) return 0;

    // Both have prerelease
    return (a.prerelease || '').localeCompare(b.prerelease || '');
  }

  private isVersionError(error: unknown): boolean {
    const message = (error as Error)?.message || '';
    return message.includes('version') ||
           message.includes('not supported') ||
           message.includes('deprecated');
  }

  private generateMigrationExample(oldAPI: string, newAPI: string): string {
    // Generate a simple migration example
    const oldParts = oldAPI.split('.');
    const newParts = newAPI.split('.');

    const oldCall = oldParts.length > 1
      ? `${oldParts[0]}.${oldParts[1]}(args)`
      : `${oldAPI}(args)`;

    const newCall = newParts.length > 1
      ? `new ${newParts[0]}().${newParts[1]}(args)`
      : `${newAPI}(args)`;

    return `// Before:\n${oldCall}\n\n// After:\n${newCall}`;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SDKBridge not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create and initialize an SDK bridge
 */
export async function createSDKBridge(
  config?: Partial<SDKBridgeConfig>
): Promise<SDKBridge> {
  const bridge = new SDKBridge(config);
  await bridge.initialize();
  return bridge;
}
