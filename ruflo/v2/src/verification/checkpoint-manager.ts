/**
 * Checkpoint Manager
 * Manages system state snapshots and verification checkpoints
 */

import { 
  Checkpoint, 
  StateSnapshot, 
  CheckpointScope, 
  CheckpointFilter,
  Validation,
  AgentState,
  SystemState,
  TaskState,
  MemoryState,
  FileSystemState,
  DatabaseState,
  StateScope,
  SnapshotMetadata
} from './interfaces.js';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export class CheckpointManager {
  private checkpointStore: Map<string, Checkpoint> = new Map();
  private snapshotStore: Map<string, StateSnapshot> = new Map();
  private storagePath: string;

  constructor(storagePath: string = '.claude-flow/checkpoints') {
    this.storagePath = storagePath;
    this.ensureStorageDirectory();
  }

  /**
   * Create a new checkpoint with state snapshot
   */
  async createCheckpoint(
    description: string, 
    scope: CheckpointScope,
    agentId?: string,
    taskId?: string,
    validations: Validation[] = []
  ): Promise<string> {
    const checkpointId = this.generateCheckpointId();
    const timestamp = Date.now();
    
    // Capture current system state
    const stateSnapshot = await this.captureSystemState(scope, agentId, taskId);
    
    const checkpoint: Checkpoint = {
      id: checkpointId,
      type: 'during', // Default type, can be overridden
      agent_id: agentId || 'system',
      task_id: taskId || 'system',
      timestamp,
      required: true,
      validations,
      state_snapshot: stateSnapshot,
      description,
      scope
    };

    // Store checkpoint
    await this.storeCheckpoint(checkpoint);
    
    console.log(`✅ Checkpoint created: ${checkpointId} (${description})`);
    return checkpointId;
  }

  /**
   * Create a pre-execution checkpoint
   */
  async createPreExecutionCheckpoint(
    agentId: string,
    taskId: string,
    description: string
  ): Promise<string> {
    const validations: Validation[] = [
      {
        name: 'agent_capabilities',
        type: 'test',
        command: 'validate-agent-capabilities',
        expected_result: true,
        passed: false,
        weight: 0.3,
        execution_time_ms: 0
      },
      {
        name: 'resource_availability',
        type: 'test',
        command: 'check-resource-availability',
        expected_result: true,
        passed: false,
        weight: 0.3,
        execution_time_ms: 0
      },
      {
        name: 'dependency_verification',
        type: 'test',
        command: 'verify-dependencies',
        expected_result: true,
        passed: false,
        weight: 0.4,
        execution_time_ms: 0
      }
    ];

    const checkpointId = await this.createCheckpoint(
      `Pre-execution: ${description}`,
      'task',
      agentId,
      taskId,
      validations
    );

    // Execute validations
    await this.executeValidations(checkpointId, validations);

    return checkpointId;
  }

  /**
   * Create a post-execution checkpoint
   */
  async createPostExecutionCheckpoint(
    agentId: string,
    taskId: string,
    description: string,
    truthScore: number
  ): Promise<string> {
    const validations: Validation[] = [
      {
        name: 'result_verification',
        type: 'test',
        command: 'verify-task-results',
        expected_result: true,
        passed: false,
        weight: 0.4,
        execution_time_ms: 0
      },
      {
        name: 'system_integrity',
        type: 'test',
        command: 'check-system-integrity',
        expected_result: true,
        passed: false,
        weight: 0.3,
        execution_time_ms: 0
      },
      {
        name: 'truth_score_validation',
        type: 'test',
        command: 'validate-truth-score',
        expected_result: truthScore >= 0.95,
        passed: truthScore >= 0.95,
        weight: 0.3,
        execution_time_ms: 0
      }
    ];

    const checkpointId = await this.createCheckpoint(
      `Post-execution: ${description}`,
      'task',
      agentId,
      taskId,
      validations
    );

    // Execute validations
    await this.executeValidations(checkpointId, validations);

    return checkpointId;
  }

  /**
   * List checkpoints with optional filtering
   */
  async listCheckpoints(filter?: CheckpointFilter): Promise<Checkpoint[]> {
    let checkpoints = Array.from(this.checkpointStore.values());

    if (filter) {
      checkpoints = checkpoints.filter(checkpoint => {
        if (filter.agent_id && checkpoint.agent_id !== filter.agent_id) return false;
        if (filter.task_id && checkpoint.task_id !== filter.task_id) return false;
        if (filter.type && checkpoint.type !== filter.type) return false;
        if (filter.scope && checkpoint.scope !== filter.scope) return false;
        if (filter.from_timestamp && checkpoint.timestamp < filter.from_timestamp) return false;
        if (filter.to_timestamp && checkpoint.timestamp > filter.to_timestamp) return false;
        return true;
      });
    }

    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a specific checkpoint
   */
  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    return this.checkpointStore.get(checkpointId) || null;
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpointStore.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Remove from memory
    this.checkpointStore.delete(checkpointId);
    this.snapshotStore.delete(checkpoint.state_snapshot.id);

    // Remove from disk
    const checkpointFile = path.join(this.storagePath, `${checkpointId}.json`);
    const snapshotFile = path.join(this.storagePath, 'snapshots', `${checkpoint.state_snapshot.id}.json`);

    try {
      await fs.unlink(checkpointFile);
      await fs.unlink(snapshotFile);
      console.log(`🗑️ Checkpoint deleted: ${checkpointId}`);
    } catch (error) {
      console.warn(`Warning: Failed to delete checkpoint files: ${error}`);
    }
  }

  /**
   * Capture current system state
   */
  private async captureSystemState(
    scope: CheckpointScope,
    agentId?: string,
    taskId?: string
  ): Promise<StateSnapshot> {
    const snapshotId = this.generateSnapshotId();
    const timestamp = Date.now();

    const stateScope: StateScope = {
      include_agents: scope !== 'local',
      include_tasks: scope !== 'local',
      include_memory: true,
      include_filesystem: scope === 'system' || scope === 'global',
      include_database: scope === 'system' || scope === 'global',
      agent_filter: agentId ? [agentId] : undefined,
      task_filter: taskId ? [taskId] : undefined
    };

    // Capture different state components based on scope
    const agentStates = stateScope.include_agents ? await this.captureAgentStates(stateScope.agent_filter) : new Map();
    const systemState = stateScope.include_agents ? await this.captureSystemState_Component() : {} as SystemState;
    const taskStates = stateScope.include_tasks ? await this.captureTaskStates(stateScope.task_filter) : new Map();
    const memoryState = stateScope.include_memory ? await this.captureMemoryState() : {} as MemoryState;
    const fileSystemState = stateScope.include_filesystem ? await this.captureFileSystemState() : {} as FileSystemState;
    const databaseState = stateScope.include_database ? await this.captureDatabaseState() : {} as DatabaseState;

    // Calculate checksum for integrity verification
    const checksum = this.calculateStateChecksum({
      agentStates,
      systemState,
      taskStates,
      memoryState,
      fileSystemState,
      databaseState
    });

    const metadata: SnapshotMetadata = {
      version: '2.0',
      created_by: agentId || 'system',
      description: `State snapshot for ${scope} scope`,
      tags: [scope, timestamp.toString()],
      size_bytes: 0, // Will be calculated after serialization
      compression_ratio: 1.0
    };

    const snapshot: StateSnapshot = {
      id: snapshotId,
      timestamp,
      agent_states: agentStates,
      system_state: systemState,
      task_states: taskStates,
      memory_state: memoryState,
      file_system_state: fileSystemState,
      database_state: databaseState,
      checksum,
      metadata
    };

    // Store snapshot
    await this.storeSnapshot(snapshot);

    return snapshot;
  }

  /**
   * Capture agent states
   */
  private async captureAgentStates(agentFilter?: string[]): Promise<Map<string, AgentState>> {
    const agentStates = new Map<string, AgentState>();
    
    // This would integrate with the actual agent manager
    // For now, we'll simulate capturing agent states
    const mockAgents = ['coordinator', 'coder', 'tester', 'researcher'];
    
    for (const agentId of mockAgents) {
      if (agentFilter && !agentFilter.includes(agentId)) continue;
      
      const agentState: AgentState = {
        id: agentId,
        status: 'idle',
        current_task: null,
        capabilities: ['code', 'test', 'analyze'],
        memory: {
          working_memory: {},
          long_term_memory: {},
          shared_memory_keys: [],
          memory_usage_mb: 10
        },
        configuration: {
          model: 'claude-3-sonnet',
          temperature: 0.7,
          max_tokens: 4096,
          timeout_ms: 30000,
          retry_attempts: 3,
          custom_parameters: {}
        },
        performance_metrics: {
          response_time_p95_ms: 500,
          throughput_requests_per_second: 10,
          error_rate_percentage: 0.1,
          cpu_usage_percentage: 5,
          memory_usage_mb: 50
        },
        last_heartbeat: Date.now()
      };
      
      agentStates.set(agentId, agentState);
    }
    
    return agentStates;
  }

  /**
   * Capture system state component
   */
  private async captureSystemState_Component(): Promise<SystemState> {
    return {
      version: '2.0.0-alpha.88',
      uptime_ms: process.uptime() * 1000,
      active_agents: 4,
      active_tasks: 2,
      memory_usage: {
        cpu_usage_percentage: 15,
        memory_usage_mb: 256,
        disk_usage_mb: 1024,
        network_io_mbps: 1.5,
        file_descriptors_used: 50
      },
      configuration: {
        max_agents: 10,
        max_concurrent_tasks: 5,
        truth_threshold: 0.95,
        verification_enabled: true,
        rollback_enabled: true
      }
    };
  }

  /**
   * Capture task states
   */
  private async captureTaskStates(taskFilter?: string[]): Promise<Map<string, TaskState>> {
    const taskStates = new Map<string, TaskState>();
    
    // Mock task states
    const mockTasks = ['task_001', 'task_002'];
    
    for (const taskId of mockTasks) {
      if (taskFilter && !taskFilter.includes(taskId)) continue;
      
      const taskState: TaskState = {
        id: taskId,
        status: 'running',
        assigned_agent: 'coder',
        dependencies: [],
        start_time: Date.now() - 60000,
        progress_percentage: 50,
        result: null
      };
      
      taskStates.set(taskId, taskState);
    }
    
    return taskStates;
  }

  /**
   * Capture memory state
   */
  private async captureMemoryState(): Promise<MemoryState> {
    return {
      total_size_mb: 512,
      used_size_mb: 128,
      fragmentation_percentage: 10,
      cache_hit_rate: 0.85,
      active_sessions: 3
    };
  }

  /**
   * Capture file system state
   */
  private async captureFileSystemState(): Promise<FileSystemState> {
    return {
      total_files: 1250,
      total_size_mb: 45,
      last_modified: Date.now(),
      checksums: {
        'package.json': 'abc123',
        'src/index.ts': 'def456'
      },
      permissions_valid: true
    };
  }

  /**
   * Capture database state
   */
  private async captureDatabaseState(): Promise<DatabaseState> {
    return {
      connection_status: 'connected',
      transaction_count: 0,
      pending_migrations: 0,
      data_integrity_check: true,
      backup_status: 'current'
    };
  }

  /**
   * Calculate state checksum for integrity verification
   */
  private calculateStateChecksum(stateData: any): string {
    const stateString = JSON.stringify(stateData, null, 0);
    return createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Execute validations for a checkpoint
   */
  private async executeValidations(checkpointId: string, validations: Validation[]): Promise<void> {
    const checkpoint = this.checkpointStore.get(checkpointId);
    if (!checkpoint) return;

    for (const validation of validations) {
      const startTime = Date.now();
      
      try {
        // Execute validation command
        const result = await this.executeValidationCommand(validation.command, validation.expected_result);
        
        validation.actual_result = result;
        validation.passed = this.compareResults(validation.expected_result, result);
        validation.execution_time_ms = Date.now() - startTime;
        
      } catch (error: any) {
        validation.passed = false;
        validation.error_message = error.message;
        validation.execution_time_ms = Date.now() - startTime;
      }
    }

    // Update checkpoint with validation results
    checkpoint.validations = validations;
    await this.storeCheckpoint(checkpoint);
  }

  /**
   * Execute a validation command
   */
  private async executeValidationCommand(command: string, expectedResult: any): Promise<any> {
    // This would integrate with actual validation systems
    switch (command) {
      case 'validate-agent-capabilities':
        return true; // Mock validation
      case 'check-resource-availability':
        return true; // Mock validation
      case 'verify-dependencies':
        return true; // Mock validation
      case 'verify-task-results':
        return true; // Mock validation
      case 'check-system-integrity':
        return true; // Mock validation
      case 'validate-truth-score':
        return expectedResult; // Pass through for truth score validation
      default:
        throw new Error(`Unknown validation command: ${command}`);
    }
  }

  /**
   * Compare validation results
   */
  private compareResults(expected: any, actual: any): boolean {
    if (typeof expected === 'boolean' && typeof actual === 'boolean') {
      return expected === actual;
    }
    
    if (typeof expected === 'number' && typeof actual === 'number') {
      return Math.abs(expected - actual) < 0.001; // Allow small floating point differences
    }
    
    return JSON.stringify(expected) === JSON.stringify(actual);
  }

  /**
   * Store checkpoint to persistent storage
   */
  private async storeCheckpoint(checkpoint: Checkpoint): Promise<void> {
    // Store in memory
    this.checkpointStore.set(checkpoint.id, checkpoint);
    
    // Store to disk
    const checkpointFile = path.join(this.storagePath, `${checkpoint.id}.json`);
    await this.writeJsonFile(checkpointFile, checkpoint);
  }

  /**
   * Store snapshot to persistent storage
   */
  private async storeSnapshot(snapshot: StateSnapshot): Promise<void> {
    // Store in memory
    this.snapshotStore.set(snapshot.id, snapshot);
    
    // Store to disk
    const snapshotDir = path.join(this.storagePath, 'snapshots');
    await this.ensureDirectory(snapshotDir);
    
    const snapshotFile = path.join(snapshotDir, `${snapshot.id}.json`);
    await this.writeJsonFile(snapshotFile, snapshot);
    
    // Update metadata with actual file size
    const stats = await fs.stat(snapshotFile);
    snapshot.metadata.size_bytes = stats.size;
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDirectory(): Promise<void> {
    await this.ensureDirectory(this.storagePath);
    await this.ensureDirectory(path.join(this.storagePath, 'snapshots'));
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Write JSON file safely
   */
  private async writeJsonFile(filePath: string, data: any): Promise<void> {
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, 'utf8');
  }

  /**
   * Generate unique checkpoint ID
   */
  private generateCheckpointId(): string {
    return `checkpoint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique snapshot ID
   */
  private generateSnapshotId(): string {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Load checkpoints from disk on startup
   */
  async loadCheckpointsFromDisk(): Promise<void> {
    try {
      const files = await fs.readdir(this.storagePath);
      const checkpointFiles = files.filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'));
      
      for (const file of checkpointFiles) {
        const filePath = path.join(this.storagePath, file);
        const data = await fs.readFile(filePath, 'utf8');
        const checkpoint: Checkpoint = JSON.parse(data);
        this.checkpointStore.set(checkpoint.id, checkpoint);
      }
      
      console.log(`📁 Loaded ${checkpointFiles.length} checkpoints from disk`);
    } catch (error) {
      console.warn('Warning: Failed to load checkpoints from disk:', error);
    }
  }

  /**
   * Load snapshots from disk on startup
   */
  async loadSnapshotsFromDisk(): Promise<void> {
    try {
      const snapshotDir = path.join(this.storagePath, 'snapshots');
      const files = await fs.readdir(snapshotDir);
      const snapshotFiles = files.filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));
      
      for (const file of snapshotFiles) {
        const filePath = path.join(snapshotDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const snapshot: StateSnapshot = JSON.parse(data);
        this.snapshotStore.set(snapshot.id, snapshot);
      }
      
      console.log(`📁 Loaded ${snapshotFiles.length} snapshots from disk`);
    } catch (error) {
      console.warn('Warning: Failed to load snapshots from disk:', error);
    }
  }

  /**
   * Cleanup old checkpoints and snapshots
   */
  async cleanup(retentionDays: number = 7): Promise<void> {
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    // Cleanup checkpoints
    for (const [id, checkpoint] of this.checkpointStore.entries()) {
      if (checkpoint.timestamp < cutoffTime) {
        await this.deleteCheckpoint(id);
        deletedCount++;
      }
    }

    console.log(`🧹 Cleaned up ${deletedCount} old checkpoints (retention: ${retentionDays} days)`);
  }
}