/**
 * Real-time Update System for Claude-Flow Web UI
 * Provides event-driven architecture for live data updates
 * Supports WebSocket-like functionality and progressive loading
 */

export class RealtimeUpdateSystem {
  constructor(ui) {
    this.ui = ui;
    this.subscribers = new Map(); // Event type -> Set of callbacks
    this.updateQueues = new Map(); // View -> Queue of pending updates
    this.updateTimers = new Map(); // View -> Timer for batched updates
    this.batchDelay = 100; // ms to batch updates
    this.eventHistory = []; // Keep last 100 events
    this.maxHistorySize = 100;

    // Performance monitoring
    this.updateMetrics = {
      totalUpdates: 0,
      updateLatency: [],
      batchedUpdates: 0,
      droppedUpdates: 0,
    };

    this.initializeSystem();
  }

  /**
   * Initialize the real-time update system
   */
  initializeSystem() {
    // Setup system event listeners
    this.setupSystemEvents();

    // Initialize update queues for all views
    this.initializeUpdateQueues();

    // Start performance monitoring
    this.startPerformanceMonitoring();

    this.ui.addLog('success', 'Real-time update system initialized');
  }

  /**
   * Setup system-level event listeners
   */
  setupSystemEvents() {
    // Listen for tool execution events
    this.subscribe('tool_start', (data) => {
      this.broadcastUpdate('tools', {
        type: 'execution_start',
        toolName: data.toolName,
        executionId: data.executionId,
        timestamp: Date.now(),
      });
    });

    this.subscribe('tool_complete', (data) => {
      this.broadcastUpdate('tools', {
        type: 'execution_complete',
        toolName: data.toolName,
        executionId: data.executionId,
        result: data.result,
        timestamp: Date.now(),
      });

      // Update relevant views based on tool type
      this.updateRelatedViews(data.toolName, data.result);
    });

    this.subscribe('tool_error', (data) => {
      this.broadcastUpdate('tools', {
        type: 'execution_error',
        toolName: data.toolName,
        executionId: data.executionId,
        error: data.error,
        timestamp: Date.now(),
      });
    });

    // Listen for swarm events
    this.subscribe('swarm_status_change', (data) => {
      this.broadcastUpdate('orchestration', {
        type: 'swarm_update',
        swarmId: data.swarmId,
        status: data.status,
        timestamp: Date.now(),
      });
    });

    // Listen for memory events
    this.subscribe('memory_change', (data) => {
      this.broadcastUpdate('memory', {
        type: 'memory_update',
        namespace: data.namespace,
        operation: data.operation,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Initialize update queues for all views
   */
  initializeUpdateQueues() {
    const views = [
      'neural',
      'analysis',
      'workflow',
      'github',
      'daa',
      'system',
      'tools',
      'orchestration',
      'memory',
    ];
    views.forEach((view) => {
      this.updateQueues.set(view, []);
    });
  }

  /**
   * Subscribe to specific event types
   */
  subscribe(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(eventType);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  /**
   * Emit event to all subscribers
   */
  emit(eventType, data) {
    const timestamp = Date.now();

    // Add to event history
    this.eventHistory.push({
      type: eventType,
      data,
      timestamp,
    });

    // Trim history if too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Notify subscribers
    const subscribers = this.subscribers.get(eventType);
    if (subscribers) {
      subscribers.forEach((callback) => {
        try {
          callback(data, timestamp);
        } catch (error) {
          console.error(`Error in event subscriber for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Broadcast update to specific view
   */
  broadcastUpdate(viewName, updateData) {
    const queue = this.updateQueues.get(viewName);
    if (!queue) return;

    // Add update to queue
    queue.push({
      ...updateData,
      id: `update_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    });

    // Schedule batched update
    this.scheduleBatchedUpdate(viewName);

    this.updateMetrics.totalUpdates++;
  }

  /**
   * Schedule batched update for a view
   */
  scheduleBatchedUpdate(viewName) {
    // Clear existing timer
    const existingTimer = this.updateTimers.get(viewName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new batched update
    const timer = setTimeout(() => {
      this.processBatchedUpdates(viewName);
    }, this.batchDelay);

    this.updateTimers.set(viewName, timer);
  }

  /**
   * Process batched updates for a view
   */
  processBatchedUpdates(viewName) {
    const queue = this.updateQueues.get(viewName);
    if (!queue || queue.length === 0) return;

    const startTime = Date.now();

    // Group updates by type
    const groupedUpdates = this.groupUpdatesByType(queue);

    // Apply updates
    this.applyUpdatesToView(viewName, groupedUpdates);

    // Clear processed updates
    queue.length = 0;

    // Update metrics
    const latency = Date.now() - startTime;
    this.updateMetrics.updateLatency.push(latency);
    this.updateMetrics.batchedUpdates++;

    // Keep only last 100 latency measurements
    if (this.updateMetrics.updateLatency.length > 100) {
      this.updateMetrics.updateLatency.shift();
    }

    // Clear timer
    this.updateTimers.delete(viewName);
  }

  /**
   * Group updates by type for efficient processing
   */
  groupUpdatesByType(updates) {
    const grouped = new Map();

    updates.forEach((update) => {
      if (!grouped.has(update.type)) {
        grouped.set(update.type, []);
      }
      grouped.get(update.type).push(update);
    });

    return grouped;
  }

  /**
   * Apply grouped updates to a specific view
   */
  applyUpdatesToView(viewName, groupedUpdates) {
    try {
      // Different views handle updates differently
      switch (viewName) {
        case 'neural':
          this.applyNeuralUpdates(groupedUpdates);
          break;
        case 'analysis':
          this.applyAnalysisUpdates(groupedUpdates);
          break;
        case 'workflow':
          this.applyWorkflowUpdates(groupedUpdates);
          break;
        case 'tools':
          this.applyToolsUpdates(groupedUpdates);
          break;
        case 'orchestration':
          this.applyOrchestrationUpdates(groupedUpdates);
          break;
        case 'memory':
          this.applyMemoryUpdates(groupedUpdates);
          break;
        default:
          this.applyGenericUpdates(viewName, groupedUpdates);
      }

      // Trigger UI refresh if this is the current view
      if (this.ui.currentView === viewName) {
        this.requestUIRefresh();
      }
    } catch (error) {
      console.error(`Error applying updates to ${viewName}:`, error);
      this.updateMetrics.droppedUpdates++;
    }
  }

  /**
   * Apply neural-specific updates
   */
  applyNeuralUpdates(groupedUpdates) {
    const neuralData = this.ui.enhancedViews?.viewData?.get('neural');
    if (!neuralData) return;

    // Handle training job updates
    const trainingUpdates = groupedUpdates.get('training_progress');
    if (trainingUpdates) {
      trainingUpdates.forEach((update) => {
        const existingJob = neuralData.trainingJobs.find((job) => job.id === update.jobId);
        if (existingJob) {
          Object.assign(existingJob, update.data);
        } else {
          neuralData.trainingJobs.push({
            id: update.jobId,
            ...update.data,
            startTime: update.timestamp,
          });
        }
      });
    }

    // Handle model updates
    const modelUpdates = groupedUpdates.get('model_update');
    if (modelUpdates) {
      modelUpdates.forEach((update) => {
        const existingModel = neuralData.models.find((model) => model.id === update.modelId);
        if (existingModel) {
          Object.assign(existingModel, update.data);
        } else {
          neuralData.models.push({
            id: update.modelId,
            ...update.data,
            createdAt: update.timestamp,
          });
        }
      });
    }
  }

  /**
   * Apply analysis-specific updates
   */
  applyAnalysisUpdates(groupedUpdates) {
    const analysisData = this.ui.enhancedViews?.viewData?.get('analysis');
    if (!analysisData) return;

    // Handle performance report updates
    const reportUpdates = groupedUpdates.get('performance_report');
    if (reportUpdates) {
      reportUpdates.forEach((update) => {
        analysisData.reports.unshift({
          id: update.reportId || `report_${update.timestamp}`,
          ...update.data,
          timestamp: update.timestamp,
        });

        // Keep only last 50 reports
        if (analysisData.reports.length > 50) {
          analysisData.reports = analysisData.reports.slice(0, 50);
        }
      });
    }

    // Handle metrics updates
    const metricsUpdates = groupedUpdates.get('metrics_update');
    if (metricsUpdates) {
      metricsUpdates.forEach((update) => {
        analysisData.metrics.push({
          ...update.data,
          timestamp: update.timestamp,
        });

        // Keep only last 100 metric points
        if (analysisData.metrics.length > 100) {
          analysisData.metrics.shift();
        }
      });
    }
  }

  /**
   * Apply tools-specific updates
   */
  applyToolsUpdates(groupedUpdates) {
    // Handle execution updates
    const executionUpdates = groupedUpdates.get('execution_start');
    if (executionUpdates) {
      executionUpdates.forEach((update) => {
        this.ui.addLog('info', `🔧 Started: ${update.toolName}`);
      });
    }

    const completionUpdates = groupedUpdates.get('execution_complete');
    if (completionUpdates) {
      completionUpdates.forEach((update) => {
        this.ui.addLog('success', `✅ Completed: ${update.toolName}`);

        // Show result summary if available
        if (update.result && update.result.summary) {
          this.ui.addLog('info', `📋 ${update.result.summary}`);
        }
      });
    }

    const errorUpdates = groupedUpdates.get('execution_error');
    if (errorUpdates) {
      errorUpdates.forEach((update) => {
        this.ui.addLog('error', `❌ Failed: ${update.toolName} - ${update.error}`);
      });
    }
  }

  /**
   * Apply orchestration-specific updates
   */
  applyOrchestrationUpdates(groupedUpdates) {
    // Handle swarm updates
    const swarmUpdates = groupedUpdates.get('swarm_update');
    if (swarmUpdates) {
      swarmUpdates.forEach((update) => {
        // Update swarm integration data
        if (this.ui.swarmIntegration) {
          this.ui.swarmIntegration.updateSwarmStatus();
        }

        this.ui.addLog('info', `🐝 Swarm ${update.swarmId}: ${update.status}`);
      });
    }
  }

  /**
   * Apply memory-specific updates
   */
  applyMemoryUpdates(groupedUpdates) {
    // Handle memory operation updates
    const memoryUpdates = groupedUpdates.get('memory_update');
    if (memoryUpdates) {
      memoryUpdates.forEach((update) => {
        // Update memory stats
        if (this.ui.memoryStats) {
          const namespace = this.ui.memoryStats.namespaces.find(
            (ns) => ns.name === update.namespace,
          );
          if (namespace) {
            // Update existing namespace stats
            if (update.operation === 'store') {
              namespace.entries++;
            } else if (update.operation === 'delete') {
              namespace.entries = Math.max(0, namespace.entries - 1);
            }
          }
        }

        this.ui.addLog('info', `💾 Memory ${update.operation} in ${update.namespace}`);
      });
    }
  }

  /**
   * Apply generic updates for other views
   */
  applyGenericUpdates(viewName, groupedUpdates) {
    // Log generic updates
    groupedUpdates.forEach((updates, type) => {
      updates.forEach((update) => {
        this.ui.addLog('info', `📡 ${viewName}: ${type} update`);
      });
    });
  }

  /**
   * Update related views based on tool execution
   */
  updateRelatedViews(toolName, result) {
    // Map tool names to affected views
    const toolViewMap = {
      // Neural tools affect neural view
      neural_train: ['neural'],
      neural_predict: ['neural'],
      neural_status: ['neural'],
      model_save: ['neural'],
      model_load: ['neural'],

      // Analysis tools affect analysis view
      performance_report: ['analysis'],
      bottleneck_analyze: ['analysis'],
      token_usage: ['analysis'],
      benchmark_run: ['analysis'],

      // Swarm tools affect orchestration view
      swarm_init: ['orchestration'],
      agent_spawn: ['orchestration'],
      task_orchestrate: ['orchestration'],

      // Memory tools affect memory view
      memory_usage: ['memory'],
      memory_search: ['memory'],
      memory_backup: ['memory'],
    };

    const affectedViews = toolViewMap[toolName] || [];

    affectedViews.forEach((viewName) => {
      this.broadcastUpdate(viewName, {
        type: 'tool_result',
        toolName,
        result,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Request UI refresh (throttled)
   */
  requestUIRefresh() {
    if (this.refreshThrottle) return;

    this.refreshThrottle = setTimeout(() => {
      if (this.ui && typeof this.ui.render === 'function') {
        this.ui.render();
      }
      this.refreshThrottle = null;
    }, 50); // Throttle to max 20 FPS
  }

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    setInterval(() => {
      this.reportPerformanceMetrics();
    }, 60000); // Report every minute
  }

  /**
   * Report performance metrics
   */
  reportPerformanceMetrics() {
    const avgLatency =
      this.updateMetrics.updateLatency.length > 0
        ? this.updateMetrics.updateLatency.reduce((a, b) => a + b, 0) /
          this.updateMetrics.updateLatency.length
        : 0;

    const queueSizes = Array.from(this.updateQueues.values()).map((q) => q.length);
    const totalQueueSize = queueSizes.reduce((a, b) => a + b, 0);

    this.emit('performance_metrics', {
      totalUpdates: this.updateMetrics.totalUpdates,
      averageLatency: avgLatency,
      batchedUpdates: this.updateMetrics.batchedUpdates,
      droppedUpdates: this.updateMetrics.droppedUpdates,
      totalQueueSize,
      eventHistorySize: this.eventHistory.length,
    });
  }

  /**
   * Get system status
   */
  getStatus() {
    const queueSizes = {};
    this.updateQueues.forEach((queue, viewName) => {
      queueSizes[viewName] = queue.length;
    });

    return {
      subscribers: this.subscribers.size,
      queueSizes,
      metrics: this.updateMetrics,
      eventHistorySize: this.eventHistory.length,
      activeTimers: this.updateTimers.size,
    };
  }

  /**
   * Create progressive loading handler
   */
  createProgressiveLoader(viewName, dataLoader, options = {}) {
    const { chunkSize = 10, delay = 100, onProgress = null, onComplete = null } = options;

    return async () => {
      try {
        const data = await dataLoader();

        if (!Array.isArray(data)) {
          // Non-array data, load immediately
          this.broadcastUpdate(viewName, {
            type: 'data_loaded',
            data,
            timestamp: Date.now(),
          });

          if (onComplete) onComplete(data);
          return;
        }

        // Progressive loading for arrays
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);

          this.broadcastUpdate(viewName, {
            type: 'data_chunk',
            chunk,
            progress: {
              loaded: Math.min(i + chunkSize, data.length),
              total: data.length,
              percentage: Math.min(((i + chunkSize) / data.length) * 100, 100),
            },
            timestamp: Date.now(),
          });

          if (onProgress) {
            onProgress({
              loaded: Math.min(i + chunkSize, data.length),
              total: data.length,
              percentage: Math.min(((i + chunkSize) / data.length) * 100, 100),
            });
          }

          // Small delay between chunks to prevent blocking
          if (i + chunkSize < data.length) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (onComplete) onComplete(data);
      } catch (error) {
        this.broadcastUpdate(viewName, {
          type: 'data_error',
          error: error.message,
          timestamp: Date.now(),
        });
      }
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Clear all timers
    this.updateTimers.forEach((timer) => clearTimeout(timer));
    this.updateTimers.clear();

    // Clear refresh throttle
    if (this.refreshThrottle) {
      clearTimeout(this.refreshThrottle);
    }

    // Clear all subscribers
    this.subscribers.clear();

    // Clear update queues
    this.updateQueues.clear();

    this.ui.addLog('info', 'Real-time update system cleaned up');
  }
}

export default RealtimeUpdateSystem;
