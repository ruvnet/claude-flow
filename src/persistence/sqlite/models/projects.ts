import { execute, query, queryOne, getDatabase } from '../database';

export interface Project {
  id: string;
  name: string;
  description?: string;
  type?: 'web-app' | 'api' | 'microservice' | 'infrastructure' | 'research' | 'migration' | 'custom';
  status?: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  stakeholders: string[]; // Stored as JSON
  budgetTotal: number;
  budgetSpent: number;
  budgetCurrency: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  tags: string[]; // Stored as JSON
  metadata: Record<string, any>; // Stored as JSON
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectPhase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: 'planned' | 'in-progress' | 'completed' | 'blocked' | 'cancelled';
  startDate?: Date;
  endDate?: Date;
  estimatedDurationHours?: number;
  actualDurationHours?: number;
  dependencies: string[]; // Stored as JSON
  assignedTeam: string[]; // Stored as JSON
  deliverables: string[]; // Stored as JSON
  completionPercentage: number;
  testCoverage: number;
  codeQuality: number;
  documentationScore: number;
  securityScore: number;
}

export interface ProjectWithPhases extends Project {
  phases: ProjectPhase[];
  completionPercentage: number;
}

export class ProjectModel {
  private static readonly TABLE_NAME = 'projects';
  private static readonly PHASES_TABLE = 'project_phases';

  static async create(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<string> {
    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, name, description, type, status, priority, owner, stakeholders,
        budget_total, budget_spent, budget_currency, planned_start, planned_end,
        actual_start, actual_end, tags, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        project.name,
        project.description,
        project.type,
        project.status || 'planning',
        project.priority || 'medium',
        project.owner,
        JSON.stringify(project.stakeholders),
        project.budgetTotal,
        project.budgetSpent,
        project.budgetCurrency,
        project.plannedStart?.toISOString(),
        project.plannedEnd?.toISOString(),
        project.actualStart?.toISOString(),
        project.actualEnd?.toISOString(),
        JSON.stringify(project.tags),
        JSON.stringify(project.metadata)
      ]
    );

