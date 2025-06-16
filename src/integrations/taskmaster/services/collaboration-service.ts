import { EventEmitter } from 'events';
import { AIProviderManager } from './ai-provider.ts';
import { AIRequest } from '../types/ai-types.ts';

export type SessionId = string;
export type UserId = string;
export type ChangeEventId = string;

export interface CollaborationSession {
  id: SessionId;
  projectId: string;
  initiatorId: UserId;
  participants: UserId[];
  activeEditors: Map<string, UserId>;
  changeLog: ChangeEvent[];
  conflictResolver: ConflictResolver;
  createdAt: number;
  lastActivity: number;
  options: SessionOptions;
}

export interface SessionOptions {
  maxParticipants?: number;
  autoSave?: boolean;
  conflictResolution?: 'manual' | 'auto' | 'ai-assisted';
  permissions?: SessionPermissions;
  timeout?: number; // in minutes
}

export interface SessionPermissions {
  canEdit: UserId[];
  canView: UserId[];
  canInvite: UserId[];
  canManage: UserId[];
}

export interface ChangeEvent {
  id: ChangeEventId;
  type: ChangeType;
  userId: UserId;
  timestamp: number;
  data: any;
  metadata: ChangeMetadata;
}

export type ChangeType = 
  | 'task_create'
  | 'task_update' 
  | 'task_delete'
  | 'requirement_edit'
  | 'status_change'
  | 'assignment_change'
  | 'comment_add'
  | 'dependency_change';

export interface ChangeMetadata {
  resourceId: string;
  resourceType: string;
  operation: string;
  previousValue?: any;
  newValue: any;
  conflictPotential: number; // 0-1 score
  aiSuggestion?: string;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  involvedUsers: UserId[];
  conflictingChanges: ChangeEvent[];
  detectedAt: number;
  autoResolvable: boolean;
  suggestedResolution?: Resolution;
}

export type ConflictType = 
  | 'concurrent_edit'
  | 'dependency_violation'
  | 'permission_conflict'
  | 'data_inconsistency'
  | 'resource_lock'
  | 'business_rule_violation';

export interface Resolution {
  id: string;
  conflictId: string;
  strategy: ResolutionStrategy;
  resolvedBy: UserId | 'system';
  resolvedAt: number;
  finalValue: any;
  reasoning: string;
  confidence: number;
}

export type ResolutionStrategy = 
  | 'last_write_wins'
  | 'first_write_wins'
  | 'merge_values'
  | 'user_decision'
  | 'ai_resolution'
  | 'escalate_to_manager';

export interface User {
  id: UserId;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
  preferences: UserPreferences;
  currentSession?: SessionId;
}

export interface Permission {
  resource: string;
  action: string;
  scope: string;
}

export interface UserPreferences {
  conflictResolutionMode: 'manual' | 'auto' | 'ai-assisted';
  notificationSettings: NotificationSettings;
  collaborationStyle: 'active' | 'passive' | 'observer';
}

export interface NotificationSettings {
  emailNotifications: boolean;
  browserNotifications: boolean;
  conflictAlerts: boolean;
  mentionAlerts: boolean;
}

export class TeamCollaborationService extends EventEmitter {
  private sessions: Map<SessionId, CollaborationSession> = new Map();
  private userSessions: Map<UserId, Set<SessionId>> = new Map();
  private rtcConnections: Map<SessionId, RTCConnection> = new Map();
  private permissionManager: PermissionManager;
  private aiProvider: AIProviderManager;
  private conflictDetector: ConflictDetector;

  constructor(
    permissionManager: PermissionManager,
    aiProvider: AIProviderManager
  ) {
    super();
    this.permissionManager = permissionManager;
    this.aiProvider = aiProvider;
    this.conflictDetector = new ConflictDetector(aiProvider);
    this.setupCleanupScheduler();
  }

