import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';

export interface ProjectPhase {
  id: string;
  name: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed' | 'blocked' | 'cancelled';
  startDate?: Date;
  endDate?: Date;
  estimatedDuration: number; // in hours
  actualDuration?: number;
  dependencies: string[];
  assignedTeam: string[];
  deliverables: string[];
  risks: ProjectRisk[];
  milestones: ProjectMilestone[];
  budget: {
    estimated: number;
    actual: number;
    currency: string;
  };
  resources: ProjectResource[];
  completionPercentage: number;
  qualityMetrics: {
    testCoverage: number;
    codeQuality: number;
    documentation: number;
    securityScore: number;
  };
}

export interface ProjectRisk {
  id: string;
  description: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
  status: 'open' | 'mitigated' | 'closed';
  assignedTo: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMilestone {
  id: string;
  name: string;
  description: string;
  targetDate: Date;
  actualDate?: Date;
  status: 'pending' | 'achieved' | 'missed' | 'at-risk';
  dependencies: string[];
  deliverables: string[];
  successCriteria: string[];
}

export interface ProjectResource {
  id: string;
  name: string;
  type: 'human' | 'infrastructure' | 'software' | 'hardware';
  availability: number; // percentage
  cost: {
    amount: number;
    currency: string;
    period: 'hour' | 'day' | 'week' | 'month';
  };
  skills: string[];
  allocation: {
    phaseId: string;
    percentage: number;
    startDate: Date;
    endDate: Date;
  }[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  type: 'web-app' | 'api' | 'microservice' | 'infrastructure' | 'research' | 'migration' | 'custom';
  status: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  stakeholders: string[];
  phases: ProjectPhase[];
  budget: {
    total: number;
    spent: number;
    remaining: number;
    currency: string;
  };
  timeline: {
    plannedStart: Date;
    plannedEnd: Date;
    actualStart?: Date;
    actualEnd?: Date;
  };
  tags: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  auditLog: ProjectAuditEntry[];
  collaboration: {
    teamMembers: TeamMember[];
    communication: CommunicationChannel[];
    sharedResources: string[];
  };
  qualityGates: QualityGate[];
  complianceRequirements: ComplianceRequirement[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  skills: string[];
  availability: number;
  permissions: string[];
  joinDate: Date;
  status: 'active' | 'inactive' | 'on-leave';
}

export interface CommunicationChannel {
  id: string;
  name: string;
  type: 'slack' | 'teams' | 'email' | 'webhook' | 'custom';
  configuration: Record<string, any>;
  isActive: boolean;
}

export interface QualityGate {
  id: string;
  name: string;
  phase: string;
  criteria: {
    metric: string;
    threshold: number;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  }[];
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  executedAt?: Date;
  results: Record<string, number>;
}

export interface ComplianceRequirement {
  id: string;
  name: string;
  framework: string; // e.g., 'SOC2', 'GDPR', 'HIPAA', 'PCI-DSS'
  description: string;
  status: 'not-started' | 'in-progress' | 'compliant' | 'non-compliant';
  evidence: string[];
  reviewer: string;
  reviewDate?: Date;
  dueDate: Date;
}

export interface ProjectAuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  target: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ProjectMetrics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  averageProjectDuration: number;
  budgetVariance: number;
  resourceUtilization: number;
  qualityScore: number;
  riskScore: number;
  teamProductivity: number;
  customerSatisfaction: number;
}

export interface ProjectReport {
  id: string;
  projectId: string;
  type: 'status' | 'financial' | 'quality' | 'risk' | 'resource' | 'compliance';
  title: string;
  summary: string;
  details: Record<string, any>;
  recommendations: string[];
  generatedAt: Date;
  generatedBy: string;
  format: 'json' | 'pdf' | 'html' | 'csv';
  recipients: string[];
}

export class ProjectManager extends EventEmitter {
  private projects: Map<string, Project> = new Map();
  private projectsPath: string;
  private logger: Logger;
  private config: ConfigManager;

  constructor(
    projectsPath: string = './projects',
    logger?: Logger,
    config?: ConfigManager
  ) {
    super();
    this.projectsPath = projectsPath;
    this.logger = logger || new Logger({ level: 'info', format: 'text', destination: 'console' });
    this.config = config || ConfigManager.getInstance();
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.projectsPath, { recursive: true });
      await this.loadProjects();
      this.logger.info('Project Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Project Manager', { error });
      throw error;
    }
  }

