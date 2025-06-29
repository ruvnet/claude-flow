/**
 * Advanced Interface Patterns for TypeScript Strict Compliance
 * Interface Design Agent #6 - Complex Generic Interfaces & Patterns
 */

// ===== CONDITIONAL TYPE INTERFACES =====

/**
 * Conditional interface based on configuration
 */
export interface ConditionalConfig<T extends 'development' | 'production'> {
  environment: T;
  debug: T extends 'development' ? true : false;
  optimization: T extends 'production' ? true : false;
  logging: T extends 'development' ? 'verbose' : 'error';
}

/**
 * Conditional agent capabilities based on agent type
 */
export interface AgentCapabilities<T extends string> {
  type: T;
  core: T extends 'coordinator' ? CoordinatorCapabilities :
        T extends 'researcher' ? ResearcherCapabilities :
        T extends 'developer' ? DeveloperCapabilities :
        T extends 'tester' ? TesterCapabilities :
        BaseCapabilities;
}

interface CoordinatorCapabilities {
  taskDistribution: true;
  agentManagement: true;
  resourceAllocation: true;
  monitoring: true;
}

interface ResearcherCapabilities {
  webSearch: true;
  dataAnalysis: true;
  reportGeneration: true;
  sourceValidation: true;
}

interface DeveloperCapabilities {
  codeGeneration: true;
  debugging: true;
  testing: true;
  refactoring: true;
}

interface TesterCapabilities {
  testGeneration: true;
  testExecution: true;
  coverageAnalysis: true;
  performanceTesting: true;
}

interface BaseCapabilities {
  communication: true;
  taskExecution: true;
}

// ===== GENERIC STATE MANAGEMENT INTERFACES =====

/**
 * Generic state container with type-safe operations
 */
export interface StateContainer<T extends Record<string, any>> {
  state: T;
  subscribe<K extends keyof T>(
    key: K,
    callback: (value: T[K], previous: T[K]) => void
  ): () => void;
  update<K extends keyof T>(
    key: K,
    updater: (current: T[K]) => T[K]
  ): void;
  patch(updates: Partial<T>): void;
  reset(): void;
}

/**
 * Generic event emitter with typed events
 */
export interface TypedEventEmitter<TEvents extends Record<string, any>> {
  on<K extends keyof TEvents>(
    event: K,
    listener: (data: TEvents[K]) => void
  ): this;
  
  off<K extends keyof TEvents>(
    event: K,
    listener: (data: TEvents[K]) => void
  ): this;
  
  emit<K extends keyof TEvents>(
    event: K,
    data: TEvents[K]
  ): boolean;
  
  once<K extends keyof TEvents>(
    event: K,
    listener: (data: TEvents[K]) => void
  ): this;
}

// ===== UTILITY TYPE PATTERNS =====

/**
 * Make specific properties optional while keeping others required
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific properties required while keeping others optional
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Deep readonly type
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T[P] extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T[P] extends object
    ? DeepReadonly<T[P]>
    : T[P];
};

/**
 * Deep partial type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

/**
 * Strict exact type that prevents extra properties
 */
export type Exact<T, U extends T = T> = U & Record<Exclude<keyof U, keyof T>, never>;

/**
 * Safe optional property assignment for exactOptionalPropertyTypes
 */
export type SafeOptional<T> = {
  [K in keyof T]: T[K] extends undefined ? never : T[K];
} & {
  [K in keyof T as T[K] extends undefined ? K : never]?: T[K];
};

// ===== INTERFACE INHERITANCE PATTERNS =====

/**
 * Base entity interface with common properties
 */