  async createCollaborationSession(
    projectId: string,
    initiatorId: UserId,
    options: SessionOptions = {}
  ): Promise<SessionId> {
    const sessionId = this.generateSessionId();
    
    // Check permissions
    const hasPermission = await this.permissionManager.checkProjectAccess(
      initiatorId,
      projectId,
      'create_session'
    );
    if (!hasPermission) {
      throw new Error(`User ${initiatorId} does not have permission to create session for project ${projectId}`);
    }

    // Create session
    const session: CollaborationSession = {
      id: sessionId,
      projectId,
      initiatorId,
      participants: [initiatorId],
      activeEditors: new Map(),
      changeLog: [],
      conflictResolver: new ConflictResolver(this.aiProvider),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      options: {
        maxParticipants: 10,
        autoSave: true,
        conflictResolution: 'ai-assisted',
        timeout: 240, // 4 hours
        ...options
      }
    };

    // Setup real-time communication
    const rtcConnection = await this.createRTCConnection(sessionId);
    this.rtcConnections.set(sessionId, rtcConnection);

    // Register session
    this.sessions.set(sessionId, session);
    this.addUserToSession(initiatorId, sessionId);

    // Emit session created event
    this.emit('sessionCreated', {
      sessionId,
      projectId,
      initiatorId,
      timestamp: Date.now()
    });

    return sessionId;
  }

  async joinSession(sessionId: SessionId, userId: UserId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check if session is full
    if (session.participants.length >= (session.options.maxParticipants || 10)) {
      throw new Error(`Session ${sessionId} is full`);
    }

    // Check permissions
    const hasPermission = await this.permissionManager.checkProjectAccess(
      userId,
      session.projectId,
      'join_session'
    );
    if (!hasPermission) {
      throw new Error(`User ${userId} does not have permission to join session ${sessionId}`);
    }

    // Add user to session
    if (!session.participants.includes(userId)) {
      session.participants.push(userId);
    }
    this.addUserToSession(userId, sessionId);

    // Update activity timestamp
    session.lastActivity = Date.now();

    // Notify other participants
    await this.broadcastToSession(sessionId, {
      type: 'user_joined',
      userId,
      timestamp: Date.now()
    }, userId);

    // Send current session state to new user
    await this.sendSessionState(sessionId, userId);

    // Emit user joined event
    this.emit('userJoined', {
      sessionId,
      userId,
      participantCount: session.participants.length,
      timestamp: Date.now()
    });
  }

  async leaveSession(sessionId: SessionId, userId: UserId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove user from participants
    const index = session.participants.indexOf(userId);
    if (index > -1) {
      session.participants.splice(index, 1);
    }

    // Remove from active editors
    for (const [resource, editorId] of session.activeEditors) {
      if (editorId === userId) {
        session.activeEditors.delete(resource);
      }
    }

    // Remove user session mapping
    this.removeUserFromSession(userId, sessionId);

    // Notify other participants
    await this.broadcastToSession(sessionId, {
      type: 'user_left',
      userId,
      timestamp: Date.now()
    }, userId);

    // Close session if no participants left
    if (session.participants.length === 0) {
      await this.closeSession(sessionId);
    } else {
      session.lastActivity = Date.now();
    }

    // Emit user left event
    this.emit('userLeft', {
      sessionId,
      userId,
      participantCount: session.participants.length,
      timestamp: Date.now()
    });
  }

  async broadcastChange(
    sessionId: SessionId,
    change: ChangeEvent,
    fromUserId: UserId
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Validate user is in session
    if (!session.participants.includes(fromUserId)) {
      throw new Error(`User ${fromUserId} is not in session ${sessionId}`);
    }

    // Check permissions for the change
    const hasPermission = await this.permissionManager.checkChangePermission(
      fromUserId,
      change
    );
    if (!hasPermission) {
      throw new Error(`User ${fromUserId} does not have permission for this change`);
    }

    // Detect conflicts before applying
    const conflicts = await this.conflictDetector.detectConflicts(
      change,
      session.changeLog
    );

    if (conflicts.length > 0) {
      // Handle conflicts
      const resolution = await this.handleConflicts(
        conflicts,
        change,
        session
      );

      if (resolution.requiresUserInput) {
        // Send conflict notification to involved users
        await this.notifyConflicts(conflicts, session);
        return;
      } else {
        // Apply auto-resolved change
        change = resolution.resolvedChange;
      }
    }

    // Add change to log
    session.changeLog.push(change);
    session.lastActivity = Date.now();

    // Update active editors
    if (change.type === 'task_update' || change.type === 'requirement_edit') {
      session.activeEditors.set(change.metadata.resourceId, fromUserId);
    }

    // Broadcast to all other participants
    const otherParticipants = session.participants.filter(id => id !== fromUserId);
    await Promise.all(
      otherParticipants.map(participantId =>
        this.sendChangeToUser(sessionId, participantId, change)
      )
    );

    // Auto-save if enabled
    if (session.options.autoSave) {
      await this.autoSaveSession(session);
    }

    // Emit change broadcasted event
    this.emit('changeBroadcasted', {
      sessionId,
      change,
      fromUserId,
      participantCount: otherParticipants.length,
      timestamp: Date.now()
    });
  }

