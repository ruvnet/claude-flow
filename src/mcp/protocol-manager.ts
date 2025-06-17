/**
 * MCP Protocol Version Management and Compatibility Checking
 */

import { MCPProtocolVersion, MCPCapabilities, MCPInitializeParams } from '../utils/types.js';
import { ILogger } from '../core/logger.js';
import { MCPError } from '../utils/errors.js';

export interface ProtocolVersionInfo {
  version: MCPProtocolVersion;
  name: string;
  releaseDate: Date;
  deprecated?: boolean;
  deprecationDate?: Date;
  supportedFeatures: string[];
  breakingChanges?: string[];
  migrationGuide?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
  recommendedVersion?: MCPProtocolVersion;
  missingFeatures?: string[];
  deprecatedFeatures?: string[];
}

export interface NegotiationResult {
  agreedVersion: MCPProtocolVersion;
  agreedCapabilities: MCPCapabilities;
  clientCapabilities: MCPCapabilities;
  serverCapabilities: MCPCapabilities;
  warnings: string[];
  limitations: string[];
}

/**
 * MCP Protocol Manager
 * Handles protocol version negotiation, compatibility checking, and feature management
 */
export class MCPProtocolManager {
  private supportedVersions: Map<string, ProtocolVersionInfo> = new Map();
  private currentVersion: MCPProtocolVersion;
  private serverCapabilities: MCPCapabilities;

  private readonly knownVersions: ProtocolVersionInfo[] = [
    {
      version: { major: 2024, minor: 11, patch: 5 },
      name: 'MCP 2024.11.5',
      releaseDate: new Date('2024-11-01'),
      supportedFeatures: [
        'tools',
        'prompts',
        'resources',
        'logging',
        'sampling',
        'notifications',
        'tool_list_changed',
        'resource_list_changed',
        'prompt_list_changed',
      ],
    },
    {
      version: { major: 2024, minor: 11, patch: 4 },
      name: 'MCP 2024.11.4',
      releaseDate: new Date('2024-10-15'),
      supportedFeatures: [
        'tools',
        'prompts',
        'resources',
        'logging',
        'notifications',
        'tool_list_changed',
        'resource_list_changed',
      ],
    },
    {
      version: { major: 2024, minor: 11, patch: 3 },
      name: 'MCP 2024.11.3',
      releaseDate: new Date('2024-10-01'),
      supportedFeatures: [
        'tools',
        'prompts',
        'resources',
        'logging',
        'notifications',
      ],
    },
    {
      version: { major: 2024, minor: 10, patch: 0 },
      name: 'MCP 2024.10.0',
      releaseDate: new Date('2024-09-01'),
      deprecated: true,
      deprecationDate: new Date('2024-11-01'),
      supportedFeatures: [
        'tools',
        'prompts',
        'resources',
        'logging',
      ],
      breakingChanges: [
        'Changed tool response format',
        'Modified error codes',
      ],
      migrationGuide: 'https://docs.mcp.io/migration/2024.10-to-2024.11',
    },
  ];

  constructor(
    private logger: ILogger,
    preferredVersion?: MCPProtocolVersion,
    serverCapabilities?: MCPCapabilities,
  ) {
    // Initialize supported versions
    for (const versionInfo of this.knownVersions) {
      const key = this.versionToString(versionInfo.version);
      this.supportedVersions.set(key, versionInfo);
    }

    // Set current version (latest supported or preferred)
    this.currentVersion = preferredVersion || this.getLatestSupportedVersion();
    
    // Set server capabilities
    this.serverCapabilities = serverCapabilities || this.getDefaultCapabilities();

    this.logger.info('Protocol manager initialized', {
      currentVersion: this.versionToString(this.currentVersion),
      supportedVersions: this.getSupportedVersionStrings(),
    });
  }

