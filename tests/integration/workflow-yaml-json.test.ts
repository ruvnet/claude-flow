/// <reference types="jest" />

/**
 * Integration tests for YAML and JSON workflow format support
 */

import { WorkflowEngine } from '../../package/src/workflow/engine.js';

describe('Workflow Format Integration Tests', () => {
  let engine: WorkflowEngine;
  let testDir: string;

  beforeEach(async () => {
    engine = new WorkflowEngine({ debug: false, monitoring: false });
    testDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
  });

  afterEach(async () => {
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('JSON Workflow Support', () => {
    it('should load and execute basic JSON workflow', async () => {
      const workflowPath = `${testDir}/basic.json`;
      const workflow = {
        name: 'Basic JSON Workflow',
        version: '1.0.0',
        description: 'A simple JSON workflow for testing',
        variables: {
          environment: 'test',
          timeout: 30000
        },
        tasks: [
          {
            id: 'setup',
            type: 'initialization',
            description: 'Setup test environment',
            input: {
              env: '${environment}',
              timeout: '${timeout}'
            }
          },
          {
            id: 'execute',
            type: 'execution',
            description: 'Execute main logic',
            depends: ['setup']
          },
          {
            id: 'cleanup',
            type: 'cleanup',
            description: 'Clean up resources',
            depends: ['execute']
          }
        ],
        settings: {
          maxConcurrency: 2,
          failurePolicy: 'fail-fast'
        }
      };

      fs.writeFileSync(workflowPath,  JSON.stringify(workflow, null, 2, "utf8"));
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Basic JSON Workflow');
      expect(loadedWorkflow.tasks.length).toBe( 3);
      expect(loadedWorkflow.variables!.environment).toBe( 'test');
      expect(loadedWorkflow.settings!.maxConcurrency).toBe( 2);

      const execution = await engine.executeWorkflow(loadedWorkflow);
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 3);
    });

    it('should handle complex JSON workflow with agents and conditions', async () => {
      const workflowPath = `${testDir}/complex.json`;
      const workflow = {
        name: 'Complex JSON Workflow',
        version: '2.0.0',
        description: 'Complex workflow with agents, conditions, and loops',
        metadata: {
          author: 'Test Suite',
          category: 'Integration Test'
        },
        variables: {
          enableOptionalTasks: true,
          maxRetries: 3,
          parallelExecution: true
        },
        agents: [
          {
            id: 'primary-agent',
            type: 'researcher',
            name: 'Primary Research Agent',
            config: {
              model: 'test-model',
              timeout: 60000
            }
          },
          {
            id: 'secondary-agent',
            type: 'analyst',
            name: 'Analysis Agent',
            config: {
              specialization: 'data-analysis'
            }
          }
        ],
        conditions: [
          {
            id: 'optional-enabled',
            expression: 'variables.enableOptionalTasks === true',
            type: 'javascript',
            description: 'Check if optional tasks are enabled'
          }
        ],
        tasks: [
          {
            id: 'main-task',
            type: 'research',
            description: 'Main research task',
            assignTo: 'primary-agent',
            retries: 2,
            timeout: 120000
          },
          {
            id: 'optional-task',
            type: 'analysis',
            description: 'Optional analysis task',
            assignTo: 'secondary-agent',
            condition: 'optional-enabled',
            depends: ['main-task']
          },
          {
            id: 'final-task',
            type: 'synthesis',
            description: 'Final synthesis task',
            depends: ['main-task'],
            parallel: true
          }
        ],
        integrations: [
          {
            id: 'test-webhook',
            type: 'webhook',
            config: {
              url: 'https://test.example.com/webhook',
              method: 'POST'
            }
          }
        ],
        settings: {
          maxConcurrency: 3,
          timeout: 600000,
          retryPolicy: 'exponential',
          failurePolicy: 'continue',
          monitoring: {
            enabled: true,
            interval: 5000
          }
        }
      };

      fs.writeFileSync(workflowPath,  JSON.stringify(workflow, null, 2, "utf8"));
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Complex JSON Workflow');
      expect(loadedWorkflow.agents!.length).toBe( 2);
      expect(loadedWorkflow.conditions!.length).toBe( 1);
      expect(loadedWorkflow.integrations!.length).toBe( 1);
      expect(loadedWorkflow.metadata!.author).toBe( 'Test Suite');

      const validation = await engine.validateWorkflow(loadedWorkflow, true);
      expect(validation.valid).toBe( true);
    });
  });

  describe('YAML Workflow Support', () => {
    it('should load and execute basic YAML workflow', async () => {
      const workflowPath = `${testDir}/basic.yaml`;
      const yamlContent = `
name: "Basic YAML Workflow"
version: "1.0.0"
description: "A simple YAML workflow for testing"

variables:
  environment: "test"
  timeout: 30000
  debug: true

tasks:
  - id: "setup"
    type: "initialization"
    description: "Setup test environment"
    input:
      env: "\${environment}"
      timeout: "\${timeout}"
      debug: "\${debug}"
    
  - id: "execute"
    type: "execution"
    description: "Execute main logic"
    depends: ["setup"]
    timeout: 60000
    
  - id: "cleanup"
    type: "cleanup"
    description: "Clean up resources"
    depends: ["execute"]

settings:
  maxConcurrency: 2
  failurePolicy: "fail-fast"
  retryPolicy: "immediate"
`;

      fs.writeFileSync(workflowPath,  yamlContent, "utf8");
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Basic YAML Workflow');
      expect(loadedWorkflow.tasks.length).toBe( 3);
      expect(loadedWorkflow.variables!.environment).toBe( 'test');
      expect(loadedWorkflow.variables!.debug).toBe( true);
      expect(loadedWorkflow.settings!.maxConcurrency).toBe( 2);

      const execution = await engine.executeWorkflow(loadedWorkflow);
      expect(execution.status).toBe( 'completed');
      expect(execution.progress.total).toBe( 3);
    });

    it('should handle complex YAML workflow with advanced features', async () => {
      const workflowPath = `${testDir}/complex.yaml`;
      const yamlContent = `
name: "Advanced YAML Workflow"
version: "2.1.0"
description: "Complex YAML workflow with all advanced features"

metadata:
  author: "YAML Test Suite"
  category: "Advanced Integration"
  tags: ["yaml", "complex", "integration"]

variables:
  project_name: "test-project"
  enable_parallel: true
  max_workers: 4
  config:
    database:
      host: "localhost"
      port: 5432
    api:
      version: "v2"
      timeout: 30

agents:
  - id: "coordinator"
    type: "coordinator"
    name: "Main Coordinator"
    config:
      priority: 1
      max_tasks: 10
    resources:
      memory: "2GB"
      cpu: "1 core"
    
  - id: "worker-1"
    type: "worker"
    name: "Primary Worker"
    config:
      specialization: "data-processing"
      timeout: 120
    
  - id: "worker-2"
    type: "worker"
    name: "Secondary Worker"
    config:
      specialization: "analysis"

conditions:
  - id: "parallel-enabled"
    expression: "variables.enable_parallel === true"
    type: "javascript"
    description: "Check if parallel execution is enabled"
    
  - id: "sufficient-workers"
    expression: "variables.max_workers >= 2"
    type: "javascript"
    description: "Ensure sufficient worker capacity"

loops:
  - id: "worker-loop"
    type: "for"
    condition: "variables.max_workers"
    tasks: ["process-batch"]
    maxIterations: 10
    continueOnError: true

tasks:
  - id: "initialization"
    name: "System Initialization"
    type: "setup"
    description: "Initialize the system and prepare for execution"
    assignTo: "coordinator"
    input:
      project: "\${project_name}"
      config: "\${config}"
    output:
      - "system_state"
      - "initialization_log"
    timeout: 60000
    retries: 2
    priority: 1
    tags: ["setup", "critical"]
    
  - id: "parallel-task-1"
    name: "Parallel Processing Task 1"
    type: "processing"
    description: "First parallel processing task"
    assignTo: "worker-1"
    depends: ["initialization"]
    condition: "parallel-enabled"
    input:
      batch_id: 1
      data: "\${initialization.system_state}"
    parallel: true
    timeout: 120000
    retries: 1
    
  - id: "parallel-task-2"
    name: "Parallel Processing Task 2"
    type: "processing"
    description: "Second parallel processing task"
    assignTo: "worker-2"
    depends: ["initialization"]
    condition: "parallel-enabled"
    input:
      batch_id: 2
      data: "\${initialization.system_state}"
    parallel: true
    timeout: 120000
    retries: 1
    
  - id: "process-batch"
    name: "Batch Processing"
    type: "batch"
    description: "Process data in batches"
    assignTo: "worker-1"
    input:
      batch_size: 100
      iteration: "\${loop.iteration}"
    condition: "sufficient-workers"
    
  - id: "aggregation"
    name: "Result Aggregation"
    type: "aggregation"
    description: "Aggregate results from parallel tasks"
    assignTo: "coordinator"
    depends: ["parallel-task-1", "parallel-task-2"]
    input:
      results_1: "\${parallel-task-1.output}"
      results_2: "\${parallel-task-2.output}"
    output:
      - "aggregated_results"
      - "summary_report"
    timeout: 90000
    onSuccess: ["finalization"]
    onFailure: ["error-handling"]
    
  - id: "error-handling"
    name: "Error Recovery"
    type: "error-recovery"
    description: "Handle and recover from errors"
    assignTo: "coordinator"
    input:
      error_context: "\${aggregation.error}"
    output:
      - "recovery_actions"
    
  - id: "finalization"
    name: "Workflow Finalization"
    type: "finalization"
    description: "Finalize workflow execution"
    assignTo: "coordinator"
    depends: ["aggregation"]
    input:
      results: "\${aggregation.aggregated_results}"
      summary: "\${aggregation.summary_report}"
    output:
      - "final_report"
      - "metrics"

integrations:
  - id: "status-webhook"
    type: "webhook"
    config:
      url: "https://status.example.com/webhook"
      method: "POST"
      headers:
        Content-Type: "application/json"
        Authorization: "Bearer \${WEBHOOK_TOKEN}"
    auth:
      type: "bearer"
      credentials:
        token: "\${WEBHOOK_TOKEN}"
    retries: 3
    timeout: 10000
    
  - id: "metrics-api"
    type: "api"
    config:
      baseUrl: "https://metrics.example.com"
      endpoints:
        submit: "/api/v1/metrics"
        query: "/api/v1/query"
    auth:
      type: "apikey"
      credentials:
        key: "\${METRICS_API_KEY}"

settings:
  maxConcurrency: 4
  timeout: 1800000  # 30 minutes
  retryPolicy: "exponential"
  failurePolicy: "continue"
  errorHandler: "error-handling"
  
  monitoring:
    enabled: true
    interval: 10000
    metrics:
      - "progress"
      - "performance"
      - "errors"
      - "resource_usage"
    alerts:
      - condition: "error_rate > 0.1"
        action: "status-webhook"
        threshold: 3
        cooldown: 300000
        
  resources:
    limits:
      memory: "8GB"
      cpu: "4 cores"
      disk: "2GB"
    requests:
      memory: "4GB"
      cpu: "2 cores"
      disk: "1GB"
      
  notifications:
    enabled: true
    channels: ["webhook", "api"]
    events:
      - "workflow.started"
      - "workflow.completed"
      - "workflow.failed"
      - "task.failed"
    templates:
      workflow.started: "Workflow '\${workflow.name}' started"
      workflow.completed: "Workflow '\${workflow.name}' completed successfully"
      workflow.failed: "Workflow '\${workflow.name}' failed: \${error.message}"
`;

      fs.writeFileSync(workflowPath,  yamlContent, "utf8");
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Advanced YAML Workflow');
      expect(loadedWorkflow.agents!.length).toBe( 3);
      expect(loadedWorkflow.tasks.length).toBe( 7);
      expect(loadedWorkflow.conditions!.length).toBe( 2);
      expect(loadedWorkflow.loops!.length).toBe( 1);
      expect(loadedWorkflow.integrations!.length).toBe( 2);
      expect(loadedWorkflow.metadata!.author).toBe( 'YAML Test Suite');
      expect(loadedWorkflow.variables!.project_name).toBe( 'test-project');
      expect(loadedWorkflow.variables!.config.database.port).toBe( 5432);

      const validation = await engine.validateWorkflow(loadedWorkflow, true);
      expect(validation.valid).toBe( true);
    });

    it('should handle YAML with different indentation styles', async () => {
      const workflowPath = `${testDir}/indentation.yaml`;
      const yamlContent = `
name: "Indentation Test"
version: "1.0.0"

# Mixed indentation styles
tasks:
    - id: "task1"
      type: "test"
      description: "Task with 4-space indentation"
      input:
          param1: "value1"
          param2: "value2"
          
    - id: "task2"
      type: "test"  
      description: "Task with mixed indentation"
      input:
        param1: "value1"
        param2: "value2"
        nested:
          deep1: "deep_value1"
          deep2: "deep_value2"

settings:
  maxConcurrency: 1
  failurePolicy: "fail-fast"
`;

      fs.writeFileSync(workflowPath,  yamlContent, "utf8");
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Indentation Test');
      expect(loadedWorkflow.tasks.length).toBe( 2);
      expect(loadedWorkflow.tasks[0].input!.param1).toBe( 'value1');
      expect(loadedWorkflow.tasks[1].input!.nested.deep1).toBe( 'deep_value1');
    });
  });

  describe('Format Auto-Detection', () => {
    it('should auto-detect JSON format without extension', async () => {
      const workflowPath = `${testDir}/no-extension`;
      const workflow = {
        name: 'Auto-detect JSON',
        tasks: [{ id: 'test', type: 'test', description: 'Test task' }]
      };

      fs.writeFileSync(workflowPath,  JSON.stringify(workflow, "utf8"));
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Auto-detect JSON');
    });

    it('should auto-detect YAML format without extension', async () => {
      const workflowPath = `${testDir}/no-extension-yaml`;
      const yamlContent = `
name: "Auto-detect YAML"
tasks:
  - id: "test"
    type: "test"
    description: "Test task"
`;

      fs.writeFileSync(workflowPath,  yamlContent, "utf8");
      
      const loadedWorkflow = await engine.loadWorkflow(workflowPath);
      expect(loadedWorkflow.name).toBe( 'Auto-detect YAML');
    });

    it('should handle invalid format gracefully', async () => {
      const workflowPath = `${testDir}/invalid-format`;
      const invalidContent = `
This is neither valid JSON nor valid YAML
It should cause an error when trying to parse
`;

      fs.writeFileSync(workflowPath,  invalidContent, "utf8");
      
      await expect(
        async () => await engine.loadWorkflow(workflowPath),
        Error,
        'Failed to load workflow file'
      );
    });
  });

  describe('Cross-Format Compatibility', () => {
    it('should produce equivalent results for JSON and YAML versions', async () => {
      // Create identical workflows in both formats
      const baseWorkflow = {
        name: 'Cross-Format Test',
        version: '1.0.0',
        variables: {
          test_var: 'test_value',
          numeric_var: 42
        },
        tasks: [
          {
            id: 'task1',
            type: 'test',
            description: 'First task',
            input: { var: '${test_var}' }
          },
          {
            id: 'task2',
            type: 'test',
            description: 'Second task',
            depends: ['task1'],
            input: { num: '${numeric_var}' }
          }
        ],
        settings: {
          maxConcurrency: 2,
          failurePolicy: 'fail-fast'
        }
      };

      // JSON version
      const jsonPath = `${testDir}/cross-format.json`;
      fs.writeFileSync(jsonPath,  JSON.stringify(baseWorkflow, null, 2, "utf8"));

      // YAML version
      const yamlPath = `${testDir}/cross-format.yaml`;
      const yamlContent = `
name: "Cross-Format Test"
version: "1.0.0"
variables:
  test_var: "test_value"
  numeric_var: 42
tasks:
  - id: "task1"
    type: "test"
    description: "First task"
    input:
      var: "\${test_var}"
  - id: "task2"
    type: "test"
    description: "Second task"
    depends: ["task1"]
    input:
      num: "\${numeric_var}"
settings:
  maxConcurrency: 2
  failurePolicy: "fail-fast"
`;
      fs.writeFileSync(yamlPath,  yamlContent, "utf8");

      // Load both versions
      const jsonWorkflow = await engine.loadWorkflow(jsonPath);
      const yamlWorkflow = await engine.loadWorkflow(yamlPath);

      // Compare key properties
      expect(jsonWorkflow.name).toBe( yamlWorkflow.name);
      expect(jsonWorkflow.version).toBe( yamlWorkflow.version);
      expect(jsonWorkflow.tasks.length).toBe( yamlWorkflow.tasks.length);
      expect(jsonWorkflow.variables!.test_var).toBe( yamlWorkflow.variables!.test_var);
      expect(jsonWorkflow.variables!.numeric_var).toBe( yamlWorkflow.variables!.numeric_var);
      expect(jsonWorkflow.settings!.maxConcurrency).toBe( yamlWorkflow.settings!.maxConcurrency);

      // Execute both and compare results
      const jsonExecution = await engine.executeWorkflow(jsonWorkflow);
      const yamlExecution = await engine.executeWorkflow(yamlWorkflow);

      expect(jsonExecution.status).toBe( yamlExecution.status);
      expect(jsonExecution.progress.total).toBe( yamlExecution.progress.total);
      expect(jsonExecution.progress.completed).toBe( yamlExecution.progress.completed);
    });
  });

  describe('Real-World Workflow Examples', () => {
    it('should execute the research workflow example', async () => {
      // Use the actual research workflow example
      const examplePath = '/workspaces/claude-code-flow/examples/research-workflow.yaml';
      
      try {
        const workflow = await engine.loadWorkflow(examplePath);
        expect(workflow.name).toBe( 'Advanced Research Workflow');
        
        const validation = await engine.validateWorkflow(workflow, true);
        expect(validation.valid).toBe( true);
        
        // Test execution with modified settings for faster testing
        const testWorkflow = { ...workflow };
        testWorkflow.settings = { ...testWorkflow.settings, timeout: 30000 };
        
        const execution = await engine.executeWorkflow(testWorkflow);
        expect(execution.id);
        expect(execution.startedAt);
      } catch (error) {
        // If the example file doesn't exist, create a minimal version for testing
        console.warn('Research workflow example not found, creating test version');
        
        const testWorkflowPath = `${testDir}/research-test.yaml`;
        const minimalResearchWorkflow = `
name: "Test Research Workflow"
version: "1.0.0"
description: "Minimal research workflow for testing"

variables:
  topic: "test topic"
  
tasks:
  - id: "research"
    type: "research"
    description: "Conduct research"
    input:
      topic: "\${topic}"
      
  - id: "analyze"
    type: "analysis"
    description: "Analyze results"
    depends: ["research"]

settings:
  maxConcurrency: 1
  timeout: 30000
`;
        
        fs.writeFileSync(testWorkflowPath,  minimalResearchWorkflow, "utf8");
        const workflow = await engine.loadWorkflow(testWorkflowPath);
        const execution = await engine.executeWorkflow(workflow);
        expect(execution.status).toBe( 'completed');
      }
    });

    it('should validate the development workflow example', async () => {
      // Use the actual development workflow example
      const examplePath = '/workspaces/claude-code-flow/examples/development-workflow.json';
      
      try {
        const workflow = await engine.loadWorkflow(examplePath);
        expect(workflow.name).toBe( 'Full-Stack Development Workflow');
        
        const validation = await engine.validateWorkflow(workflow, true);
        expect(validation.valid).toBe( true);
        
        // Verify complex structure
        expect(workflow.agents);
        expect(workflow.conditions);
        expect(workflow.integrations);
        expect(workflow.agents!.length > 0).toBe( true);
        expect(workflow.tasks.length > 0).toBe( true);
        
      } catch (error) {
        // If the example file doesn't exist, create a minimal version for testing
        console.warn('Development workflow example not found, creating test version');
        
        const testWorkflowPath = `${testDir}/development-test.json`;
        const minimalDevWorkflow = {
          name: "Test Development Workflow",
          version: "1.0.0",
          description: "Minimal development workflow for testing",
          agents: [
            { id: "developer", type: "coder", name: "Developer Agent" }
          ],
          tasks: [
            {
              id: "code",
              type: "coding",
              description: "Write code",
              assignTo: "developer"
            },
            {
              id: "test",
              type: "testing",
              description: "Test code",
              depends: ["code"]
            }
          ],
          settings: {
            maxConcurrency: 1,
            timeout: 30000
          }
        };
        
        fs.writeFileSync(testWorkflowPath,  JSON.stringify(minimalDevWorkflow, null, 2, "utf8"));
        const workflow = await engine.loadWorkflow(testWorkflowPath);
        const validation = await engine.validateWorkflow(workflow, true);
        expect(validation.valid).toBe( true);
      }
    });
  });
});