export interface BaseEntity {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

/**
 * Trackable interface for entities that need lifecycle tracking
 */
export interface Trackable extends BaseEntity {
  readonly status: 'active' | 'inactive' | 'archived';
  readonly lastAccessedAt?: Date;
  readonly accessCount: number;
}

/**
 * Auditable interface for entities that need audit trails
 */
export interface Auditable extends BaseEntity {
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly auditTrail: AuditEntry[];
}

export interface AuditEntry {
  readonly timestamp: Date;
  readonly action: 'created' | 'updated' | 'deleted' | 'accessed';
  readonly userId: string;
  readonly changes?: Record<string, { from: any; to: any }>;
  readonly metadata?: Record<string, any>;
}

/**
 * Generic repository interface with CRUD operations
 */
export interface Repository<T extends BaseEntity, TCreateInput = Omit<T, keyof BaseEntity>, TUpdateInput = Partial<TCreateInput>> {
  create(input: TCreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findMany(criteria?: Partial<T>): Promise<T[]>;
  update(id: string, input: TUpdateInput): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count(criteria?: Partial<T>): Promise<number>;
}

// ===== TASK AND WORKFLOW INTERFACES =====

/**
 * Generic task interface with flexible input/output types
 */
export interface GenericTask<TInput = any, TOutput = any, TError = Error> {
  readonly id: string;
  readonly type: string;
  readonly status: TaskStatus;
  readonly input: TInput;
  readonly output?: TOutput;
  readonly error?: TError;
  readonly metadata: TaskMetadata;
  readonly dependencies: readonly string[];
  readonly constraints: TaskConstraints;
}

export type TaskStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying';

export interface TaskMetadata {
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly duration?: number;
  readonly retryCount: number;
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
  readonly tags: readonly string[];
  readonly assignedTo?: string;
}

export interface TaskConstraints {
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly requiredCapabilities: readonly string[];
  readonly resourceLimits?: ResourceLimits;
  readonly scheduling?: SchedulingConstraints;
}

export interface ResourceLimits {
  readonly maxMemoryMB?: number;
  readonly maxCpuCores?: number;
  readonly maxDurationMs?: number;
}

export interface SchedulingConstraints {
  readonly notBefore?: Date;
  readonly notAfter?: Date;
  readonly preferredAgents?: readonly string[];
  readonly excludedAgents?: readonly string[];
}

// ===== COMMUNICATION INTERFACES =====

/**
 * Generic message interface with typed payloads
 */
export interface TypedMessage<TType extends string, TPayload = any> {
  readonly id: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly source: string;
  readonly target?: string;
  readonly timestamp: Date;
  readonly correlationId?: string;
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly metadata?: Record<string, any>;
}

/**
 * Message handler interface with type safety
 */
export interface MessageHandler<TMessage extends TypedMessage<string, any>> {
  canHandle(message: TypedMessage<string, any>): message is TMessage;
  handle(message: TMessage): Promise<void>;
  readonly priority: number;
  readonly timeout?: number;
}

/**
 * Message router interface
 */
export interface MessageRouter<TMessageTypes extends Record<string, any>> {
  register<K extends keyof TMessageTypes>(
    type: K,
    handler: MessageHandler<TypedMessage<K, TMessageTypes[K]>>
  ): void;
  
  unregister<K extends keyof TMessageTypes>(type: K): void;
  
  route<K extends keyof TMessageTypes>(
    message: TypedMessage<K, TMessageTypes[K]>
  ): Promise<void>;
  
  broadcast<K extends keyof TMessageTypes>(
    type: K,
    payload: TMessageTypes[K],
    options?: BroadcastOptions
  ): Promise<void>;
}

export interface BroadcastOptions {
  readonly excludeTargets?: readonly string[];
  readonly includeTargets?: readonly string[];
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly timeout?: number;
}

// ===== PLUGIN AND EXTENSION INTERFACES =====

/**
 * Generic plugin interface
 */
export interface Plugin<TConfig = any, TApi = any> {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly dependencies?: readonly string[];
  
  initialize(config: TConfig): Promise<void>;
  activate(api: TApi): Promise<void>;
  deactivate(): Promise<void>;
  destroy(): Promise<void>;
  
