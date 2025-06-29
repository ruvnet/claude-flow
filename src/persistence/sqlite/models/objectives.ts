import { execute, query, queryOne, getDatabase } from '../database';
import { Task, TaskModel } from './tasks';

export interface Objective {
  id: string;
  description: string;
  strategy?: 'auto' | 'research' | 'development' | 'analysis';
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

export interface ObjectiveTask {
  objectiveId: string;
  taskId: string;
  sequenceOrder: number;
}

export interface ObjectiveWithTasks extends Objective {
  tasks: Array<{
    taskId: string;
    sequenceOrder: number;
    task?: Task;
  }>;
  progress: number;
}

export class ObjectiveModel {
  private static readonly TABLE_NAME = 'objectives';
  private static readonly TASKS_TABLE = 'objective_tasks';

  static async create(objective: Omit<Objective, 'createdAt' | 'completedAt'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, description, strategy, status)
       VALUES (?, ?, ?, ?)`,
      [
        objective.id,
        objective.description,
        objective.strategy,
        objective.status
      ]
    );

    return objective.id;
  }

  static async findById(id: string): Promise<ObjectiveWithTasks | undefined> {
    const objective = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!objective) return undefined;

    const tasks = await query<any>(
      `SELECT 
         ot.task_id,
         ot.sequence_order,
         t.*
       FROM ${this.TASKS_TABLE} ot
       LEFT JOIN tasks t ON ot.task_id = t.id
       WHERE ot.objective_id = ?
       ORDER BY ot.sequence_order`,
      [id]
    );

    return this.mapToObjectiveWithTasks(objective, tasks);
  }

  static async findByStatus(status: Objective['status']): Promise<ObjectiveWithTasks[]> {
    const objectives = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status = ?
       ORDER BY created_at DESC`,
      [status]
    );

    const results: ObjectiveWithTasks[] = [];
    for (const objective of objectives) {
      const tasks = await query<any>(
        `SELECT 
           ot.task_id,
           ot.sequence_order,
           t.*
         FROM ${this.TASKS_TABLE} ot
         LEFT JOIN tasks t ON ot.task_id = t.id
         WHERE ot.objective_id = ?
         ORDER BY ot.sequence_order`,
        [objective.id]
      );
      results.push(this.mapToObjectiveWithTasks(objective, tasks));
    }

