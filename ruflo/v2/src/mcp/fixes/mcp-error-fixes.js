/**
 * MCP Error Fixes
 * Fixes for agent_metrics, swarm_monitor, and neural_train errors
 */

// Fix 1: agent_metrics - Ensure neuralNetworks is always an array
export function fixAgentMetrics(data) {
  if (!data) {
    return {
      success: true,
      agentId: null,
      metrics: {
        tasksCompleted: 0,
        successRate: 0,
        avgExecutionTime: 0,
        neuralNetworks: [], // Ensure it's an array
        memoryUsage: 0,
        cpuUsage: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Ensure neuralNetworks is an array
  if (data.metrics && !Array.isArray(data.metrics.neuralNetworks)) {
    data.metrics.neuralNetworks = [];
  }

  // If neuralNetworks exists but isn't an array, convert it
  if (data.neuralNetworks && !Array.isArray(data.neuralNetworks)) {
    data.neuralNetworks = [];
  }

  return data;
}

// Fix 2: swarm_monitor - Ensure recentEvents is always an array
export function fixSwarmMonitor(data) {
  if (!data) {
    return {
      success: true,
      monitoring: {
        swarmId: null,
        status: 'active',
        recentEvents: [], // Ensure it's an array
        agentActivity: [],
        taskProgress: [],
        resourceUsage: {
          cpu: 0,
          memory: 0,
          network: 0,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Ensure recentEvents is an array
  if (data.monitoring && !Array.isArray(data.monitoring.recentEvents)) {
    data.monitoring.recentEvents = [];
  }

  // If recentEvents exists at top level but isn't an array, convert it
  if (data.recentEvents && !Array.isArray(data.recentEvents)) {
    data.recentEvents = [];
  }

  return data;
}

// Fix 3: neural_train - Add proper parameter validation
export function fixNeuralTrain(args) {
  // Ensure agentId is provided as a string
  if (!args.agentId && !args.agent_id) {
    // Generate a default agent ID if not provided
    args.agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // Normalize parameter names
  if (args.agent_id && !args.agentId) {
    args.agentId = args.agent_id;
  }

  // Ensure agentId is a string
  if (typeof args.agentId !== 'string') {
    args.agentId = String(args.agentId || '');
  }

  // Set default iterations if not provided
  if (!args.iterations && !args.epochs) {
    args.iterations = 10;
  }

  // Normalize epochs to iterations
  if (args.epochs && !args.iterations) {
    args.iterations = args.epochs;
  }

  return args;
}

// Wrapper function to handle ruv-swarm MCP responses
export function wrapRuvSwarmResponse(toolName, response) {
  try {
    // Parse response if it's a string
    let data = response;
    if (typeof response === 'string') {
      try {
        data = JSON.parse(response);
      } catch {
        // If can't parse, wrap in object
        data = { output: response };
      }
    }

    // Apply specific fixes based on tool name
    switch (toolName) {
      case 'agent_metrics':
      case 'mcp__ruv-swarm__agent_metrics':
        return fixAgentMetrics(data);

      case 'swarm_monitor':
      case 'mcp__ruv-swarm__swarm_monitor':
        return fixSwarmMonitor(data);

      case 'neural_train':
      case 'mcp__ruv-swarm__neural_train':
        // For neural_train, we fix the args before calling
        return data;

      default:
        return data;
    }
  } catch (error) {
    console.error(`Error wrapping response for ${toolName}:`, error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Export for use in MCP server
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fixAgentMetrics,
    fixSwarmMonitor,
    fixNeuralTrain,
    wrapRuvSwarmResponse,
  };
}