  /**
   * Negotiate protocol version and capabilities with client
   */
  async negotiateProtocol(clientParams: MCPInitializeParams): Promise<NegotiationResult> {
    this.logger.debug('Starting protocol negotiation', {
      clientVersion: this.versionToString(clientParams.protocolVersion),
      clientCapabilities: clientParams.capabilities,
      clientInfo: clientParams.clientInfo,
    });

    const result: NegotiationResult = {
      agreedVersion: this.currentVersion,
      agreedCapabilities: { ...this.serverCapabilities },
      clientCapabilities: clientParams.capabilities,
      serverCapabilities: this.serverCapabilities,
      warnings: [],
      limitations: [],
    };

    try {
      // Check version compatibility
      const compatibility = this.checkCompatibility(clientParams.protocolVersion);
      
      if (!compatibility.compatible) {
        throw new MCPError(
          `Protocol version ${this.versionToString(clientParams.protocolVersion)} is not compatible. ${compatibility.errors.join(', ')}`
        );
      }

      // Use client's version if it's supported and newer
      if (this.isVersionSupported(clientParams.protocolVersion)) {
        const clientVersionInfo = this.getVersionInfo(clientParams.protocolVersion);
        const currentVersionInfo = this.getVersionInfo(this.currentVersion);
        
        if (clientVersionInfo && currentVersionInfo) {
          if (this.compareVersions(clientParams.protocolVersion, this.currentVersion) <= 0) {
            result.agreedVersion = clientParams.protocolVersion;
          }
        }
      }

      // Negotiate capabilities
      result.agreedCapabilities = this.negotiateCapabilities(
        clientParams.capabilities,
        this.serverCapabilities,
        result.agreedVersion
      );

      // Add warnings from compatibility check
      result.warnings.push(...compatibility.warnings);

      // Check for deprecated features
      const versionInfo = this.getVersionInfo(result.agreedVersion);
      if (versionInfo?.deprecated) {
        result.warnings.push(
          `Protocol version ${this.versionToString(result.agreedVersion)} is deprecated. ` +
          `Please upgrade to a newer version.`
        );
      }

      // Check for missing features
      const missingFeatures = this.getMissingFeatures(
        result.agreedVersion,
        result.agreedCapabilities
      );
      
      if (missingFeatures.length > 0) {
        result.limitations.push(
          `Some features may not be available: ${missingFeatures.join(', ')}`
        );
      }

      this.logger.info('Protocol negotiation completed', {
        agreedVersion: this.versionToString(result.agreedVersion),
        warnings: result.warnings.length,
        limitations: result.limitations.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Protocol negotiation failed', {
        clientVersion: this.versionToString(clientParams.protocolVersion),
        error,
      });
      throw error;
    }
  }

  /**
   * Check compatibility between client and server versions
   */
  checkCompatibility(clientVersion: MCPProtocolVersion): CompatibilityResult {
    const result: CompatibilityResult = {
      compatible: false,
      warnings: [],
      errors: [],
    };

    const clientVersionInfo = this.getVersionInfo(clientVersion);
    const serverVersionInfo = this.getVersionInfo(this.currentVersion);

    // Check if version is known
    if (!clientVersionInfo) {
      result.errors.push(`Unknown protocol version: ${this.versionToString(clientVersion)}`);
      result.recommendedVersion = this.getLatestSupportedVersion();
      return result;
    }

    // Check major version compatibility
    if (clientVersion.major !== this.currentVersion.major) {
      result.errors.push(
        `Major version mismatch: client ${clientVersion.major}, server ${this.currentVersion.major}`
      );
      return result;
    }

    // Check if client version is too new
    if (this.compareVersions(clientVersion, this.currentVersion) > 0) {
      result.errors.push(
        `Client version ${this.versionToString(clientVersion)} is newer than supported server version ${this.versionToString(this.currentVersion)}`
      );
      result.recommendedVersion = this.currentVersion;
      return result;
    }

    // Check for deprecated versions
    if (clientVersionInfo.deprecated) {
      result.warnings.push(
        `Client is using deprecated version ${this.versionToString(clientVersion)}. ` +
        `Support will be removed after ${clientVersionInfo.deprecationDate?.toISOString().split('T')[0]}`
      );
      result.recommendedVersion = this.getLatestSupportedVersion();
    }

    // Check for missing features
    const serverFeatures = serverVersionInfo?.supportedFeatures || [];
    const clientFeatures = clientVersionInfo.supportedFeatures;
    const missingFeatures = serverFeatures.filter(feature => !clientFeatures.includes(feature));
    
    if (missingFeatures.length > 0) {
      result.missingFeatures = missingFeatures;
      result.warnings.push(
        `Client version lacks some server features: ${missingFeatures.join(', ')}`
      );
    }

    // Check for deprecated features being used
    const deprecatedFeatures = this.getDeprecatedFeatures(clientVersion);
    if (deprecatedFeatures.length > 0) {
      result.deprecatedFeatures = deprecatedFeatures;
      result.warnings.push(
        `Client version uses deprecated features: ${deprecatedFeatures.join(', ')}`
      );
    }

    result.compatible = true;
    return result;
  }

  /**
   * Get information about a specific protocol version
   */
  getVersionInfo(version: MCPProtocolVersion): ProtocolVersionInfo | undefined {
    return this.supportedVersions.get(this.versionToString(version));
  }

  /**
   * Check if a version is supported
   */
  isVersionSupported(version: MCPProtocolVersion): boolean {
    return this.supportedVersions.has(this.versionToString(version));
  }

  /**
   * Get the latest supported version
   */
  getLatestSupportedVersion(): MCPProtocolVersion {
    const versions = Array.from(this.supportedVersions.values())
      .filter(v => !v.deprecated)
      .sort((a, b) => this.compareVersions(b.version, a.version));
    
    return versions[0]?.version || { major: 2024, minor: 11, patch: 5 };
  }

  /**
   * Get all supported version strings
   */
  getSupportedVersionStrings(): string[] {
    return Array.from(this.supportedVersions.keys());
  }

