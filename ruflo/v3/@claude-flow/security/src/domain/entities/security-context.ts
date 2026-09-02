/**
 * Security Context Entity - Domain Layer
 *
 * Represents security context for operations with validation and policy enforcement.
 *
 * @module v3/security/domain/entities
 */

import { randomUUID } from 'crypto';

/**
 * Permission levels
 */
export type PermissionLevel = 'read' | 'write' | 'execute' | 'admin';

/**
 * Security context properties
 */
export interface SecurityContextProps {
  id?: string;
  principalId: string;
  principalType: 'agent' | 'user' | 'system';
  permissions: PermissionLevel[];
  allowedPaths?: string[];
  blockedPaths?: string[];
  allowedCommands?: string[];
  blockedCommands?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
  createdAt?: Date;
}

/**
 * Security Context - Entity
 */
export class SecurityContext {
  private _id: string;
  private _principalId: string;
  private _principalType: 'agent' | 'user' | 'system';
  private _permissions: Set<PermissionLevel>;
  private _allowedPaths: Set<string>;
  private _blockedPaths: Set<string>;
  private _allowedCommands: Set<string>;
  private _blockedCommands: Set<string>;
  private _metadata: Record<string, unknown>;
  private _expiresAt?: Date;
  private _createdAt: Date;

  private constructor(props: SecurityContextProps) {
    this._id = props.id ?? randomUUID();
    this._principalId = props.principalId;
    this._principalType = props.principalType;
    this._permissions = new Set(props.permissions);
    this._allowedPaths = new Set(props.allowedPaths ?? []);
    this._blockedPaths = new Set(props.blockedPaths ?? []);
    this._allowedCommands = new Set(props.allowedCommands ?? []);
    this._blockedCommands = new Set(props.blockedCommands ?? []);
    this._metadata = props.metadata ?? {};
    this._expiresAt = props.expiresAt;
    this._createdAt = props.createdAt ?? new Date();
  }

  static create(props: SecurityContextProps): SecurityContext {
    return new SecurityContext(props);
  }

  static fromPersistence(props: SecurityContextProps): SecurityContext {
    return new SecurityContext(props);
  }

  get id(): string { return this._id; }
  get principalId(): string { return this._principalId; }
  get principalType(): string { return this._principalType; }
  get permissions(): PermissionLevel[] { return Array.from(this._permissions); }
  get allowedPaths(): string[] { return Array.from(this._allowedPaths); }
  get blockedPaths(): string[] { return Array.from(this._blockedPaths); }
  get allowedCommands(): string[] { return Array.from(this._allowedCommands); }
  get blockedCommands(): string[] { return Array.from(this._blockedCommands); }
  get metadata(): Record<string, unknown> { return { ...this._metadata }; }
  get expiresAt(): Date | undefined { return this._expiresAt; }
  get createdAt(): Date { return new Date(this._createdAt); }

  // Business Logic

  hasPermission(level: PermissionLevel): boolean {
    return this._permissions.has(level) || this._permissions.has('admin');
  }

  isExpired(): boolean {
    if (!this._expiresAt) return false;
    return Date.now() > this._expiresAt.getTime();
  }

  canAccessPath(path: string): boolean {
    if (this.isExpired()) return false;

    // Check blocked paths first
    for (const blocked of this._blockedPaths) {
      if (path.startsWith(blocked) || this.matchGlob(path, blocked)) {
        return false;
      }
    }

    // If no allowed paths specified, allow all non-blocked
    if (this._allowedPaths.size === 0) return true;

    // Check allowed paths
    for (const allowed of this._allowedPaths) {
      if (path.startsWith(allowed) || this.matchGlob(path, allowed)) {
        return true;
      }
    }

    return false;
  }

  canExecuteCommand(command: string): boolean {
    if (this.isExpired()) return false;

    const cmdBase = command.split(' ')[0];

    // Check blocked commands first
    if (this._blockedCommands.has(cmdBase) || this._blockedCommands.has(command)) {
      return false;
    }

    // If no allowed commands specified, allow all non-blocked
    if (this._allowedCommands.size === 0) return true;

    // Check allowed commands
    return this._allowedCommands.has(cmdBase) || this._allowedCommands.has(command);
  }

  private matchGlob(path: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(path);
  }

  grantPermission(level: PermissionLevel): void {
    this._permissions.add(level);
  }

  revokePermission(level: PermissionLevel): void {
    this._permissions.delete(level);
  }

  addAllowedPath(path: string): void {
    this._allowedPaths.add(path);
  }

  addBlockedPath(path: string): void {
    this._blockedPaths.add(path);
  }

  toPersistence(): Record<string, unknown> {
    return {
      id: this._id,
      principalId: this._principalId,
      principalType: this._principalType,
      permissions: Array.from(this._permissions),
      allowedPaths: Array.from(this._allowedPaths),
      blockedPaths: Array.from(this._blockedPaths),
      allowedCommands: Array.from(this._allowedCommands),
      blockedCommands: Array.from(this._blockedCommands),
      metadata: this._metadata,
      expiresAt: this._expiresAt?.toISOString(),
      createdAt: this._createdAt.toISOString(),
    };
  }
}
