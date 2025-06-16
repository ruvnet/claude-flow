/**
 * Workflow Service for TaskMaster
 * Manages workflow definitions and execution
 */

import {
  Workflow,
  WorkflowExecution,
  ExecutionStatus,
  WorkflowTrigger,
  TriggerType,
  WorkflowCondition,
  ConditionOperator,
  TemplateApplicationResult
} from '../../templates/types/template-types.ts';
import { TemplateService } from '../../templates/service/template-service.ts';
import { MemoryService } from '../../services/memory-adapter.ts';
import { v4 as uuidv4 } from 'npm:uuid@9.0.0';

export class WorkflowService {
  private memoryService: MemoryService;
  private templateService: TemplateService;
  private readonly WORKFLOW_NAMESPACE = 'taskmaster:workflows';
  private readonly EXECUTION_NAMESPACE = 'taskmaster:executions';

  constructor(memoryService: MemoryService, templateService: TemplateService) {
    this.memoryService = memoryService;
    this.templateService = templateService;
  }

  /**
   * Create a new workflow
   */
  async createWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workflow> {
    // Validate workflow
    await this.validateWorkflow(workflow);

    const newWorkflow: Workflow = {
      ...workflow,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.saveWorkflow(newWorkflow);
    return newWorkflow;
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    const workflows = await this.getAllWorkflows();
    return workflows.find(w => w.id === id) || null;
  }

  /**
   * Get all workflows
   */
  async getAllWorkflows(): Promise<Workflow[]> {
    const stored = await this.memoryService.retrieve(`${this.WORKFLOW_NAMESPACE}:all`);
    if (!stored) return [];
    
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  /**
   * Update a workflow
   */
  async updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) {
      throw new Error(`Workflow ${id} not found`);
    }

    const updatedWorkflow: Workflow = {
      ...workflow,
      ...updates,
      id, // Preserve original ID
      createdAt: workflow.createdAt, // Preserve creation date
      updatedAt: new Date()
    };

    await this.validateWorkflow(updatedWorkflow);
    await this.saveWorkflow(updatedWorkflow);
    return updatedWorkflow;
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(id: string): Promise<boolean> {
    const workflows = await this.getAllWorkflows();
    const filtered = workflows.filter(w => w.id !== id);
    
    if (filtered.length === workflows.length) {
      return false; // Workflow not found
    }

    await this.memoryService.store(
      `${this.WORKFLOW_NAMESPACE}:all`,
      JSON.stringify(filtered)
    );
    return true;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string, 
    variables: Record<string, any>,
    context?: any
  ): Promise<WorkflowExecution> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Check conditions
    if (workflow.conditions && !this.evaluateConditions(workflow.conditions, context)) {
      throw new Error('Workflow conditions not met');
    }

    // Create execution record
    const execution: WorkflowExecution = {
      workflowId,
      status: ExecutionStatus.RUNNING,
      currentStep: 0,
      variables,
      results: [],
      startedAt: new Date()
    };

    await this.saveExecution(execution);

    try {
      // Execute each template in sequence
      for (let i = 0; i < workflow.templates.length; i++) {
        execution.currentStep = i;
        
        const templateId = workflow.templates[i];
        const result = await this.templateService.applyTemplate({
          templateId,
          variables: this.mergeVariables(workflow.variables || [], variables)
        });

        execution.results.push(result);

        if (!result.success) {
          execution.status = ExecutionStatus.FAILED;
          execution.error = `Failed at step ${i + 1}: ${result.errors?.join(', ')}`;
          break;
        }
      }

      if (execution.status !== ExecutionStatus.FAILED) {
        execution.status = ExecutionStatus.COMPLETED;
        execution.completedAt = new Date();
      }
    } catch (error) {
      execution.status = ExecutionStatus.FAILED;
      execution.error = error instanceof Error ? error.message : 'Unknown error';
    }

    await this.saveExecution(execution);
    return execution;
  }

  /**
   * Get workflow executions
   */
  async getExecutions(workflowId?: string): Promise<WorkflowExecution[]> {
    const stored = await this.memoryService.retrieve(`${this.EXECUTION_NAMESPACE}:all`);
    if (!stored) return [];

    try {
      const executions: WorkflowExecution[] = JSON.parse(stored);
      if (workflowId) {
        return executions.filter(e => e.workflowId === workflowId);
      }
      return executions;
    } catch {
      return [];
    }
  }

  /**
   * Get workflows by trigger type
   */
  async getWorkflowsByTrigger(triggerType: TriggerType): Promise<Workflow[]> {
    const workflows = await this.getAllWorkflows();
    return workflows.filter(w => 
      w.triggers?.some(t => t.type === triggerType)
    );
  }

  /**
   * Trigger workflows based on event
   */
  async triggerWorkflows(
    triggerType: TriggerType, 
    context: any,
    variables: Record<string, any> = {}
  ): Promise<WorkflowExecution[]> {
    const workflows = await this.getWorkflowsByTrigger(triggerType);
    const executions: WorkflowExecution[] = [];

    for (const workflow of workflows) {
      try {
        // Check if workflow should auto-apply
        if (workflow.metadata?.autoApply === false) {
          continue;
        }

        // Check trigger config
        const trigger = workflow.triggers?.find(t => t.type === triggerType);
        if (trigger && !this.evaluateTriggerConfig(trigger, context)) {
          continue;
        }

        const execution = await this.executeWorkflow(workflow.id, variables, context);
        executions.push(execution);
      } catch (error) {
        console.error(`Failed to trigger workflow ${workflow.id}:`, error);
      }
    }

    return executions;
  }