    return results;
  }

  static async findActive(): Promise<ObjectiveWithTasks[]> {
    const objectives = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status IN ('planning', 'executing')
       ORDER BY created_at ASC`
    );

    const results: ObjectiveWithTasks[] = [];
    for (const objective of objectives) {
      const tasks = await query<any>(
        `SELECT 
           ot.task_id,
           ot.sequence_order,
           t.*
         FROM ${this.TASKS_TABLE} ot
         LEFT JOIN tasks t ON ot.task_id = t.id
         WHERE ot.objective_id = ?
         ORDER BY ot.sequence_order`,
        [objective.id]
      );
      results.push(this.mapToObjectiveWithTasks(objective, tasks));
    }

    return results;
  }

  static async update(id: string, updates: Partial<Objective>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.strategy !== undefined) {
      fields.push('strategy = ?');
      values.push(updates.strategy);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt?.toISOString());
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async addTask(objectiveId: string, taskId: string, order?: number): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      // Get the next sequence order if not provided
      if (order === undefined) {
        const maxOrderStmt = conn.prepare(
          `SELECT MAX(sequence_order) as max_order FROM ${this.TASKS_TABLE} WHERE objective_id = ?`
        );
        const result = maxOrderStmt.get(objectiveId) as any;
        order = (result?.max_order || 0) + 1;
      }

      const insertStmt = conn.prepare(
        `INSERT INTO ${this.TASKS_TABLE} (objective_id, task_id, sequence_order) VALUES (?, ?, ?)`
      );
      const insertResult = insertStmt.run(objectiveId, taskId, order);

      // Update objective status if needed
      const updateStmt = conn.prepare(
        `UPDATE ${this.TABLE_NAME} 
         SET status = CASE 
           WHEN status = 'planning' THEN 'executing' 
           ELSE status 
         END
         WHERE id = ?`
      );
      updateStmt.run(objectiveId);

      return insertResult.changes > 0;
    });
  }

  static async addTasks(objectiveId: string, taskIds: string[]): Promise<number> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      // Get the current max order
      const maxOrderStmt = conn.prepare(
        `SELECT MAX(sequence_order) as max_order FROM ${this.TASKS_TABLE} WHERE objective_id = ?`
      );
      const result = maxOrderStmt.get(objectiveId) as any;
      let currentOrder = (result?.max_order || 0) + 1;

      const insertStmt = conn.prepare(
        `INSERT INTO ${this.TASKS_TABLE} (objective_id, task_id, sequence_order) VALUES (?, ?, ?)`
      );

      let added = 0;
      for (const taskId of taskIds) {
        const result = insertStmt.run(objectiveId, taskId, currentOrder++);
        if (result.changes > 0) added++;
      }

      // Update objective status if needed
      const updateStmt = conn.prepare(
        `UPDATE ${this.TABLE_NAME} 
         SET status = CASE 
           WHEN status = 'planning' THEN 'executing' 
           ELSE status 
         END
         WHERE id = ?`
      );
      updateStmt.run(objectiveId);

      return added;
    });
  }

  static async removeTask(objectiveId: string, taskId: string): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      // Remove the task
      const deleteStmt = conn.prepare(
        `DELETE FROM ${this.TASKS_TABLE} WHERE objective_id = ? AND task_id = ?`
      );
      const result = deleteStmt.run(objectiveId, taskId);

      // Reorder remaining tasks
      const reorderStmt = conn.prepare(`
        UPDATE ${this.TASKS_TABLE}
        SET sequence_order = sequence_order - 1
        WHERE objective_id = ? AND sequence_order > (
          SELECT sequence_order FROM ${this.TASKS_TABLE}
          WHERE objective_id = ? AND task_id = ?
        )
      `);
      reorderStmt.run(objectiveId, objectiveId, taskId);

      return result.changes > 0;
    });
  }

  static async reorderTasks(objectiveId: string, taskOrders: Array<{ taskId: string; order: number }>): Promise<boolean> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      const updateStmt = conn.prepare(
        `UPDATE ${this.TASKS_TABLE} SET sequence_order = ? WHERE objective_id = ? AND task_id = ?`
      );

      for (const { taskId, order } of taskOrders) {
        updateStmt.run(order, objectiveId, taskId);
      }

      return true;
    });
  }

  static async markCompleted(id: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    return result.changes > 0;
  }

  static async markFailed(id: string): Promise<boolean> {
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} 
       SET status = 'failed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    return result.changes > 0;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async getProgress(objectiveId: string): Promise<number> {
    const result = await queryOne<any>(
      `SELECT 
         COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
         COUNT(*) as total
       FROM ${this.TASKS_TABLE} ot
       JOIN tasks t ON ot.task_id = t.id
       WHERE ot.objective_id = ?`,
      [objectiveId]
    );

    if (!result || result.total === 0) return 0;
    return Math.round((result.completed / result.total) * 100);
  }

  static async getStatistics(): Promise<{
    totalObjectives: number;
    objectivesByStatus: Record<Objective['status'], number>;
    averageTasksPerObjective: number;
    averageCompletionTime: number;
  }> {
    const db = getDatabase();
    return db.withConnection(async (conn) => {
      const totalStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME}`
      );
      const total = totalStmt.get() as any;

      const statusStmt = conn.prepare(
        `SELECT status, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY status`
      );
      const statusResults = statusStmt.all() as any[];

      const avgTasksStmt = conn.prepare(`
        SELECT AVG(task_count) as avg_tasks FROM (
          SELECT COUNT(task_id) as task_count
          FROM ${this.TABLE_NAME} o
          LEFT JOIN ${this.TASKS_TABLE} ot ON o.id = ot.objective_id
          GROUP BY o.id
        )
      `);
      const avgTasks = avgTasksStmt.get() as any;

      const avgTimeStmt = conn.prepare(`
        SELECT AVG(
          CASE 
            WHEN completed_at IS NOT NULL 
            THEN (julianday(completed_at) - julianday(created_at)) * 86400000
            ELSE NULL
          END
        ) as avg_time
        FROM ${this.TABLE_NAME}
        WHERE status IN ('completed', 'failed')
      `);
      const avgTime = avgTimeStmt.get() as any;

      const objectivesByStatus: Record<Objective['status'], number> = {
        planning: 0,
        executing: 0,
        completed: 0,
        failed: 0
      };

      statusResults.forEach(row => {
        objectivesByStatus[row.status as Objective['status']] = row.count;
      });

      return {
        totalObjectives: total.count || 0,
        objectivesByStatus,
        averageTasksPerObjective: avgTasks.avg_tasks || 0,
        averageCompletionTime: avgTime.avg_time || 0
      };
    });
  }

  private static mapToObjectiveWithTasks(objective: any, tasks: any[]): ObjectiveWithTasks {
    const { TaskModel } = require('./tasks');
    
    const progress = tasks.length > 0
      ? Math.round(
          (tasks.filter(t => t.status === 'completed').length / tasks.length) * 100
        )
      : 0;

    const result: ObjectiveWithTasks = {
      id: objective.id,
      description: objective.description,
      status: objective.status,
      createdAt: new Date(objective.created_at),
      tasks: tasks.map(t => {
        const taskObj: { taskId: string; sequenceOrder: number; task?: Task } = {
          taskId: t.task_id,
          sequenceOrder: t.sequence_order
        };
        if (t.id) {
          taskObj.task = TaskModel.mapToTask(t);
        }
        return taskObj;
      }),
      progress
    };
    
    if (objective.strategy !== null && objective.strategy !== undefined) {
      result.strategy = objective.strategy;
    }
    
    if (objective.completed_at !== null && objective.completed_at !== undefined) {
      result.completedAt = new Date(objective.completed_at);
    }
    
    return result;
  }
}