    return project.id;
  }

  static async findById(id: string): Promise<ProjectWithPhases | undefined> {
    const project = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!project) return undefined;

    const phases = await query<any>(
      `SELECT * FROM ${this.PHASES_TABLE} 
       WHERE project_id = ?
       ORDER BY start_date`,
      [id]
    );

    return this.mapToProjectWithPhases(project, phases);
  }

  static async findByStatus(status: Project['status']): Promise<ProjectWithPhases[]> {
    const projects = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status = ?
       ORDER BY priority DESC, updated_at DESC`,
      [status]
    );

    const results: ProjectWithPhases[] = [];
    for (const project of projects) {
      const phases = await query<any>(
        `SELECT * FROM ${this.PHASES_TABLE} 
         WHERE project_id = ?
         ORDER BY start_date`,
        [project.id]
      );
      results.push(this.mapToProjectWithPhases(project, phases));
    }

    return results;
  }

  static async findByOwner(owner: string): Promise<ProjectWithPhases[]> {
    const projects = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE owner = ?
       ORDER BY status, priority DESC`,
      [owner]
    );

    const results: ProjectWithPhases[] = [];
    for (const project of projects) {
      const phases = await query<any>(
        `SELECT * FROM ${this.PHASES_TABLE} 
         WHERE project_id = ?
         ORDER BY start_date`,
        [project.id]
      );
      results.push(this.mapToProjectWithPhases(project, phases));
    }

    return results;
  }

  static async findActive(): Promise<ProjectWithPhases[]> {
    const projects = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE status IN ('planning', 'active')
       ORDER BY priority DESC, updated_at DESC`
    );

    const results: ProjectWithPhases[] = [];
    for (const project of projects) {
      const phases = await query<any>(
        `SELECT * FROM ${this.PHASES_TABLE} 
         WHERE project_id = ?
         ORDER BY start_date`,
        [project.id]
      );
      results.push(this.mapToProjectWithPhases(project, phases));
    }

    return results;
  }

  static async update(id: string, updates: Partial<Project>): Promise<boolean> {
    const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.owner !== undefined) {
      fields.push('owner = ?');
      values.push(updates.owner);
    }
    if (updates.stakeholders !== undefined) {
      fields.push('stakeholders = ?');
      values.push(JSON.stringify(updates.stakeholders));
    }
    if (updates.budgetTotal !== undefined) {
      fields.push('budget_total = ?');
      values.push(updates.budgetTotal);
    }
    if (updates.budgetSpent !== undefined) {
      fields.push('budget_spent = ?');
      values.push(updates.budgetSpent);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(id);
    const result = await execute(
      `UPDATE ${this.TABLE_NAME} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return result.changes > 0;
  }

  static async createPhase(phase: ProjectPhase): Promise<string> {
    await execute(
      `INSERT INTO ${this.PHASES_TABLE} 
       (id, project_id, name, description, status, start_date, end_date,
        estimated_duration_hours, actual_duration_hours, dependencies,
        assigned_team, deliverables, completion_percentage, test_coverage,
        code_quality, documentation_score, security_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        phase.id,
        phase.projectId,
        phase.name,
        phase.description,
        phase.status,
        phase.startDate?.toISOString(),
        phase.endDate?.toISOString(),
        phase.estimatedDurationHours,
        phase.actualDurationHours,
        JSON.stringify(phase.dependencies),
        JSON.stringify(phase.assignedTeam),
        JSON.stringify(phase.deliverables),
        phase.completionPercentage,
        phase.testCoverage,
        phase.codeQuality,
        phase.documentationScore,
        phase.securityScore
      ]
    );

    // Update project's updated_at timestamp
    await execute(
      `UPDATE ${this.TABLE_NAME} SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [phase.projectId]
    );

    return phase.id;
  }

  static async updatePhase(id: string, updates: Partial<ProjectPhase>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.completionPercentage !== undefined) {
      fields.push('completion_percentage = ?');
      values.push(updates.completionPercentage);
    }
    if (updates.testCoverage !== undefined) {
      fields.push('test_coverage = ?');
      values.push(updates.testCoverage);
    }
    if (updates.codeQuality !== undefined) {
      fields.push('code_quality = ?');
      values.push(updates.codeQuality);
    }
    if (updates.documentationScore !== undefined) {
      fields.push('documentation_score = ?');
      values.push(updates.documentationScore);
    }
    if (updates.securityScore !== undefined) {
      fields.push('security_score = ?');
      values.push(updates.securityScore);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = await execute(
      `UPDATE ${this.PHASES_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    if (result.changes > 0) {
      // Update project's updated_at timestamp
      const phase = await queryOne<any>(
        `SELECT project_id FROM ${this.PHASES_TABLE} WHERE id = ?`,
        [id]
      );
      if (phase) {
        await execute(
          `UPDATE ${this.TABLE_NAME} SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [phase.project_id]
        );
      }
    }

    return result.changes > 0;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async deletePhase(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.PHASES_TABLE} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async getStatistics(): Promise<{
    totalProjects: number;
    projectsByStatus: Record<NonNullable<Project['status']>, number>;
    projectsByPriority: Record<NonNullable<Project['priority']>, number>;
    averageBudgetUtilization: number;
    averageCompletionRate: number;
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

      const priorityStmt = conn.prepare(
        `SELECT priority, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY priority`
      );
      const priorityResults = priorityStmt.all() as any[];

      const budgetStmt = conn.prepare(`
        SELECT AVG(
          CASE 
            WHEN budget_total > 0 
            THEN (budget_spent / budget_total) * 100
            ELSE 0
          END
        ) as avg_utilization
        FROM ${this.TABLE_NAME}
      `);
      const budget = budgetStmt.get() as any;

      const completionStmt = conn.prepare(`
        SELECT AVG(completion_percentage) as avg_completion
        FROM ${this.PHASES_TABLE}
      `);
      const completion = completionStmt.get() as any;

      const projectsByStatus: Record<NonNullable<Project['status']>, number> = {
        planning: 0,
        active: 0,
        'on-hold': 0,
        completed: 0,
        cancelled: 0
      };

      statusResults.forEach(row => {
        if (row.status) {
          projectsByStatus[row.status as NonNullable<Project['status']>] = row.count;
        }
      });

      const projectsByPriority: Record<NonNullable<Project['priority']>, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      };

      priorityResults.forEach(row => {
        if (row.priority) {
          projectsByPriority[row.priority as NonNullable<Project['priority']>] = row.count;
        }
      });

      return {
        totalProjects: total.count || 0,
        projectsByStatus,
        projectsByPriority,
        averageBudgetUtilization: budget.avg_utilization || 0,
        averageCompletionRate: completion.avg_completion || 0
      };
    });
  }

  static async searchProjects(searchText: string): Promise<ProjectWithPhases[]> {
    const projects = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME}
       WHERE name LIKE ? OR description LIKE ? OR tags LIKE ?
       ORDER BY updated_at DESC`,
      [`%${searchText}%`, `%${searchText}%`, `%${searchText}%`]
    );

    const results: ProjectWithPhases[] = [];
    for (const project of projects) {
      const phases = await query<any>(
        `SELECT * FROM ${this.PHASES_TABLE} 
         WHERE project_id = ?
         ORDER BY start_date`,
        [project.id]
      );
      results.push(this.mapToProjectWithPhases(project, phases));
    }

    return results;
  }

  private static mapToProject(row: any): Project {
    const project: Project = {
      id: row.id,
      name: row.name,
      owner: row.owner,
      stakeholders: JSON.parse(row.stakeholders || '[]'),
      budgetTotal: row.budget_total,
      budgetSpent: row.budget_spent,
      budgetCurrency: row.budget_currency,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    if (row.description !== null && row.description !== undefined) {
      project.description = row.description;
    }
    
    if (row.type !== null && row.type !== undefined) {
      project.type = row.type;
    }
    
    if (row.status !== null && row.status !== undefined) {
      project.status = row.status;
    }
    
    if (row.priority !== null && row.priority !== undefined) {
      project.priority = row.priority;
    }
    
    if (row.planned_start !== null && row.planned_start !== undefined) {
      project.plannedStart = new Date(row.planned_start);
    }
    
    if (row.planned_end !== null && row.planned_end !== undefined) {
      project.plannedEnd = new Date(row.planned_end);
    }
    
    if (row.actual_start !== null && row.actual_start !== undefined) {
      project.actualStart = new Date(row.actual_start);
    }
    
    if (row.actual_end !== null && row.actual_end !== undefined) {
      project.actualEnd = new Date(row.actual_end);
    }
    
    return project;
  }

  private static mapToPhase(row: any): ProjectPhase {
    const phase: ProjectPhase = {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      dependencies: JSON.parse(row.dependencies || '[]'),
      assignedTeam: JSON.parse(row.assigned_team || '[]'),
      deliverables: JSON.parse(row.deliverables || '[]'),
      completionPercentage: row.completion_percentage,
      testCoverage: row.test_coverage,
      codeQuality: row.code_quality,
      documentationScore: row.documentation_score,
      securityScore: row.security_score
    };
    
    if (row.description !== null && row.description !== undefined) {
      phase.description = row.description;
    }
    
    if (row.start_date !== null && row.start_date !== undefined) {
      phase.startDate = new Date(row.start_date);
    }
    
    if (row.end_date !== null && row.end_date !== undefined) {
      phase.endDate = new Date(row.end_date);
    }
    
    if (row.estimated_duration_hours !== null && row.estimated_duration_hours !== undefined) {
      phase.estimatedDurationHours = row.estimated_duration_hours;
    }
    
    if (row.actual_duration_hours !== null && row.actual_duration_hours !== undefined) {
      phase.actualDurationHours = row.actual_duration_hours;
    }
    
    return phase;
  }

  private static mapToProjectWithPhases(project: any, phases: any[]): ProjectWithPhases {
    const mappedProject = this.mapToProject(project);
    const mappedPhases = phases.map(p => this.mapToPhase(p));
    
    const completionPercentage = mappedPhases.length > 0
      ? mappedPhases.reduce((sum, p) => sum + p.completionPercentage, 0) / mappedPhases.length
      : 0;

    return {
      ...mappedProject,
      phases: mappedPhases,
      completionPercentage
    };
  }
}