  /**
   * Cancel a workflow execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const executions = await this.getExecutions();
    const execution = executions.find(e => 
      e.workflowId === executionId && e.status === ExecutionStatus.RUNNING
    );

    if (!execution) {
      return false;
    }

    execution.status = ExecutionStatus.CANCELLED;
    execution.completedAt = new Date();

    await this.memoryService.store(
      `${this.EXECUTION_NAMESPACE}:all`,
      JSON.stringify(executions)
    );

    return true;
  }

  /**
   * Validate workflow
   */
  private async validateWorkflow(workflow: Partial<Workflow>): Promise<void> {
    if (!workflow.name) {
      throw new Error('Workflow name is required');
    }

    if (!workflow.templates || workflow.templates.length === 0) {
      throw new Error('Workflow must have at least one template');
    }

    // Validate all templates exist
    for (const templateId of workflow.templates) {
      const template = await this.templateService.getTemplate(templateId);
      if (!template) {
        throw new Error(`Template ${templateId} not found`);
      }
    }
  }

  /**
   * Evaluate workflow conditions
   */
  private evaluateConditions(conditions: WorkflowCondition[], context: any): boolean {
    for (const condition of conditions) {
      const value = this.getNestedValue(context, condition.field);
      
      switch (condition.operator) {
        case ConditionOperator.EQUALS:
          if (value !== condition.value) return false;
          break;
        case ConditionOperator.NOT_EQUALS:
          if (value === condition.value) return false;
          break;
        case ConditionOperator.CONTAINS:
          if (!String(value).includes(String(condition.value))) return false;
          break;
        case ConditionOperator.GREATER_THAN:
          if (Number(value) <= Number(condition.value)) return false;
          break;
        case ConditionOperator.LESS_THAN:
          if (Number(value) >= Number(condition.value)) return false;
          break;
        case ConditionOperator.IN:
          if (!Array.isArray(condition.value) || !condition.value.includes(value)) return false;
          break;
        case ConditionOperator.NOT_IN:
          if (Array.isArray(condition.value) && condition.value.includes(value)) return false;
          break;
      }
    }
    
    return true;
  }

  /**
   * Evaluate trigger configuration
   */
  private evaluateTriggerConfig(trigger: WorkflowTrigger, context: any): boolean {
    // Implement trigger-specific logic
    switch (trigger.type) {
      case TriggerType.PRD_CREATED:
        return context.type === 'prd' && context.action === 'created';
      case TriggerType.PROJECT_STARTED:
        return context.type === 'project' && context.status === 'started';
      case TriggerType.PHASE_COMPLETED:
        return context.phase === trigger.config.phase && context.status === 'completed';
      default:
        return true;
    }
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Merge workflow variables with provided variables
   */
  private mergeVariables(
    workflowVars: any[], 
    providedVars: Record<string, any>
  ): Record<string, any> {
    const merged: Record<string, any> = {};

    // Add defaults from workflow variables
    for (const variable of workflowVars) {
      if (variable.default !== undefined) {
        merged[variable.name] = variable.default;
      }
    }

    // Override with provided variables
    Object.assign(merged, providedVars);

    return merged;
  }

  /**
   * Save workflow to memory
   */
  private async saveWorkflow(workflow: Workflow): Promise<void> {
    const workflows = await this.getAllWorkflows();
    const index = workflows.findIndex(w => w.id === workflow.id);
    
    if (index >= 0) {
      workflows[index] = workflow;
    } else {
      workflows.push(workflow);
    }

    await this.memoryService.store(
      `${this.WORKFLOW_NAMESPACE}:all`,
      JSON.stringify(workflows)
    );
  }

  /**
   * Save execution to memory
   */
  private async saveExecution(execution: WorkflowExecution): Promise<void> {
    const executions = await this.getExecutions();
    const index = executions.findIndex(e => 
      e.workflowId === execution.workflowId && 
      e.startedAt.getTime() === execution.startedAt.getTime()
    );
    
    if (index >= 0) {
      executions[index] = execution;
    } else {
      executions.push(execution);
    }

    await this.memoryService.store(
      `${this.EXECUTION_NAMESPACE}:all`,
      JSON.stringify(executions)
    );
  }

  /**
   * Import workflows from JSON
   */
  async importWorkflows(json: string): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    try {
      const data = JSON.parse(json);
      const workflows = Array.isArray(data) ? data : [data];

      for (const workflow of workflows) {
        try {
          await this.createWorkflow(workflow);
          imported++;
        } catch (error) {
          errors.push(`Failed to import workflow '${workflow.name}': ${error}`);
        }
      }
    } catch (error) {
      errors.push(`Invalid JSON: ${error}`);
    }

    return { imported, errors };
  }

  /**
   * Export workflows to JSON
   */
  async exportWorkflows(ids?: string[]): Promise<string> {
    let workflows = await this.getAllWorkflows();
    
    if (ids && ids.length > 0) {
      workflows = workflows.filter(w => ids.includes(w.id));
    }

    return JSON.stringify(workflows, null, 2);
  }
}