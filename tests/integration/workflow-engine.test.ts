/**
 * Integration tests for the Workflow Engine
 */

import { assertEquals, assertExists, assertThrows } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { WorkflowEngine, WorkflowDefinition, ExecutionOptions } from '../../package/src/workflow/engine.ts';

describe('Workflow Engine Integration Tests', () => {
  let engine: WorkflowEngine;
  let testWorkflowDir: string;

  beforeEach(async () => {
    engine = new WorkflowEngine({ debug: true, monitoring: false });
    testWorkflowDir = await Deno.makeTempDir({ prefix: 'workflow-test-' });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testWorkflowDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Workflow Loading', () => {
    it('should load JSON workflow files', async () => {
      const workflowPath = `${testWorkflowDir}/test-workflow.json`;
      const workflow: WorkflowDefinition = {
        name: 'Test Workflow',
        version: '1.0.0',
        description: 'A test workflow',
        tasks: [
          {
            id: 'test-task',
            type: 'test',
            description: 'A test task'
          }
        ]
      };

      await Deno.writeTextFile(workflowPath, JSON.stringify(workflow, null, 2));
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      assertEquals(loadedWorkflow.name, 'Test Workflow');
      assertEquals(loadedWorkflow.tasks.length, 1);
      assertEquals(loadedWorkflow.tasks[0].id, 'test-task');
    });

    it('should load YAML workflow files', async () => {
      const workflowPath = `${testWorkflowDir}/test-workflow.yaml`;
      const yamlContent = `
name: "YAML Test Workflow"
version: "1.0.0"
description: "A test workflow in YAML format"
tasks:
  - id: "yaml-task"
    type: "test"
    description: "A YAML test task"
`;

      await Deno.writeTextFile(workflowPath, yamlContent);
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      assertEquals(loadedWorkflow.name, 'YAML Test Workflow');
      assertEquals(loadedWorkflow.tasks.length, 1);
      assertEquals(loadedWorkflow.tasks[0].id, 'yaml-task');
    });

    it('should handle invalid workflow files', async () => {
      const workflowPath = `${testWorkflowDir}/invalid-workflow.json`;
      await Deno.writeTextFile(workflowPath, 'invalid json content');
      
      await assertThrows(
        async () => await engine.loadWorkflow(workflowPath),
        Error,
        'Failed to load workflow file'
      );
    });
  });

  describe('Workflow Validation', () => {
    it('should validate correct workflow definitions', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Valid Workflow',
        tasks: [
          {
            id: 'task1',
            type: 'research',
            description: 'First task'
          },
          {
            id: 'task2',
            type: 'analysis',
            description: 'Second task',
            depends: ['task1']
          }
        ]
      };

      const validation = await engine.validateWorkflow(workflow);
      assertEquals(validation.valid, true);
      assertEquals(validation.errors.length, 0);
    });

    it('should detect missing required fields', async () => {
      const workflow: WorkflowDefinition = {
        name: '',
        tasks: []
      };

      const validation = await engine.validateWorkflow(workflow);
      assertEquals(validation.valid, false);
      assertEquals(validation.errors.includes('Workflow name is required'), true);
      assertEquals(validation.errors.includes('At least one task is required'), true);
    });

    it('should detect circular dependencies', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Circular Dependencies',
        tasks: [
          {
            id: 'task1',
            type: 'test',
            description: 'Task 1',
            depends: ['task2']
          },
          {
            id: 'task2',
            type: 'test',
            description: 'Task 2',
            depends: ['task1']
          }
        ]
      };

      const validation = await engine.validateWorkflow(workflow, true);
      assertEquals(validation.valid, false);
      assertEquals(validation.errors.includes('Circular dependencies detected'), true);
    });

    it('should validate agent assignments', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Agent Assignment Test',
        agents: [
          {
            id: 'agent1',
            type: 'researcher'
          }
        ],
        tasks: [
          {
            id: 'task1',
            type: 'research',
            description: 'Research task',
            assignTo: 'agent1'
          },
          {
            id: 'task2',
            type: 'analysis',
            description: 'Analysis task',
            assignTo: 'nonexistent-agent'
          }
        ]
      };

      const validation = await engine.validateWorkflow(workflow);
      assertEquals(validation.valid, false);
      assertEquals(validation.errors.some(e => e.includes('unknown agent nonexistent-agent')), true);
    });
  });

  describe('Workflow Execution', () => {
    it('should execute simple workflow successfully', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Simple Execution Test',
        tasks: [
          {
            id: 'simple-task',
            type: 'test',
            description: 'A simple test task'
          }
        ],
        settings: {
          maxConcurrency: 1,
          timeout: 30000
        }
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.workflowName, 'Simple Execution Test');
      assertEquals(execution.status, 'completed');
      assertEquals(execution.progress.total, 1);
      assertEquals(execution.progress.completed, 1);
      assertEquals(execution.progress.failed, 0);
      assertExists(execution.completedAt);
      assertExists(execution.duration);
    });

    it('should execute workflow with dependencies', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Dependency Test',
        tasks: [
          {
            id: 'task1',
            type: 'test',
            description: 'First task'
          },
          {
            id: 'task2',
            type: 'test',
            description: 'Second task',
            depends: ['task1']
          },
          {
            id: 'task3',
            type: 'test',
            description: 'Third task',
            depends: ['task1', 'task2']
          }
        ]
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.progress.total, 3);
      assertEquals(execution.progress.completed, 3);
      
      // Verify execution order
      const task1 = execution.tasks.find(t => t.taskId === 'task1')!;
      const task2 = execution.tasks.find(t => t.taskId === 'task2')!;
      const task3 = execution.tasks.find(t => t.taskId === 'task3')!;
      
      assertEquals(task1.status, 'completed');
      assertEquals(task2.status, 'completed');
      assertEquals(task3.status, 'completed');
      
      // Task 1 should complete before task 2
      assertEquals(task1.completedAt! <= task2.startedAt!, true);
      // Tasks 1 and 2 should complete before task 3
      assertEquals(task1.completedAt! <= task3.startedAt!, true);
      assertEquals(task2.completedAt! <= task3.startedAt!, true);
    });

    it('should handle parallel execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel Execution Test',
        tasks: [
          {
            id: 'task1',
            type: 'test',
            description: 'Parallel task 1',
            parallel: true
          },
          {
            id: 'task2',
            type: 'test',
            description: 'Parallel task 2',
            parallel: true
          },
          {
            id: 'task3',
            type: 'test',
            description: 'Final task',
            depends: ['task1', 'task2']
          }
        ],
        settings: {
          maxConcurrency: 3
        }
      };

      const startTime = Date.now();
      const execution = await engine.executeWorkflow(workflow);
      const endTime = Date.now();
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.progress.total, 3);
      assertEquals(execution.progress.completed, 3);
      
      // Parallel execution should be faster than sequential
      const executionTime = endTime - startTime;
      assertEquals(executionTime < 5000, true); // Should complete in less than 5 seconds
    });

    it('should handle conditional execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Conditional Execution Test',
        variables: {
          enableOptionalTask: false
        },
        conditions: [
          {
            id: 'optional-condition',
            expression: 'variables.enableOptionalTask === true',
            type: 'javascript'
          }
        ],
        tasks: [
          {
            id: 'required-task',
            type: 'test',
            description: 'Always executed task'
          },
          {
            id: 'optional-task',
            type: 'test',
            description: 'Conditionally executed task',
            condition: 'optional-condition'
          }
        ]
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.progress.total, 2);
      assertEquals(execution.progress.completed, 1);
      assertEquals(execution.progress.skipped, 1);
      
      const requiredTask = execution.tasks.find(t => t.taskId === 'required-task')!;
      const optionalTask = execution.tasks.find(t => t.taskId === 'optional-task')!;
      
      assertEquals(requiredTask.status, 'completed');
      assertEquals(optionalTask.status, 'skipped');
    });

    it('should handle task retries on failure', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Retry Test',
        tasks: [
          {
            id: 'flaky-task',
            type: 'test',
            description: 'Task that might fail',
            retries: 2
          }
        ],
        settings: {
          retryPolicy: 'immediate'
        }
      };

      // Mock a task that fails the first time but succeeds on retry
      const originalExecuteTaskByType = (engine as any).executeTaskByType;
      let attemptCount = 0;
      
      (engine as any).executeTaskByType = async function(execution: any, task: any, taskDef: any) {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Simulated failure');
        }
        return originalExecuteTaskByType.call(this, execution, task, taskDef);
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.progress.completed, 1);
      assertEquals(execution.progress.failed, 0);
      
      const task = execution.tasks.find(t => t.taskId === 'flaky-task')!;
      assertEquals(task.status, 'completed');
      assertEquals(task.retryCount, 1);
    });

    it('should handle workflow timeout', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Timeout Test',
        tasks: [
          {
            id: 'long-task',
            type: 'test',
            description: 'A task that takes too long',
            timeout: 100 // Very short timeout
          }
        ]
      };

      // Mock a task that takes longer than the timeout
      (engine as any).executeTaskByType = async function() {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true };
      };

      const execution = await engine.executeWorkflow(workflow);
      
      // The workflow should handle the timeout gracefully
      assertEquals(execution.status, 'failed');
      assertEquals(execution.progress.failed, 1);
    });
  });

  describe('Workflow Management', () => {
    it('should list workflow executions', async () => {
      const workflow1: WorkflowDefinition = {
        name: 'Workflow 1',
        tasks: [{ id: 'task1', type: 'test', description: 'Task 1' }]
      };
      
      const workflow2: WorkflowDefinition = {
        name: 'Workflow 2',
        tasks: [{ id: 'task2', type: 'test', description: 'Task 2' }]
      };

      const execution1 = await engine.executeWorkflow(workflow1);
      const execution2 = await engine.executeWorkflow(workflow2);
      
      const executions = engine.listExecutions();
      assertEquals(executions.length, 2);
      assertEquals(executions.some(e => e.id === execution1.id), true);
      assertEquals(executions.some(e => e.id === execution2.id), true);
    });

    it('should filter workflow executions', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Filter Test',
        tasks: [{ id: 'task1', type: 'test', description: 'Task 1' }]
      };

      const execution = await engine.executeWorkflow(workflow);
      
      const filteredByName = engine.listExecutions({ workflowName: 'Filter Test' });
      assertEquals(filteredByName.length, 1);
      assertEquals(filteredByName[0].id, execution.id);
      
      const filteredByStatus = engine.listExecutions({ status: 'completed' });
      assertEquals(filteredByStatus.length, 1);
      assertEquals(filteredByStatus[0].id, execution.id);
      
      const filteredByDifferentName = engine.listExecutions({ workflowName: 'Nonexistent' });
      assertEquals(filteredByDifferentName.length, 0);
    });

    it('should cancel workflow execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Cancellation Test',
        tasks: [
          {
            id: 'long-task',
            type: 'test',
            description: 'A long running task'
          }
        ]
      };

      // Mock a long-running task
      (engine as any).executeTaskByType = async function() {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
        return { success: true };
      };

      // Start execution in background
      const executionPromise = engine.executeWorkflow(workflow);
      
      // Wait a bit then cancel
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const executions = engine.listExecutions();
      assertEquals(executions.length, 1);
      
      await engine.cancelExecution(executions[0].id);
      
      const execution = await executionPromise;
      assertEquals(execution.status, 'cancelled');
    });
  });

  describe('Error Handling', () => {
    it('should handle task failures with fail-fast policy', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Fail Fast Test',
        tasks: [
          {
            id: 'failing-task',
            type: 'test',
            description: 'Task that fails'
          },
          {
            id: 'subsequent-task',
            type: 'test',
            description: 'Task that should not run'
          }
        ],
        settings: {
          failurePolicy: 'fail-fast'
        }
      };

      // Mock a failing task
      (engine as any).executeTaskByType = async function(execution: any, task: any, taskDef: any) {
        if (taskDef.id === 'failing-task') {
          throw new Error('Intentional failure');
        }
        return { success: true };
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'failed');
      assertEquals(execution.progress.failed, 1);
      assertEquals(execution.progress.completed, 0);
      
      const failingTask = execution.tasks.find(t => t.taskId === 'failing-task')!;
      const subsequentTask = execution.tasks.find(t => t.taskId === 'subsequent-task')!;
      
      assertEquals(failingTask.status, 'failed');
      assertEquals(subsequentTask.status, 'pending'); // Should not have started
    });

    it('should handle task failures with continue policy', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Continue Test',
        tasks: [
          {
            id: 'failing-task',
            type: 'test',
            description: 'Task that fails'
          },
          {
            id: 'success-task',
            type: 'test',
            description: 'Task that succeeds'
          }
        ],
        settings: {
          failurePolicy: 'continue'
        }
      };

      // Mock mixed success/failure
      (engine as any).executeTaskByType = async function(execution: any, task: any, taskDef: any) {
        if (taskDef.id === 'failing-task') {
          throw new Error('Intentional failure');
        }
        return { success: true };
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'failed'); // Overall failed due to one failure
      assertEquals(execution.progress.failed, 1);
      assertEquals(execution.progress.completed, 1);
      
      const failingTask = execution.tasks.find(t => t.taskId === 'failing-task')!;
      const successTask = execution.tasks.find(t => t.taskId === 'success-task')!;
      
      assertEquals(failingTask.status, 'failed');
      assertEquals(successTask.status, 'completed');
    });
  });

  describe('Variable and Context Management', () => {
    it('should handle variable substitution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Variable Test',
        variables: {
          testValue: 'Hello World',
          numericValue: 42
        },
        tasks: [
          {
            id: 'variable-task',
            type: 'test',
            description: 'Task using variables',
            input: {
              message: '${testValue}',
              number: '${numericValue}'
            }
          }
        ]
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.context.variables.testValue, 'Hello World');
      assertEquals(execution.context.variables.numericValue, 42);
    });

    it('should handle output storage and retrieval', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Output Test',
        tasks: [
          {
            id: 'producer-task',
            type: 'test',
            description: 'Task that produces output',
            output: ['result', 'data']
          },
          {
            id: 'consumer-task',
            type: 'test',
            description: 'Task that consumes output',
            depends: ['producer-task'],
            input: {
              inputData: '${producer-task.result}'
            }
          }
        ]
      };

      // Mock task that produces output
      (engine as any).executeTaskByType = async function(execution: any, task: any, taskDef: any) {
        if (taskDef.id === 'producer-task') {
          return {
            result: 'produced data',
            data: { value: 123 }
          };
        }
        return { success: true };
      };

      const execution = await engine.executeWorkflow(workflow);
      
      assertEquals(execution.status, 'completed');
      assertEquals(execution.context.outputs['producer-task.result'], 'produced data');
      assertEquals(execution.context.outputs['producer-task.data'].value, 123);
    });
  });
});