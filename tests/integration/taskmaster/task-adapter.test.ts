/**
 * Task Adapter Integration Tests
 * Tests bidirectional task conversion, validation, and conflict resolution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskAdapter } from '../../../src/integrations/taskmaster/adapters/task-adapter.ts';
import {
  TaskMasterTask,
  ClaudeFlowTask,
  TaskMasterStatus,
  ClaudeFlowStatus,
  TaskMasterPriority,
  ClaudeFlowPriority,
  SPARCPhase,
  MappingConfig
} from '../../../src/integrations/taskmaster/types/task-types.ts';

describe('TaskAdapter Integration Tests', () => {
  let adapter: TaskAdapter;
  let mockTaskMasterTask: TaskMasterTask;
  let mockClaudeFlowTask: ClaudeFlowTask;

  beforeEach(() => {
    adapter = new TaskAdapter();
    
    mockTaskMasterTask = {
      id: 'tm-task-1',
      title: 'Implement User Authentication',
      description: 'Build secure user authentication system with JWT tokens',
      status: TaskMasterStatus.TODO,
      priority: TaskMasterPriority.HIGH,
      tags: ['authentication', 'security', 'backend'],
      dependencies: ['tm-task-0'],
      estimate: 8,
      assignee: 'john.doe',
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:00:00Z'),
      metadata: {
        prd_section: 'Authentication Requirements',
        complexity: 7,
        ai_generated: true,
        model_used: 'claude-3-opus'
      }
    };

    mockClaudeFlowTask = {
      id: 'cf-task-1',
      title: 'Design API Architecture',
      description: 'Create RESTful API architecture with proper error handling',
      status: ClaudeFlowStatus.IN_PROGRESS,
      priority: ClaudeFlowPriority.HIGH,
      phase: SPARCPhase.ARCHITECTURE,
      agent: 'architect',
      dependencies: ['cf-task-0'],
      estimatedHours: 6,
      createdAt: new Date('2024-01-01T11:00:00Z'),
      updatedAt: new Date('2024-01-01T11:00:00Z'),
      context: {
        sparc_phase: SPARCPhase.ARCHITECTURE,
        assigned_agent: 'architect',
        project_context: 'API Design | Backend'
      }
    };
  });

  describe('Task Conversion: TaskMaster to ClaudeFlow', () => {
    it('should convert TaskMaster task to ClaudeFlow format correctly', () => {
      const result = adapter.toClaudeFlow(mockTaskMasterTask);

      expect(result.id).toBe(mockTaskMasterTask.id);
      expect(result.title).toBe(mockTaskMasterTask.title);
      expect(result.description).toBe(mockTaskMasterTask.description);
      expect(result.status).toBe(ClaudeFlowStatus.PENDING);
      expect(result.priority).toBe(ClaudeFlowPriority.HIGH);
      expect(result.dependencies).toEqual(mockTaskMasterTask.dependencies);
      expect(result.estimatedHours).toBe(mockTaskMasterTask.estimate);
      expect(result.createdAt).toBe(mockTaskMasterTask.createdAt);
      expect(result.updatedAt).toBe(mockTaskMasterTask.updatedAt);
    });

    it('should infer SPARC phase from PRD section metadata', () => {
      mockTaskMasterTask.metadata!.prd_section = 'System Architecture Design';
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.phase).toBe(SPARCPhase.ARCHITECTURE);
      expect(result.context?.sparc_phase).toBe(SPARCPhase.ARCHITECTURE);
    });

    it('should suggest appropriate agent based on task content and phase', () => {
      mockTaskMasterTask.title = 'Write unit tests for authentication module';
      mockTaskMasterTask.metadata!.prd_section = 'Testing Requirements';
      
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.agent).toBe('tdd');
      expect(result.context?.assigned_agent).toBe('tdd');
    });

    it('should handle tasks without metadata gracefully', () => {
      delete mockTaskMasterTask.metadata;
      
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.phase).toBeUndefined();
      expect(result.agent).toBeUndefined();
      expect(result.context?.project_context).toBeDefined();
    });

    it('should preserve task dependencies', () => {
      mockTaskMasterTask.dependencies = ['dep-1', 'dep-2', 'dep-3'];
      
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.dependencies).toEqual(['dep-1', 'dep-2', 'dep-3']);
    });
  });

  describe('Task Conversion: ClaudeFlow to TaskMaster', () => {
    it('should convert ClaudeFlow task to TaskMaster format correctly', () => {
      const result = adapter.toTaskMaster(mockClaudeFlowTask);

      expect(result.id).toBe(mockClaudeFlowTask.id);
      expect(result.title).toBe(mockClaudeFlowTask.title);
      expect(result.description).toBe(mockClaudeFlowTask.description);
      expect(result.status).toBe(TaskMasterStatus.IN_PROGRESS);
      expect(result.priority).toBe(TaskMasterPriority.HIGH);
      expect(result.dependencies).toEqual(mockClaudeFlowTask.dependencies);
      expect(result.estimate).toBe(mockClaudeFlowTask.estimatedHours);
      expect(result.assignee).toBe(mockClaudeFlowTask.agent);
      expect(result.createdAt).toBe(mockClaudeFlowTask.createdAt);
      expect(result.updatedAt).toBe(mockClaudeFlowTask.updatedAt);
    });

    it('should generate appropriate tags from ClaudeFlow properties', () => {
      const result = adapter.toTaskMaster(mockClaudeFlowTask);
      
      expect(result.tags).toContain(SPARCPhase.ARCHITECTURE);
      expect(result.tags).toContain('architect');
      expect(result.tags).toContain('priority-high');
    });

    it('should map SPARC phase to PRD section in metadata', () => {
      const result = adapter.toTaskMaster(mockClaudeFlowTask);
      
      expect(result.metadata?.prd_section).toBe('System Architecture');
      expect(result.metadata?.ai_generated).toBe(true);
      expect(result.metadata?.model_used).toBe('claude-flow-adapter');
    });

    it('should estimate complexity based on task properties', () => {
      mockClaudeFlowTask.estimatedHours = 12;
      mockClaudeFlowTask.dependencies = ['dep-1', 'dep-2'];
      
      const result = adapter.toTaskMaster(mockClaudeFlowTask);
      
      expect(result.metadata?.complexity).toBeGreaterThan(5);
    });
  });

  describe('Batch Operations', () => {
    it('should convert multiple TaskMaster tasks to ClaudeFlow', () => {
      const tasks = [mockTaskMasterTask, { ...mockTaskMasterTask, id: 'tm-task-2' }];
      
      const results = adapter.batchToClaudeFlow(tasks);
      
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('tm-task-1');
      expect(results[1].id).toBe('tm-task-2');
    });

    it('should convert multiple ClaudeFlow tasks to TaskMaster', () => {
      const tasks = [mockClaudeFlowTask, { ...mockClaudeFlowTask, id: 'cf-task-2' }];
      
      const results = adapter.batchToTaskMaster(tasks);
      
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('cf-task-1');
      expect(results[1].id).toBe('cf-task-2');
    });

    it('should handle invalid tasks gracefully in batch operations', () => {
      const invalidTask = { id: 'invalid', invalidField: true } as any;
      const tasks = [mockTaskMasterTask, invalidTask];
      
      const results = adapter.batchToClaudeFlow(tasks);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('tm-task-1');
    });
  });

  describe('Task Validation', () => {
    it('should validate valid TaskMaster task', () => {
      const result = adapter.validateTaskConversion(mockTaskMasterTask);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid ClaudeFlow task', () => {
      const result = adapter.validateTaskConversion(mockClaudeFlowTask);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const invalidTask = { title: 'Test Task' };
      
      const result = adapter.validateTaskConversion(invalidTask);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Task ID is required');
      expect(result.errors).toContain('Task status is required');
      expect(result.errors).toContain('Created date is required');
    });

    it('should detect invalid status values', () => {
      const invalidTask = {
        id: 'test',
        title: 'Test',
        status: 'invalid-status',
        createdAt: new Date()
      };
      
      const result = adapter.validateTaskConversion(invalidTask);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid task status');
    });

    it('should generate warnings for missing optional fields', () => {
      const minimalTask = {
        id: 'test',
        title: 'Test',
        status: TaskMasterStatus.TODO,
        createdAt: new Date()
      };
      
      const result = adapter.validateTaskConversion(minimalTask);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Task description is missing');
      expect(result.warnings).toContain('Task priority not set');
    });
  });

  describe('Conflict Detection and Resolution', () => {
    it('should detect status conflicts between TaskMaster and ClaudeFlow tasks', () => {
      const tmTask = { ...mockTaskMasterTask, status: TaskMasterStatus.IN_PROGRESS, updatedAt: new Date('2024-01-02') };
      const cfTask = { ...mockClaudeFlowTask, status: ClaudeFlowStatus.PENDING, updatedAt: new Date('2024-01-01') };
      
      const conflicts = adapter.detectConflicts(tmTask, cfTask);
      
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('status');
      expect(conflicts[0].source).toBe('taskmaster');
    });

    it('should detect priority conflicts', () => {
      const tmTask = { ...mockTaskMasterTask, priority: TaskMasterPriority.CRITICAL, updatedAt: new Date('2024-01-02') };
      const cfTask = { ...mockClaudeFlowTask, priority: ClaudeFlowPriority.MEDIUM, updatedAt: new Date('2024-01-01') };
      
      const conflicts = adapter.detectConflicts(tmTask, cfTask);
      
      expect(conflicts.some(c => c.field === 'priority')).toBe(true);
    });

    it('should detect title conflicts', () => {
      const tmTask = { ...mockTaskMasterTask, title: 'Updated Title', updatedAt: new Date('2024-01-02') };
      const cfTask = { ...mockClaudeFlowTask, title: 'Original Title', updatedAt: new Date('2024-01-01') };
      
      const conflicts = adapter.detectConflicts(tmTask, cfTask);
      
      expect(conflicts.some(c => c.field === 'title')).toBe(true);
    });

    it('should resolve conflicts using TaskMaster wins strategy', () => {
      const conflicts = [{
        taskId: 'test-1',
        field: 'status',
        taskMasterValue: TaskMasterStatus.DONE,
        claudeFlowValue: ClaudeFlowStatus.IN_PROGRESS,
        source: 'taskmaster' as const
      }];
      
      const resolutions = adapter.resolveConflicts(conflicts, 'taskmaster');
      
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].resolvedValue).toBe(TaskMasterStatus.DONE);
      expect(resolutions[0].strategy).toBe('taskmaster_wins');
    });

    it('should resolve conflicts using ClaudeFlow wins strategy', () => {
      const conflicts = [{
        taskId: 'test-1',
        field: 'priority',
        taskMasterValue: TaskMasterPriority.LOW,
        claudeFlowValue: ClaudeFlowPriority.HIGH,
        source: 'claudeflow' as const
      }];
      
      const resolutions = adapter.resolveConflicts(conflicts, 'claudeflow');
      
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].resolvedValue).toBe(ClaudeFlowPriority.HIGH);
      expect(resolutions[0].strategy).toBe('claudeflow_wins');
    });

    it('should resolve conflicts using merge strategy (most recent wins)', () => {
      const conflicts = [{
        taskId: 'test-1',
        field: 'title',
        taskMasterValue: 'TM Title',
        claudeFlowValue: 'CF Title',
        source: 'taskmaster' as const
      }];
      
      const resolutions = adapter.resolveConflicts(conflicts, 'merge');
      
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].resolvedValue).toBe('TM Title');
      expect(resolutions[0].strategy).toBe('merge');
    });
  });

  describe('Custom Mapping Configuration', () => {
    it('should apply custom status mapping', () => {
      const customConfig: MappingConfig = {
        statusMapping: {
          [TaskMasterStatus.TODO]: ClaudeFlowStatus.PENDING,
          [TaskMasterStatus.IN_PROGRESS]: ClaudeFlowStatus.IN_PROGRESS,
          [TaskMasterStatus.BLOCKED]: ClaudeFlowStatus.CANCELLED, // Custom mapping
          [TaskMasterStatus.DONE]: ClaudeFlowStatus.COMPLETED,
          [TaskMasterStatus.CANCELLED]: ClaudeFlowStatus.CANCELLED
        },
        priorityMapping: {
          [TaskMasterPriority.LOW]: ClaudeFlowPriority.LOW,
          [TaskMasterPriority.MEDIUM]: ClaudeFlowPriority.MEDIUM,
          [TaskMasterPriority.HIGH]: ClaudeFlowPriority.HIGH,
          [TaskMasterPriority.CRITICAL]: ClaudeFlowPriority.HIGH
        }
      };
      
      adapter.configureMappings(customConfig);
      
      const blockedTask = { ...mockTaskMasterTask, status: TaskMasterStatus.BLOCKED };
      const result = adapter.toClaudeFlow(blockedTask);
      
      expect(result.status).toBe(ClaudeFlowStatus.CANCELLED);
    });

    it('should apply custom priority mapping', () => {
      const customConfig: MappingConfig = {
        statusMapping: {
          [TaskMasterStatus.TODO]: ClaudeFlowStatus.PENDING,
          [TaskMasterStatus.IN_PROGRESS]: ClaudeFlowStatus.IN_PROGRESS,
          [TaskMasterStatus.BLOCKED]: ClaudeFlowStatus.BLOCKED,
          [TaskMasterStatus.DONE]: ClaudeFlowStatus.COMPLETED,
          [TaskMasterStatus.CANCELLED]: ClaudeFlowStatus.CANCELLED
        },
        priorityMapping: {
          [TaskMasterPriority.LOW]: ClaudeFlowPriority.LOW,
          [TaskMasterPriority.MEDIUM]: ClaudeFlowPriority.LOW, // Custom mapping
          [TaskMasterPriority.HIGH]: ClaudeFlowPriority.MEDIUM, // Custom mapping
          [TaskMasterPriority.CRITICAL]: ClaudeFlowPriority.HIGH
        }
      };
      
      adapter.configureMappings(customConfig);
      
      const mediumTask = { ...mockTaskMasterTask, priority: TaskMasterPriority.MEDIUM };
      const result = adapter.toClaudeFlow(mediumTask);
      
      expect(result.priority).toBe(ClaudeFlowPriority.LOW);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should throw error for invalid TaskMaster task during conversion', () => {
      const invalidTask = { title: 'Invalid Task' } as TaskMasterTask;
      
      expect(() => adapter.toClaudeFlow(invalidTask)).toThrow('Invalid TaskMaster task');
    });

    it('should throw error for invalid ClaudeFlow task during conversion', () => {
      const invalidTask = { title: 'Invalid Task' } as ClaudeFlowTask;
      
      expect(() => adapter.toTaskMaster(invalidTask)).toThrow('Invalid ClaudeFlow task');
    });

    it('should handle tasks with circular dependencies', () => {
      mockTaskMasterTask.dependencies = ['task-2'];
      const task2 = { ...mockTaskMasterTask, id: 'task-2', dependencies: ['tm-task-1'] };
      
      // Should not throw error during conversion
      expect(() => adapter.toClaudeFlow(mockTaskMasterTask)).not.toThrow();
      expect(() => adapter.toClaudeFlow(task2)).not.toThrow();
    });

    it('should handle tasks with very long titles', () => {
      const longTitle = 'A'.repeat(1000);
      mockTaskMasterTask.title = longTitle;
      
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.title).toBe(longTitle);
    });

    it('should handle tasks with empty or null values', () => {
      mockTaskMasterTask.description = '';
      mockTaskMasterTask.tags = [];
      mockTaskMasterTask.dependencies = [];
      mockTaskMasterTask.estimate = 0;
      
      const result = adapter.toClaudeFlow(mockTaskMasterTask);
      
      expect(result.description).toBe('');
      expect(result.dependencies).toEqual([]);
      expect(result.estimatedHours).toBe(0);
    });
  });
});