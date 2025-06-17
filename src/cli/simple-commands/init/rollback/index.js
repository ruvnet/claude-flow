// rollback/index.js - Comprehensive rollback system for SPARC initialization

import { BackupManager } from './backup-manager.js';
import { RollbackExecutor } from './rollback-executor.js';
import { StateTracker } from './state-tracker.js';
import { RecoveryManager } from './recovery-manager.js';
import { printSuccess, printError, printWarning } from '../../../utils.js';

/**
 * Main rollback orchestrator
 */
export class RollbackSystem {
  constructor(workingDir) {
    this.workingDir = workingDir;
    this.backupManager = new BackupManager(workingDir);
    this.rollbackExecutor = new RollbackExecutor(workingDir);
    this.stateTracker = new StateTracker(workingDir);
    this.recoveryManager = new RecoveryManager(workingDir);
  }

  /**
   * Create backup before initialization
   */
  async createPreInitBackup() {
    const result = {
      success: true,
      backupId: null,
      errors: [],
      warnings: []
    };

    try {
      console.log('🔄 Creating pre-initialization backup...');
      
      const backup = await this.backupManager.createBackup('pre-init');
      result.backupId = backup.id;
      result.success = backup.success;
      
      if (backup.success) {
        printSuccess(`Backup created: ${backup.id}`);
        console.log(`  📁 Backup location: ${backup.location}`);
        
        // Record rollback point
        await this.stateTracker.recordRollbackPoint('pre-init', {
          backupId: backup.id,
          timestamp: Date.now(),
          state: 'clean'
        });
      } else {
        result.errors.push(...backup.errors);
        printError('Failed to create backup');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Backup creation failed: ${error.message}`);
      printError(`Backup failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Create checkpoint during initialization
   */
  async createCheckpoint(phase, data = {}) {
    const result = {
      success: true,
      checkpointId: null,
      errors: []
    };

    try {
      const checkpoint = await this.stateTracker.createCheckpoint(phase, data);
      result.checkpointId = checkpoint.id;
      result.success = checkpoint.success;

      if (!checkpoint.success) {
        result.errors.push(...checkpoint.errors);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Checkpoint creation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Perform full rollback to pre-initialization state
   */
  async performFullRollback(backupId = null) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      console.log('🔄 Performing full rollback...');

      // Find the appropriate backup
      const targetBackup = backupId || await this.findLatestPreInitBackup();
      if (!targetBackup) {
        result.success = false;
        result.errors.push('No suitable backup found for rollback');
        return result;
      }

      // Execute rollback
      const rollbackResult = await this.rollbackExecutor.executeFullRollback(targetBackup);
      result.success = rollbackResult.success;
      result.errors.push(...rollbackResult.errors);
      result.warnings.push(...rollbackResult.warnings);
      result.actions.push(...rollbackResult.actions);

      if (rollbackResult.success) {
        printSuccess('Full rollback completed successfully');
        
        // Update state tracking
        await this.stateTracker.recordRollback(targetBackup, 'full');
      } else {
        printError('Full rollback failed');
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Rollback failed: ${error.message}`);
      printError(`Rollback failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Perform partial rollback to specific checkpoint
   */
  async performPartialRollback(phase, checkpointId = null) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      actions: []
    };

    try {
      console.log(`🔄 Performing partial rollback for phase: ${phase}`);

      // Find checkpoint
      const checkpoint = checkpointId || await this.findLatestCheckpoint(phase);
      if (!checkpoint) {
        result.success = false;
        result.errors.push(`No checkpoint found for phase: ${phase}`);
        return result;
      }

      // Execute partial rollback
      const rollbackResult = await this.rollbackExecutor.executePartialRollback(phase, checkpoint);
      result.success = rollbackResult.success;
      result.errors.push(...rollbackResult.errors);
      result.warnings.push(...rollbackResult.warnings);
      result.actions.push(...rollbackResult.actions);

      if (rollbackResult.success) {
        printSuccess(`Partial rollback completed for phase: ${phase}`);
        
        // Update state tracking
        await this.stateTracker.recordRollback(checkpoint, 'partial', phase);
      } else {
        printError(`Partial rollback failed for phase: ${phase}`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Partial rollback failed: ${error.message}`);
      printError(`Partial rollback failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Auto-recovery from common failures
   */
  async performAutoRecovery(failureType, context = {}) {
    const result = {
      success: true,
      errors: [],
      warnings: [],
      recoveryActions: []
    };

    try {
      console.log(`🔧 Attempting auto-recovery for: ${failureType}`);

      const recoveryResult = await this.recoveryManager.performRecovery(failureType, context);
      result.success = recoveryResult.success;
      result.errors.push(...recoveryResult.errors);
      result.warnings.push(...recoveryResult.warnings);
      result.recoveryActions.push(...recoveryResult.actions);

      if (recoveryResult.success) {
        printSuccess(`Auto-recovery completed for: ${failureType}`);
      } else {
        printWarning(`Auto-recovery failed for: ${failureType}`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Auto-recovery failed: ${error.message}`);
      printError(`Auto-recovery failed: ${error.message}`);
    }

    return result;
  }

  /**
   * List available rollback points
   */
  async listRollbackPoints() {
    const result = {
      success: true,
      rollbackPoints: [],
      checkpoints: [],
      errors: []
    };

    try {
      // Get rollback points
      const rollbackPoints = await this.stateTracker.getRollbackPoints();
      result.rollbackPoints = rollbackPoints;

      // Get checkpoints
      const checkpoints = await this.stateTracker.getCheckpoints();
      result.checkpoints = checkpoints;

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to list rollback points: ${error.message}`);
    }

    return result;
  }

  /**
   * Clean up old backups and checkpoints
   */
  async cleanupOldBackups(keepCount = 5) {
    const result = {
      success: true,
      cleaned: [],
      errors: []
    };

    try {
      const cleanupResult = await this.backupManager.cleanupOldBackups(keepCount);
      result.success = cleanupResult.success;
      result.cleaned = cleanupResult.cleaned;
      result.errors.push(...cleanupResult.errors);

      if (cleanupResult.success) {
        console.log(`🗑️  Cleaned up ${cleanupResult.cleaned.length} old backups`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Cleanup failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate rollback system integrity
   */
  async validateRollbackSystem() {
    const result = {
      success: true,
      checks: {},
      errors: [],
      warnings: []
    };

    try {
      // Check backup system
      const backupCheck = await this.backupManager.validateBackupSystem();
      result.checks.backup = backupCheck;
      if (!backupCheck.success) {
        result.success = false;
        result.errors.push(...backupCheck.errors);
      }

      // Check state tracking
      const stateCheck = await this.stateTracker.validateStateTracking();
      result.checks.stateTracking = stateCheck;
      if (!stateCheck.success) {
        result.warnings.push(...stateCheck.errors);
      }

      // Check recovery system
      const recoveryCheck = await this.recoveryManager.validateRecoverySystem();
      result.checks.recovery = recoveryCheck;
      if (!recoveryCheck.success) {
        result.warnings.push(...recoveryCheck.errors);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Rollback system validation failed: ${error.message}`);
    }

    return result;
  }

  // Helper methods

  async findLatestPreInitBackup() {
    try {
      const rollbackPoints = await this.stateTracker.getRollbackPoints();
      const preInitPoints = rollbackPoints.filter(point => point.type === 'pre-init');
      
      if (preInitPoints.length > 0) {
        return preInitPoints.sort((a, b) => b.timestamp - a.timestamp)[0].backupId;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  async findLatestCheckpoint(phase) {
    try {
      const checkpoints = await this.stateTracker.getCheckpoints();
      const phaseCheckpoints = checkpoints.filter(checkpoint => checkpoint.phase === phase);
      
      if (phaseCheckpoints.length > 0) {
        return phaseCheckpoints.sort((a, b) => b.timestamp - a.timestamp)[0];
      }
      
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Atomic operation wrapper
 */
export class AtomicOperation {
  constructor(rollbackSystem, operationName) {
    this.rollbackSystem = rollbackSystem;
    this.operationName = operationName;
    this.checkpointId = null;
    this.completed = false;
  }

  /**
   * Begin atomic operation
   */
  async begin() {
    const checkpoint = await this.rollbackSystem.createCheckpoint(
      `atomic-${this.operationName}`,
      { operation: this.operationName, started: Date.now() }
    );
    
    this.checkpointId = checkpoint.checkpointId;
    return checkpoint.success;
  }

  /**
   * Commit atomic operation
   */
  async commit() {
    this.completed = true;
    
    // Mark checkpoint as committed
    if (this.checkpointId) {
      await this.rollbackSystem.stateTracker.updateCheckpoint(this.checkpointId, {
        status: 'committed',
        completed: Date.now()
      });
    }
  }

  /**
   * Rollback atomic operation
   */
  async rollback() {
    if (this.checkpointId && !this.completed) {
      await this.rollbackSystem.performPartialRollback(
        `atomic-${this.operationName}`,
        this.checkpointId
      );
    }
  }
}

/**
 * Create and manage atomic operations
 */
export function createAtomicOperation(rollbackSystem, operationName) {
  return new AtomicOperation(rollbackSystem, operationName);
}