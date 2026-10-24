/**
 * MCP 2025-11 Version Negotiation Protocol
 *
 * Implements version negotiation and capability exchange
 * per MCP 2025-11 specification
 */

import type { ILogger } from '../../interfaces/logger.js';

/**
 * MCP version in YYYY-MM format
 */
export type MCPVersion = '2025-11' | '2024-11' | '2024-10';

/**
 * MCP capability flags
 */
export type MCPCapability =
  | 'async'       // Job handles, poll/resume
  | 'registry'    // Self-registration
  | 'code_exec'   // External code execution
  | 'stream'      // Streaming output
  | 'sandbox'     // Isolated execution
  | 'schema_ref'; // Shared schema references

/**
 * MCP handshake request/response
 */
export interface MCPHandshake {
  mcp_version: MCPVersion;
  client_id?: string;
  server_id?: string;
  transport: 'stdio' | 'http' | 'ws';
  capabilities: MCPCapability[];
  metadata?: {
    name?: string;
    version?: string;
    description?: string;
  };
}

/**
 * Version negotiation result
 */
export interface NegotiationResult {
  success: boolean;
  agreed_version: MCPVersion;
  agreed_capabilities: MCPCapability[];
  error?: string;
}

/**
 * Version negotiation errors
 */
export class VersionNegotiationError extends Error {
  constructor(
    message: string,
    public code: 'VERSION_MISMATCH' | 'UNSUPPORTED_CAPABILITY' | 'INVALID_HANDSHAKE'
  ) {
    super(message);
    this.name = 'VersionNegotiationError';
  }
}

/**
 * MCP Version Negotiator
 *
 * Handles version compatibility checking and capability negotiation
 */
export class VersionNegotiator {
  // Supported versions in order of preference
  private supportedVersions: MCPVersion[] = ['2025-11', '2024-11'];

  // Current server version
  private serverVersion: MCPVersion = '2025-11';

  // Server capabilities
  private serverCapabilities: MCPCapability[] = [
    'async',
    'registry',
    'code_exec',
    'stream',
  ];

  constructor(private logger: ILogger) {}

  /**
   * Negotiate version with client
   */
  async negotiate(clientHandshake: MCPHandshake): Promise<NegotiationResult> {
    this.logger.info('Starting version negotiation', {
      clientVersion: clientHandshake.mcp_version,
      serverVersion: this.serverVersion,
      clientCapabilities: clientHandshake.capabilities,
    });

    // Validate handshake structure
    if (!this.isValidHandshake(clientHandshake)) {
      return {
        success: false,
        agreed_version: this.serverVersion,
        agreed_capabilities: [],
        error: 'Invalid handshake structure',
      };
    }

    // Check version compatibility
    const versionResult = this.checkVersionCompatibility(clientHandshake.mcp_version);
    if (!versionResult.compatible) {
      return {
        success: false,
        agreed_version: this.serverVersion,
        agreed_capabilities: [],
        error: versionResult.error,
      };
    }

    // Negotiate capabilities
    const agreedCapabilities = this.negotiateCapabilities(
      clientHandshake.capabilities
    );

    this.logger.info('Version negotiation successful', {
      agreedVersion: versionResult.version,
      agreedCapabilities,
    });

    return {
      success: true,
      agreed_version: versionResult.version,
      agreed_capabilities: agreedCapabilities,
    };
  }

  /**
   * Check if handshake is valid
   */
  private isValidHandshake(handshake: MCPHandshake): boolean {
    return !!(
      handshake.mcp_version &&
      handshake.transport &&
      Array.isArray(handshake.capabilities)
    );
  }