  readonly isActive: boolean;
  readonly health: PluginHealth;
}

export interface PluginHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly lastCheck: Date;
  readonly issues?: readonly string[];
  readonly metrics?: Record<string, number>;
}

/**
 * Extension point interface for extensible systems
 */
export interface ExtensionPoint<T> {
  readonly name: string;
  readonly type: string;
  register(extension: T): void;
  unregister(extensionId: string): void;
  getExtensions(): readonly T[];
  execute<TArgs extends any[], TReturn>(
    method: keyof T,
    ...args: TArgs
  ): Promise<TReturn[]>;
}

// ===== CONFIGURATION INTERFACES =====

/**
 * Type-safe configuration interface with validation
 */
export interface TypedConfig<T extends Record<string, any>> {
  readonly schema: ConfigSchema<T>;
  readonly values: T;
  
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  update(updates: Partial<T>): void;
  validate(): ConfigValidationResult;
  reset(): void;
  export(): string;
  import(data: string): void;
}

export interface ConfigSchema<T> {
  readonly properties: {
    [K in keyof T]: ConfigProperty<T[K]>;
  };
  readonly required?: readonly (keyof T)[];
}

export interface ConfigProperty<T> {
  readonly type: ConfigPropertyType;
  readonly description?: string;
  readonly default?: T;
  readonly validator?: (value: T) => boolean | string;
  readonly options?: readonly T[];
  readonly min?: number;
  readonly max?: number;
}

export type ConfigPropertyType = 
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum';

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ConfigValidationError[];
  readonly warnings: readonly ConfigValidationWarning[];
}

export interface ConfigValidationError {
  readonly path: string;
  readonly message: string;
  readonly value: any;
}

export interface ConfigValidationWarning {
  readonly path: string;
  readonly message: string;
  readonly suggestion?: string;
}

// ===== MONITORING AND METRICS INTERFACES =====

/**
 * Generic metrics collector interface
 */
export interface MetricsCollector<TMetrics extends Record<string, number | string | boolean>> {
  collect(): Promise<TMetrics>;
  getMetricNames(): readonly (keyof TMetrics)[];
  getMetricType(name: keyof TMetrics): 'counter' | 'gauge' | 'histogram' | 'summary';
  reset(): void;
}

/**
 * Health check interface
 */
export interface HealthCheck {
  readonly name: string;
  readonly description?: string;
  readonly timeout?: number;
  
  check(): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  readonly status: 'pass' | 'fail' | 'warn';
  readonly message?: string;
  readonly details?: Record<string, any>;
  readonly timestamp: Date;
  readonly duration: number;
}

// ===== ERROR HANDLING INTERFACES =====

/**
 * Structured error interface with context
 */
export interface StructuredError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly context: Record<string, any>;
  readonly timestamp: Date;
  readonly correlationId?: string;
  readonly cause?: Error;
  readonly recoverable: boolean;
}

export type ErrorCategory = 
  | 'validation'
  | 'business'
  | 'technical'
  | 'security'
  | 'external'
  | 'unknown';

export type ErrorSeverity = 
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/**
 * Error handler interface
 */
export interface ErrorHandler<TError extends Error = Error> {
  canHandle(error: Error): error is TError;
  handle(error: TError): Promise<ErrorHandlingResult>;
  readonly priority: number;
}

export interface ErrorHandlingResult {
  readonly handled: boolean;
  readonly recovered: boolean;
  readonly retry: boolean;
  readonly escalate: boolean;
  readonly metadata?: Record<string, any>;
}

// ===== TYPE EXPORTS =====

export type {
  // Conditional types
  ConditionalConfig,
  AgentCapabilities,
  
  // State management
  StateContainer,
  TypedEventEmitter,
  
  // Utility types
  PartialBy,
  RequiredBy,
  DeepReadonly,
  DeepPartial,
  Exact,
  SafeOptional,
  
  // Base patterns
  BaseEntity,
  Trackable,
  Auditable,
  Repository,
  
  // Task patterns
  GenericTask,
  TaskStatus,
  TaskMetadata,
  TaskConstraints,
  
  // Communication
  TypedMessage,
  MessageHandler,
  MessageRouter,
  
  // Plugin system
  Plugin,
  ExtensionPoint,
  
  // Configuration
  TypedConfig,
  ConfigSchema,
  
  // Monitoring
  MetricsCollector,
  HealthCheck,
  
  // Error handling
  StructuredError,
  ErrorHandler
};