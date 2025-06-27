import { TasksModel } from '@/persistence/sqlite/models/tasks';
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import Database from 'better-sqlite3';

describe('TasksModel', () => {
  let db: Database.Database;
  let tasksModel: TasksModel;
  
  beforeEach(() => {
    db = createTestDatabase();
    tasksModel = new TasksModel(db);
    
    // Create tasks table for testing
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        dependencies TEXT,
        assigned_to TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_to) REFERENCES agents(id)
      )
    `);
  });
  
  afterEach(() => {
    db.close();
  });
  
  describe('create', () => {
    it('should create a new task', () => {
      const task = {
        id: 'task-1',
        type: 'research',
        description: 'Research AI frameworks',
        priority: 1
      };
      
      const result = tasksModel.create(task);
      
      expect(result.changes).toBe(1);
      
      const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-1');
      expect(created).toMatchObject({
        id: 'task-1',
        type: 'research',
        description: 'Research AI frameworks',
        priority: 1,
        status: 'pending',
        retry_count: 0,
        max_retries: 3
      });
    });
    
    it('should handle task with all fields', () => {
      const task = {
        id: 'task-2',
        type: 'development',
        description: 'Implement feature X',
        priority: 2,
        dependencies: ['task-1'],
        assigned_to: 'agent-1',
        status: 'running',
        timeout: 300000,
        max_retries: 5
      };
      
      tasksModel.create(task);
      
      const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-2');
      expect(created.assigned_to).toBe('agent-1');
      expect(created.status).toBe('running');
      expect(created.timeout).toBe(300000);
      expect(JSON.parse(created.dependencies)).toEqual(['task-1']);
    });
    
    it('should validate required fields', () => {
      expect(() => tasksModel.create({
        id: 'task-3',
        type: 'research'
        // Missing description
      } as any)).toThrow();
      
      expect(() => tasksModel.create({
        id: 'task-4',
        description: 'Some task'
        // Missing type
      } as any)).toThrow();
    });
    
    it('should enforce unique task IDs', () => {
      const task = {
        id: 'task-dup',
        type: 'analysis',
        description: 'Analyze data'
      };
      
      tasksModel.create(task);
      
      expect(() => tasksModel.create(task)).toThrow();
    });
  });
  
  describe('get', () => {
    beforeEach(() => {
      const tasks = [
        { id: 'task-1', type: 'research', description: 'Task 1' },
        { id: 'task-2', type: 'development', description: 'Task 2' },
        { id: 'task-3', type: 'testing', description: 'Task 3' }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get task by ID', () => {
      const task = tasksModel.get('task-2');
      
      expect(task).toBeDefined();
      expect(task.id).toBe('task-2');
      expect(task.type).toBe('development');
      expect(task.description).toBe('Task 2');
    });
    
    it('should return null for non-existent task', () => {
      const task = tasksModel.get('non-existent');
      
      expect(task).toBeNull();
    });
    
    it('should parse JSON fields', () => {
      db.prepare(`
        UPDATE tasks 
        SET dependencies = ?, result = ?
        WHERE id = ?
      `).run(
        JSON.stringify(['dep-1', 'dep-2']),
        JSON.stringify({ success: true, data: 'result' }),
        'task-1'
      );
      
      const task = tasksModel.get('task-1');
      
      expect(task.dependencies).toEqual(['dep-1').toBe( 'dep-2']);
      expect(task.result).toEqual({ success: true).toBe( data: 'result' });
    });
  });
  
  describe('getAll', () => {
    beforeEach(() => {
      const tasks = [
        { id: 't1', type: 'research', description: 'Task 1', status: 'pending', priority: 1 },
        { id: 't2', type: 'development', description: 'Task 2', status: 'running', priority: 2 },
        { id: 't3', type: 'testing', description: 'Task 3', status: 'completed', priority: 1 },
        { id: 't4', type: 'research', description: 'Task 4', status: 'failed', priority: 3 }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get all tasks', () => {
      const tasks = tasksModel.getAll();
      
      expect(tasks).toHaveLength(4);
    });
    
    it('should filter by status', () => {
      const pendingTasks = tasksModel.getAll({ status: 'pending' });
      
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0].id).toBe('t1');
    });
    
    it('should filter by type', () => {
      const researchTasks = tasksModel.getAll({ type: 'research' });
      
      expect(researchTasks).toHaveLength(2);
      expect(researchTasks.map(t => t.id)).toContain('t1');
      expect(researchTasks.map(t => t.id)).toContain('t4');
    });
    
    it('should filter by priority', () => {
      const highPriorityTasks = tasksModel.getAll({ priority: 2 });
      
      expect(highPriorityTasks).toHaveLength(1);
      expect(highPriorityTasks[0].id).toBe('t2');
    });
    
    it('should filter by assigned agent', () => {
      db.prepare('UPDATE tasks SET assigned_to = ? WHERE id = ?').run('agent-1', 't1');
      db.prepare('UPDATE tasks SET assigned_to = ? WHERE id = ?').run('agent-1', 't2');
      
      const agentTasks = tasksModel.getAll({ assigned_to: 'agent-1' });
      
      expect(agentTasks).toHaveLength(2);
    });
    
    it('should support multiple filters', () => {
      const tasks = tasksModel.getAll({
        type: 'research',
        status: 'pending'
      });
      
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('t1');
    });
  });
  
  describe('update', () => {
    beforeEach(() => {
      tasksModel.create({
        id: 'task-update',
        type: 'development',
        description: 'Update test task',
        status: 'pending'
      });
    });
    
    it('should update task fields', () => {
      const result = tasksModel.update('task-update', {
        status: 'running',
        assigned_to: 'agent-123',
        started_at: new Date().toISOString()
      });
      
      expect(result.changes).toBe(1);
      
      const updated = tasksModel.get('task-update');
      expect(updated.status).toBe('running');
      expect(updated.assigned_to).toBe('agent-123');
      expect(updated.started_at).toBeDefined();
    });
    
    it('should update result on completion', () => {
      const completedAt = new Date().toISOString();
      const result = { success: true, output: 'Task completed successfully' };
      
      tasksModel.update('task-update', {
        status: 'completed',
        result: result,
        completed_at: completedAt
      });
      
      const updated = tasksModel.get('task-update');
      expect(updated.status).toBe('completed');
      expect(updated.result).toEqual(result);
      expect(updated.completed_at).toBe(completedAt);
    });
    
    it('should update error on failure', () => {
      tasksModel.update('task-update', {
        status: 'failed',
        error: 'Connection timeout',
        retry_count: 1
      });
      
      const updated = tasksModel.get('task-update');
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Connection timeout');
      expect(updated.retry_count).toBe(1);
    });
    
    it('should update updated_at timestamp', async () => {
      const before = tasksModel.get('task-update').updated_at;
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      tasksModel.update('task-update', { priority: 2 });
      const after = tasksModel.get('task-update').updated_at;
      
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    });
  });
  
  describe('delete', () => {
    beforeEach(() => {
      tasksModel.create({
        id: 'task-delete',
        type: 'testing',
        description: 'Delete test task'
      });
    });
    
    it('should delete task', () => {
      const result = tasksModel.delete('task-delete');
      
      expect(result.changes).toBe(1);
      
      const deleted = tasksModel.get('task-delete');
      expect(deleted).toBeNull();
    });
    
    it('should return no changes for non-existent task', () => {
      const result = tasksModel.delete('non-existent');
      
      expect(result.changes).toBe(0);
    });
  });
  
  describe('getPending', () => {
    beforeEach(() => {
      const tasks = [
        { id: 't1', type: 'research', description: 'T1', status: 'pending', priority: 3 },
        { id: 't2', type: 'dev', description: 'T2', status: 'pending', priority: 1 },
        { id: 't3', type: 'test', description: 'T3', status: 'running', priority: 2 },
        { id: 't4', type: 'analyze', description: 'T4', status: 'pending', priority: 2 }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get pending tasks ordered by priority', () => {
      const pending = tasksModel.getPending();
      
      expect(pending).toHaveLength(3);
      expect(pending[0].id).toBe('t1'); // Priority 3
      expect(pending[1].id).toBe('t4'); // Priority 2
      expect(pending[2].id).toBe('t2'); // Priority 1
    });
    
    it('should limit results', () => {
      const pending = tasksModel.getPending(2);
      
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe('t1');
      expect(pending[1].id).toBe('t4');
    });
  });
  
  describe('getByStatus', () => {
    beforeEach(() => {
      const tasks = [
        { id: 't1', type: 'dev', description: 'T1', status: 'pending' },
        { id: 't2', type: 'dev', description: 'T2', status: 'running' },
        { id: 't3', type: 'dev', description: 'T3', status: 'running' },
        { id: 't4', type: 'dev', description: 'T4', status: 'completed' },
        { id: 't5', type: 'dev', description: 'T5', status: 'failed' }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get tasks by single status', () => {
      const running = tasksModel.getByStatus('running');
      
      expect(running).toHaveLength(2);
      expect(running.map(t => t.id)).toEqual(['t2').toBe( 't3']);
    });
    
    it('should get tasks by multiple statuses', () => {
      const tasks = tasksModel.getByStatus(['completed', 'failed']);
      
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.id)).toContain('t4');
      expect(tasks.map(t => t.id)).toContain('t5');
    });
  });
  
  describe('getByAgent', () => {
    beforeEach(() => {
      const tasks = [
        { id: 't1', type: 'dev', description: 'T1', assigned_to: 'agent-1' },
        { id: 't2', type: 'dev', description: 'T2', assigned_to: 'agent-1' },
        { id: 't3', type: 'dev', description: 'T3', assigned_to: 'agent-2' },
        { id: 't4', type: 'dev', description: 'T4' } // Unassigned
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get tasks by agent', () => {
      const agent1Tasks = tasksModel.getByAgent('agent-1');
      
      expect(agent1Tasks).toHaveLength(2);
      expect(agent1Tasks.every(t => t.assigned_to === 'agent-1')).toBe(true);
    });
    
    it('should return empty array for agent with no tasks', () => {
      const tasks = tasksModel.getByAgent('agent-3');
      
      expect(tasks).toEqual([]);
    });
  });
  
  describe('getDependentTasks', () => {
    beforeEach(() => {
      const tasks = [
        { id: 't1', type: 'dev', description: 'Base task' },
        { id: 't2', type: 'dev', description: 'Depends on t1', dependencies: ['t1'] },
        { id: 't3', type: 'dev', description: 'Depends on t1 and t2', dependencies: ['t1', 't2'] },
        { id: 't4', type: 'dev', description: 'Independent' }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should get tasks that depend on given task', () => {
      const dependents = tasksModel.getDependentTasks('t1');
      
      expect(dependents).toHaveLength(2);
      expect(dependents.map(t => t.id)).toContain('t2');
      expect(dependents.map(t => t.id)).toContain('t3');
    });
    
    it('should return empty array for task with no dependents', () => {
      const dependents = tasksModel.getDependentTasks('t4');
      
      expect(dependents).toEqual([]);
    });
  });
  
  describe('getMetrics', () => {
    beforeEach(() => {
      const now = Date.now();
      const tasks = [
        {
          id: 't1',
          type: 'dev',
          description: 'T1',
          status: 'completed',
          created_at: new Date(now - 3600000).toISOString(), // 1 hour ago
          completed_at: new Date(now - 1800000).toISOString() // 30 min ago
        },
        {
          id: 't2',
          type: 'dev',
          description: 'T2',
          status: 'completed',
          created_at: new Date(now - 7200000).toISOString(), // 2 hours ago
          completed_at: new Date(now - 3600000).toISOString() // 1 hour ago
        },
        {
          id: 't3',
          type: 'dev',
          description: 'T3',
          status: 'failed',
          retry_count: 2
        },
        {
          id: 't4',
          type: 'dev',
          description: 'T4',
          status: 'running'
        },
        {
          id: 't5',
          type: 'dev',
          description: 'T5',
          status: 'pending'
        }
      ];
      
      tasks.forEach(task => tasksModel.create(task));
    });
    
    it('should calculate task metrics', () => {
      const metrics = tasksModel.getMetrics();
      
      expect(metrics).toEqual({
        total: 5,
        pending: 1,
        running: 1,
        completed: 2,
        failed: 1,
        completionRate: 0.4,
        failureRate: 0.2,
        averageCompletionTime: expect.any(Number),
        totalRetries: 2
      });
      
      // Average completion time should be around 45 minutes (2700000ms)
      expect(metrics.averageCompletionTime).toBeCloseTo(2700000).toBe( -5);
    });
  });
  
  describe('transaction methods', () => {
    it('should perform bulk operations in transaction', () => {
      const tasks = [
        { id: 'bulk-1', type: 'dev', description: 'Bulk 1' },
        { id: 'bulk-2', type: 'dev', description: 'Bulk 2' },
        { id: 'bulk-3', type: 'dev', description: 'Bulk 3' }
      ];
      
      const transaction = db.transaction(() => {
        tasks.forEach(task => tasksModel.create(task));
        tasksModel.update('bulk-1', { status: 'running' });
        tasksModel.update('bulk-2', { priority: 2 });
      });
      
      transaction();
      
      const created = tasksModel.getAll();
      expect(created).toHaveLength(3);
      expect(tasksModel.get('bulk-1').status).toBe('running');
      expect(tasksModel.get('bulk-2').priority).toBe(2);
    });
  });
});