  /**
   * Get current server capabilities
   */
  getServerCapabilities(): MCPCapabilities {
    return { ...this.serverCapabilities };
  }

  /**
   * Update server capabilities
   */
  updateServerCapabilities(capabilities: Partial<MCPCapabilities>): void {
    this.serverCapabilities = { ...this.serverCapabilities, ...capabilities };
    this.logger.info('Server capabilities updated', { capabilities: this.serverCapabilities });
  }

  /**
   * Check if a feature is supported in a specific version
   */
  isFeatureSupported(version: MCPProtocolVersion, feature: string): boolean {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.supportedFeatures.includes(feature) || false;
  }

  private versionToString(version: MCPProtocolVersion): string {
    return `${version.major}.${version.minor}.${version.patch}`;
  }

  private compareVersions(a: MCPProtocolVersion, b: MCPProtocolVersion): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  }

  private getDefaultCapabilities(): MCPCapabilities {
    return {
      logging: {
        level: 'info',
      },
      tools: {
        listChanged: true,
      },
      resources: {
        listChanged: true,
        subscribe: false,
      },
      prompts: {
        listChanged: true,
      },
    };
  }

  private negotiateCapabilities(
    clientCapabilities: MCPCapabilities,
    serverCapabilities: MCPCapabilities,
    agreedVersion: MCPProtocolVersion
  ): MCPCapabilities {
    const result: MCPCapabilities = {};

    // Negotiate logging capabilities
    if (clientCapabilities.logging && serverCapabilities.logging) {
      result.logging = {
        level: this.negotiateLogLevel(
          clientCapabilities.logging.level,
          serverCapabilities.logging.level
        ),
      };
    }

    // Negotiate tools capabilities
    if (clientCapabilities.tools && serverCapabilities.tools) {
      result.tools = {
        listChanged: clientCapabilities.tools.listChanged && serverCapabilities.tools.listChanged,
      };
    }

    // Negotiate resources capabilities
    if (clientCapabilities.resources && serverCapabilities.resources) {
      result.resources = {
        listChanged: clientCapabilities.resources.listChanged && serverCapabilities.resources.listChanged,
        subscribe: clientCapabilities.resources.subscribe && serverCapabilities.resources.subscribe,
      };
    }

    // Negotiate prompts capabilities
    if (clientCapabilities.prompts && serverCapabilities.prompts) {
      result.prompts = {
        listChanged: clientCapabilities.prompts.listChanged && serverCapabilities.prompts.listChanged,
      };
    }

    // Only include capabilities supported by the agreed version
    return this.filterCapabilitiesByVersion(result, agreedVersion);
  }

  private negotiateLogLevel(
    clientLevel?: 'debug' | 'info' | 'warn' | 'error',
    serverLevel?: 'debug' | 'info' | 'warn' | 'error'
  ): 'debug' | 'info' | 'warn' | 'error' {
    const levels = ['debug', 'info', 'warn', 'error'];
    const clientIndex = clientLevel ? levels.indexOf(clientLevel) : 1;
    const serverIndex = serverLevel ? levels.indexOf(serverLevel) : 1;
    
    // Use the more restrictive (higher) level
    const chosenIndex = Math.max(clientIndex, serverIndex);
    return levels[chosenIndex] as 'debug' | 'info' | 'warn' | 'error';
  }

  private filterCapabilitiesByVersion(
    capabilities: MCPCapabilities,
    version: MCPProtocolVersion
  ): MCPCapabilities {
    const versionInfo = this.getVersionInfo(version);
    if (!versionInfo) return capabilities;

    const result: MCPCapabilities = {};

    // Only include capabilities supported by this version
    if (versionInfo.supportedFeatures.includes('logging') && capabilities.logging) {
      result.logging = capabilities.logging;
    }
    
    if (versionInfo.supportedFeatures.includes('tools') && capabilities.tools) {
      result.tools = capabilities.tools;
    }
    
    if (versionInfo.supportedFeatures.includes('resources') && capabilities.resources) {
      result.resources = capabilities.resources;
    }
    
    if (versionInfo.supportedFeatures.includes('prompts') && capabilities.prompts) {
      result.prompts = capabilities.prompts;
    }

    return result;
  }

  private getMissingFeatures(
    version: MCPProtocolVersion,
    capabilities: MCPCapabilities
  ): string[] {
    const versionInfo = this.getVersionInfo(version);
    if (!versionInfo) return [];

    const missing: string[] = [];
    const availableFeatures = versionInfo.supportedFeatures;

    // Check what's missing compared to latest version
    const latestVersion = this.getLatestSupportedVersion();
    const latestVersionInfo = this.getVersionInfo(latestVersion);
    
    if (latestVersionInfo) {
      for (const feature of latestVersionInfo.supportedFeatures) {
        if (!availableFeatures.includes(feature)) {
          missing.push(feature);
        }
      }
    }

    return missing;
  }

  private getDeprecatedFeatures(version: MCPProtocolVersion): string[] {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.breakingChanges || [];
  }
}