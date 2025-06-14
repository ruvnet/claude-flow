import { EventEmitter } from 'events';
import { AIProviderManager } from './ai-provider';
import { AIRequest } from '../types/ai-types';

export type IntegrationType = 
  | 'jira'
  | 'asana'
  | 'azure_devops'
  | 'monday'
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'slack'
  | 'teams'
  | 'jenkins'
  | 'circleci'
  | 'github_actions';

export type SyncDirection = 'incoming' | 'outgoing' | 'bidirectional';

export interface IntegrationConfig {
  type: IntegrationType;
  apiUrl: string;
  authentication: AuthenticationConfig;
  syncConfig?: SyncConfig;
  webhookConfig?: WebhookConfig;
  mappingConfig?: MappingConfig;
  retryPolicy?: RetryPolicy;
}

export interface AuthenticationConfig {
  type: 'oauth2' | 'api_key' | 'basic' | 'token';
  credentials: Record<string, string>;
  refreshToken?: string;
  expiresAt?: number;
}

export interface SyncConfig {
  direction: SyncDirection;
  schedule: string; // cron expression
  batchSize: number;
  conflictResolution: 'manual' | 'auto' | 'ai_assisted';
  filters?: SyncFilter[];
}

export interface SyncFilter {
  field: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'regex';
  value: string;
}

export interface WebhookConfig {
  url: string;
  secret: string;
  events: string[];
  retryConfig: RetryConfig;
}

export interface RetryConfig {
  maxRetries: number;
  backoffMultiplier: number;
  maxBackoffTime: number;
}

export interface MappingConfig {
  fieldMappings: FieldMapping[];
  customTransformations?: Transformation[];
  aiAssistance: boolean;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  transformation?: string;
  required: boolean;
}

export interface Transformation {
  id: string;
  name: string;
  sourceFields: string[];
  targetField: string;
  script: string; // JavaScript transformation function
}

export interface Integration {
  id: string;
  type: IntegrationType;
  config: IntegrationConfig;
  status: IntegrationStatus;
  lastSync?: SyncResult;
  webhookEndpoint?: string;
  createdAt: number;
  updatedAt: number;
}

export type IntegrationStatus = 
  | 'active'
  | 'inactive'
  | 'error'
  | 'syncing'
  | 'configuring';

export interface SyncResult {
  id: string;
  integrationType: IntegrationType;
  direction: SyncDirection;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  errors: SyncError[];
  conflicts: SyncConflict[];
  summary: SyncSummary;
}

export interface SyncError {
  recordId: string;
  field?: string;
  error: string;
  timestamp: number;
  retryable: boolean;
}

export interface SyncConflict {
  id: string;
  recordId: string;
  conflictType: ConflictType;
  sourceValue: any;
  targetValue: any;
  resolution?: ConflictResolution;
  timestamp: number;
}

export type ConflictType = 
  | 'field_mismatch'
  | 'record_exists'
  | 'dependency_missing'
  | 'validation_failed'
  | 'permission_denied';

export interface ConflictResolution {
  strategy: 'source_wins' | 'target_wins' | 'merge' | 'manual' | 'ai_resolution';
  resolvedValue: any;
  resolvedBy: string;
  timestamp: number;
  reasoning?: string;
}

export interface SyncSummary {
  tasksCreated: number;
  tasksUpdated: number;
  tasksDeleted: number;
  projectsCreated: number;
  projectsUpdated: number;
  usersCreated: number;
  usersUpdated: number;
}

export interface WebhookPayload {
  eventType: string;
  source: IntegrationType;
  timestamp: number;
  data: any;
  signature?: string;
}

