/**
 * PRD Workflow Sample
 * Automatically applies templates based on PRD content
 */

import { Workflow, TriggerType, ConditionOperator, VariableType } from '../../templates/types/template-types.ts';

export const prdWorkflow: Workflow = {
  id: 'prd-auto-workflow',
  name: 'PRD Auto-Template Application',
  description: 'Automatically applies relevant templates when a PRD is created',
  templates: [], // Will be dynamically selected based on PRD content
  triggers: [
    {
      type: TriggerType.PRD_CREATED,
      config: {
        autoDetect: true
      }
    }
  ],
  conditions: [
    {
      field: 'prd.status',
      operator: ConditionOperator.EQUALS,
      value: 'approved'
    }
  ],
  variables: [
    {
      name: 'projectName',
      type: VariableType.STRING,
      description: 'Name of the project from PRD',
      required: true,
      default: ''
    },
    {
      name: 'projectType',
      type: VariableType.ENUM,
      description: 'Type of project detected from PRD',
      required: true,
      options: ['web', 'mobile', 'api', 'ml', 'data'],
      default: 'web'
    }
  ],
  metadata: {
    autoApply: true,
    requiresApproval: true,
    notifyOnComplete: true
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

export const developmentWorkflow: Workflow = {
  id: 'full-stack-workflow',
  name: 'Full Stack Development Workflow',
  description: 'Complete workflow for full-stack application development',
  templates: [
    'api-service-template',
    'web-app-template'
  ],
  triggers: [
    {
      type: TriggerType.PROJECT_STARTED,
      config: {
        projectType: 'fullstack'
      }
    }
  ],
  variables: [
    {
      name: 'appName',
      type: VariableType.STRING,
      description: 'Application name',
      required: true,
      default: ''
    },
    {
      name: 'framework',
      type: VariableType.ENUM,
      description: 'Frontend framework',
      required: true,
      options: ['React', 'Vue', 'Angular'],
      default: 'React'
    },
    {
      name: 'backend',
      type: VariableType.ENUM,
      description: 'Backend technology',
      required: true,
      options: ['Node.ts', 'Python', 'Go'],
      default: 'Node.ts'
    },
    {
      name: 'database',
      type: VariableType.ENUM,
      description: 'Database type',
      required: true,
      options: ['PostgreSQL', 'MySQL', 'MongoDB'],
      default: 'PostgreSQL'
    }
  ],
  metadata: {
    autoApply: false,
    requiresApproval: true,
    notifyOnComplete: true
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

export const sparcPhaseWorkflow: Workflow = {
  id: 'sparc-phase-workflow',
  name: 'SPARC Phase Completion Workflow',
  description: 'Applies next phase templates when a SPARC phase is completed',
  templates: [], // Dynamically selected based on completed phase
  triggers: [
    {
      type: TriggerType.PHASE_COMPLETED,
      config: {
        phases: ['specification', 'architecture', 'refinement']
      }
    }
  ],
  conditions: [
    {
      field: 'phase.tasksCompleted',
      operator: ConditionOperator.EQUALS,
      value: 'phase.totalTasks'
    }
  ],
  variables: [
    {
      name: 'completedPhase',
      type: VariableType.STRING,
      description: 'The phase that was just completed',
      required: true,
      default: ''
    },
    {
      name: 'nextPhase',
      type: VariableType.STRING,
      description: 'The next phase to begin',
      required: true,
      default: ''
    }
  ],
  metadata: {
    autoApply: true,
    requiresApproval: false,
    notifyOnComplete: true
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

// Export all sample workflows
export const sampleWorkflows = [
  prdWorkflow,
  developmentWorkflow,
  sparcPhaseWorkflow
];