  async handleConflict(
    conflictId: string,
    resolution: Resolution
  ): Promise<void> {
    const conflict = await this.getConflict(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    // Apply resolution
    await this.applyResolution(conflict, resolution);

    // Notify involved users
    await this.notifyResolution(conflict, resolution);

    // Emit conflict resolved event
    this.emit('conflictResolved', {
      conflictId,
      resolution,
      timestamp: Date.now()
    });
  }

  async getActiveUsers(sessionId: SessionId): Promise<User[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const users: User[] = [];
    for (const userId of session.participants) {
      const user = await this.getUserProfile(userId);
      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  async getSessionState(sessionId: SessionId): Promise<SessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      id: sessionId,
      projectId: session.projectId,
      participants: session.participants,
      activeEditors: Object.fromEntries(session.activeEditors),
      recentChanges: session.changeLog.slice(-10),
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      options: session.options
    };
  }

  async getConflicts(sessionId: SessionId): Promise<Conflict[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return await this.conflictDetector.getActiveConflicts(session);
  }

  // Private helper methods
  private async createRTCConnection(sessionId: SessionId): Promise<RTCConnection> {
    // Mock RTC connection implementation
    return new RTCConnection(sessionId);
  }

  private async broadcastToSession(
    sessionId: SessionId,
    message: any,
    excludeUserId?: UserId
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const rtcConnection = this.rtcConnections.get(sessionId);
    if (!rtcConnection) return;

    const recipients = session.participants.filter(id => id !== excludeUserId);
    
    await Promise.all(
      recipients.map(userId =>
        rtcConnection.sendToUser(userId, message)
      )
    );
  }

  private async sendSessionState(sessionId: SessionId, userId: UserId): Promise<void> {
    const sessionState = await this.getSessionState(sessionId);
    const rtcConnection = this.rtcConnections.get(sessionId);
    
    if (rtcConnection) {
      await rtcConnection.sendToUser(userId, {
        type: 'session_state',
        data: sessionState,
        timestamp: Date.now()
      });
    }
  }

  private async sendChangeToUser(
    sessionId: SessionId,
    userId: UserId,
    change: ChangeEvent
  ): Promise<void> {
    const rtcConnection = this.rtcConnections.get(sessionId);
    
    if (rtcConnection) {
      await rtcConnection.sendToUser(userId, {
        type: 'change_event',
        change,
        timestamp: Date.now()
      });
    }
  }

  private addUserToSession(userId: UserId, sessionId: SessionId): void {
    const userSessions = this.userSessions.get(userId) || new Set();
    userSessions.add(sessionId);
    this.userSessions.set(userId, userSessions);
  }

  private removeUserFromSession(userId: UserId, sessionId: SessionId): void {
    const userSessions = this.userSessions.get(userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessions.delete(userId);
      }
    }
  }

  private async closeSession(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up RTC connection
    const rtcConnection = this.rtcConnections.get(sessionId);
    if (rtcConnection) {
      await rtcConnection.close();
      this.rtcConnections.delete(sessionId);
    }

    // Remove session
    this.sessions.delete(sessionId);

    // Clean up user session mappings
    for (const userId of session.participants) {
      this.removeUserFromSession(userId, sessionId);
    }

    // Emit session closed event
    this.emit('sessionClosed', {
      sessionId,
      projectId: session.projectId,
      duration: Date.now() - session.createdAt,
      timestamp: Date.now()
    });
  }