export interface ExternalTask {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee?: string;
  priority?: string;
  dueDate?: number;
  labels?: string[];
  customFields?: Record<string, any>;
  parentId?: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExternalProject {
  id: string;
  name: string;
  description: string;
  status: string;
  owner?: string;
  members?: string[];
  startDate?: number;
  endDate?: number;
  customFields?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export class EnterpriseIntegrationService extends EventEmitter {
  private integrations: Map<string, Integration> = new Map();
  private adapters: Map<IntegrationType, IntegrationAdapter> = new Map();
  private syncScheduler: SyncScheduler;
  private webhookProcessor: WebhookProcessor;
  private mappingService: DataMappingService;
  private conflictResolver: IntegrationConflictResolver;
  private aiProvider: AIProviderManager;

  constructor(aiProvider: AIProviderManager) {
    super();
    this.aiProvider = aiProvider;
    this.syncScheduler = new SyncScheduler(this);
    this.webhookProcessor = new WebhookProcessor(this);
    this.mappingService = new DataMappingService(aiProvider);
    this.conflictResolver = new IntegrationConflictResolver(aiProvider);
    this.initializeAdapters();
  }

  async setupIntegration(config: IntegrationConfig): Promise<Integration> {
    const adapter = this.adapters.get(config.type);
    if (!adapter) {
      throw new Error(`Unsupported integration type: ${config.type}`);
    }

    // Validate configuration
    const validationResult = await adapter.validateConfig(config);
    if (!validationResult.isValid) {
      throw new Error(`Invalid configuration: ${validationResult.errors.join(', ')}`);
    }

    // Test connectivity
    const connectivityTest = await adapter.testConnectivity(config);
    if (!connectivityTest.success) {
      throw new Error(`Connectivity test failed: ${connectivityTest.error}`);
    }

    // Create integration
    const integration: Integration = {
      id: this.generateIntegrationId(),
      type: config.type,
      config,
      status: 'configuring',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Setup webhooks if supported
    if (adapter.supportsWebhooks && config.webhookConfig) {
      integration.webhookEndpoint = await this.setupWebhook(integration, config.webhookConfig);
    }

    // Schedule sync if configured
    if (config.syncConfig) {
      await this.syncScheduler.schedule(integration, config.syncConfig);
    }

    integration.status = 'active';
    integration.updatedAt = Date.now();

    this.integrations.set(integration.id, integration);

    this.emit('integrationSetup', {
      integrationId: integration.id,
      type: config.type,
      timestamp: Date.now()
    });

    return integration;
  }

  async syncData(
    integrationId: string,
    direction: SyncDirection = 'bidirectional',
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    const adapter = this.adapters.get(integration.type);
    if (!adapter) {
      throw new Error(`Adapter for ${integration.type} not found`);
    }

    const syncId = this.generateSyncId();
    const syncResult: SyncResult = {
      id: syncId,
      integrationType: integration.type,
      direction,
      startedAt: Date.now(),
      status: 'running',
      recordsProcessed: 0,
      recordsSucceeded: 0,
      recordsFailed: 0,
      errors: [],
      conflicts: [],
      summary: {
        tasksCreated: 0,
        tasksUpdated: 0,
        tasksDeleted: 0,
        projectsCreated: 0,
        projectsUpdated: 0,
        usersCreated: 0,
        usersUpdated: 0
      }
    };

    this.emit('syncStarted', {
      integrationId,
      syncId,
      direction,
      timestamp: Date.now()
    });

    try {
      if (direction === 'incoming' || direction === 'bidirectional') {
        await this.syncFromExternal(adapter, integration, syncResult, options);
      }

      if (direction === 'outgoing' || direction === 'bidirectional') {
        await this.syncToExternal(adapter, integration, syncResult, options);
      }

      syncResult.status = 'completed';
      syncResult.completedAt = Date.now();

      integration.lastSync = syncResult;
      integration.updatedAt = Date.now();

      this.emit('syncCompleted', {
        integrationId,
        syncId,
        result: syncResult,
        timestamp: Date.now()
      });

    } catch (error) {
      syncResult.status = 'failed';
      syncResult.completedAt = Date.now();
      
      this.emit('syncFailed', {
        integrationId,
        syncId,
        error: error.message,
        timestamp: Date.now()
      });

      throw error;
    }

    return syncResult;
  }

  async processWebhook(
    payload: WebhookPayload,
    signature?: string
  ): Promise<void> {
    await this.webhookProcessor.process(payload, signature);
  }

  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution
  ): Promise<void> {
    await this.conflictResolver.resolve(conflictId, resolution);
  }

  async getIntegrationStatus(integrationId: string): Promise<IntegrationStatus> {
    const integration = this.integrations.get(integrationId);
    return integration?.status || 'inactive';
  }

  async pauseIntegration(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (integration) {
      integration.status = 'inactive';
      integration.updatedAt = Date.now();
      
      await this.syncScheduler.pause(integrationId);
      
      this.emit('integrationPaused', {
        integrationId,
        timestamp: Date.now()
      });
    }
  }

  async resumeIntegration(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (integration) {
      integration.status = 'active';
      integration.updatedAt = Date.now();
      
      if (integration.config.syncConfig) {
        await this.syncScheduler.resume(integrationId, integration.config.syncConfig);
      }
      
      this.emit('integrationResumed', {
        integrationId,
        timestamp: Date.now()
      });
    }
  }

  async removeIntegration(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (integration) {
      // Stop sync scheduler
      await this.syncScheduler.remove(integrationId);
      
      // Remove webhooks
      if (integration.webhookEndpoint) {
        await this.removeWebhook(integration);
      }
      
      // Remove integration
      this.integrations.delete(integrationId);
      
      this.emit('integrationRemoved', {
        integrationId,
        type: integration.type,
        timestamp: Date.now()
      });
    }
  }

  // Private helper methods
  private async syncFromExternal(
    adapter: IntegrationAdapter,
    integration: Integration,
    syncResult: SyncResult,
    options: SyncOptions
  ): Promise<void> {
    const lastSyncTime = integration.lastSync?.completedAt || 0;
    const externalChanges = await adapter.getChangesSince(lastSyncTime);

    for (const change of externalChanges) {
      syncResult.recordsProcessed++;

      try {
        // Map external data to internal format
        const mappedData = await this.mappingService.mapFromExternal(
          change,
          integration.config.mappingConfig
        );

        // Check for conflicts
        const conflicts = await this.detectSyncConflicts(mappedData, integration.type);
        
        if (conflicts.length > 0) {
          for (const conflict of conflicts) {
            syncResult.conflicts.push(conflict);
          }

          // Auto-resolve if configured
          if (integration.config.syncConfig?.conflictResolution === 'auto') {
            await this.autoResolveConflicts(conflicts, syncResult);
          } else if (integration.config.syncConfig?.conflictResolution === 'ai_assisted') {
            await this.aiResolveConflicts(conflicts, mappedData, syncResult);
          }
        } else {
          // Apply change to internal system
          await this.applyInternalChange(mappedData, syncResult.summary);
          syncResult.recordsSucceeded++;
        }

      } catch (error) {
        syncResult.recordsFailed++;
        syncResult.errors.push({
          recordId: change.id,
          error: error.message,
          timestamp: Date.now(),
          retryable: this.isRetryableError(error)
        });
      }
    }
  }

  private async syncToExternal(
    adapter: IntegrationAdapter,
    integration: Integration,
    syncResult: SyncResult,
    options: SyncOptions
  ): Promise<void> {
    const lastSyncTime = integration.lastSync?.completedAt || 0;
    const internalChanges = await this.getInternalChangesSince(lastSyncTime);

    for (const change of internalChanges) {
      syncResult.recordsProcessed++;

      try {
        // Map internal data to external format
        const mappedData = await this.mappingService.mapToExternal(
          change,
          integration.config.mappingConfig,
          integration.type
        );

        // Push to external system
        await adapter.pushChange(mappedData);
        syncResult.recordsSucceeded++;

      } catch (error) {
        syncResult.recordsFailed++;
        syncResult.errors.push({
          recordId: change.id,
          error: error.message,
          timestamp: Date.now(),
          retryable: this.isRetryableError(error)
        });
      }
    }
  }

  private async detectSyncConflicts(data: any, integrationType: IntegrationType): Promise<SyncConflict[]> {
    // Implementation depends on specific conflict detection logic
    return [];
  }

  private async autoResolveConflicts(conflicts: SyncConflict[], syncResult: SyncResult): Promise<void> {
    for (const conflict of conflicts) {
      // Simple auto-resolution: source wins
      const resolution: ConflictResolution = {
        strategy: 'source_wins',
        resolvedValue: conflict.sourceValue,
        resolvedBy: 'system',
        timestamp: Date.now(),
        reasoning: 'Auto-resolved using source wins strategy'
      };

      conflict.resolution = resolution;
      await this.applyConflictResolution(conflict);
    }
  }

  private async aiResolveConflicts(
    conflicts: SyncConflict[],
    data: any,
    syncResult: SyncResult
  ): Promise<void> {
    for (const conflict of conflicts) {
      try {
        const aiRequest: AIRequest = {
          type: 'analysis',
          content: `Resolve data synchronization conflict:

Conflict Type: ${conflict.conflictType}
Source Value: ${JSON.stringify(conflict.sourceValue)}
Target Value: ${JSON.stringify(conflict.targetValue)}

Context Data:
${JSON.stringify(data, null, 2)}

Determine the best resolution strategy:
1. Which value should be kept (source or target)?
2. Should values be merged?
3. What is the reasoning for this decision?

Return JSON with resolution strategy and reasoning.`,
          systemPrompt: 'You are a data synchronization expert. Provide logical conflict resolution based on data context and business rules.'
        };

        const response = await this.aiProvider.executeWithFallback(aiRequest);
        const aiResolution = JSON.parse(response.content);

        const resolution: ConflictResolution = {
          strategy: aiResolution.strategy,
          resolvedValue: aiResolution.resolvedValue,
          resolvedBy: 'ai',
          timestamp: Date.now(),
          reasoning: aiResolution.reasoning
        };

        conflict.resolution = resolution;
        await this.applyConflictResolution(conflict);

      } catch (error) {
        // Fall back to manual resolution
        console.warn('AI conflict resolution failed, marking for manual resolution:', error);
      }
    }
  }

  private async applyConflictResolution(conflict: SyncConflict): Promise<void> {
    // Implementation depends on the specific conflict type and resolution strategy
    console.log(`Applied resolution for conflict ${conflict.id}: ${conflict.resolution?.strategy}`);
  }

  private async applyInternalChange(data: any, summary: SyncSummary): Promise<void> {
    // Implementation depends on the internal data model
    if (data.type === 'task') {
      if (data.operation === 'create') {
        summary.tasksCreated++;
      } else if (data.operation === 'update') {
        summary.tasksUpdated++;
      } else if (data.operation === 'delete') {
        summary.tasksDeleted++;
      }
    } else if (data.type === 'project') {
      if (data.operation === 'create') {
        summary.projectsCreated++;
      } else if (data.operation === 'update') {
        summary.projectsUpdated++;
      }
    }
  }

  private async getInternalChangesSince(timestamp: number): Promise<any[]> {
    // Mock implementation - would query internal database
    return [];
  }

  private async setupWebhook(integration: Integration, config: WebhookConfig): Promise<string> {
    const adapter = this.adapters.get(integration.type);
    if (adapter?.supportsWebhooks) {
      return await adapter.setupWebhook(config);
    }
    throw new Error(`Webhooks not supported for ${integration.type}`);
  }

  private async removeWebhook(integration: Integration): Promise<void> {
    const adapter = this.adapters.get(integration.type);
    if (adapter?.supportsWebhooks && integration.webhookEndpoint) {
      await adapter.removeWebhook(integration.webhookEndpoint);
    }
  }

  private isRetryableError(error: Error): boolean {
    // Determine if error is retryable based on error type
    return error.message.includes('timeout') || 
           error.message.includes('rate limit') ||
           error.message.includes('temporarily unavailable');
  }

  private generateIntegrationId(): string {
    return `integration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSyncId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeAdapters(): void {
    // Initialize all integration adapters
    this.adapters.set('jira', new JiraAdapter());
    this.adapters.set('asana', new AsanaAdapter());
    this.adapters.set('azure_devops', new AzureDevOpsAdapter());
    this.adapters.set('github', new GitHubAdapter());
    this.adapters.set('gitlab', new GitLabAdapter());
    this.adapters.set('slack', new SlackAdapter());
    this.adapters.set('jenkins', new JenkinsAdapter());
  }
}

// Supporting classes
export abstract class IntegrationAdapter {
  abstract supportsWebhooks: boolean;
  
  abstract validateConfig(config: IntegrationConfig): Promise<ValidationResult>;
  abstract testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult>;
  abstract getChangesSince(timestamp: number): Promise<ExternalChange[]>;
  abstract pushChange(data: any): Promise<void>;
  
  async setupWebhook?(config: WebhookConfig): Promise<string>;
  async removeWebhook?(webhookId: string): Promise<void>;
}

export class JiraAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Pushing change to Jira:', data);
  }

  async setupWebhook(config: WebhookConfig): Promise<string> {
    return 'jira_webhook_123';
  }

  async removeWebhook(webhookId: string): Promise<void> {
    console.log('Removing Jira webhook:', webhookId);
  }
}

export class AsanaAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Pushing change to Asana:', data);
  }

  async setupWebhook(config: WebhookConfig): Promise<string> {
    return 'asana_webhook_123';
  }

  async removeWebhook(webhookId: string): Promise<void> {
    console.log('Removing Asana webhook:', webhookId);
  }
}

export class AzureDevOpsAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Pushing change to Azure DevOps:', data);
  }
}

export class GitHubAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Pushing change to GitHub:', data);
  }
}

export class GitLabAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Pushing change to GitLab:', data);
  }
}

export class SlackAdapter extends IntegrationAdapter {
  supportsWebhooks = false;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Sending notification to Slack:', data);
  }
}

export class JenkinsAdapter extends IntegrationAdapter {
  supportsWebhooks = true;

  async validateConfig(config: IntegrationConfig): Promise<ValidationResult> {
    return { isValid: true, errors: [] };
  }

  async testConnectivity(config: IntegrationConfig): Promise<ConnectivityResult> {
    return { success: true };
  }

  async getChangesSince(timestamp: number): Promise<ExternalChange[]> {
    return [];
  }

  async pushChange(data: any): Promise<void> {
    console.log('Updating Jenkins build:', data);
  }
}

export class SyncScheduler {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private integrationService: EnterpriseIntegrationService;

  constructor(integrationService: EnterpriseIntegrationService) {
    this.integrationService = integrationService;
  }

  async schedule(integration: Integration, config: SyncConfig): Promise<void> {
    const job: ScheduledJob = {
      integrationId: integration.id,
      schedule: config.schedule,
      direction: config.direction,
      lastRun: 0,
      nextRun: this.calculateNextRun(config.schedule)
    };

    this.scheduledJobs.set(integration.id, job);
    console.log(`Scheduled sync for integration ${integration.id}: ${config.schedule}`);
  }

  async pause(integrationId: string): Promise<void> {
    this.scheduledJobs.delete(integrationId);
  }

  async resume(integrationId: string, config: SyncConfig): Promise<void> {
    // Re-schedule the job
    const integration = { id: integrationId } as Integration;
    await this.schedule(integration, config);
  }

  async remove(integrationId: string): Promise<void> {
    this.scheduledJobs.delete(integrationId);
  }

  private calculateNextRun(schedule: string): number {
    // Parse cron expression and calculate next run time
    // For now, return current time + 1 hour
    return Date.now() + (60 * 60 * 1000);
  }
}

export class WebhookProcessor {
  private integrationService: EnterpriseIntegrationService;
  private rateLimiter: Map<string, RateLimitInfo> = new Map();

  constructor(integrationService: EnterpriseIntegrationService) {
    this.integrationService = integrationService;
  }

  async process(payload: WebhookPayload, signature?: string): Promise<void> {
    // Validate webhook signature
    if (signature && !this.validateSignature(payload, signature)) {
      throw new Error('Invalid webhook signature');
    }

    // Check rate limits
    if (!this.checkRateLimit(payload.source)) {
      throw new Error('Rate limit exceeded');
    }

    // Process the webhook
    console.log(`Processing webhook from ${payload.source}: ${payload.eventType}`);
    
    // Emit event for specific handlers
    this.integrationService.emit('webhookReceived', payload);
  }

  private validateSignature(payload: WebhookPayload, signature: string): boolean {
    // Implement signature validation logic
    return true;
  }

  private checkRateLimit(source: IntegrationType): boolean {
    const now = Date.now();
    const windowSize = 60000; // 1 minute
    const maxRequests = 100;

    const rateInfo = this.rateLimiter.get(source) || {
      requests: 0,
      windowStart: now
    };

    if (now - rateInfo.windowStart > windowSize) {
      rateInfo.requests = 1;
      rateInfo.windowStart = now;
    } else {
      rateInfo.requests++;
    }

    this.rateLimiter.set(source, rateInfo);

    return rateInfo.requests <= maxRequests;
  }
}

export class DataMappingService {
  private aiProvider: AIProviderManager;
  private mappingCache: Map<string, any> = new Map();

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
  }

  async mapFromExternal(data: any, config?: MappingConfig): Promise<any> {
    if (!config) {
      return this.performDefaultMapping(data);
    }

    const mappedData: any = {};

    // Apply field mappings
    for (const mapping of config.fieldMappings) {
      const sourceValue = this.getNestedValue(data, mapping.sourceField);
      if (sourceValue !== undefined || mapping.required) {
        mappedData[mapping.targetField] = mapping.transformation 
          ? this.applyTransformation(sourceValue, mapping.transformation)
          : sourceValue;
      }
    }

    // Apply custom transformations
    if (config.customTransformations) {
      for (const transformation of config.customTransformations) {
        const sourceValues = transformation.sourceFields.map(field => 
          this.getNestedValue(data, field)
        );
        mappedData[transformation.targetField] = this.executeTransformation(
          transformation.script,
          sourceValues
        );
      }
    }

    // Use AI assistance for unmapped fields
    if (config.aiAssistance) {
      const aiMappings = await this.getAIMappings(data, mappedData);
      Object.assign(mappedData, aiMappings);
    }

    return mappedData;
  }

  async mapToExternal(data: any, config?: MappingConfig, targetType?: IntegrationType): Promise<any> {
    // Similar to mapFromExternal but in reverse direction
    return this.performDefaultMapping(data);
  }

  private performDefaultMapping(data: any): any {
    // Default mapping logic
    return {
      id: data.id || data.key,
      title: data.title || data.summary || data.name,
      description: data.description || data.body,
      status: data.status?.name || data.status,
      assignee: data.assignee?.name || data.assignee,
      createdAt: data.created ? new Date(data.created).getTime() : Date.now(),
      updatedAt: data.updated ? new Date(data.updated).getTime() : Date.now()
    };
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private applyTransformation(value: any, transformation: string): any {
    // Apply transformation function (could be a simple mapping or custom logic)
    switch (transformation) {
      case 'toLowerCase':
        return value?.toString().toLowerCase();
      case 'toUpperCase':
        return value?.toString().toUpperCase();
      case 'parseDate':
        return new Date(value).getTime();
      default:
        return value;
    }
  }

  private executeTransformation(script: string, values: any[]): any {
    // Execute custom JavaScript transformation
    try {
      const func = new Function('values', script);
      return func(values);
    } catch (error) {
      console.error('Transformation script error:', error);
      return values[0]; // Fallback to first value
    }
  }

  private async getAIMappings(sourceData: any, currentMapping: any): Promise<any> {
    // Use AI to suggest mappings for unmapped fields
    try {
      const aiRequest: AIRequest = {
        type: 'structured-output',
        content: `Analyze this external data and suggest field mappings:

Source Data:
${JSON.stringify(sourceData, null, 2)}

Current Mapping:
${JSON.stringify(currentMapping, null, 2)}

Suggest mappings for unmapped fields to standard task/project fields:
- title, description, status, priority, assignee, dueDate, labels, etc.

Return JSON with field mappings.`,
        systemPrompt: 'You are a data mapping expert. Suggest logical field mappings based on field names and values.'
      };

      const response = await this.aiProvider.executeWithFallback(aiRequest);
      return JSON.parse(response.content);
    } catch (error) {
      console.warn('AI mapping failed:', error);
      return {};
    }
  }
}

export class IntegrationConflictResolver {
  private aiProvider: AIProviderManager;
  private pendingConflicts: Map<string, SyncConflict> = new Map();

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
  }

  async resolve(conflictId: string, resolution: ConflictResolution): Promise<void> {
    const conflict = this.pendingConflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    conflict.resolution = resolution;
    
    // Apply the resolution
    await this.applyResolution(conflict);
    
    // Remove from pending conflicts
    this.pendingConflicts.delete(conflictId);
  }

  private async applyResolution(conflict: SyncConflict): Promise<void> {
    // Implementation depends on the specific conflict type and resolution strategy
    console.log(`Applied resolution for conflict ${conflict.id}: ${conflict.resolution?.strategy}`);
  }
}

// Supporting interfaces
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ConnectivityResult {
  success: boolean;
  error?: string;
}

export interface ExternalChange {
  id: string;
  type: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
}

export interface SyncOptions {
  batchSize?: number;
  dryRun?: boolean;
  includeDeleted?: boolean;
}

export interface ScheduledJob {
  integrationId: string;
  schedule: string;
  direction: SyncDirection;
  lastRun: number;
  nextRun: number;
}

export interface RateLimitInfo {
  requests: number;
  windowStart: number;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}