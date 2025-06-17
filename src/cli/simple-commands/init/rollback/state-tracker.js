// state-tracker.js - Track initialization state and rollback points

export class StateTracker {
  constructor(workingDir) {
    this.workingDir = workingDir;
    this.stateFile = `${workingDir}/.claude-flow-state.json`;
  }

  /**
   * Record a rollback point
   */
  async recordRollbackPoint(type, data) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const state = await this.loadState();
      
      const rollbackPoint = {
        id: this.generateId(),
        type,
        timestamp: Date.now(),
        data,
        ...data
      };

      state.rollbackPoints = state.rollbackPoints || [];
      state.rollbackPoints.push(rollbackPoint);

      // Keep only the last 10 rollback points
      if (state.rollbackPoints.length > 10) {
        state.rollbackPoints = state.rollbackPoints.slice(-10);
      }

      await this.saveState(state);

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to record rollback point: ${error.message}`);
    }

    return result;
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(phase, data) {
    const result = {
      success: true,
      id: null,
      errors: []
    };

    try {
      const state = await this.loadState();
      
      const checkpoint = {
        id: this.generateId(),
        phase,
        timestamp: Date.now(),
        data,
        status: 'active'
      };

      result.id = checkpoint.id;

      state.checkpoints = state.checkpoints || [];
      state.checkpoints.push(checkpoint);

      // Keep only the last 20 checkpoints
      if (state.checkpoints.length > 20) {
        state.checkpoints = state.checkpoints.slice(-20);
      }

      await this.saveState(state);

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to create checkpoint: ${error.message}`);
    }

    return result;
  }

  /**
   * Update a checkpoint
   */
  async updateCheckpoint(checkpointId, updates) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const state = await this.loadState();
      
      if (state.checkpoints) {
        const checkpoint = state.checkpoints.find(cp => cp.id === checkpointId);
        if (checkpoint) {
          Object.assign(checkpoint, updates);
          await this.saveState(state);
        } else {
          result.success = false;
          result.errors.push(`Checkpoint not found: ${checkpointId}`);
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to update checkpoint: ${error.message}`);
    }

    return result;
  }

  /**
   * Record a rollback operation
   */
  async recordRollback(targetId, rollbackType, phase = null) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const state = await this.loadState();
      
      const rollbackRecord = {
        id: this.generateId(),
        targetId,
        rollbackType,
        phase,
        timestamp: Date.now(),
        status: 'completed'
      };

      state.rollbackHistory = state.rollbackHistory || [];
      state.rollbackHistory.push(rollbackRecord);

      // Keep only the last 50 rollback records
      if (state.rollbackHistory.length > 50) {
        state.rollbackHistory = state.rollbackHistory.slice(-50);
      }

      await this.saveState(state);

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to record rollback: ${error.message}`);
    }

    return result;
  }

  /**
   * Get rollback points
   */
  async getRollbackPoints() {
    try {
      const state = await this.loadState();
      return state.rollbackPoints || [];
    } catch {
      return [];
    }
  }

  /**
   * Get checkpoints
   */
  async getCheckpoints() {
    try {
      const state = await this.loadState();
      return state.checkpoints || [];
    } catch {
      return [];
    }
  }

  /**
   * Get rollback history
   */
  async getRollbackHistory() {
    try {
      const state = await this.loadState();
      return state.rollbackHistory || [];
    } catch {
      return [];
    }
  }

  /**
   * Track file operation
   */
  async trackFileOperation(operation, filePath, metadata = {}) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const state = await this.loadState();
      
      const fileOp = {
        id: this.generateId(),
        operation, // 'create', 'modify', 'delete'
        filePath,
        timestamp: Date.now(),
        metadata
      };

      state.fileOperations = state.fileOperations || [];
      state.fileOperations.push(fileOp);

      // Keep only the last 100 file operations
      if (state.fileOperations.length > 100) {
        state.fileOperations = state.fileOperations.slice(-100);
      }

      await this.saveState(state);

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to track file operation: ${error.message}`);
    }

    return result;
  }

  /**
   * Get current initialization phase
   */
  async getCurrentPhase() {
    try {
      const state = await this.loadState();
      return state.currentPhase || 'not-started';
    } catch {
      return 'not-started';
    }
  }

  /**
   * Set current initialization phase
   */
  async setCurrentPhase(phase) {
    const result = {
      success: true,
      errors: []
    };

    try {
      const state = await this.loadState();
      state.currentPhase = phase;
      state.phaseTimestamp = Date.now();
      
      // Track phase transitions
      state.phaseHistory = state.phaseHistory || [];
      state.phaseHistory.push({
        phase,
        timestamp: Date.now()
      });

      await this.saveState(state);

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to set phase: ${error.message}`);
    }

    return result;
  }

  /**
   * Get initialization statistics
   */
  async getInitializationStats() {
    try {
      const state = await this.loadState();
      
      return {
        rollbackPoints: (state.rollbackPoints || []).length,
        checkpoints: (state.checkpoints || []).length,
        rollbackHistory: (state.rollbackHistory || []).length,
        fileOperations: (state.fileOperations || []).length,
        currentPhase: state.currentPhase || 'not-started',
        lastActivity: state.lastActivity || 0,
        phaseHistory: state.phaseHistory || []
      };
    } catch {
      return {
        rollbackPoints: 0,
        checkpoints: 0,
        rollbackHistory: 0,
        fileOperations: 0,
        currentPhase: 'not-started',
        lastActivity: 0,
        phaseHistory: []
      };
    }
  }

  /**
   * Clean up old state data
   */
  async cleanupOldState(daysToKeep = 7) {
    const result = {
      success: true,
      cleaned: 0,
      errors: []
    };

    try {
      const state = await this.loadState();
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      
      let cleaned = 0;

      // Clean rollback points
      if (state.rollbackPoints) {
        const before = state.rollbackPoints.length;
        state.rollbackPoints = state.rollbackPoints.filter(rp => rp.timestamp > cutoffTime);
        cleaned += before - state.rollbackPoints.length;
      }

      // Clean checkpoints
      if (state.checkpoints) {
        const before = state.checkpoints.length;
        state.checkpoints = state.checkpoints.filter(cp => cp.timestamp > cutoffTime);
        cleaned += before - state.checkpoints.length;
      }

      // Clean file operations
      if (state.fileOperations) {
        const before = state.fileOperations.length;
        state.fileOperations = state.fileOperations.filter(fo => fo.timestamp > cutoffTime);
        cleaned += before - state.fileOperations.length;
      }

      result.cleaned = cleaned;
      
      if (cleaned > 0) {
        await this.saveState(state);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`State cleanup failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate state tracking system
   */
  async validateStateTracking() {
    const result = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Test state file access
      const state = await this.loadState();
      
      // Test write access
      state.lastValidation = Date.now();
      await this.saveState(state);

      // Validate state structure
      const validationResult = this.validateStateStructure(state);
      if (!validationResult.valid) {
        result.warnings.push(...validationResult.issues);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`State tracking validation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Export state for backup
   */
  async exportState() {
    try {
      const state = await this.loadState();
      return {
        success: true,
        data: state,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Import state from backup
   */
  async importState(stateData) {
    const result = {
      success: true,
      errors: []
    };

    try {
      if (this.validateStateStructure(stateData).valid) {
        await this.saveState(stateData);
      } else {
        result.success = false;
        result.errors.push('Invalid state data structure');
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`State import failed: ${error.message}`);
    }

    return result;
  }

  // Helper methods

  async loadState() {
    try {
      const content = await Deno.readTextFile(this.stateFile);
      return JSON.parse(content);
    } catch {
      // Return default state if file doesn't exist or is invalid
      return {
        version: '1.0',
        created: Date.now(),
        lastActivity: Date.now(),
        rollbackPoints: [],
        checkpoints: [],
        rollbackHistory: [],
        fileOperations: [],
        currentPhase: 'not-started',
        phaseHistory: []
      };
    }
  }

  async saveState(state) {
    state.lastActivity = Date.now();
    state.version = '1.0';
    
    await Deno.writeTextFile(
      this.stateFile,
      JSON.stringify(state, null, 2)
    );
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  validateStateStructure(state) {
    const result = {
      valid: true,
      issues: []
    };

    if (!state || typeof state !== 'object') {
      result.valid = false;
      result.issues.push('State must be an object');
      return result;
    }

    // Check required fields
    const requiredFields = ['version', 'created', 'lastActivity'];
    for (const field of requiredFields) {
      if (!(field in state)) {
        result.issues.push(`Missing required field: ${field}`);
      }
    }

    // Check array fields
    const arrayFields = ['rollbackPoints', 'checkpoints', 'rollbackHistory', 'fileOperations'];
    for (const field of arrayFields) {
      if (field in state && !Array.isArray(state[field])) {
        result.issues.push(`Field ${field} must be an array`);
      }
    }

    return result;
  }
}