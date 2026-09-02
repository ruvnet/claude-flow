/**
 * Performance Tracking Hooks
 * Integrates with all Claude Flow operations to track real performance metrics
 */

import {
  trackTaskExecution,
  trackAgentActivity,
  trackNeuralEvent,
  initializeMetrics
} from './performance-metrics.js';
import { performance } from 'perf_hooks';

// Track active operations
const activeOperations = new Map();

// Initialize performance tracking
export async function initializePerformanceTracking() {
  await initializeMetrics();
  
  // Hook into global events if available
  if (global.claudeFlowHooks) {
    global.claudeFlowHooks.on('task:start', onTaskStart);
    global.claudeFlowHooks.on('task:end', onTaskEnd);
    global.claudeFlowHooks.on('agent:spawn', onAgentSpawn);
    global.claudeFlowHooks.on('agent:action', onAgentAction);
    global.claudeFlowHooks.on('neural:event', onNeuralEvent);
  }
}

// Task tracking
export function onTaskStart(taskId, taskType, metadata = {}) {
  activeOperations.set(taskId, {
    type: 'task',
    taskType,
    startTime: performance.now(),
    metadata
  });
}

export async function onTaskEnd(taskId, success = true, error = null) {
  const operation = activeOperations.get(taskId);
  if (!operation) return;
  
  const duration = performance.now() - operation.startTime;
  activeOperations.delete(taskId);
  
  await trackTaskExecution(
    taskId,
    operation.taskType,
    success,
    duration,
    {
      ...operation.metadata,
      error: error ? error.message : undefined
    }
  );
}

// Agent tracking
export async function onAgentSpawn(agentId, agentType, metadata = {}) {
  const startTime = performance.now();
  
  await trackAgentActivity(
    agentId,
    agentType,
    'spawn',
    performance.now() - startTime,
    true
  );
}

export function onAgentActionStart(agentId, agentType, action) {
  const key = `${agentId}:${action}`;
  activeOperations.set(key, {
    type: 'agent',
    agentId,
    agentType,
    action,
    startTime: performance.now()
  });
}

export async function onAgentAction(agentId, agentType, action, success = true) {
  const key = `${agentId}:${action}`;
  const operation = activeOperations.get(key);
  
  if (operation) {
    const duration = performance.now() - operation.startTime;
    activeOperations.delete(key);
    
    await trackAgentActivity(
      agentId,
      agentType,
      action,
      duration,
      success
    );
  } else {
    // Quick action without start tracking
    await trackAgentActivity(
      agentId,
      agentType,
      action,
      0,
      success
    );
  }
}

// Neural event tracking
export async function onNeuralEvent(eventType, metadata = {}) {
  await trackNeuralEvent(eventType, metadata);
}

// Wrapper functions for easy integration
export function wrapTaskExecution(taskId, taskType, fn, metadata = {}) {
  return async (...args) => {
    onTaskStart(taskId, taskType, metadata);
    try {
      const result = await fn(...args);
      await onTaskEnd(taskId, true);
      return result;
    } catch (error) {
      await onTaskEnd(taskId, false, error);
      throw error;
    }
  };
}

export function wrapAgentAction(agentId, agentType, action, fn) {
  return async (...args) => {
    onAgentActionStart(agentId, agentType, action);
    try {
      const result = await fn(...args);
      await onAgentAction(agentId, agentType, action, true);
      return result;
    } catch (error) {
      await onAgentAction(agentId, agentType, action, false);
      throw error;
    }
  };
}

// Integration helpers for existing commands
export function trackCommand(commandName) {
  return function decorator(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      const taskId = `cmd-${commandName}-${Date.now()}`;
      return wrapTaskExecution(taskId, commandName, originalMethod.bind(this))(...args);
    };
    
    return descriptor;
  };
}

// Manual tracking for commands that don't use decorators
export async function trackCommandExecution(commandName, fn, ...args) {
  const taskId = `cmd-${commandName}-${Date.now()}`;
  return wrapTaskExecution(taskId, commandName, fn)(...args);
}

// Export a simple API for manual tracking
export const performanceTracker = {
  startTask: onTaskStart,
  endTask: onTaskEnd,
  trackAgent: onAgentAction,
  trackNeural: onNeuralEvent,
  wrapTask: wrapTaskExecution,
  wrapAgent: wrapAgentAction
};