  private async handleConflicts(
    conflicts: Conflict[],
    change: ChangeEvent,
    session: CollaborationSession
  ): Promise<ConflictResolution> {
    const resolutionMode = session.options.conflictResolution || 'ai-assisted';

    switch (resolutionMode) {
      case 'auto':
        return await this.autoResolveConflicts(conflicts, change);
      case 'ai-assisted':
        return await this.aiResolveConflicts(conflicts, change);
      case 'manual':
      default:
        return { requiresUserInput: true, conflicts };
    }
  }

  private async autoResolveConflicts(
    conflicts: Conflict[],
    change: ChangeEvent
  ): Promise<ConflictResolution> {
    // Simple auto-resolution: last write wins
    for (const conflict of conflicts) {
      if (conflict.autoResolvable) {
        const resolution: Resolution = {
          id: this.generateResolutionId(),
          conflictId: conflict.id,
          strategy: 'last_write_wins',
          resolvedBy: 'system',
          resolvedAt: Date.now(),
          finalValue: change.data,
          reasoning: 'Auto-resolved using last write wins strategy',
          confidence: 0.8
        };

        await this.applyResolution(conflict, resolution);
      }
    }

    return {
      requiresUserInput: false,
      resolvedChange: change,
      resolutions: conflicts.map(c => c.suggestedResolution).filter(Boolean)
    };
  }

