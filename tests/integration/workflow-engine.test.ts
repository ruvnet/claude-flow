/// <reference types="jest" />

/**
 * Integration tests for the Workflow Engine
 */

import { WorkflowEngine, WorkflowDefinition, ExecutionOptions } from '../../package/src/workflow/engine.js';

describe('Workflow Engine Integration Tests', () => {
  let engine: WorkflowEngine;
  let testWorkflowDir: string;

  beforeEach(async () => {
    engine = new WorkflowEngine({ debug: true, monitoring: false });
    testWorkflowDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
  });

  afterEach(async () => {
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testWorkflowDir, { recursive: true });
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

      fs.writeFileSync(workflowPath,  JSON.stringify(workflow, null, 2, "utf8"));
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Test Workflow');
      expect(loadedWorkflow.tasks.length).toBe( 1);
      expect(loadedWorkflow.tasks[0].id).toBe( 'test-task');
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

      fs.writeFileSync(workflowPath,  yamlContent, "utf8");
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'YAML Test Workflow');
      expect(loadedWorkflow.tasks.length).toBe( 1);
      expect(loadedWorkflow.tasks[0].id).toBe( 'yaml-task');
    });

    it('should handle invalid workflow files', async () => {
      const workflowPath = `${testWorkflowDir}/invalid-workflow.json`;
      fs.writeFileSync(workflowPath,  'invalid json content', "utf8");
      
      await expect(
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
      expect(validation.valid).toBe( true);
      expect(validation.errors.length).toBe( 0);
    });

    it('should detect missing required fields', async () => {
      const workflow: WorkflowDefinition = {
        name: '',
        tasks: []
      };

      const validation = await engine.validateWorkflow(workflow);
      expect(validation.valid).toBe( false);
      expect(validation.errors.includes('Workflow name is required')).toBe( true);
      expect(validation.errors.includes('At least one task is required')).toBe( true);
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
      expect(validation.valid).toBe( false);
      expect(validation.errors.includes('Circular dependencies detected')).toBe( true);
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
      expect(validation.valid).toBe( false);
      expect(validation.errors.some(e => e.includes('unknown agent nonexistent-agent'))).toBe( true);
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
      
      expect(execution.workflowName).toBe( 'Simple Execution Test');
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 1);
      expect(execution.progress.completed).toBe( 1);
      expect(execution.progress.failed).toBe( 0);
      expect(execution.completedAt);
      expect(execution.duration);
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 3);
      expect(execution.progress.completed).toBe( 3);
      
      // Verify execution order
      const task1 = execution.tasks.find(t => t.taskId === 'task1')!;
      const task2 = execution.tasks.find(t => t.taskId === 'task2')!;
      const task3 = execution.tasks.find(t => t.taskId === 'task3')!;
      
      expect(task1.status).toBe( 'completed');
      expect(task2.status).toBe( 'completed');
      expect(task3.status).toBe( 'completed');
      
      // Task 1 should complete before task 2
      expect(task1.completedAt! <= task2.startedAt!).toBe( true);
      // Tasks 1 and 2 should complete before task 3
      expect(task1.completedAt! <= task3.startedAt!).toBe( true);
      expect(task2.completedAt! <= task3.startedAt!).toBe( true);
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 3);
      expect(execution.progress.completed).toBe( 3);
      
      // Parallel execution should be faster than sequential
      const executionTime = endTime - startTime;
      expect(executionTime < 5000).toBe( true); // Should complete in less than 5 seconds
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 2);
      expect(execution.progress.completed).toBe( 1);
      expect(execution.progress.skipped).toBe( 1);
      
      const requiredTask = execution.tasks.find(t => t.taskId === 'required-task')!;
      const optionalTask = execution.tasks.find(t => t.taskId === 'optional-task')!;
      
      expect(requiredTask.status).toBe( 'completed');
      expect(optionalTask.status).toBe( 'skipped');
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.completed).toBe( 1);
      expect(execution.progress.failed).toBe( 0);
      
      const task = execution.tasks.find(t => t.taskId === 'flaky-task')!;
      expect(task.status).toBe( 'completed');
      expect(task.retryCount).toBe( 1);
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
      expect(execution.status).toBe( 'failed');
      expect(execution.progress.failed).toBe( 1);
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
      expect(executions.length).toBe( 2);
      expect(executions.some(e => e.id === execution1.id)).toBe( true);
      expect(executions.some(e => e.id === execution2.id)).toBe( true);
    });

    it('should filter workflow executions', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Filter Test',
        tasks: [{ id: 'task1', type: 'test', description: 'Task 1' }]
      };

      const execution = await engine.executeWorkflow(workflow);
      
      const filteredByName = engine.listExecutions({ workflowName: 'Filter Test' });
      expect(filteredByName.length).toBe( 1);
      expect(filteredByName[0].id).toBe( execution.id);
      
      const filteredByStatus = engine.listExecutions({ status: 'completed' });
      expect(filteredByStatus.length).toBe( 1);
      expect(filteredByStatus[0].id).toBe( execution.id);
      
      const filteredByDifferentName = engine.listExecutions({ workflowName: 'Nonexistent' });
      expect(filteredByDifferentName.length).toBe( 0);
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
      expect(executions.length).toBe( 1);
      
      await engine.cancelExecution(executions[0].id);
      
      const execution = await executionPromise;
      expect(execution.status).toBe( 'cancelled');
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
      
      expect(execution.status).toBe( 'failed');
      expect(execution.progress.failed).toBe( 1);
      expect(execution.progress.completed).toBe( 0);
      
      const failingTask = execution.tasks.find(t => t.taskId === 'failing-task')!;
      const subsequentTask = execution.tasks.find(t => t.taskId === 'subsequent-task')!;
      
      expect(failingTask.status).toBe( 'failed');
      expect(subsequentTask.status).toBe( 'pending'); // Should not have started
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
      
      expect(execution.status).toBe( 'failed'); // Overall failed due to one failure
      expect(execution.progress.failed).toBe( 1);
      expect(execution.progress.completed).toBe( 1);
      
      const failingTask = execution.tasks.find(t => t.taskId === 'failing-task')!;
      const successTask = execution.tasks.find(t => t.taskId === 'success-task')!;
      
      expect(failingTask.status).toBe( 'failed');
      expect(successTask.status).toBe( 'completed');
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.context.variables.testValue).toBe( 'Hello World');
      expect(execution.context.variables.numericValue).toBe( 42);
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
      
      expect(execution.status).toBe( 'completed');
      expect(execution.context.outputs['producer-task.result']).toBe( 'produced data');
      expect(execution.context.outputs['producer-task.data'].value).toBe( 123);
    });
  });
});
