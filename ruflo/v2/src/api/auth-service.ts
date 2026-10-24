/**
 * Authentication and authorization service for swarm coordination system
 * Provides secure access control with JWT tokens, API keys, and role-based permissions
 */

import { ILogger } from '../core/logger.js';
import { AuthenticationError } from '../utils/errors.js';
import { nanoid } from 'nanoid';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn?: string; // Default: '24h'
  apiKeyLength?: number; // Default: 32
  bcryptRounds?: number; // Default: 12
  sessionTimeout?: number; // Default: 3600000 (1 hour)
  maxLoginAttempts?: number; // Default: 5
  lockoutDuration?: number; // Default: 900000 (15 minutes)
  requireMFA?: boolean; // Default: false
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  permissions: Permission[];
  apiKeys: ApiKey[];
  isActive: boolean;
  lastLogin?: Date;
  loginAttempts: number;
  lockedUntil?: Date;
  mfaSecret?: string;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  key: string;
  keyHash: string;
  name: string;
  permissions: Permission[];
  expiresAt?: Date;
  lastUsed?: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface AuthToken {
  token: string;
  type: 'jwt' | 'api_key';
  userId?: string;
  apiKeyId?: string;
  permissions: Permission[];
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  clientInfo?: {
    userAgent?: string;
    ip?: string;
    device?: string;
  };
  isActive: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 
  | 'admin'       // Full system access
  | 'operator'    // Can manage swarms and agents
  | 'developer'   // Can create and monitor tasks
  | 'viewer'      // Read-only access
  | 'service';    // Service-to-service authentication

export type Permission = 
  | 'swarm.create'
  | 'swarm.read'
  | 'swarm.update'
  | 'swarm.delete'
  | 'swarm.scale'
  | 'agent.spawn'
  | 'agent.read'
  | 'agent.terminate'
  | 'task.create'
  | 'task.read'
  | 'task.cancel'
  | 'metrics.read'
  | 'system.admin'
  | 'api.access';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'swarm.create', 'swarm.read', 'swarm.update', 'swarm.delete', 'swarm.scale',
    'agent.spawn', 'agent.read', 'agent.terminate',
    'task.create', 'task.read', 'task.cancel',
    'metrics.read', 'system.admin', 'api.access'
  ],
  operator: [
    'swarm.create', 'swarm.read', 'swarm.update', 'swarm.scale',
    'agent.spawn', 'agent.read', 'agent.terminate',
    'task.create', 'task.read', 'task.cancel',
    'metrics.read', 'api.access'
  ],
  developer: [
    'swarm.read', 'agent.read',
    'task.create', 'task.read', 'task.cancel',
    'metrics.read', 'api.access'
  ],
  viewer: [
    'swarm.read', 'agent.read', 'task.read', 'metrics.read', 'api.access'
  ],
  service: [
    'api.access'
  ]
};

/**
 * Authentication service implementation
 */
export class AuthService {
  private users = new Map<string, User>();
  private sessions = new Map<string, AuthSession>();
  private apiKeys = new Map<string, ApiKey>();
  private loginAttempts = new Map<string, { count: number; lastAttempt: Date }>();

  constructor(
    private config: AuthConfig,
    private logger: ILogger,
  ) {
    this.initializeDefaultUsers();
  }