  private async aiResolveConflicts(
    conflicts: Conflict[],
    change: ChangeEvent
  ): Promise<ConflictResolution> {
    try {
      // Use AI to resolve conflicts
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Resolve conflicts in collaborative editing session:

New Change:
- Type: ${change.type}
- User: ${change.userId}
- Resource: ${change.metadata.resourceId}
- Data: ${JSON.stringify(change.data)}

Conflicts:
${conflicts.map(c => `
- Type: ${c.type}
- Severity: ${c.severity}
- Involved Users: ${c.involvedUsers.join(', ')}
- Changes: ${c.conflictingChanges.length}
`).join('\n')}

Determine the best resolution strategy and provide:
1. Resolution strategy (merge_values, last_write_wins, etc.)
2. Final merged value
3. Reasoning for the decision
4. Confidence score (0-1)

Return JSON with resolution recommendations.`,
        systemPrompt: 'You are a conflict resolution expert for collaborative editing. Provide fair and logical resolutions that preserve user intent while maintaining data consistency.'
      };

      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const aiResolution = JSON.parse(response.content);

      // Apply AI-suggested resolutions
      const resolutions: Resolution[] = [];
      for (const conflict of conflicts) {
        const resolution: Resolution = {
          id: this.generateResolutionId(),
          conflictId: conflict.id,
          strategy: aiResolution.strategy,
          resolvedBy: 'system',
          resolvedAt: Date.now(),
          finalValue: aiResolution.finalValue,
          reasoning: aiResolution.reasoning,
          confidence: aiResolution.confidence || 0.7
        };

        await this.applyResolution(conflict, resolution);
        resolutions.push(resolution);
      }

      // Create resolved change with merged values
      const resolvedChange: ChangeEvent = {
        ...change,
        data: aiResolution.finalValue,
        metadata: {
          ...change.metadata,
          aiSuggestion: aiResolution.reasoning
        }
      };

      return {
        requiresUserInput: false,
        resolvedChange,
        resolutions
      };
    } catch (error) {
      console.warn('AI conflict resolution failed, falling back to manual:', error);
      return { requiresUserInput: true, conflicts };
    }
  }

  private async notifyConflicts(
    conflicts: Conflict[],
    session: CollaborationSession
  ): Promise<void> {
    const involvedUsers = new Set<UserId>();
    conflicts.forEach(c => c.involvedUsers.forEach(u => involvedUsers.add(u)));

    for (const userId of involvedUsers) {
      await this.sendChangeToUser(session.id, userId, {
        id: this.generateChangeId(),
        type: 'conflict_notification' as any,
        userId: 'system',
        timestamp: Date.now(),
        data: { conflicts },
        metadata: {
          resourceId: 'system',
          resourceType: 'conflict',
          operation: 'notify',
          newValue: conflicts,
          conflictPotential: 1
        }
      });
    }
  }

  private async notifyResolution(
    conflict: Conflict,
    resolution: Resolution
  ): Promise<void> {
    // Notify involved users about conflict resolution
    for (const userId of conflict.involvedUsers) {
      // Implementation depends on notification system
    }
  }

  private async applyResolution(conflict: Conflict, resolution: Resolution): Promise<void> {
    // Apply the resolution to the data
    // Implementation depends on the specific conflict type and resolution strategy
  }

  private async autoSaveSession(session: CollaborationSession): Promise<void> {
    // Auto-save session state
    try {
      // Implementation depends on persistence layer
      console.log(`Auto-saving session ${session.id}`);
    } catch (error) {
      console.error(`Auto-save failed for session ${session.id}:`, error);
    }
  }

  private async getConflict(conflictId: string): Promise<Conflict | null> {
    // Get conflict by ID
    // Implementation depends on conflict storage
    return null;
  }

  private async getUserProfile(userId: UserId): Promise<User | null> {
    // Get user profile
    // Implementation depends on user management system
    return null;
  }

  private generateSessionId(): SessionId {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateChangeId(): ChangeEventId {
    return `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateResolutionId(): string {
    return `resolution_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupCleanupScheduler(): void {
    // Clean up inactive sessions every hour
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, 60 * 60 * 1000); // 1 hour
  }

  private async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const timeout = 4 * 60 * 60 * 1000; // 4 hours

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > timeout) {
        await this.closeSession(sessionId);
      }
    }
  }
}

// Supporting classes
export class ConflictDetector {
  private aiProvider: AIProviderManager;

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
  }

  async detectConflicts(
    change: ChangeEvent,
    changeLog: ChangeEvent[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Check for concurrent edits on the same resource
    const recentChanges = changeLog
      .filter(c => 
        c.metadata.resourceId === change.metadata.resourceId &&
        Date.now() - c.timestamp < 30000 // Last 30 seconds
      );

    if (recentChanges.length > 0) {
      conflicts.push({
        id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'concurrent_edit',
        severity: 'medium',
        involvedUsers: [change.userId, ...recentChanges.map(c => c.userId)],
        conflictingChanges: [change, ...recentChanges],
        detectedAt: Date.now(),
        autoResolvable: true
      });
    }

    return conflicts;
  }

  async getActiveConflicts(session: CollaborationSession): Promise<Conflict[]> {
    // Return active conflicts for the session
    return [];
  }
}

export class ConflictResolver {
  private aiProvider: AIProviderManager;

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
  }

  async resolve(conflict: Conflict): Promise<Resolution> {
    // Implement conflict resolution logic
    return {
      id: `resolution_${Date.now()}`,
      conflictId: conflict.id,
      strategy: 'last_write_wins',
      resolvedBy: 'system',
      resolvedAt: Date.now(),
      finalValue: {},
      reasoning: 'Auto-resolved',
      confidence: 0.8
    };
  }
}

export class PermissionManager {
  async checkProjectAccess(
    userId: UserId,
    projectId: string,
    action: string
  ): Promise<boolean> {
    // Check if user has permission for the action on the project
    return true; // Mock implementation
  }

  async checkChangePermission(userId: UserId, change: ChangeEvent): Promise<boolean> {
    // Check if user has permission to make this change
    return true; // Mock implementation
  }
}

export class RTCConnection {
  private sessionId: SessionId;

  constructor(sessionId: SessionId) {
    this.sessionId = sessionId;
  }

  async sendToUser(userId: UserId, message: any): Promise<void> {
    // Send message to specific user via WebSocket/WebRTC
    console.log(`Sending to ${userId} in session ${this.sessionId}:`, message);
  }

  async close(): Promise<void> {
    // Close RTC connection
    console.log(`Closing RTC connection for session ${this.sessionId}`);
  }
}

// Additional interfaces
export interface SessionState {
  id: SessionId;
  projectId: string;
  participants: UserId[];
  activeEditors: Record<string, UserId>;
  recentChanges: ChangeEvent[];
  createdAt: number;
  lastActivity: number;
  options: SessionOptions;
}

export interface ConflictResolution {
  requiresUserInput: boolean;
  resolvedChange?: ChangeEvent;
  resolutions?: Resolution[];
  conflicts?: Conflict[];
}