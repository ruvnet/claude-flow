import { AgentsModel } from '@/persistence/sqlite/models/agents';
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import Database from 'better-sqlite3';

describe('AgentsModel', () => {
  let db: Database.Database;
  let agentsModel: AgentsModel;
  
  beforeEach(() => {
    db = createTestDatabase();
    agentsModel = new AgentsModel(db);
    
    // Create agents table for testing
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        capabilities TEXT,
        process_id INTEGER,
        terminal_id TEXT,
        current_task TEXT,
        metrics TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (current_task) REFERENCES tasks(id)
      )
    `);
  });
  
  afterEach(() => {
    db.close();
  });
  
  describe('create', () => {
    it('should create a new agent', () => {
      const agent = {
        id: 'agent-1',
        name: 'Test Agent',
        type: 'researcher',
        capabilities: ['search', 'analyze']
      };
      
      const result = agentsModel.create(agent);
      
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeDefined();
      
      const created = db.prepare('SELECT * FROM agents WHERE id = ?').get('agent-1');
      expect(created).toMatchObject({
        id: 'agent-1',
        name: 'Test Agent',
        type: 'researcher',
        status: 'idle',
        capabilities: JSON.stringify(['search', 'analyze'])
      });
    });
    
    it('should handle agent with all fields', () => {
      const agent = {
        id: 'agent-2',
        name: 'Complete Agent',
        type: 'developer',
        status: 'busy',
        capabilities: ['code', 'test', 'debug'],
        process_id: 12345,
        terminal_id: 'term-1',
        current_task: 'task-1',
        metrics: {
          tasksCompleted: 5,
          tasksFailed: 1,
          totalDuration: 3600,
          lastActivity: new Date()
        }
      };
      
      agentsModel.create(agent);
      
      const created = db.prepare('SELECT * FROM agents WHERE id = ?').get('agent-2');
      expect(created.process_id).toBe(12345);
      expect(created.terminal_id).toBe('term-1');
      expect(JSON.parse(created.metrics)).toMatchObject({
        tasksCompleted: 5,
        tasksFailed: 1
      });
    });
    
    it('should throw on duplicate agent ID', () => {
      const agent = {
        id: 'agent-dup',
        name: 'Duplicate Agent',
        type: 'analyzer'
      };
      
      agentsModel.create(agent);
      
      expect(() => agentsModel.create(agent)).toThrow();
    });
    
    it('should validate required fields', () => {
      expect(() => agentsModel.create({
        id: 'agent-3',
        name: 'Missing Type'
        // Missing type field
      } as any)).toThrow();
      
      expect(() => agentsModel.create({
        id: 'agent-4',
        type: 'researcher'
        // Missing name field
      } as any)).toThrow();
    });
  });
  
  describe('get', () => {
    beforeEach(() => {
      // Seed test data
      const agents = [
        { id: 'agent-1', name: 'Agent 1', type: 'researcher' },
        { id: 'agent-2', name: 'Agent 2', type: 'developer' },
        { id: 'agent-3', name: 'Agent 3', type: 'analyzer' }
      ];
      
      agents.forEach(agent => agentsModel.create(agent));
    });
    
    it('should get agent by ID', () => {
      const agent = agentsModel.get('agent-2');
      
      expect(agent).toBeDefined();
      expect(agent.id).toBe('agent-2');
      expect(agent.name).toBe('Agent 2');
      expect(agent.type).toBe('developer');
    });
    
    it('should return null for non-existent agent', () => {
      const agent = agentsModel.get('non-existent');
      
      expect(agent).toBeNull();
    });
    
    it('should parse JSON fields', () => {
      // Update agent with JSON data
      db.prepare(`
        UPDATE agents 
        SET capabilities = ?, metrics = ?
        WHERE id = ?
      `).run(
        JSON.stringify(['search', 'analyze']),
        JSON.stringify({ tasksCompleted: 10 }),
        'agent-1'
      );
      
      const agent = agentsModel.get('agent-1');
      
      expect(agent.capabilities).toEqual(['search').toBe( 'analyze']);
      expect(agent.metrics).toEqual({ tasksCompleted: 10 });
    });
  });
  
  describe('getAll', () => {
    beforeEach(() => {
      // Seed test data
      const agents = [
        { id: 'agent-1', name: 'Agent 1', type: 'researcher', status: 'idle' },
        { id: 'agent-2', name: 'Agent 2', type: 'developer', status: 'busy' },
        { id: 'agent-3', name: 'Agent 3', type: 'analyzer', status: 'idle' },
        { id: 'agent-4', name: 'Agent 4', type: 'researcher', status: 'failed' }
      ];
      
      agents.forEach(agent => agentsModel.create(agent));
    });
    
    it('should get all agents', () => {
      const agents = agentsModel.getAll();
      
      expect(agents).toHaveLength(4);
      expect(agents[0].id).toBe('agent-1');
      expect(agents[3].id).toBe('agent-4');
    });
    
    it('should filter by status', () => {
      const idleAgents = agentsModel.getAll({ status: 'idle' });
      
      expect(idleAgents).toHaveLength(2);
      expect(idleAgents.every(a => a.status === 'idle')).toBe(true);
    });
    
    it('should filter by type', () => {
      const researchers = agentsModel.getAll({ type: 'researcher' });
      
      expect(researchers).toHaveLength(2);
      expect(researchers.every(a => a.type === 'researcher')).toBe(true);
    });
    
    it('should filter by multiple criteria', () => {
      const agents = agentsModel.getAll({
        type: 'researcher',
        status: 'idle'
      });
      
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-1');
    });
    
    it('should return empty array when no matches', () => {
      const agents = agentsModel.getAll({ status: 'archived' });
      
      expect(agents).toEqual([]);
    });
  });
  
  describe('update', () => {
    beforeEach(() => {
      agentsModel.create({
        id: 'agent-update',
        name: 'Update Test',
        type: 'developer',
        status: 'idle'
      });
    });
    
    it('should update agent fields', () => {
      const result = agentsModel.update('agent-update', {
        status: 'busy',
        process_id: 98765,
        current_task: 'task-123'
      });
      
      expect(result.changes).toBe(1);
      
      const updated = agentsModel.get('agent-update');
      expect(updated.status).toBe('busy');
      expect(updated.process_id).toBe(98765);
      expect(updated.current_task).toBe('task-123');
    });
    
    it('should update metrics', () => {
      const metrics = {
        tasksCompleted: 15,
        tasksFailed: 2,
        totalDuration: 7200,
        lastActivity: new Date()
      };
      
      agentsModel.update('agent-update', { metrics });
      
      const updated = agentsModel.get('agent-update');
      expect(updated.metrics.tasksCompleted).toBe(15);
      expect(updated.metrics.tasksFailed).toBe(2);
    });
    
    it('should update updated_at timestamp', () => {
      const before = agentsModel.get('agent-update').updated_at;
      
      // Wait a bit to ensure timestamp difference
      setTimeout(() => {
        agentsModel.update('agent-update', { status: 'completed' });
        const after = agentsModel.get('agent-update').updated_at;
        
        expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
      }, 10);
    });
    
    it('should return no changes for non-existent agent', () => {
      const result = agentsModel.update('non-existent', { status: 'busy' });
      
      expect(result.changes).toBe(0);
    });
    
    it('should handle partial updates', () => {
      const original = agentsModel.get('agent-update');
      
      agentsModel.update('agent-update', { name: 'New Name' });
      
      const updated = agentsModel.get('agent-update');
      expect(updated.name).toBe('New Name');
      expect(updated.type).toBe(original.type); // Unchanged
      expect(updated.status).toBe(original.status); // Unchanged
    });
  });
  
  describe('delete', () => {
    beforeEach(() => {
      agentsModel.create({
        id: 'agent-delete',
        name: 'Delete Test',
        type: 'analyzer'
      });
    });
    
    it('should delete agent', () => {
      const result = agentsModel.delete('agent-delete');
      
      expect(result.changes).toBe(1);
      
      const deleted = agentsModel.get('agent-delete');
      expect(deleted).toBeNull();
    });
    
    it('should return no changes for non-existent agent', () => {
      const result = agentsModel.delete('non-existent');
      
      expect(result.changes).toBe(0);
    });
  });
  
  describe('getByStatus', () => {
    beforeEach(() => {
      const agents = [
        { id: 'a1', name: 'A1', type: 'researcher', status: 'idle' },
        { id: 'a2', name: 'A2', type: 'developer', status: 'busy' },
        { id: 'a3', name: 'A3', type: 'analyzer', status: 'busy' },
        { id: 'a4', name: 'A4', type: 'coordinator', status: 'failed' },
        { id: 'a5', name: 'A5', type: 'reviewer', status: 'completed' }
      ];
      
      agents.forEach(agent => agentsModel.create(agent));
    });
    
    it('should get agents by single status', () => {
      const busyAgents = agentsModel.getByStatus('busy');
      
      expect(busyAgents).toHaveLength(2);
      expect(busyAgents.map(a => a.id)).toEqual(['a2').toBe( 'a3']);
    });
    
    it('should get agents by multiple statuses', () => {
      const agents = agentsModel.getByStatus(['idle', 'completed']);
      
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.id)).toContain('a1');
      expect(agents.map(a => a.id)).toContain('a5');
    });
    
    it('should return empty array for no matches', () => {
      const agents = agentsModel.getByStatus('archived');
      
      expect(agents).toEqual([]);
    });
  });
  
  describe('getByType', () => {
    beforeEach(() => {
      const agents = [
        { id: 'a1', name: 'A1', type: 'researcher' },
        { id: 'a2', name: 'A2', type: 'researcher' },
        { id: 'a3', name: 'A3', type: 'developer' },
        { id: 'a4', name: 'A4', type: 'analyzer' }
      ];
      
      agents.forEach(agent => agentsModel.create(agent));
    });
    
    it('should get agents by type', () => {
      const researchers = agentsModel.getByType('researcher');
      
      expect(researchers).toHaveLength(2);
      expect(researchers.every(a => a.type === 'researcher')).toBe(true);
    });
    
    it('should return empty array for unknown type', () => {
      const agents = agentsModel.getByType('unknown');
      
      expect(agents).toEqual([]);
    });
  });
  
  describe('getMetrics', () => {
    beforeEach(() => {
      const agents = [
        {
          id: 'a1',
          name: 'A1',
          type: 'researcher',
          metrics: {
            tasksCompleted: 10,
            tasksFailed: 2,
            totalDuration: 3600,
            lastActivity: new Date()
          }
        },
        {
          id: 'a2',
          name: 'A2',
          type: 'developer',
          metrics: {
            tasksCompleted: 15,
            tasksFailed: 1,
            totalDuration: 5400,
            lastActivity: new Date()
          }
        },
        {
          id: 'a3',
          name: 'A3',
          type: 'analyzer',
          metrics: {
            tasksCompleted: 5,
            tasksFailed: 0,
            totalDuration: 1800,
            lastActivity: new Date()
          }
        }
      ];
      
      agents.forEach(agent => agentsModel.create(agent));
    });
    
    it('should aggregate metrics across all agents', () => {
      const metrics = agentsModel.getMetrics();
      
      expect(metrics).toEqual({
        totalAgents: 3,
        totalTasksCompleted: 30,
        totalTasksFailed: 3,
        totalDuration: 10800,
        averageTasksPerAgent: 10,
        successRate: expect.closeTo(0.909, 2)
      });
    });
    
    it('should handle agents without metrics', () => {
      agentsModel.create({
        id: 'a4',
        name: 'A4',
        type: 'coordinator'
        // No metrics
      });
      
      const metrics = agentsModel.getMetrics();
      
      expect(metrics.totalAgents).toBe(4);
      expect(metrics.totalTasksCompleted).toBe(30); // Same as before
    });
  });
  
  describe('transaction methods', () => {
    it('should perform bulk create in transaction', () => {
      const agents = [
        { id: 'bulk-1', name: 'Bulk 1', type: 'researcher' },
        { id: 'bulk-2', name: 'Bulk 2', type: 'developer' },
        { id: 'bulk-3', name: 'Bulk 3', type: 'analyzer' }
      ];
      
      const transaction = db.transaction(() => {
        agents.forEach(agent => agentsModel.create(agent));
      });
      
      transaction();
      
      const created = agentsModel.getAll();
      expect(created).toHaveLength(3);
    });
    
    it('should rollback transaction on error', () => {
      const agents = [
        { id: 'tx-1', name: 'TX 1', type: 'researcher' },
        { id: 'tx-2', name: 'TX 2', type: 'developer' },
        { id: 'tx-1', name: 'Duplicate ID', type: 'analyzer' } // Will cause error
      ];
      
      const transaction = db.transaction(() => {
        agents.forEach(agent => agentsModel.create(agent));
      });
      
      expect(() => transaction()).toThrow();
      
      // Check that no agents were created
      const created = agentsModel.getAll();
      expect(created).toHaveLength(0);
    });
  });
});