  /**
   * Authenticate user with email and password
   */
  async authenticateUser(email: string, password: string, clientInfo?: {
    userAgent?: string;
    ip?: string;
    device?: string;
  }): Promise<{ user: User; token: string; session: AuthSession }> {
    try {
      // Check for rate limiting
      await this.checkRateLimit(email);

      // Find user
      const user = Array.from(this.users.values()).find(u => u.email === email);
      if (!user) {
        await this.recordFailedLogin(email);
        throw new AuthenticationError('Invalid credentials');
      }

      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AuthenticationError('Account locked due to too many failed attempts');
      }

      // Check if account is active
      if (!user.isActive) {
        throw new AuthenticationError('Account is disabled');
      }

      // Verify password
      const isValid = await this.verifyPassword(password, user.passwordHash);
      if (!isValid) {
        await this.recordFailedLogin(email);
        throw new AuthenticationError('Invalid credentials');
      }

      // Reset login attempts on successful authentication
      this.loginAttempts.delete(email);
      user.loginAttempts = 0;
      user.lockedUntil = undefined;
      user.lastLogin = new Date();

      // Create session
      const session = await this.createSession(user.id, clientInfo);

      // Generate JWT token
      const token = await this.generateJWT(user, session.id);

      this.logger.info('User authenticated successfully', {
        userId: user.id,
        email: user.email,
        sessionId: session.id,
      });

      return { user, token, session };
    } catch (error) {
      this.logger.error('Authentication failed', {
        email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Authenticate API key
   */
  async authenticateApiKey(apiKey: string): Promise<{ key: ApiKey; user?: User }> {
    try {
      // Hash the provided key to compare with stored hash
      const keyHash = this.hashApiKey(apiKey);
      
      // Find matching API key
      const storedKey = Array.from(this.apiKeys.values()).find(k => 
        this.constantTimeCompare(k.keyHash, keyHash)
      );

      if (!storedKey) {
        throw new AuthenticationError('Invalid API key');
      }

      // Check if key is active
      if (!storedKey.isActive) {
        throw new AuthenticationError('API key is disabled');
      }

      // Check if key is expired
      if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
        throw new AuthenticationError('API key has expired');
      }

      // Update last used timestamp
      storedKey.lastUsed = new Date();

      // Find associated user (if any)
      const user = Array.from(this.users.values()).find(u => 
        u.apiKeys.some(k => k.id === storedKey.id)
      );

      this.logger.info('API key authenticated successfully', {
        keyId: storedKey.id,
        keyName: storedKey.name,
        userId: user?.id,
      });

      return { key: storedKey, user };
    } catch (error) {
      this.logger.error('API key authentication failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  async verifyJWT(token: string): Promise<{ user: User; session: AuthSession }> {
    try {
      const payload = this.decodeJWT(token);
      
      if (!payload.userId || !payload.sessionId) {
        throw new AuthenticationError('Invalid token payload');
      }

      // Check if session exists and is active
      const session = this.sessions.get(payload.sessionId);
      if (!session || !session.isActive) {
        throw new AuthenticationError('Invalid or expired session');
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        session.isActive = false;
        throw new AuthenticationError('Session expired');
      }

      // Get user
      const user = this.users.get(payload.userId);
      if (!user || !user.isActive) {
        throw new AuthenticationError('User not found or inactive');
      }

      // Update session activity
      session.updatedAt = new Date();

      return { user, session };
    } catch (error) {
      this.logger.error('JWT verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check if user has required permission
   */
  hasPermission(userOrPermissions: User | Permission[], requiredPermission: Permission): boolean {
    const permissions = Array.isArray(userOrPermissions) 
      ? userOrPermissions 
      : userOrPermissions.permissions;
    
    return permissions.includes(requiredPermission) || permissions.includes('system.admin');
  }

  /**
   * Create new user
   */
  async createUser(userData: {
    email: string;
    password: string;
    role: UserRole;
    isActive?: boolean;
  }): Promise<User> {
    // Check if email already exists
    const existingUser = Array.from(this.users.values()).find(u => u.email === userData.email);
    if (existingUser) {
      throw new AuthenticationError('Email already exists');
    }

    const userId = `user_${Date.now()}_${nanoid(8)}`;
    const passwordHash = await this.hashPassword(userData.password);
    const permissions = ROLE_PERMISSIONS[userData.role] || [];

    const user: User = {
      id: userId,
      email: userData.email,
      passwordHash,
      role: userData.role,
      permissions,
      apiKeys: [],
      isActive: userData.isActive ?? true,
      loginAttempts: 0,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(userId, user);

    this.logger.info('User created', {
      userId,
      email: userData.email,
      role: userData.role,
    });

    return user;
  }

  /**
   * Create API key for user
   */
  async createApiKey(userId: string, keyData: {
    name: string;
    permissions?: Permission[];
    expiresAt?: Date;
  }): Promise<{ apiKey: ApiKey; key: string }> {
    const user = this.users.get(userId);
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    const key = this.generateApiKey();
    const keyHash = this.hashApiKey(key);
    const keyId = `key_${Date.now()}_${nanoid(8)}`;

    const permissions = keyData.permissions || user.permissions;

    const apiKey: ApiKey = {
      id: keyId,
      key: key.substring(0, 8) + '...',  // Store only prefix for display
      keyHash,
      name: keyData.name,
      permissions,
      expiresAt: keyData.expiresAt,
      isActive: true,
      createdAt: new Date(),
    };

    // Add to user's API keys
    user.apiKeys.push(apiKey);
    
    // Store in global API keys map
    this.apiKeys.set(keyId, apiKey);

    this.logger.info('API key created', {
      userId,
      keyId,
      keyName: keyData.name,
    });

    return { apiKey, key };
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(keyId: string): Promise<void> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      throw new AuthenticationError('API key not found');
    }

    apiKey.isActive = false;
    
    // Remove from user's keys
    const user = Array.from(this.users.values()).find(u => 
      u.apiKeys.some(k => k.id === keyId)
    );
    if (user) {
      user.apiKeys = user.apiKeys.filter(k => k.id !== keyId);
    }

    this.logger.info('API key revoked', {
      keyId,
      keyName: apiKey.name,
      userId: user?.id,
    });
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.logger.info('Session invalidated', {
        sessionId,
        userId: session.userId,
      });
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupSessions(): Promise<void> {
    const now = new Date();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      if (!session.isActive || session.expiresAt < now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired sessions', { count: cleaned });
    }
  }

  /**
   * Get user by ID
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * List all users (admin only)
   */
  listUsers(): User[] {
    return Array.from(this.users.values());
  }

  // Private helper methods
  private async checkRateLimit(email: string): Promise<void> {
    const attempts = this.loginAttempts.get(email);
    const maxAttempts = this.config.maxLoginAttempts || 5;
    const lockoutDuration = this.config.lockoutDuration || 900000; // 15 minutes

    if (attempts && attempts.count >= maxAttempts) {
      const timeSinceLastAttempt = Date.now() - attempts.lastAttempt.getTime();
      if (timeSinceLastAttempt < lockoutDuration) {
        throw new AuthenticationError('Too many failed login attempts. Please try again later.');
      } else {
        // Reset attempts after lockout period
        this.loginAttempts.delete(email);
      }
    }
  }

  private async recordFailedLogin(email: string): Promise<void> {
    const attempts = this.loginAttempts.get(email) || { count: 0, lastAttempt: new Date() };
    attempts.count++;
    attempts.lastAttempt = new Date();
    this.loginAttempts.set(email, attempts);
  }

  private async createSession(userId: string, clientInfo?: {
    userAgent?: string;
    ip?: string;
    device?: string;
  }): Promise<AuthSession> {
    const sessionId = `session_${Date.now()}_${nanoid(16)}`;
    const sessionTimeout = this.config.sessionTimeout || 3600000; // 1 hour
    const expiresAt = new Date(Date.now() + sessionTimeout);

    const session: AuthSession = {
      id: sessionId,
      userId,
      token: nanoid(32),
      clientInfo,
      isActive: true,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private async generateJWT(user: User, sessionId: string): Promise<string> {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      sessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
    };

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = createHmac('sha256', this.config.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private decodeJWT(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthenticationError('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    
    // Verify signature
    const expectedSignature = createHmac('sha256', this.config.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    if (!this.constantTimeCompare(signature, expectedSignature)) {
      throw new AuthenticationError('Invalid token signature');
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AuthenticationError('Token expired');
    }

    return payload;
  }

  private generateApiKey(): string {
    const length = this.config.apiKeyLength || 32;
    return nanoid(length);
  }

  private hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    // In a real implementation, use bcrypt
    return createHash('sha256').update(password + 'salt').digest('hex');
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    // In a real implementation, use bcrypt.compare
    const passwordHash = createHash('sha256').update(password + 'salt').digest('hex');
    return this.constantTimeCompare(passwordHash, hash);
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    const bufferA = Buffer.from(a, 'hex');
    const bufferB = Buffer.from(b, 'hex');
    
    return timingSafeEqual(bufferA, bufferB);
  }

  private initializeDefaultUsers(): void {
    // Create default admin user
    const adminId = 'admin_default';
    const adminUser: User = {
      id: adminId,
      email: 'admin@claude-flow.local',
      passwordHash: createHash('sha256').update('admin123' + 'salt').digest('hex'),
      role: 'admin',
      permissions: ROLE_PERMISSIONS.admin,
      apiKeys: [],
      isActive: true,
      loginAttempts: 0,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(adminId, adminUser);

    // Create default service user
    const serviceId = 'service_default';
    const serviceUser: User = {
      id: serviceId,
      email: 'service@claude-flow.local',
      passwordHash: createHash('sha256').update('service123' + 'salt').digest('hex'),
      role: 'service',
      permissions: ROLE_PERMISSIONS.service,
      apiKeys: [],
      isActive: true,
      loginAttempts: 0,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(serviceId, serviceUser);

    this.logger.info('Default users initialized', {
      admin: adminUser.email,
      service: serviceUser.email,
    });
  }
}