/**
 * Session manager for MCP connections
 */

import {
  MCPSession,
  MCPInitializeParams,
  MCPProtocolVersion,
  MCPCapabilities,
  MCPAuthConfig,
  MCPConfig,
} from '../utils/types.js';
import { ILogger } from '../core/logger.js';
import { MCPError } from '../utils/errors.js';
import { createHash, timingSafeEqual } from 'node:crypto';

export interface ISessionManager {
  createSession(transport: 'stdio' | 'http' | 'websocket'): MCPSession;
  getSession(id: string): MCPSession | undefined;
  initializeSession(sessionId: string, params: MCPInitializeParams): void;
  authenticateSession(sessionId: string, credentials: unknown): boolean;
  updateActivity(sessionId: string): void;
  removeSession(sessionId: string): void;
  getActiveSessions(): MCPSession[];
  cleanupExpiredSessions(): void;
  getSessionMetrics(): {
    total: number;
    active: number;
    authenticated: number;
    expired: number;
  };
}

/**
 * Session manager implementation
 */
export class SessionManager implements ISessionManager {
  private sessions = new Map<string, MCPSession>();
  private authConfig: MCPAuthConfig;
  private sessionTimeout: number;
  private maxSessions: number;
  private cleanupInterval?: number;

  constructor(
    private config: MCPConfig,
    private logger: ILogger,
  ) {
    this.authConfig = config.auth || { enabled: false, method: 'token' };
    this.sessionTimeout = config.sessionTimeout || 3600000; // 1 hour default
    this.maxSessions = config.maxSessions || 100;

    // Start cleanup timer
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Clean up every minute
  }

  createSession(transport: 'stdio' | 'http' | 'websocket'): MCPSession {
    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      // Try to clean up expired sessions first
      this.cleanupExpiredSessions();
      
      if (this.sessions.size >= this.maxSessions) {
        throw new MCPError('Maximum number of sessions reached');
      }
    }

    const sessionId = this.generateSessionId();
    const now = new Date();

    const session: MCPSession = {
      id: sessionId,
      clientInfo: { name: 'unknown', version: 'unknown' },
      protocolVersion: { major: 0, minor: 0, patch: 0 },
      capabilities: {},
      isInitialized: false,
      createdAt: now,
      lastActivity: now,
      transport,
      authenticated: !this.authConfig.enabled, // If auth disabled, session is authenticated
    };

    this.sessions.set(sessionId, session);

    this.logger.info('Session created', {
      sessionId,
      transport,
      totalSessions: this.sessions.size,
    });