  async createProject(projectData: Partial<Project>): Promise<Project> {
    const project: Project = {
      id: projectData.id || `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: projectData.name || 'Unnamed Project',
      description: projectData.description || '',
      type: projectData.type || 'custom',
      status: 'planning',
      priority: projectData.priority || 'medium',
      owner: projectData.owner || 'system',
      stakeholders: projectData.stakeholders || [],
      phases: projectData.phases || [],
      budget: projectData.budget || {
        total: 0,
        spent: 0,
        remaining: 0,
        currency: 'USD'
      },
      timeline: {
        plannedStart: projectData.timeline?.plannedStart || new Date(),
        plannedEnd: projectData.timeline?.plannedEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        actualStart: projectData.timeline?.actualStart,
        actualEnd: projectData.timeline?.actualEnd
      },
      tags: projectData.tags || [],
      metadata: projectData.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      auditLog: [],
      collaboration: {
        teamMembers: [],
        communication: [],
        sharedResources: []
      },
      qualityGates: [],
      complianceRequirements: []
    };

    // Add initial audit entry
    this.addAuditEntry(project, 'system', 'project_created', 'project', {
      projectId: project.id,
      projectName: project.name
    });

    this.projects.set(project.id, project);
    await this.saveProject(project);

    this.emit('project:created', project);
    this.logger.info(`Project created: ${project.name} (${project.id})`);

    return project;
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const updatedProject = { ...project, ...updates, updatedAt: new Date() };

    // Add audit entry
    this.addAuditEntry(updatedProject, 'system', 'project_updated', 'project', {
      projectId,
      changes: Object.keys(updates)
    });

    this.projects.set(projectId, updatedProject);
    await this.saveProject(updatedProject);

    this.emit('project:updated', updatedProject);
    this.logger.info(`Project updated: ${project.name} (${projectId})`);

    return updatedProject;
  }

  async deleteProject(projectId: string, userId: string = 'system'): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Add audit entry before deletion
    this.addAuditEntry(project, userId, 'project_deleted', 'project', {
      projectId,
      projectName: project.name
    });

    this.projects.delete(projectId);
    
    // Archive project instead of deleting
    const archivePath = join(this.projectsPath, 'archived');
    await mkdir(archivePath, { recursive: true });
    await writeFile(
      join(archivePath, `${projectId}.json`),
      JSON.stringify(project, null, 2)
    );

    this.emit('project:deleted', { projectId, project });
    this.logger.info(`Project archived: ${project.name} (${projectId})`);
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) || null;
  }

  async listProjects(filters?: {
    status?: Project['status'];
    type?: Project['type'];
    priority?: Project['priority'];
    owner?: string;
    tags?: string[];
  }): Promise<Project[]> {
    let projects = Array.from(this.projects.values());

    if (filters) {
      if (filters.status) {
        projects = projects.filter(p => p.status === filters.status);
      }
      if (filters.type) {
        projects = projects.filter(p => p.type === filters.type);
      }
      if (filters.priority) {
        projects = projects.filter(p => p.priority === filters.priority);
      }
      if (filters.owner) {
        projects = projects.filter(p => p.owner === filters.owner);
      }
      if (filters.tags && filters.tags.length > 0) {
        projects = projects.filter(p => 
          filters.tags!.some(tag => p.tags.includes(tag))
        );
      }
    }

    return projects.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async addPhase(projectId: string, phase: Omit<ProjectPhase, 'id'>): Promise<ProjectPhase> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const newPhase: ProjectPhase = {
      id: `phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...phase
    };

    project.phases.push(newPhase);
    project.updatedAt = new Date();

    this.addAuditEntry(project, 'system', 'phase_added', 'phase', {
      projectId,
      phaseId: newPhase.id,
      phaseName: newPhase.name
    });

    await this.saveProject(project);
    this.emit('phase:added', { project, phase: newPhase });

    return newPhase;
  }

  async updatePhase(projectId: string, phaseId: string, updates: Partial<ProjectPhase>): Promise<ProjectPhase> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const phaseIndex = project.phases.findIndex(p => p.id === phaseId);
    if (phaseIndex === -1) {
      throw new Error(`Phase not found: ${phaseId}`);
    }

    const updatedPhase = { ...project.phases[phaseIndex], ...updates };
    project.phases[phaseIndex] = updatedPhase;
    project.updatedAt = new Date();

    this.addAuditEntry(project, 'system', 'phase_updated', 'phase', {
      projectId,
      phaseId,
      changes: Object.keys(updates)
    });

    await this.saveProject(project);
    this.emit('phase:updated', { project, phase: updatedPhase });

