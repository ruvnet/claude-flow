/**
 * Tool Execution Framework
 * Provides unified interface for executing all Claude-Flow MCP tools
 * Handles progress tracking, cancellation, and result formatting
 */

import MCPIntegrationLayer from './mcp-integration-layer.js';

export class ToolExecutionFramework {
  constructor(ui) {
    this.ui = ui;
    this.mcpLayer = new MCPIntegrationLayer(ui);
    this.executionQueue = [];
    this.maxConcurrentExecutions = 5;
    this.currentExecutions = 0;
    this.resultFormatters = new Map();

    this.initializeFormatters();
  }

  /**
   * Initialize result formatters for different tool types
   */
  initializeFormatters() {
    // Swarm tools formatters
    this.resultFormatters.set('swarm_init', (result) => ({
      title: 'Swarm Initialized',
      summary: `${result.topology} topology with ${result.maxAgents} max agents`,
      details: [
        `Swarm ID: ${result.swarmId}`,
        `Strategy: ${result.strategy}`,
        `Status: ${result.status}`,
      ],
      status: result.success ? 'success' : 'error',
    }));

    this.resultFormatters.set('neural_train', (result) => ({
      title: 'Neural Training Complete',
      summary: `${result.pattern_type} model trained with ${result.accuracy.toFixed(2)} accuracy`,
      details: [
        `Model ID: ${result.modelId}`,
        `Epochs: ${result.epochs}`,
        `Training time: ${result.training_time.toFixed(1)}s`,
        `Accuracy: ${(result.accuracy * 100).toFixed(1)}%`,
      ],
      status: result.success ? 'success' : 'error',
      metrics: {
        accuracy: result.accuracy,
        epochs: result.epochs,
        time: result.training_time,
      },
    }));

    this.resultFormatters.set('performance_report', (result) => ({
      title: 'Performance Report',
      summary: `${result.timeframe} analysis - ${result.metrics.success_rate.toFixed(1)}% success rate`,
      details: [
        `Tasks executed: ${result.metrics.tasks_executed}`,
        `Average execution time: ${result.metrics.avg_execution_time.toFixed(1)}s`,
        `Agents spawned: ${result.metrics.agents_spawned}`,
        `Memory efficiency: ${(result.metrics.memory_efficiency * 100).toFixed(1)}%`,
      ],
      status: 'success',
      charts: {
        successRate: result.metrics.success_rate,
        memoryEfficiency: result.metrics.memory_efficiency,
      },
    }));

    this.resultFormatters.set('memory_usage', (result) => ({
      title: 'Memory Operation',
      summary: `${result.action} operation on key "${result.key}"`,
      details: [
        `Namespace: ${result.namespace}`,
        `Action: ${result.action}`,
        `Status: ${result.action === 'store' ? 'Stored' : 'Retrieved'}`,
      ],
      status: result.success ? 'success' : 'error',
    }));

    // Default formatter for unknown tools
    this.resultFormatters.set('default', (result) => ({
      title: `Tool: ${result.tool || 'Unknown'}`,
      summary: result.message || 'Tool executed successfully',
      details: Object.entries(result).map(
        ([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`,
      ),
      status: result.success ? 'success' : 'error',
    }));
  }

  /**
   * Execute a single tool with comprehensive tracking
   */
  async executeTool(toolName, parameters = {}, options = {}) {
    try {
      // Validate tool exists
      if (!this.isToolAvailable(toolName)) {
        throw new Error(`Tool "${toolName}" is not available`);
      }

      // Create execution context
      const execution = {
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName,
        parameters,
        options,
        startTime: Date.now(),
        status: 'queued',
        progress: 0,
      };

      // Add to queue or execute immediately
      if (this.currentExecutions >= this.maxConcurrentExecutions) {
        this.executionQueue.push(execution);
        this.ui.addLog('info', `Tool ${toolName} queued (${this.executionQueue.length} in queue)`);
      } else {
        await this.executeToolDirect(execution);
      }

      return execution;
    } catch (error) {
      this.ui.addLog('error', `Failed to execute ${toolName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute tool directly
   */
  async executeToolDirect(execution) {
    this.currentExecutions++;
    execution.status = 'running';
    execution.startTime = Date.now();

    try {
      this.ui.addLog('info', `Executing ${execution.toolName}...`);

      // Execute via MCP layer
      const result = await this.mcpLayer.executeTool(
        execution.toolName,
        execution.parameters,
        execution.options,
      );

      // Format result
      const formattedResult = this.formatResult(execution.toolName, result.result);

      // Update execution
      execution.status = 'completed';
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.result = formattedResult;

      // Log success
      this.ui.addLog('success', `${execution.toolName} completed in ${execution.duration}ms`);

      // Process queue
      this.processQueue();

      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = Date.now();
      execution.error = error.message;

      this.ui.addLog('error', `${execution.toolName} failed: ${error.message}`);

      // Process queue
      this.processQueue();

      throw error;
    } finally {
      this.currentExecutions--;
    }
  }

  /**
   * Process execution queue
   */
  async processQueue() {
    if (this.executionQueue.length > 0 && this.currentExecutions < this.maxConcurrentExecutions) {
      const nextExecution = this.executionQueue.shift();
      await this.executeToolDirect(nextExecution);
    }
  }

  /**
   * Execute multiple tools in batch
   */
  async executeToolsBatch(toolExecutions, options = {}) {
    const batchId = `batch_${Date.now()}`;
    const results = [];

    this.ui.addLog('info', `Starting batch execution: ${toolExecutions.length} tools`);

    try {
      if (options.parallel) {
        // Execute in parallel
        const promises = toolExecutions.map(({ toolName, parameters, toolOptions }) =>
          this.executeTool(toolName, parameters, toolOptions),
        );

        const settled = await Promise.allSettled(promises);

        settled.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push({ success: true, execution: result.value });
          } else {
            results.push({
              success: false,
              error: result.reason.message,
              toolName: toolExecutions[index].toolName,
            });
          }
        });
      } else {
        // Execute sequentially
        for (let i = 0; i < toolExecutions.length; i++) {
          const { toolName, parameters, toolOptions } = toolExecutions[i];

          try {
            const execution = await this.executeTool(toolName, parameters, toolOptions);
            results.push({ success: true, execution });

            // Report progress
            if (options.progressCallback) {
              options.progressCallback({
                completed: i + 1,
                total: toolExecutions.length,
                progress: ((i + 1) / toolExecutions.length) * 100,
                currentTool: toolName,
              });
            }
          } catch (error) {
            results.push({
              success: false,
              error: error.message,
              toolName,
            });

            // Stop on first error if configured
            if (options.stopOnError) {
              break;
            }
          }
        }
      }

      const successful = results.filter((r) => r.success).length;
      this.ui.addLog(
        'success',
        `Batch ${batchId} completed: ${successful}/${results.length} successful`,
      );

      return {
        batchId,
        results,
        summary: {
          total: results.length,
          successful,
          failed: results.length - successful,
        },
      };
    } catch (error) {
      this.ui.addLog('error', `Batch ${batchId} failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute workflow (sequence of dependent tools)
   */
  async executeWorkflow(workflow, options = {}) {
    const workflowId = `workflow_${Date.now()}`;
    const context = {}; // Shared context between steps
    const results = [];

    this.ui.addLog('info', `Starting workflow: ${workflow.name || workflowId}`);

    try {
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];

        // Resolve parameters using context
        const resolvedParameters = this.resolveParameters(step.parameters, context);

        // Execute step
        const execution = await this.executeTool(step.toolName, resolvedParameters, step.options);

        // Update context with results
        if (step.outputVariable && execution.result) {
          context[step.outputVariable] = execution.result;
        }

        results.push(execution);

        // Check for step failure
        if (execution.status === 'failed' && step.required !== false) {
          throw new Error(`Required step ${step.toolName} failed: ${execution.error}`);
        }

        // Report progress
        if (options.progressCallback) {
          options.progressCallback({
            completed: i + 1,
            total: workflow.steps.length,
            progress: ((i + 1) / workflow.steps.length) * 100,
            currentStep: step.toolName,
          });
        }
      }

      this.ui.addLog('success', `Workflow ${workflowId} completed successfully`);

      return {
        workflowId,
        results,
        context,
        summary: {
          totalSteps: workflow.steps.length,
          completedSteps: results.filter((r) => r.status === 'completed').length,
          failedSteps: results.filter((r) => r.status === 'failed').length,
        },
      };
    } catch (error) {
      this.ui.addLog('error', `Workflow ${workflowId} failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve parameters using context variables
   */
  resolveParameters(parameters, context) {
    if (typeof parameters !== 'object' || parameters === null) {
      return parameters;
    }

    const resolved = {};

    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        // Context variable reference
        const varName = value.substring(1);
        resolved[key] = context[varName] || value;
      } else if (typeof value === 'object') {
        resolved[key] = this.resolveParameters(value, context);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Format tool result for display
   */
  formatResult(toolName, result) {
    const formatter = this.resultFormatters.get(toolName) || this.resultFormatters.get('default');
    return formatter(result);
  }

  /**
   * Check if tool is available
   */
  isToolAvailable(toolName) {
    const allTools = Object.values(this.mcpLayer.toolCategories).flat();
    return allTools.includes(toolName);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category) {
    return this.mcpLayer.getToolsByCategory(category);
  }

  /**
   * Get all available categories
   */
  getCategories() {
    return this.mcpLayer.getToolCategories();
  }

  /**
   * Get execution status
   */
  getExecutionStatus() {
    return {
      currentExecutions: this.currentExecutions,
      queuedExecutions: this.executionQueue.length,
      maxConcurrent: this.maxConcurrentExecutions,
    };
  }

  /**
   * Cancel execution
   */
  async cancelExecution(executionId) {
    // Try to remove from queue first
    const queueIndex = this.executionQueue.findIndex((e) => e.id === executionId);
    if (queueIndex !== -1) {
      this.executionQueue.splice(queueIndex, 1);
      this.ui.addLog('info', `Cancelled queued execution ${executionId}`);
      return true;
    }

    // Cancel running execution via MCP layer
    return await this.mcpLayer.cancelExecution(executionId);
  }

  /**
   * Get predefined workflows
   */
  getPredefinedWorkflows() {
    return {
      neural_training_pipeline: {
        name: 'Neural Training Pipeline',
        description: 'Complete neural network training with evaluation',
        steps: [
          {
            toolName: 'neural_train',
            parameters: {
              pattern_type: 'coordination',
              epochs: 100,
              training_data: 'recent_swarm_data',
            },
            outputVariable: 'trainedModel',
            required: true,
          },
          {
            toolName: 'neural_predict',
            parameters: {
              modelId: '$trainedModel.modelId',
              input: 'test_coordination_scenario',
            },
            outputVariable: 'prediction',
            required: true,
          },
          {
            toolName: 'neural_explain',
            parameters: {
              modelId: '$trainedModel.modelId',
              prediction: '$prediction',
            },
            required: false,
          },
        ],
      },

      swarm_deployment: {
        name: 'Swarm Deployment',
        description: 'Initialize and deploy a complete swarm',
        steps: [
          {
            toolName: 'swarm_init',
            parameters: {
              topology: 'hierarchical',
              maxAgents: 8,
              strategy: 'adaptive',
            },
            outputVariable: 'swarm',
            required: true,
          },
          {
            toolName: 'agent_spawn',
            parameters: {
              type: 'coordinator',
              swarmId: '$swarm.swarmId',
            },
            required: true,
          },
          {
            toolName: 'agent_spawn',
            parameters: {
              type: 'researcher',
              swarmId: '$swarm.swarmId',
            },
            required: true,
          },
          {
            toolName: 'swarm_monitor',
            parameters: {
              swarmId: '$swarm.swarmId',
              interval: 5000,
            },
            required: false,
          },
        ],
      },

      performance_analysis: {
        name: 'Performance Analysis',
        description: 'Comprehensive system performance analysis',
        steps: [
          {
            toolName: 'performance_report',
            parameters: {
              timeframe: '24h',
              format: 'detailed',
            },
            outputVariable: 'report',
            required: true,
          },
          {
            toolName: 'bottleneck_analyze',
            parameters: {
              component: 'system',
            },
            outputVariable: 'bottlenecks',
            required: true,
          },
          {
            toolName: 'trend_analysis',
            parameters: {
              metric: 'performance',
              period: '7d',
            },
            required: false,
          },
        ],
      },
    };
  }

  /**
   * Execute predefined workflow
   */
  async executePredefinedWorkflow(workflowName, options = {}) {
    const workflows = this.getPredefinedWorkflows();
    const workflow = workflows[workflowName];

    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowName}`);
    }

    return await this.executeWorkflow(workflow, options);
  }

  /**
   * Get comprehensive status
   */
  getStatus() {
    return {
      ...this.getExecutionStatus(),
      mcpStatus: this.mcpLayer.getStatus(),
      availableTools: Object.values(this.mcpLayer.toolCategories).flat().length,
      availableWorkflows: Object.keys(this.getPredefinedWorkflows()).length,
    };
  }
}

export default ToolExecutionFramework;