    return session;
  }

  getSession(id: string): MCPSession | undefined {
    const session = this.sessions.get(id);
    if (session && this.isSessionExpired(session)) {
      this.removeSession(id);
      return undefined;
    }
    return session;
  }

  initializeSession(sessionId: string, params: MCPInitializeParams): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new MCPError(`Session not found: ${sessionId}`);
    }

    // Validate protocol version
    this.validateProtocolVersion(params.protocolVersion);

    // Update session with initialization params
    session.clientInfo = params.clientInfo;
    session.protocolVersion = params.protocolVersion;
    session.capabilities = params.capabilities;
    session.isInitialized = true;
    session.lastActivity = new Date();

    this.logger.info('Session initialized', {
      sessionId,
      clientInfo: params.clientInfo,
      protocolVersion: params.protocolVersion,
    });
  }

  authenticateSession(sessionId: string, credentials: unknown): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    if (!this.authConfig.enabled) {
      session.authenticated = true;
      return true;
    }

    let authenticated = false;

    switch (this.authConfig.method) {
      case 'token':
        authenticated = this.authenticateToken(credentials);
        break;
      case 'basic':
        authenticated = this.authenticateBasic(credentials);
        break;
      case 'oauth':
        authenticated = this.authenticateOAuth(credentials);
        break;
      default:
        this.logger.warn('Unknown authentication method', {
          method: this.authConfig.method,
        });
        return false;
    }

    if (authenticated) {
      session.authenticated = true;
      session.authData = this.extractAuthData(credentials);
      session.lastActivity = new Date();

      this.logger.info('Session authenticated', {
        sessionId,
        method: this.authConfig.method,
      });
    } else {
      this.logger.warn('Session authentication failed', {
        sessionId,
        method: this.authConfig.method,
      });
    }

    return authenticated;
  }

  updateActivity(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.logger.info('Session removed', {
        sessionId,
        duration: Date.now() - session.createdAt.getTime(),
        transport: session.transport,
      });
    }
  }

  getActiveSessions(): MCPSession[] {
    const activeSessions: MCPSession[] = [];
    for (const session of this.sessions.values()) {
      if (!this.isSessionExpired(session)) {
        activeSessions.push(session);
      }
    }
    return activeSessions;
  }

  cleanupExpiredSessions(): void {
    const expiredSessions: string[] = [];
    
    for (const [sessionId, session] of this.sessions) {
      if (this.isSessionExpired(session)) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.removeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      this.logger.info('Cleaned up expired sessions', {
        count: expiredSessions.length,
        remainingSessions: this.sessions.size,
      });
    }
  }

  getSessionMetrics(): {
    total: number;
    active: number;
    authenticated: number;
    expired: number;
  } {
    let active = 0;
    let authenticated = 0;
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (this.isSessionExpired(session)) {
        expired++;
      } else {
        active++;
        if (session.authenticated) {
          authenticated++;
        }
      }
    }

    return {
      total: this.sessions.size,
      active,
      authenticated,
      expired,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `session_${timestamp}_${random}`;
  }

  private isSessionExpired(session: MCPSession): boolean {
    const now = Date.now();
    const sessionAge = now - session.lastActivity.getTime();
    return sessionAge > this.sessionTimeout;
  }

  private validateProtocolVersion(version: MCPProtocolVersion): void {
    // Currently supporting MCP version 2024-11-05
    const supportedVersions = [
      { major: 2024, minor: 11, patch: 5 },
    ];

    const isSupported = supportedVersions.some(
      (supported) =>
        supported.major === version.major &&
        supported.minor === version.minor &&
        supported.patch === version.patch,
    );

    if (!isSupported) {
      throw new MCPError(
        `Unsupported protocol version: ${version.major}.${version.minor}.${version.patch}`,
        { supportedVersions }
      );
    }
  }

  private authenticateToken(credentials: unknown): boolean {
    if (!this.authConfig.tokens || this.authConfig.tokens.length === 0) {
      return false;
    }

    const token = this.extractToken(credentials);
    if (!token) {
      return false;
    }

    // Use timing-safe comparison to prevent timing attacks
    return this.authConfig.tokens.some((validToken) => {
      const encoder = new TextEncoder();
      const validTokenBytes = encoder.encode(validToken);
      const providedTokenBytes = encoder.encode(token);
      
      if (validTokenBytes.length !== providedTokenBytes.length) {
        return false;
      }
      
      return timingSafeEqual(validTokenBytes, providedTokenBytes);
    });
  }

  private authenticateBasic(credentials: unknown): boolean {
    if (!this.authConfig.users || this.authConfig.users.length === 0) {
      return false;
    }

    const { username, password } = this.extractBasicAuth(credentials);
    if (!username || !password) {
      return false;
    }

    const user = this.authConfig.users.find((u) => u.username === username);
    if (!user) {
      return false;
    }

    // Hash the provided password and compare
    const hashedPassword = this.hashPassword(password);
    const expectedHashedPassword = this.hashPassword(user.password);

    const encoder = new TextEncoder();
    const hashedPasswordBytes = encoder.encode(hashedPassword);
    const expectedHashedPasswordBytes = encoder.encode(expectedHashedPassword);

    if (hashedPasswordBytes.length !== expectedHashedPasswordBytes.length) {
      return false;
    }

    return timingSafeEqual(hashedPasswordBytes, expectedHashedPasswordBytes);
  }

  private authenticateOAuth(credentials: unknown): boolean {
    // TODO: Implement OAuth authentication
    // This would typically involve validating JWT tokens
    this.logger.warn('OAuth authentication not yet implemented');
    return false;
  }

  private extractToken(credentials: unknown): string | null {
    if (typeof credentials === 'string') {
      return credentials;
    }

    if (typeof credentials === 'object' && credentials !== null) {
      const creds = credentials as Record<string, unknown>;
      if (typeof creds.token === 'string') {
        return creds.token;
      }
      if (typeof creds.authorization === 'string') {
        const match = creds.authorization.match(/^Bearer\s+(.+)$/);
        return match ? match[1] : null;
      }
    }

    return null;
  }

  private extractBasicAuth(credentials: unknown): { username?: string; password?: string } {
    if (typeof credentials === 'object' && credentials !== null) {
      const creds = credentials as Record<string, unknown>;
      
      if (typeof creds.username === 'string' && typeof creds.password === 'string') {
        return {
          username: creds.username,
          password: creds.password,
        };
      }

      if (typeof creds.authorization === 'string') {
        const match = creds.authorization.match(/^Basic\s+(.+)$/);
        if (match) {
          try {
            const decoded = atob(match[1]);
            const [username, password] = decoded.split(':', 2);
            return { username, password };
          } catch {
            return {};
          }
        }
      }
    }

    return {};
  }

  private extractAuthData(credentials: unknown): any {
    if (typeof credentials === 'object' && credentials !== null) {
      const creds = credentials as Record<string, unknown>;
      return {
        token: this.extractToken(credentials),
        user: creds.username || creds.user,
        permissions: creds.permissions || [],
      };
    }
    return {};
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }
}