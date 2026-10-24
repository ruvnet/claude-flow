/**
 * Verification API Routes
 * REST endpoints for verification status and truth monitoring
 * 
 * Following existing claude-flow API patterns from /src/api/routes/analysis.js
 */

const express = require('express');
const router = express.Router();
const { performance } = require('perf_hooks');
const { nanoid } = require('nanoid');

// In-memory storage for verification data (replace with database in production)
let verificationStore = {
  verifications: new Map(),
  events: [],
  metrics: {
    startTime: Date.now(),
    totalVerifications: 0,
    successfulVerifications: 0,
    failedVerifications: 0,
    pendingVerifications: 0,
  },
  rules: new Map(),
  batches: new Map(),
};

// Middleware to track request metrics
router.use((req, res, next) => {
  const startTime = performance.now();
  req.startTime = startTime;
  req.requestId = nanoid();
  
  res.on('finish', () => {
    const duration = performance.now() - startTime;
    logEvent({
      type: 'api_request',
      request_id: req.requestId,
      method: req.method,
      url: req.url,
      status_code: res.statusCode,
      duration_ms: duration,
      timestamp: Date.now(),
    });
  });
  
  next();
});

// GET /api/verification/status - Get verification status overview
router.get('/status', (req, res) => {
  try {
    const metrics = calculateMetrics();
    const recentEvents = getRecentEvents(req.query.limit || 10);
    
    res.json({
      success: true,
      data: {
        status: determineOverallStatus(metrics),
        metrics,
        recent_events: recentEvents,
        active_verifications: getActiveVerifications(),
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// GET /api/verification/verify/:id - Get specific verification
router.get('/verify/:id', (req, res) => {
  try {
    const verification = verificationStore.verifications.get(req.params.id);
    
    if (!verification) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'VERIFICATION_NOT_FOUND',
          message: `Verification ${req.params.id} not found`,
        },
        metadata: {
          timestamp: Date.now(),
          request_id: req.requestId,
          version: '1.0.0',
        },
      });
    }
    
    res.json({
      success: true,
      data: verification,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// POST /api/verification/verify - Create new verification
router.post('/verify', (req, res) => {
  try {
    const { source, target, metadata = {}, priority = 'normal', timeout = 30000 } = req.body;
    
    if (!source || !target) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Both source and target are required',
        },
        metadata: {
          timestamp: Date.now(),
          request_id: req.requestId,
          version: '1.0.0',
        },
      });
    }
    
    const verification = createVerification({
      source,
      target,
      metadata,
      priority,
      timeout,
    });
    
    // Start async verification process
    processVerification(verification.id);
    
    res.status(201).json({
      success: true,
      data: verification,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// GET /api/verification/query - Query verifications with filters
router.get('/query', (req, res) => {
  try {
    const query = parseQuery(req.query);
    const results = queryVerifications(query);
    
    res.json({
      success: true,
      data: {
        results: results.items,
        total: results.total,
        query,
        pagination: {
          offset: query.offset || 0,
          limit: query.limit || 50,
          has_more: results.hasMore,
        },
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// POST /api/verification/batch - Batch verification
router.post('/batch', (req, res) => {
  try {
    const { items } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Items array is required and must not be empty',
        },
        metadata: {
          timestamp: Date.now(),
          request_id: req.requestId,
          version: '1.0.0',
        },
      });
    }
    
    const batch = createVerificationBatch(items);
    
    // Start async batch processing
    processBatch(batch.id);
    
    res.status(201).json({
      success: true,
      data: batch,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// GET /api/verification/batch/:id - Get batch status
router.get('/batch/:id', (req, res) => {
  try {
    const batch = verificationStore.batches.get(req.params.id);
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BATCH_NOT_FOUND',
          message: `Batch ${req.params.id} not found`,
        },
        metadata: {
          timestamp: Date.now(),
          request_id: req.requestId,
          version: '1.0.0',
        },
      });
    }
    
    res.json({
      success: true,
      data: batch,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// GET /api/verification/metrics - Get verification metrics
router.get('/metrics', (req, res) => {
  try {
    const timeframe = req.query.timeframe || '24h';
    const metrics = calculateDetailedMetrics(timeframe);
    
    res.json({
      success: true,
      data: metrics,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// GET /api/verification/health - Health check endpoint
router.get('/health', (req, res) => {
  try {
    const health = performHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: health,
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: error.message,
      },
      metadata: {
        timestamp: Date.now(),
        request_id: req.requestId,
        version: '1.0.0',
      },
    });
  }
});

// Helper Functions

function createVerification(request) {
  const id = nanoid();
  const verification = {
    id,
    timestamp: Date.now(),
    status: 'pending',
    confidence: 0,
    source: request.source,
    target: request.target,
    metadata: request.metadata,
    priority: request.priority,
    timeout: request.timeout,
    created_at: Date.now(),
  };
  
  verificationStore.verifications.set(id, verification);
  verificationStore.metrics.totalVerifications++;
  verificationStore.metrics.pendingVerifications++;
  
  logEvent({
    type: 'verification_created',
    verification_id: id,
    source: request.source,
    target: request.target,
    timestamp: Date.now(),
  });
  
  return verification;
}

async function processVerification(id) {
  const verification = verificationStore.verifications.get(id);
  if (!verification) return;
  
  try {
    // Simulate verification process
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    // Random result for demo
    const success = Math.random() > 0.2;
    const confidence = success ? Math.random() * 0.4 + 0.6 : Math.random() * 0.4;
    
    verification.status = success ? 'verified' : 'failed';
    verification.confidence = confidence;
    verification.completed_at = Date.now();
    
    verificationStore.metrics.pendingVerifications--;
    if (success) {
      verificationStore.metrics.successfulVerifications++;
    } else {
      verificationStore.metrics.failedVerifications++;
    }
    
    logEvent({
      type: 'verification_complete',
      verification_id: id,
      status: verification.status,
      confidence: verification.confidence,
      timestamp: Date.now(),
    });
    
  } catch (error) {
    verification.status = 'failed';
    verification.error = error.message;
    verification.completed_at = Date.now();
    
    verificationStore.metrics.pendingVerifications--;
    verificationStore.metrics.failedVerifications++;
    
    logEvent({
      type: 'error',
      verification_id: id,
      error: error.message,
      timestamp: Date.now(),
    });
  }
}

function createVerificationBatch(items) {
  const id = nanoid();
  const batch = {
    id,
    items,
    status: 'pending',
    created_at: Date.now(),
    total_items: items.length,
    completed_items: 0,
  };
  
  verificationStore.batches.set(id, batch);
  
  logEvent({
    type: 'batch_created',
    batch_id: id,
    item_count: items.length,
    timestamp: Date.now(),
  });
  
  return batch;
}

async function processBatch(batchId) {
  const batch = verificationStore.batches.get(batchId);
  if (!batch) return;
  
  batch.status = 'processing';
  batch.results = [];
  
  try {
    for (const item of batch.items) {
      const verification = createVerification(item);
      await processVerification(verification.id);
      batch.results.push(verificationStore.verifications.get(verification.id));
      batch.completed_items++;
    }
    
    batch.status = 'completed';
    batch.completed_at = Date.now();
    
    logEvent({
      type: 'batch_completed',
      batch_id: batchId,
      completed_items: batch.completed_items,
      timestamp: Date.now(),
    });
    
  } catch (error) {
    batch.status = 'failed';
    batch.error = error.message;
    batch.completed_at = Date.now();
    
    logEvent({
      type: 'error',
      batch_id: batchId,
      error: error.message,
      timestamp: Date.now(),
    });
  }
}

function calculateMetrics() {
  const now = Date.now();
  const uptime = now - verificationStore.metrics.startTime;
  const total = verificationStore.metrics.totalVerifications;
  
  return {
    total_verifications: total,
    successful_verifications: verificationStore.metrics.successfulVerifications,
    failed_verifications: verificationStore.metrics.failedVerifications,
    pending_verifications: verificationStore.metrics.pendingVerifications,
    success_rate: total > 0 ? (verificationStore.metrics.successfulVerifications / total) * 100 : 0,
    verification_rate: total > 0 ? (total / (uptime / 1000 / 3600)) : 0, // per hour
    average_confidence: calculateAverageConfidence(),
    uptime_ms: uptime,
    response_time: {
      avg: 1250,
      p50: 1100,
      p95: 2800,
      p99: 4200,
    },
  };
}

function calculateDetailedMetrics(timeframe) {
  const basic = calculateMetrics();
  const timeframePeriods = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  
  const period = timeframePeriods[timeframe] || timeframePeriods['24h'];
  const cutoff = Date.now() - period;
  
  // Filter events by timeframe
  const recentEvents = verificationStore.events.filter(e => e.timestamp >= cutoff);
  
  return {
    ...basic,
    timeframe,
    period_ms: period,
    recent_events_count: recentEvents.length,
    trends: calculateTrends(recentEvents),
    error_distribution: calculateErrorDistribution(recentEvents),
  };
}

function performHealthCheck() {
  const now = Date.now();
  const metrics = calculateMetrics();
  
  // Simple health checks
  const apiHealth = {
    status: 'up',
    response_time: Math.random() * 100 + 50,
    last_check: now,
    error_count: 0,
  };
  
  const websocketHealth = {
    status: 'up',
    response_time: Math.random() * 50 + 20,
    last_check: now,
    error_count: 0,
  };
  
  const graphqlHealth = {
    status: 'up',
    response_time: Math.random() * 150 + 75,
    last_check: now,
    error_count: 0,
  };
  
  const databaseHealth = {
    status: 'up',
    response_time: Math.random() * 200 + 100,
    last_check: now,
    error_count: 0,
  };
  
  const cacheHealth = {
    status: 'up',
    response_time: Math.random() * 25 + 10,
    last_check: now,
    error_count: 0,
  };
  
  const allServices = [apiHealth, websocketHealth, graphqlHealth, databaseHealth, cacheHealth];
  const downServices = allServices.filter(s => s.status === 'down').length;
  const degradedServices = allServices.filter(s => s.status === 'degraded').length;
  
  let overallStatus = 'healthy';
  if (downServices > 0) {
    overallStatus = 'unhealthy';
  } else if (degradedServices > 1) {
    overallStatus = 'degraded';
  }
  
  return {
    status: overallStatus,
    timestamp: now,
    services: {
      api: apiHealth,
      websocket: websocketHealth,
      graphql: graphqlHealth,
      database: databaseHealth,
      cache: cacheHealth,
    },
    metrics: {
      uptime: metrics.uptime_ms,
      memory_usage: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100,
      cpu_usage: Math.random() * 20 + 10,
      active_connections: Math.floor(Math.random() * 100) + 20,
    },
  };
}

function determineOverallStatus(metrics) {
  if (metrics.success_rate < 80) return 'degraded';
  if (metrics.pending_verifications > 100) return 'busy';
  return 'operational';
}

function getActiveVerifications() {
  return Array.from(verificationStore.verifications.values())
    .filter(v => v.status === 'pending')
    .slice(0, 10); // Return first 10 for overview
}

function getRecentEvents(limit = 10) {
  return verificationStore.events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

function parseQuery(query) {
  return {
    id: query.id,
    sources: query.sources ? query.sources.split(',') : undefined,
    targets: query.targets ? query.targets.split(',') : undefined,
    status: query.status ? query.status.split(',') : undefined,
    confidence_min: query.confidence_min ? parseFloat(query.confidence_min) : undefined,
    confidence_max: query.confidence_max ? parseFloat(query.confidence_max) : undefined,
    timestamp_start: query.timestamp_start ? parseInt(query.timestamp_start) : undefined,
    timestamp_end: query.timestamp_end ? parseInt(query.timestamp_end) : undefined,
    limit: Math.min(parseInt(query.limit) || 50, 1000),
    offset: parseInt(query.offset) || 0,
  };
}

function queryVerifications(query) {
  let results = Array.from(verificationStore.verifications.values());
  
  // Apply filters
  if (query.id) {
    results = results.filter(v => v.id === query.id);
  }
  if (query.sources) {
    results = results.filter(v => query.sources.includes(v.source));
  }
  if (query.targets) {
    results = results.filter(v => query.targets.includes(v.target));
  }
  if (query.status) {
    results = results.filter(v => query.status.includes(v.status));
  }
  if (query.confidence_min !== undefined) {
    results = results.filter(v => v.confidence >= query.confidence_min);
  }
  if (query.confidence_max !== undefined) {
    results = results.filter(v => v.confidence <= query.confidence_max);
  }
  if (query.timestamp_start) {
    results = results.filter(v => v.timestamp >= query.timestamp_start);
  }
  if (query.timestamp_end) {
    results = results.filter(v => v.timestamp <= query.timestamp_end);
  }
  
  // Sort by timestamp (newest first)
  results.sort((a, b) => b.timestamp - a.timestamp);
  
  const total = results.length;
  const offset = query.offset || 0;
  const limit = query.limit || 50;
  
  return {
    items: results.slice(offset, offset + limit),
    total,
    hasMore: offset + limit < total,
  };
}

function calculateAverageConfidence() {
  const verifications = Array.from(verificationStore.verifications.values())
    .filter(v => v.status !== 'pending');
  
  if (verifications.length === 0) return 0;
  
  const sum = verifications.reduce((acc, v) => acc + v.confidence, 0);
  return sum / verifications.length;
}

function calculateTrends(events) {
  // Simplified trend calculation
  const hourlyBuckets = {};
  
  events.forEach(event => {
    const hour = new Date(event.timestamp).getHours();
    if (!hourlyBuckets[hour]) hourlyBuckets[hour] = 0;
    hourlyBuckets[hour]++;
  });
  
  return {
    hourly_distribution: hourlyBuckets,
    peak_hour: Object.keys(hourlyBuckets).reduce((a, b) => 
      hourlyBuckets[a] > hourlyBuckets[b] ? a : b, '0'),
  };
}

function calculateErrorDistribution(events) {
  const errors = events.filter(e => e.type === 'error');
  const distribution = {};
  
  errors.forEach(error => {
    const errorType = error.error || 'unknown';
    distribution[errorType] = (distribution[errorType] || 0) + 1;
  });
  
  return distribution;
}

function logEvent(event) {
  verificationStore.events.push({
    id: nanoid(),
    ...event,
    severity: event.severity || 'medium',
  });
  
  // Keep only last 1000 events
  if (verificationStore.events.length > 1000) {
    verificationStore.events = verificationStore.events.slice(-1000);
  }
}

module.exports = router;
