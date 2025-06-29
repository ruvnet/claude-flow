/**
 * IPC (Inter-Process Communication) Module
 * Cross-platform IPC implementation for Claude-Flow
 */

import * as os from 'os';
import * as path from 'path';
import { 
  IPCConfig, 
  IPCTransport, 
  TransportType,
  IPCServer,
  IPCClient,
  IPCSecurityOptions
} from './types.js';
import { UnixSocketTransport } from './transports/unix-socket-transport.js';
import { NamedPipeTransport } from './transports/named-pipe-transport.js';
import { HTTPTransport } from './transports/http-transport.js';
import { IPCServerImpl } from './server.js';
import { IPCClientImpl } from './client.js';

// Re-export types
export * from './types.js';
export { IPCServerImpl } from './server.js';
export { IPCClientImpl } from './client.js';

/**
 * IPC Factory for creating servers and clients
 */
export class IPCFactory {
  /**
   * Create an IPC server
   */
  static createServer(config?: Partial<IPCConfig>): IPCServer {
    const fullConfig = this.buildConfig(config);
    const transport = this.createTransport(fullConfig);
    return new IPCServerImpl(transport, fullConfig);
  }
  
  /**
   * Create an IPC client
   */
  static createClient(config?: Partial<IPCConfig>): IPCClient {
    const fullConfig = this.buildConfig(config);
    const transport = this.createTransport(fullConfig);
    return new IPCClientImpl(transport, fullConfig);
  }
  
  /**
   * Build full configuration with defaults
   */
  private static buildConfig(partial?: Partial<IPCConfig>): IPCConfig {
    const defaults: IPCConfig = {
      transport: this.getDefaultTransport(),
      path: this.getDefaultPath(),
      security: this.getDefaultSecurity(),
      reconnectAttempts: 3,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      requestTimeout: 30000,
      ...partial
    };
    
    // Override with partial config
    if (partial?.security) {
      defaults.security = { ...defaults.security, ...partial.security };
    }
    
    return defaults;
  }
  
  /**
   * Get default transport based on platform
   */
  private static getDefaultTransport(): TransportType {
    if (process.platform === 'win32') {
      return TransportType.NAMED_PIPE;
    }
    return TransportType.UNIX_SOCKET;
  }
  
  /**
   * Get default IPC path
   */
  private static getDefaultPath(): string {
    if (process.platform === 'win32') {
      return `claude-flow-${process.pid}`;
    }
    
    const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
    return path.join(tmpDir, 'claude-flow', `claude-flow-${process.pid}.sock`);
  }
  
  /**
   * Get default security options
   */
  private static getDefaultSecurity(): IPCSecurityOptions {
    return {
      enableEncryption: false, // Can be implemented later
      enableAuthentication: false,
      maxMessageSize: 1024 * 1024 * 10, // 10MB
      rateLimitPerSecond: 100
    };
  }
  
  /**
   * Create transport based on configuration
   */
  private static createTransport(config: IPCConfig): IPCTransport {
    switch (config.transport) {
      case TransportType.UNIX_SOCKET:
        if (process.platform === 'win32') {
          throw new Error('Unix sockets are not supported on Windows');
        }
        return new UnixSocketTransport({ socketPath: config.path });
        
      case TransportType.NAMED_PIPE:
        if (process.platform !== 'win32') {
          console.warn('Named pipes are primarily for Windows, using Unix socket instead');
          return new UnixSocketTransport({ socketPath: config.path });
        }
        return new NamedPipeTransport(config.path);
        
      case TransportType.HTTP:
        return new HTTPTransport(config.port || 0, config.host || 'localhost');
        
      default:
        throw new Error(`Unsupported transport type: ${config.transport}`);
    }
  }
}

/**
 * Default IPC paths for common scenarios
 */
export const IPCPaths = {
  /**
   * Get path for main orchestrator process
   */
  getOrchestratorPath(): string {
    if (process.platform === 'win32') {
      return 'claude-flow-orchestrator';
    }
    const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
    return path.join(tmpDir, 'claude-flow', 'orchestrator.sock');
  },
  
  /**
   * Get path for agent processes
   */
  getAgentPath(agentId: string): string {
    if (process.platform === 'win32') {
      return `claude-flow-agent-${agentId}`;
    }
    const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
    return path.join(tmpDir, 'claude-flow', 'agents', `${agentId}.sock`);
  },
  
  /**
   * Get path for swarm coordinator
   */
  getSwarmPath(swarmId: string): string {
    if (process.platform === 'win32') {
      return `claude-flow-swarm-${swarmId}`;
    }
    const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
    return path.join(tmpDir, 'claude-flow', 'swarms', `${swarmId}.sock`);
  }
};

/**
 * Convenience functions for common IPC patterns
 */

/**
 * Create a server that listens on the orchestrator path
 */
export function createOrchestratorServer(security?: IPCSecurityOptions): IPCServer {
  return IPCFactory.createServer({
    path: IPCPaths.getOrchestratorPath(),
    security
  });
}

/**
 * Create a client that connects to the orchestrator
 */
export function createOrchestratorClient(): IPCClient {
  return IPCFactory.createClient({
    path: IPCPaths.getOrchestratorPath()
  });
}

/**
 * Create an agent server
 */
export function createAgentServer(agentId: string, security?: IPCSecurityOptions): IPCServer {
  return IPCFactory.createServer({
    path: IPCPaths.getAgentPath(agentId),
    security
  });
}

/**
 * Create a client that connects to an agent
 */
export function createAgentClient(agentId: string): IPCClient {
  return IPCFactory.createClient({
    path: IPCPaths.getAgentPath(agentId)
  });
}

/**
 * Utility to clean up IPC resources
 */
export async function cleanupIPCResources(): Promise<void> {
  if (process.platform === 'win32') {
    // Windows named pipes are cleaned up automatically
    return;
  }
  
  const fs = await import('fs/promises');
  const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
  const ipcDir = path.join(tmpDir, 'claude-flow');
  
  try {
    const files = await fs.readdir(ipcDir, { recursive: true });
    const cleanupPromises = files
      .filter(file => file.endsWith('.sock'))
      .map(file => fs.unlink(path.join(ipcDir, file)).catch(() => {}));
    
    await Promise.all(cleanupPromises);
  } catch (error) {
    // Directory might not exist
  }
}