    return updatedPhase;
  }

  async addTeamMember(projectId: string, member: TeamMember): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.collaboration.teamMembers.push(member);
    project.updatedAt = new Date();

    this.addAuditEntry(project, 'system', 'team_member_added', 'team', {
      projectId,
      memberId: member.id,
      memberName: member.name
    });

    await this.saveProject(project);
    this.emit('team:member_added', { project, member });
  }

  async removeTeamMember(projectId: string, memberId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const memberIndex = project.collaboration.teamMembers.findIndex(m => m.id === memberId);
    if (memberIndex === -1) {
      throw new Error(`Team member not found: ${memberId}`);
    }

    const member = project.collaboration.teamMembers[memberIndex];
    project.collaboration.teamMembers.splice(memberIndex, 1);
    project.updatedAt = new Date();

    this.addAuditEntry(project, 'system', 'team_member_removed', 'team', {
      projectId,
      memberId,
      memberName: member.name
    });

    await this.saveProject(project);
    this.emit('team:member_removed', { project, memberId });
  }

  async getProjectMetrics(projectId?: string): Promise<ProjectMetrics> {
    const projects = projectId ? 
      [this.projects.get(projectId)].filter(Boolean) as Project[] :
      Array.from(this.projects.values());

    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === 'active').length;
    const completedProjects = projects.filter(p => p.status === 'completed').length;

    const completedProjectsWithDuration = projects.filter(p => 
      p.status === 'completed' && p.timeline.actualStart && p.timeline.actualEnd
    );

    const averageProjectDuration = completedProjectsWithDuration.length > 0 ?
      completedProjectsWithDuration.reduce((sum, p) => {
        const duration = p.timeline.actualEnd!.getTime() - p.timeline.actualStart!.getTime();
        return sum + (duration / (1000 * 60 * 60 * 24)); // Convert to days
      }, 0) / completedProjectsWithDuration.length : 0;

    const budgetVariance = projects.reduce((sum, p) => {
      if (p.budget.total > 0) {
        return sum + ((p.budget.spent - p.budget.total) / p.budget.total);
      }
      return sum;
    }, 0) / Math.max(projects.length, 1);

    const resourceUtilization = projects.reduce((sum, p) => {
      const totalResources = p.phases.reduce((phaseSum, phase) => 
        phaseSum + phase.resources.length, 0
      );
      const utilizedResources = p.phases.reduce((phaseSum, phase) => 
        phaseSum + phase.resources.filter(r => r.availability > 0).length, 0
      );
      return sum + (totalResources > 0 ? utilizedResources / totalResources : 0);
    }, 0) / Math.max(projects.length, 1);

    const qualityScore = projects.reduce((sum, p) => {
      const phaseQuality = p.phases.reduce((phaseSum, phase) => {
        const metrics = phase.qualityMetrics;
        return phaseSum + (metrics.testCoverage + metrics.codeQuality + 
                          metrics.documentation + metrics.securityScore) / 4;
      }, 0) / Math.max(p.phases.length, 1);
      return sum + phaseQuality;
    }, 0) / Math.max(projects.length, 1);

    return {
      totalProjects,
      activeProjects,
      completedProjects,
      averageProjectDuration,
      budgetVariance,
      resourceUtilization,
      qualityScore,
      riskScore: 0, // Calculate based on risk assessment
      teamProductivity: 0, // Calculate based on velocity metrics
      customerSatisfaction: 0 // Calculate based on feedback
    };
  }

  async generateReport(
    projectId: string,
    type: ProjectReport['type'],
    userId: string = 'system'
  ): Promise<ProjectReport> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const report: ProjectReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      projectId,
      type,
      title: `${type.toUpperCase()} Report - ${project.name}`,
      summary: '',
      details: {},
      recommendations: [],
      generatedAt: new Date(),
      generatedBy: userId,
      format: 'json',
      recipients: []
    };

    switch (type) {
      case 'status':
        report.summary = `Project ${project.name} is currently ${project.status}`;
        report.details = {
          status: project.status,
          progress: this.calculateProjectProgress(project),
          phases: project.phases.map(p => ({
            name: p.name,
            status: p.status,
            completion: p.completionPercentage
          })),
          timeline: project.timeline,
          nextMilestones: this.getUpcomingMilestones(project)
        };
        break;

      case 'financial':
        report.summary = `Budget utilization: ${((project.budget.spent / project.budget.total) * 100).toFixed(1)}%`;
        report.details = {
          budget: project.budget,
          costBreakdown: this.calculateCostBreakdown(project),
          variance: project.budget.spent - project.budget.total,
          projectedCost: this.projectFinalCost(project)
        };
        break;

      case 'quality':
        const qualityMetrics = this.calculateQualityMetrics(project);
        report.summary = `Overall quality score: ${qualityMetrics.overall.toFixed(1)}%`;
        report.details = {
          qualityMetrics,
          qualityGates: project.qualityGates,
          recommendations: this.generateQualityRecommendations(project)
        };
        break;

      case 'risk':
        const risks = this.getAllRisks(project);
        report.summary = `${risks.filter(r => r.status === 'open').length} open risks identified`;
        report.details = {
          risks,
          riskMatrix: this.generateRiskMatrix(risks),
          mitigation: this.generateRiskMitigation(risks)
        };
        break;

      case 'resource':
        report.summary = `${project.collaboration.teamMembers.length} team members, ${this.getTotalResources(project)} resources allocated`;
        report.details = {
          teamMembers: project.collaboration.teamMembers,
          resourceAllocation: this.calculateResourceAllocation(project),
          utilization: this.calculateResourceUtilization(project),
          capacity: this.calculateCapacity(project)
        };
        break;

      case 'compliance':
        const compliance = this.calculateComplianceStatus(project);
        report.summary = `${compliance.compliant} of ${compliance.total} requirements met`;
        report.details = {
          requirements: project.complianceRequirements,
          status: compliance,
          gaps: this.identifyComplianceGaps(project),
          recommendations: this.generateComplianceRecommendations(project)
        };
        break;
    }

    this.addAuditEntry(project, userId, 'report_generated', 'report', {
      projectId,
      reportId: report.id,
      reportType: type
    });

    this.emit('report:generated', { project, report });
    return report;
  }

  private async loadProjects(): Promise<void> {
    try {
      const files = await readdir(this.projectsPath);
      const projectFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

      for (const file of projectFiles) {
        try {
          const content = await readFile(join(this.projectsPath, file), 'utf-8');
          const project: Project = JSON.parse(content);
          this.projects.set(project.id, project);
        } catch (error) {
          this.logger.error(`Failed to load project file: ${file}`, { error });
        }
      }

      this.logger.info(`Loaded ${this.projects.size} projects`);
    } catch (error) {
      this.logger.error('Failed to load projects', { error });
    }
  }

  private async saveProject(project: Project): Promise<void> {
    const filePath = join(this.projectsPath, `${project.id}.json`);
    await writeFile(filePath, JSON.stringify(project, null, 2));
  }

  private addAuditEntry(
    project: Project,
    userId: string,
    action: string,
    target: string,
    details: Record<string, any>
  ): void {
    const entry: ProjectAuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      userId,
      action,
      target,
      details
    };

    project.auditLog.push(entry);
  }

  private calculateProjectProgress(project: Project): number {
    if (project.phases.length === 0) return 0;
    
    const totalProgress = project.phases.reduce((sum, phase) => 
      sum + phase.completionPercentage, 0
    );
    
    return totalProgress / project.phases.length;
  }

  private getUpcomingMilestones(project: Project): ProjectMilestone[] {
    const allMilestones = project.phases.flatMap(p => p.milestones);
    const now = new Date();
    
    return allMilestones
      .filter(m => m.status === 'pending' && m.targetDate > now)
      .sort((a, b) => a.targetDate.getTime() - b.targetDate.getTime())
      .slice(0, 5);
  }

  private calculateCostBreakdown(project: Project): Record<string, number> {
    const breakdown: Record<string, number> = {};
    
    for (const phase of project.phases) {
      for (const resource of phase.resources) {
        const category = resource.type;
        const cost = resource.cost.amount;
        breakdown[category] = (breakdown[category] || 0) + cost;
      }
    }
    
    return breakdown;
  }

  private projectFinalCost(project: Project): number {
    const progress = this.calculateProjectProgress(project);
    if (progress === 0) return project.budget.total;
    
    return (project.budget.spent / progress) * 100;
  }

  private calculateQualityMetrics(project: Project): any {
    const allMetrics = project.phases.map(p => p.qualityMetrics);
    if (allMetrics.length === 0) {
      return { overall: 0, testCoverage: 0, codeQuality: 0, documentation: 0, securityScore: 0 };
    }

    const averages = {
      testCoverage: allMetrics.reduce((sum, m) => sum + m.testCoverage, 0) / allMetrics.length,
      codeQuality: allMetrics.reduce((sum, m) => sum + m.codeQuality, 0) / allMetrics.length,
      documentation: allMetrics.reduce((sum, m) => sum + m.documentation, 0) / allMetrics.length,
      securityScore: allMetrics.reduce((sum, m) => sum + m.securityScore, 0) / allMetrics.length
    };

    const overall = (averages.testCoverage + averages.codeQuality + 
                    averages.documentation + averages.securityScore) / 4;

    return { overall, ...averages };
  }

  private generateQualityRecommendations(project: Project): string[] {
    const recommendations: string[] = [];
    const metrics = this.calculateQualityMetrics(project);

    if (metrics.testCoverage < 80) {
      recommendations.push('Increase test coverage to at least 80%');
    }
    if (metrics.codeQuality < 70) {
      recommendations.push('Improve code quality through refactoring and code reviews');
    }
    if (metrics.documentation < 60) {
      recommendations.push('Enhance documentation coverage for better maintainability');
    }
    if (metrics.securityScore < 85) {
      recommendations.push('Address security vulnerabilities and implement security best practices');
    }

    return recommendations;
  }

  private getAllRisks(project: Project): ProjectRisk[] {
    return project.phases.flatMap(p => p.risks);
  }

  private generateRiskMatrix(risks: ProjectRisk[]): any {
    const matrix = {
      low: { low: 0, medium: 0, high: 0 },
      medium: { low: 0, medium: 0, high: 0 },
      high: { low: 0, medium: 0, high: 0 }
    };

    for (const risk of risks) {
      if (risk.status === 'open') {
        matrix[risk.probability][risk.impact]++;
      }
    }

    return matrix;
  }

  private generateRiskMitigation(risks: ProjectRisk[]): any {
    const openRisks = risks.filter(r => r.status === 'open');
    const highPriorityRisks = openRisks.filter(r => 
      (r.probability === 'high' && r.impact === 'high') ||
      (r.probability === 'high' && r.impact === 'medium') ||
      (r.probability === 'medium' && r.impact === 'high')
    );

    return {
      totalRisks: risks.length,
      openRisks: openRisks.length,
      highPriorityRisks: highPriorityRisks.length,
      mitigationActions: highPriorityRisks.map(r => ({
        risk: r.description,
        mitigation: r.mitigation,
        assignedTo: r.assignedTo
      }))
    };
  }

  private getTotalResources(project: Project): number {
    return project.phases.reduce((sum, phase) => sum + phase.resources.length, 0);
  }

  private calculateResourceAllocation(project: Project): any {
    const allocation: Record<string, number> = {};
    
    for (const phase of project.phases) {
      for (const resource of phase.resources) {
        allocation[resource.type] = (allocation[resource.type] || 0) + 1;
      }
    }
    
    return allocation;
  }

  private calculateResourceUtilization(project: Project): any {
    const utilization: Record<string, number> = {};
    
    for (const phase of project.phases) {
      for (const resource of phase.resources) {
        utilization[resource.type] = (utilization[resource.type] || 0) + resource.availability;
      }
    }
    
    return utilization;
  }

  private calculateCapacity(project: Project): any {
    const teamSize = project.collaboration.teamMembers.length;
    const totalAvailability = project.collaboration.teamMembers.reduce(
      (sum, member) => sum + member.availability, 0
    );
    
    return {
      teamSize,
      totalAvailability,
      averageAvailability: teamSize > 0 ? totalAvailability / teamSize : 0
    };
  }

  private calculateComplianceStatus(project: Project): any {
    const requirements = project.complianceRequirements;
    const total = requirements.length;
    const compliant = requirements.filter(r => r.status === 'compliant').length;
    const inProgress = requirements.filter(r => r.status === 'in-progress').length;
    const nonCompliant = requirements.filter(r => r.status === 'non-compliant').length;
    
    return {
      total,
      compliant,
      inProgress,
      nonCompliant,
      compliancePercentage: total > 0 ? (compliant / total) * 100 : 0
    };
  }

  private identifyComplianceGaps(project: Project): ComplianceRequirement[] {
    return project.complianceRequirements.filter(r => 
      r.status === 'not-started' || r.status === 'non-compliant'
    );
  }

  private generateComplianceRecommendations(project: Project): string[] {
    const gaps = this.identifyComplianceGaps(project);
    const recommendations: string[] = [];
    
    for (const gap of gaps) {
      recommendations.push(
        `Address ${gap.framework} requirement: ${gap.name} (Due: ${gap.dueDate.toLocaleDateString()})`
      );
    }
    
    return recommendations;
  }
}