  /**
   * Check version compatibility
   */
  private checkVersionCompatibility(clientVersion: MCPVersion): {
    compatible: boolean;
    version: MCPVersion;
    error?: string;
  } {
    // Exact match - best case
    if (clientVersion === this.serverVersion) {
      return { compatible: true, version: clientVersion };
    }

    // Check if client version is supported
    if (this.supportedVersions.includes(clientVersion)) {
      this.logger.warn('Client using older version, but compatible', {
        clientVersion,
        serverVersion: this.serverVersion,
      });
      return { compatible: true, version: clientVersion };
    }

    // Check version gap
    const clientDate = this.parseVersion(clientVersion);
    const serverDate = this.parseVersion(this.serverVersion);
    const monthsDiff = this.getMonthsDifference(clientDate, serverDate);

    // Reject if more than 1 cycle (1 month) difference
    if (Math.abs(monthsDiff) > 1) {
      return {
        compatible: false,
        version: this.serverVersion,
        error: `Version mismatch: client ${clientVersion}, server ${this.serverVersion}. Difference exceeds 1 cycle.`,
      };
    }

    // Accept with warning for small differences
    this.logger.warn('Version close enough, accepting', {
      clientVersion,
      serverVersion: this.serverVersion,
      monthsDiff,
    });
    return { compatible: true, version: this.serverVersion };
  }

  /**
   * Negotiate capabilities between client and server
   */
  private negotiateCapabilities(
    clientCapabilities: MCPCapability[]
  ): MCPCapability[] {
    // Return intersection of client and server capabilities
    return clientCapabilities.filter(cap =>
      this.serverCapabilities.includes(cap)
    );
  }

  /**
   * Parse version string to date
   */
  private parseVersion(version: MCPVersion): Date {
    const [year, month] = version.split('-').map(Number);
    return new Date(year, month - 1, 1);
  }

  /**
   * Calculate months difference between dates
   */
  private getMonthsDifference(date1: Date, date2: Date): number {
    const months = (date2.getFullYear() - date1.getFullYear()) * 12;
    return months + date2.getMonth() - date1.getMonth();
  }

  /**
   * Create server handshake response
   */
  createServerHandshake(
    serverId: string,
    transport: 'stdio' | 'http' | 'ws',
    metadata?: MCPHandshake['metadata']
  ): MCPHandshake {
    return {
      mcp_version: this.serverVersion,
      server_id: serverId,
      transport,
      capabilities: this.serverCapabilities,
      metadata,
    };
  }

  /**
   * Get current server version
   */
  getServerVersion(): MCPVersion {
    return this.serverVersion;
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): MCPCapability[] {
    return [...this.serverCapabilities];
  }

  /**
   * Check if capability is supported
   */
  hasCapability(capability: MCPCapability): boolean {
    return this.serverCapabilities.includes(capability);
  }

  /**
   * Add capability (dynamic capability registration)
   */
  addCapability(capability: MCPCapability): void {
    if (!this.serverCapabilities.includes(capability)) {
      this.serverCapabilities.push(capability);
      this.logger.info('Capability added', { capability });
    }
  }

  /**
   * Remove capability
   */
  removeCapability(capability: MCPCapability): void {
    const index = this.serverCapabilities.indexOf(capability);
    if (index > -1) {
      this.serverCapabilities.splice(index, 1);
      this.logger.info('Capability removed', { capability });
    }
  }
}

/**
 * Backward compatibility helper
 * Converts legacy requests to MCP 2025-11 format
 */
export class BackwardCompatibilityAdapter {
  constructor(private logger: ILogger) {}

  /**
   * Detect if request is legacy format
   */
  isLegacyRequest(request: any): boolean {
    // Legacy requests don't have mcp_version field
    return !request.mcp_version || request.version;
  }

  /**
   * Convert legacy request to MCP 2025-11 format
   */
  convertToModern(legacyRequest: any): MCPHandshake {
    this.logger.info('Converting legacy request to MCP 2025-11 format');

    return {
      mcp_version: '2025-11',
      client_id: legacyRequest.clientId || 'legacy-client',
      transport: legacyRequest.transport || 'stdio',
      capabilities: legacyRequest.capabilities || [],
      metadata: {
        name: legacyRequest.name || 'Legacy Client',
        version: legacyRequest.version || '1.0.0',
      },
    };
  }

  /**
   * Convert modern response to legacy format if needed
   */
  convertToLegacy(modernResponse: any, requestedLegacy: boolean): any {
    if (!requestedLegacy) {
      return modernResponse;
    }

    this.logger.info('Converting response to legacy format');

    return {
      version: modernResponse.mcp_version,
      serverId: modernResponse.server_id,
      capabilities: modernResponse.capabilities,
      ...modernResponse,
    };
  }
}
