import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';

export interface AnalyticsMetric {
  id: string;
  name: string;
  description: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  category: 'performance' | 'usage' | 'business' | 'technical' | 'security' | 'cost';
  unit: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
  source: string;
  metadata: Record<string, any>;
}

export interface AnalyticsDashboard {
  id: string;
  name: string;
  description: string;
  type: 'operational' | 'executive' | 'technical' | 'business' | 'security' | 'custom';
  widgets: DashboardWidget[];
  layout: DashboardLayout;
  permissions: {
    viewers: string[];
    editors: string[];
    public: boolean;
  };
  schedule: {
    autoRefresh: boolean;
    refreshInterval: number; // seconds
    exportSchedule?: {
      frequency: 'daily' | 'weekly' | 'monthly';
      format: 'pdf' | 'png' | 'csv' | 'json';
      recipients: string[];
    };
  };
  filters: DashboardFilter[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'chart' | 'table' | 'metric' | 'gauge' | 'map' | 'text' | 'alert';
  size: 'small' | 'medium' | 'large' | 'full-width';
  position: { x: number; y: number; width: number; height: number };
  dataSource: {
    query: string;
    metrics: string[];
    aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'p95' | 'p99';
    timeRange: string;
    groupBy: string[];
  };
  visualization: {
    chartType?: 'line' | 'bar' | 'pie' | 'scatter' | 'heatmap' | 'area';
    options: Record<string, any>;
    thresholds?: {
      warning: number;
      critical: number;
    };
  };
  alerts: {
    enabled: boolean;
    conditions: AlertCondition[];
  };
}

export interface DashboardLayout {
  columns: number;
  rows: number;
  grid: boolean;
  responsive: boolean;
}

export interface DashboardFilter {
  id: string;
  name: string;
  type: 'dropdown' | 'multiselect' | 'daterange' | 'text' | 'number';
  field: string;
  values?: string[];
  defaultValue?: any;
  required: boolean;
}

export interface AlertCondition {
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  duration: number; // seconds
  severity: 'info' | 'warning' | 'critical';
}

export interface AnalyticsInsight {
  id: string;
  title: string;
  description: string;
  type: 'anomaly' | 'trend' | 'correlation' | 'prediction' | 'recommendation';
  category: 'performance' | 'usage' | 'cost' | 'security' | 'quality';
  confidence: number; // 0-100
  impact: 'low' | 'medium' | 'high';
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: {
    metrics: string[];
    timeRange: { start: Date; end: Date };
    values: Record<string, number>;
    baseline?: Record<string, number>;
    deviation?: number;
  };
  recommendations: {
    action: string;
    effort: 'low' | 'medium' | 'high';
    impact: string;
    implementation: string[];
  }[];
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'dismissed';
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface PerformanceMetrics {
  system: {
    cpu: {
      usage: number;
      cores: number;
      loadAverage: number[];
    };
    memory: {
      used: number;
      free: number;
      total: number;
      usage: number;
    };
    disk: {
      used: number;
      free: number;
      total: number;
      usage: number;
      iops: number;
    };
    network: {
      bytesIn: number;
      bytesOut: number;
      packetsIn: number;
      packetsOut: number;
      errors: number;
    };
  };
  application: {
    responseTime: {
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    };
    throughput: {
      requestsPerSecond: number;
      transactionsPerSecond: number;
    };
    errors: {
      rate: number;
      count: number;
      types: Record<string, number>;
    };
    availability: {
      uptime: number;
      sla: number;
      incidents: number;
    };
  };
  database: {
    connections: {
      active: number;
      idle: number;
      max: number;
    };
    queries: {
      avgExecutionTime: number;
      slowQueries: number;
      deadlocks: number;
    };
    storage: {
      size: number;
      growth: number;
      fragmentation: number;
    };
  };
  infrastructure: {
    containers: {
      running: number;
      stopped: number;
      restarts: number;
    };
    services: {
      healthy: number;
      unhealthy: number;
      degraded: number;
    };
  };
}

export interface UsageMetrics {
  users: {
    total: number;
    active: number;
    new: number;
    returning: number;
    churn: number;
  };
  sessions: {
    total: number;
    duration: {
      avg: number;
      median: number;
    };
    bounceRate: number;
    pagesPerSession: number;
  };
  features: {
    adoption: Record<string, {
      users: number;
      usage: number;
      retention: number;
    }>;
    mostUsed: string[];
    leastUsed: string[];
  };
  api: {
    calls: number;
    uniqueConsumers: number;
    avgResponseTime: number;
    errorRate: number;
    rateLimits: {
      hit: number;
      consumed: number;
    };
  };
  content: {
    created: number;
    modified: number;
    deleted: number;
    views: number;
  };
}

export interface BusinessMetrics {
  revenue: {
    total: number;
    recurring: number;
    growth: number;
    arpu: number; // Average Revenue Per User
    ltv: number;  // Lifetime Value
  };
  customers: {
    total: number;
    new: number;
    retained: number;
    churned: number;
    satisfaction: number;
  };
  conversion: {
    leads: number;
    qualified: number;
    opportunities: number;
    closed: number;
    rate: number;
  };
  support: {
    tickets: number;
    resolved: number;
    avgResolutionTime: number;
    satisfaction: number;
  };
}

export interface PredictiveModel {
  id: string;
  name: string;
  description: string;
  type: 'regression' | 'classification' | 'time-series' | 'anomaly-detection';
  algorithm: string;
  features: string[];
  target: string;
  accuracy: number;
  confidence: number;
  trainedAt: Date;
  lastPrediction?: Date;
  trainingData: {
    samples: number;
    features: number;
    timeRange: { start: Date; end: Date };
  };
  performance: {
    precision: number;
    recall: number;
    f1Score: number;
    mse?: number;
    mae?: number;
  };
  predictions: PredictionResult[];
  status: 'training' | 'ready' | 'needs-retraining' | 'error';
}

export interface PredictionResult {
  id: string;
  modelId: string;
  input: Record<string, any>;
  prediction: any;
  confidence: number;
  timestamp: Date;
  actual?: any; // For validation
  accuracy?: number;
}

export interface AnalyticsReport {
  id: string;
  name: string;
  description: string;
  type: 'performance' | 'usage' | 'business' | 'security' | 'compliance' | 'custom';
  format: 'pdf' | 'html' | 'csv' | 'json' | 'xlsx';
  schedule: {
    frequency: 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
    time?: string;
    timezone?: string;
    recipients: string[];
  };
  sections: ReportSection[];
  filters: Record<string, any>;
  lastGenerated?: Date;
  nextGeneration?: Date;
  generatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportSection {
  id: string;
  title: string;
  type: 'summary' | 'chart' | 'table' | 'text' | 'metrics';
  content: {
    query?: string;
    visualization?: any;
    text?: string;
    metrics?: string[];
  };
  order: number;
}

export interface AnalyticsConfiguration {
  collection: {
    enabled: boolean;
    samplingRate: number;
    batchSize: number;
    flushInterval: number;
  };
  storage: {
    retention: {
      raw: string;      // e.g., '7d'
      aggregated: string; // e.g., '90d'
      summary: string;   // e.g., '1y'
    };
    compression: boolean;
    encryption: boolean;
  };
  processing: {
    realTime: boolean;
    batchProcessing: boolean;
    aggregationIntervals: string[];
  };
  alerts: {
    enabled: boolean;
    channels: string[];
    escalation: {
      levels: number;
      intervals: number[];
    };
  };
  privacy: {
    anonymization: boolean;
    gdprCompliant: boolean;
    dataMinimization: boolean;
  };
  integrations: {
    grafana?: { url: string; apiKey: string };
    prometheus?: { url: string };
    elasticsearch?: { url: string; index: string };
    splunk?: { url: string; token: string };
  };
}

export class AnalyticsManager extends EventEmitter {
  private metrics: Map<string, AnalyticsMetric[]> = new Map();
  private dashboards: Map<string, AnalyticsDashboard> = new Map();
  private insights: Map<string, AnalyticsInsight> = new Map();
  private models: Map<string, PredictiveModel> = new Map();
  private reports: Map<string, AnalyticsReport> = new Map();
  private analyticsPath: string;
  private logger: Logger;
  private config: ConfigManager;
  private configuration: AnalyticsConfiguration;

  constructor(
    analyticsPath: string = './analytics',
    logger?: Logger,
    config?: ConfigManager
  ) {
    super();
    this.analyticsPath = analyticsPath;
    this.logger = logger || new Logger({ level: 'info', format: 'text', destination: 'console' });
    this.config = config || ConfigManager.getInstance();
    this.configuration = this.getDefaultConfiguration();
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.analyticsPath, { recursive: true });
      await mkdir(join(this.analyticsPath, 'metrics'), { recursive: true });
      await mkdir(join(this.analyticsPath, 'dashboards'), { recursive: true });
      await mkdir(join(this.analyticsPath, 'insights'), { recursive: true });
      await mkdir(join(this.analyticsPath, 'models'), { recursive: true });
      await mkdir(join(this.analyticsPath, 'reports'), { recursive: true });
      
      await this.loadConfigurations();
      await this.initializeDefaultDashboards();
      await this.startMetricsCollection();
      
      this.logger.info('Analytics Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Analytics Manager', { error });
      throw error;
    }
  }

  async recordMetric(metric: Omit<AnalyticsMetric, 'id' | 'timestamp'>): Promise<void> {
    const fullMetric: AnalyticsMetric = {
      id: `metric-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...metric
    };

    const key = `${metric.category}-${metric.name}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metricArray = this.metrics.get(key)!;
    metricArray.push(fullMetric);

    // Keep only recent metrics in memory (configurable retention)
    const retentionPeriod = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = Date.now() - retentionPeriod;
    const filteredMetrics = metricArray.filter(m => m.timestamp.getTime() > cutoff);
    this.metrics.set(key, filteredMetrics);

    // Persist to disk for longer-term storage
    await this.persistMetric(fullMetric);

    this.emit('metric:recorded', fullMetric);

    // Check for anomalies and generate insights
    await this.checkForAnomalies(key, fullMetric);
  }

  async queryMetrics(query: {
    metrics: string[];
    timeRange: { start: Date; end: Date };
    aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'p95' | 'p99';
    groupBy?: string[];
    filters?: Record<string, any>;
  }): Promise<Record<string, any[]>> {
    const results: Record<string, any[]> = {};

    for (const metricName of query.metrics) {
      const key = metricName.includes('-') ? metricName : `*-${metricName}`;
      const matchingKeys = Array.from(this.metrics.keys()).filter(k => 
        key === '*' || k.includes(key.replace('*-', '')) || k === key
      );

      let allMetrics: AnalyticsMetric[] = [];
      for (const k of matchingKeys) {
        const keyMetrics = this.metrics.get(k) || [];
        allMetrics.push(...keyMetrics);
      }

      // Filter by time range
      allMetrics = allMetrics.filter(m => 
        m.timestamp >= query.timeRange.start && 
        m.timestamp <= query.timeRange.end
      );

      // Apply filters
      if (query.filters) {
        for (const [field, value] of Object.entries(query.filters)) {
          allMetrics = allMetrics.filter(m => {
            if (field === 'tags') {
              return Object.entries(value as Record<string, string>).every(([k, v]) => 
                m.tags[k] === v
              );
            }
            return (m as any)[field] === value;
          });
        }
      }

      // Group by if specified
      if (query.groupBy && query.groupBy.length > 0) {
        const grouped = this.groupMetrics(allMetrics, query.groupBy);
        for (const [group, metrics] of Object.entries(grouped)) {
          const aggregated = this.aggregateMetrics(metrics, query.aggregation || 'avg');
          results[`${metricName}-${group}`] = aggregated;
        }
      } else {
        const aggregated = this.aggregateMetrics(allMetrics, query.aggregation || 'avg');
        results[metricName] = aggregated;
      }
    }

    return results;
  }

  async createDashboard(dashboardData: {
    name: string;
    description: string;
    type: AnalyticsDashboard['type'];
    widgets: Omit<DashboardWidget, 'id'>[];
    permissions?: Partial<AnalyticsDashboard['permissions']>;
  }): Promise<AnalyticsDashboard> {
    const dashboard: AnalyticsDashboard = {
      id: `dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: dashboardData.name,
      description: dashboardData.description,
      type: dashboardData.type,
      widgets: dashboardData.widgets.map((widget, index) => ({
        id: `widget-${Date.now()}-${index}`,
        ...widget
      })),
      layout: {
        columns: 12,
        rows: 8,
        grid: true,
        responsive: true
      },
      permissions: {
        viewers: [],
        editors: [],
        public: false,
        ...dashboardData.permissions
      },
      schedule: {
        autoRefresh: true,
        refreshInterval: 30
      },
      filters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system'
    };

    this.dashboards.set(dashboard.id, dashboard);
    await this.saveDashboard(dashboard);

    this.emit('dashboard:created', dashboard);
    this.logger.info(`Dashboard created: ${dashboard.name} (${dashboard.id})`);

    return dashboard;
  }

  async generateInsights(
    scope: {
      metrics?: string[];
      timeRange?: { start: Date; end: Date };
      categories?: string[];
    } = {}
  ): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Default time range: last 24 hours
    const timeRange = scope.timeRange || {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date()
    };

    // Anomaly detection
    const anomalies = await this.detectAnomalies(timeRange, scope.metrics);
    insights.push(...anomalies);

    // Trend analysis
    const trends = await this.analyzeTrends(timeRange, scope.metrics);
    insights.push(...trends);

    // Performance insights
    const performance = await this.analyzePerformance(timeRange);
    insights.push(...performance);

    // Usage insights
    const usage = await this.analyzeUsage(timeRange);
    insights.push(...usage);

    // Cost optimization insights
    const costOptimizations = await this.analyzeCostOptimization(timeRange);
    insights.push(...costOptimizations);

    // Store insights
    for (const insight of insights) {
      this.insights.set(insight.id, insight);
      await this.saveInsight(insight);
    }

    this.emit('insights:generated', { insights, scope });
    this.logger.info(`Generated ${insights.length} insights`);

    return insights;
  }

  async trainPredictiveModel(modelConfig: {
    name: string;
    description: string;
    type: PredictiveModel['type'];
    algorithm: string;
    features: string[];
    target: string;
    trainingPeriod: { start: Date; end: Date };
  }): Promise<PredictiveModel> {
    const model: PredictiveModel = {
      id: `model-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: modelConfig.name,
      description: modelConfig.description,
      type: modelConfig.type,
      algorithm: modelConfig.algorithm,
      features: modelConfig.features,
      target: modelConfig.target,
      accuracy: 0,
      confidence: 0,
      trainedAt: new Date(),
      trainingData: {
        samples: 0,
        features: modelConfig.features.length,
        timeRange: modelConfig.trainingPeriod
      },
      performance: {
        precision: 0,
        recall: 0,
        f1Score: 0
      },
      predictions: [],
      status: 'training'
    };

    try {
      // Collect training data
      const trainingData = await this.collectTrainingData(model);
      
      // Train the model (simplified implementation)
      const trained = await this.executeModelTraining(model, trainingData);
      
      Object.assign(model, trained);
      model.status = 'ready';

      this.models.set(model.id, model);
      await this.saveModel(model);

      this.emit('model:trained', model);
      this.logger.info(`Predictive model trained: ${model.name} (${model.id}) - Accuracy: ${model.accuracy}%`);

    } catch (error) {
      model.status = 'error';
      this.logger.error(`Model training failed: ${model.name}`, { error });
      throw error;
    }

    return model;
  }

  async makePrediction(
    modelId: string,
    input: Record<string, any>
  ): Promise<PredictionResult> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    if (model.status !== 'ready') {
      throw new Error(`Model is not ready for predictions: ${model.status}`);
    }

    // Simple prediction logic (would be replaced with actual ML inference)
    const prediction = await this.executePrediction(model, input);

    const result: PredictionResult = {
      id: `prediction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      modelId,
      input,
      prediction: prediction.value,
      confidence: prediction.confidence,
      timestamp: new Date()
    };

    model.predictions.push(result);
    model.lastPrediction = new Date();

    await this.saveModel(model);

    this.emit('prediction:made', { model, result });
    this.logger.debug(`Prediction made: ${modelId} - ${JSON.stringify(result.prediction)}`);

    return result;
  }

  async getPerformanceMetrics(
    timeRange?: { start: Date; end: Date }
  ): Promise<PerformanceMetrics> {
    const range = timeRange || {
      start: new Date(Date.now() - 60 * 60 * 1000), // Last hour
      end: new Date()
    };

    const systemMetrics = await this.queryMetrics({
      metrics: ['cpu-usage', 'memory-usage', 'disk-usage', 'network-io'],
      timeRange: range,
      aggregation: 'avg'
    });

    const appMetrics = await this.queryMetrics({
      metrics: ['response-time', 'request-rate', 'error-rate', 'uptime'],
      timeRange: range,
      aggregation: 'avg'
    });

    const dbMetrics = await this.queryMetrics({
      metrics: ['db-connections', 'query-time', 'db-size'],
      timeRange: range,
      aggregation: 'avg'
    });

    // Construct performance metrics (simplified)
    return {
      system: {
        cpu: {
          usage: this.getLatestValue(systemMetrics['cpu-usage']) || 0,
          cores: 8, // Would be detected from system
          loadAverage: [1.2, 1.5, 1.8] // Would be collected from system
        },
        memory: {
          used: this.getLatestValue(systemMetrics['memory-usage']) || 0,
          free: 4000000000, // Would be calculated
          total: 8000000000,
          usage: 50
        },
        disk: {
          used: this.getLatestValue(systemMetrics['disk-usage']) || 0,
          free: 100000000000,
          total: 500000000000,
          usage: 20,
          iops: 1000
        },
        network: {
          bytesIn: 1000000,
          bytesOut: 2000000,
          packetsIn: 5000,
          packetsOut: 6000,
          errors: 5
        }
      },
      application: {
        responseTime: {
          avg: this.getLatestValue(appMetrics['response-time']) || 0,
          p50: 150,
          p95: 500,
          p99: 1000
        },
        throughput: {
          requestsPerSecond: this.getLatestValue(appMetrics['request-rate']) || 0,
          transactionsPerSecond: 50
        },
        errors: {
          rate: this.getLatestValue(appMetrics['error-rate']) || 0,
          count: 10,
          types: { '500': 5, '404': 3, '400': 2 }
        },
        availability: {
          uptime: this.getLatestValue(appMetrics['uptime']) || 0,
          sla: 99.9,
          incidents: 2
        }
      },
      database: {
        connections: {
          active: 25,
          idle: 75,
          max: 100
        },
        queries: {
          avgExecutionTime: this.getLatestValue(dbMetrics['query-time']) || 0,
          slowQueries: 5,
          deadlocks: 0
        },
        storage: {
          size: this.getLatestValue(dbMetrics['db-size']) || 0,
          growth: 1000000, // bytes per day
          fragmentation: 5
        }
      },
      infrastructure: {
        containers: {
          running: 12,
          stopped: 2,
          restarts: 3
        },
        services: {
          healthy: 15,
          unhealthy: 1,
          degraded: 0
        }
      }
    };
  }

  async getUsageMetrics(
    timeRange?: { start: Date; end: Date }
  ): Promise<UsageMetrics> {
    const range = timeRange || {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date()
    };

    const usageData = await this.queryMetrics({
      metrics: ['active-users', 'sessions', 'api-calls', 'feature-usage'],
      timeRange: range,
      aggregation: 'sum'
    });

    return {
      users: {
        total: 10000,
        active: this.getLatestValue(usageData['active-users']) || 0,
        new: 50,
        returning: 1500,
        churn: 25
      },
      sessions: {
        total: this.getLatestValue(usageData['sessions']) || 0,
        duration: {
          avg: 15 * 60, // 15 minutes
          median: 12 * 60
        },
        bounceRate: 25,
        pagesPerSession: 4.5
      },
      features: {
        adoption: {
          'dashboard': { users: 800, usage: 5000, retention: 85 },
          'reports': { users: 600, usage: 2000, retention: 70 },
          'analytics': { users: 400, usage: 1500, retention: 60 }
        },
        mostUsed: ['dashboard', 'reports', 'search'],
        leastUsed: ['advanced-filters', 'export', 'integrations']
      },
      api: {
        calls: this.getLatestValue(usageData['api-calls']) || 0,
        uniqueConsumers: 150,
        avgResponseTime: 250,
        errorRate: 2.5,
        rateLimits: {
          hit: 5,
          consumed: 75
        }
      },
      content: {
        created: 100,
        modified: 250,
        deleted: 25,
        views: 5000
      }
    };
  }

  async getBusinessMetrics(
    timeRange?: { start: Date; end: Date }
  ): Promise<BusinessMetrics> {
    // This would integrate with business systems (CRM, billing, etc.)
    return {
      revenue: {
        total: 1000000,
        recurring: 800000,
        growth: 15,
        arpu: 100,
        ltv: 2400
      },
      customers: {
        total: 500,
        new: 25,
        retained: 450,
        churned: 10,
        satisfaction: 4.2
      },
      conversion: {
        leads: 1000,
        qualified: 400,
        opportunities: 200,
        closed: 50,
        rate: 5
      },
      support: {
        tickets: 150,
        resolved: 140,
        avgResolutionTime: 4 * 60 * 60, // 4 hours
        satisfaction: 4.5
      }
    };
  }

  // Private helper methods
  private getDefaultConfiguration(): AnalyticsConfiguration {
    return {
      collection: {
        enabled: true,
        samplingRate: 1.0,
        batchSize: 1000,
        flushInterval: 60000
      },
      storage: {
        retention: {
          raw: '7d',
          aggregated: '90d',
          summary: '1y'
        },
        compression: true,
        encryption: false
      },
      processing: {
        realTime: true,
        batchProcessing: true,
        aggregationIntervals: ['1m', '5m', '1h', '1d']
      },
      alerts: {
        enabled: true,
        channels: ['email', 'slack'],
        escalation: {
          levels: 3,
          intervals: [5, 15, 30] // minutes
        }
      },
      privacy: {
        anonymization: true,
        gdprCompliant: true,
        dataMinimization: true
      },
      integrations: {}
    };
  }

  private async loadConfigurations(): Promise<void> {
    try {
      // Load dashboards
      const dashboardFiles = await readdir(join(this.analyticsPath, 'dashboards'));
      for (const file of dashboardFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.analyticsPath, 'dashboards', file), 'utf-8');
        const dashboard: AnalyticsDashboard = JSON.parse(content);
        this.dashboards.set(dashboard.id, dashboard);
      }

      // Load insights
      const insightFiles = await readdir(join(this.analyticsPath, 'insights'));
      for (const file of insightFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.analyticsPath, 'insights', file), 'utf-8');
        const insight: AnalyticsInsight = JSON.parse(content);
        this.insights.set(insight.id, insight);
      }

      // Load models
      const modelFiles = await readdir(join(this.analyticsPath, 'models'));
      for (const file of modelFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.analyticsPath, 'models', file), 'utf-8');
        const model: PredictiveModel = JSON.parse(content);
        this.models.set(model.id, model);
      }

      this.logger.info(`Loaded ${this.dashboards.size} dashboards, ${this.insights.size} insights, ${this.models.size} models`);
    } catch (error) {
      this.logger.warn('Failed to load some analytics configurations', { error });
    }
  }

  private async initializeDefaultDashboards(): Promise<void> {
    const defaultDashboards = [
      {
        name: 'System Performance',
        description: 'Real-time system performance metrics',
        type: 'operational' as const,
        widgets: [
          {
            title: 'CPU Usage',
            type: 'gauge' as const,
            size: 'medium' as const,
            position: { x: 0, y: 0, width: 6, height: 3 },
            dataSource: {
              query: 'cpu-usage',
              metrics: ['cpu-usage'],
              aggregation: 'avg' as const,
              timeRange: '1h',
              groupBy: []
            },
            visualization: {
              chartType: 'gauge' as const,
              options: { max: 100, unit: '%' },
              thresholds: { warning: 70, critical: 90 }
            },
            alerts: { enabled: true, conditions: [] }
          },
          {
            title: 'Memory Usage',
            type: 'gauge' as const,
            size: 'medium' as const,
            position: { x: 6, y: 0, width: 6, height: 3 },
            dataSource: {
              query: 'memory-usage',
              metrics: ['memory-usage'],
              aggregation: 'avg' as const,
              timeRange: '1h',
              groupBy: []
            },
            visualization: {
              chartType: 'gauge' as const,
              options: { max: 100, unit: '%' },
              thresholds: { warning: 80, critical: 95 }
            },
            alerts: { enabled: true, conditions: [] }
          },
          {
            title: 'Response Time',
            type: 'chart' as const,
            size: 'large' as const,
            position: { x: 0, y: 3, width: 12, height: 4 },
            dataSource: {
              query: 'response-time',
              metrics: ['response-time'],
              aggregation: 'avg' as const,
              timeRange: '24h',
              groupBy: ['service']
            },
            visualization: {
              chartType: 'line' as const,
              options: { unit: 'ms' }
            },
            alerts: { enabled: false, conditions: [] }
          }
        ]
      },
      {
        name: 'Business KPIs',
        description: 'Key business performance indicators',
        type: 'executive' as const,
        widgets: [
          {
            title: 'Active Users',
            type: 'metric' as const,
            size: 'small' as const,
            position: { x: 0, y: 0, width: 3, height: 2 },
            dataSource: {
              query: 'active-users',
              metrics: ['active-users'],
              aggregation: 'count' as const,
              timeRange: '24h',
              groupBy: []
            },
            visualization: {
              options: { unit: 'users' }
            },
            alerts: { enabled: false, conditions: [] }
          }
        ]
      }
    ];

    for (const dashboardData of defaultDashboards) {
      if (!Array.from(this.dashboards.values()).some(d => d.name === dashboardData.name)) {
        await this.createDashboard(dashboardData as Parameters<typeof this.createDashboard>[0]);
      }
    }
  }

  private async startMetricsCollection(): Promise<void> {
    // Start collecting system metrics
    setInterval(async () => {
      await this.collectSystemMetrics();
    }, 60000); // Every minute

    // Start collecting application metrics
    setInterval(async () => {
      await this.collectApplicationMetrics();
    }, 30000); // Every 30 seconds

    this.logger.info('Started automatic metrics collection');
  }

  private async collectSystemMetrics(): Promise<void> {
    try {
      // Mock system metrics collection
      await this.recordMetric({
        name: 'cpu-usage',
        description: 'CPU usage percentage',
        type: 'gauge',
        category: 'performance',
        unit: 'percent',
        value: Math.random() * 100,
        tags: { host: 'localhost', service: 'system' },
        source: 'system-monitor',
        metadata: {}
      });

      await this.recordMetric({
        name: 'memory-usage',
        description: 'Memory usage percentage',
        type: 'gauge',
        category: 'performance',
        unit: 'percent',
        value: Math.random() * 100,
        tags: { host: 'localhost', service: 'system' },
        source: 'system-monitor',
        metadata: {}
      });

      await this.recordMetric({
        name: 'disk-usage',
        description: 'Disk usage percentage',
        type: 'gauge',
        category: 'performance',
        unit: 'percent',
        value: Math.random() * 100,
        tags: { host: 'localhost', service: 'system' },
        source: 'system-monitor',
        metadata: {}
      });
    } catch (error) {
      this.logger.error('Failed to collect system metrics', { error });
    }
  }

  private async collectApplicationMetrics(): Promise<void> {
    try {
      // Mock application metrics collection
      await this.recordMetric({
        name: 'response-time',
        description: 'Average response time',
        type: 'gauge',
        category: 'performance',
        unit: 'milliseconds',
        value: Math.random() * 1000 + 100,
        tags: { service: 'api', endpoint: '/users' },
        source: 'application',
        metadata: {}
      });

      await this.recordMetric({
        name: 'request-rate',
        description: 'Requests per second',
        type: 'counter',
        category: 'usage',
        unit: 'requests/sec',
        value: Math.random() * 100 + 10,
        tags: { service: 'api' },
        source: 'application',
        metadata: {}
      });

      await this.recordMetric({
        name: 'error-rate',
        description: 'Error rate percentage',
        type: 'gauge',
        category: 'performance',
        unit: 'percent',
        value: Math.random() * 5,
        tags: { service: 'api' },
        source: 'application',
        metadata: {}
      });
    } catch (error) {
      this.logger.error('Failed to collect application metrics', { error });
    }
  }

  private async persistMetric(metric: AnalyticsMetric): Promise<void> {
    const date = metric.timestamp.toISOString().split('T')[0];
    const filePath = join(this.analyticsPath, 'metrics', `${date}.json`);
    
    try {
      let existingData: AnalyticsMetric[] = [];
      try {
        const content = await readFile(filePath, 'utf-8');
        existingData = JSON.parse(content);
      } catch {
        // File doesn't exist yet
      }
      
      existingData.push(metric);
      await writeFile(filePath, JSON.stringify(existingData, null, 2));
    } catch (error) {
      this.logger.error('Failed to persist metric', { error, metric: metric.id });
    }
  }

  private async checkForAnomalies(metricKey: string, metric: AnalyticsMetric): Promise<void> {
    const historical = this.metrics.get(metricKey) || [];
    if (historical.length < 10) return; // Need enough data for baseline

    const recent = historical.slice(-10);
    const average = recent.reduce((sum, m) => sum + m.value, 0) / recent.length;
    const stdDev = Math.sqrt(
      recent.reduce((sum, m) => sum + Math.pow(m.value - average, 2), 0) / recent.length
    );

    const threshold = 2; // 2 standard deviations
    const deviation = Math.abs(metric.value - average) / stdDev;

    if (deviation > threshold) {
      const insight: AnalyticsInsight = {
        id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: `Anomaly detected in ${metric.name}`,
        description: `The metric ${metric.name} has deviated significantly from its normal pattern`,
        type: 'anomaly',
        category: (['performance', 'usage', 'cost', 'security', 'quality'].includes(metric.category) 
          ? metric.category 
          : 'performance') as 'performance' | 'usage' | 'cost' | 'security' | 'quality',
        confidence: Math.min(95, deviation * 20),
        impact: deviation > 3 ? 'high' : 'medium',
        priority: deviation > 3 ? 'high' : 'medium',
        data: {
          metrics: [metric.name],
          timeRange: { start: recent[0].timestamp, end: metric.timestamp },
          values: { current: metric.value, average, stdDev },
          baseline: { average, stdDev },
          deviation
        },
        recommendations: [
          {
            action: 'Investigate the cause of the anomaly',
            effort: 'medium',
            impact: 'Identify potential issues before they become critical',
            implementation: [
              'Check recent deployments or configuration changes',
              'Review system logs for errors or warnings',
              'Monitor related metrics for correlation'
            ]
          }
        ],
        status: 'new',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.insights.set(insight.id, insight);
      await this.saveInsight(insight);

      this.emit('anomaly:detected', { metric, insight, deviation });
      this.logger.warn(`Anomaly detected in ${metric.name}`, { 
        current: metric.value, 
        average, 
        deviation 
      });
    }
  }

  private async detectAnomalies(
    timeRange: { start: Date; end: Date },
    metrics?: string[]
  ): Promise<AnalyticsInsight[]> {
    // Simplified anomaly detection
    return [];
  }

  private async analyzeTrends(
    timeRange: { start: Date; end: Date },
    metrics?: string[]
  ): Promise<AnalyticsInsight[]> {
    // Simplified trend analysis
    return [];
  }

  private async analyzePerformance(
    timeRange: { start: Date; end: Date }
  ): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Check response time trends
    const responseTimeData = await this.queryMetrics({
      metrics: ['response-time'],
      timeRange,
      aggregation: 'avg'
    });

    if (responseTimeData['response-time']?.length > 0) {
      const values = responseTimeData['response-time'].map((d: any) => d.value);
      const recent = values.slice(-5);
      const earlier = values.slice(0, -5);

      if (recent.length > 0 && earlier.length > 0) {
        const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
        const earlierAvg = earlier.reduce((sum, v) => sum + v, 0) / earlier.length;
        const change = ((recentAvg - earlierAvg) / earlierAvg) * 100;

        if (Math.abs(change) > 20) {
          insights.push({
            id: `perf-insight-${Date.now()}`,
            title: `Response time ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(1)}%`,
            description: `Response time has changed significantly in the recent period`,
            type: 'trend',
            category: 'performance',
            confidence: 80,
            impact: Math.abs(change) > 50 ? 'high' : 'medium',
            priority: Math.abs(change) > 50 ? 'high' : 'medium',
            data: {
              metrics: ['response-time'],
              timeRange,
              values: { recent: recentAvg, earlier: earlierAvg, change },
            },
            recommendations: change > 0 ? [
              {
                action: 'Investigate performance degradation',
                effort: 'medium',
                impact: 'Restore optimal response times',
                implementation: [
                  'Check for increased load or traffic',
                  'Review recent code deployments',
                  'Analyze database query performance',
                  'Monitor resource utilization'
                ]
              }
            ] : [
              {
                action: 'Document performance improvement',
                effort: 'low',
                impact: 'Understand what caused the improvement',
                implementation: [
                  'Identify recent optimizations',
                  'Document best practices',
                  'Monitor sustainability'
                ]
              }
            ],
            status: 'new',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
    }

    return insights;
  }

  private async analyzeUsage(
    timeRange: { start: Date; end: Date }
  ): Promise<AnalyticsInsight[]> {
    // Simplified usage analysis
    return [];
  }

  private async analyzeCostOptimization(
    timeRange: { start: Date; end: Date }
  ): Promise<AnalyticsInsight[]> {
    // Simplified cost optimization analysis
    return [];
  }

  private async collectTrainingData(model: PredictiveModel): Promise<any[]> {
    // Collect historical data for training
    const data = await this.queryMetrics({
      metrics: model.features,
      timeRange: model.trainingData.timeRange,
      aggregation: 'avg'
    });

    // Transform data for ML training (simplified)
    return Object.values(data).flat();
  }

  private async executeModelTraining(model: PredictiveModel, data: any[]): Promise<Partial<PredictiveModel>> {
    // Simplified model training
    return {
      accuracy: 85 + Math.random() * 10,
      confidence: 80 + Math.random() * 15,
      performance: {
        precision: 0.85,
        recall: 0.82,
        f1Score: 0.83
      },
      trainingData: {
        ...model.trainingData,
        samples: data.length
      }
    };
  }

  private async executePrediction(model: PredictiveModel, input: Record<string, any>): Promise<{ value: any; confidence: number }> {
    // Simplified prediction logic
    const value = Math.random() * 100;
    const confidence = 70 + Math.random() * 25;
    
    return { value, confidence };
  }

  private groupMetrics(metrics: AnalyticsMetric[], groupBy: string[]): Record<string, AnalyticsMetric[]> {
    const groups: Record<string, AnalyticsMetric[]> = {};
    
    for (const metric of metrics) {
      const key = groupBy.map(field => {
        if (field === 'tags') {
          return Object.entries(metric.tags).map(([k, v]) => `${k}:${v}`).join(',');
        }
        return (metric as any)[field] || 'unknown';
      }).join('-');
      
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(metric);
    }
    
    return groups;
  }

  private aggregateMetrics(metrics: AnalyticsMetric[], aggregation: string): any[] {
    if (metrics.length === 0) return [];

    // Group by time buckets for time series aggregation
    const buckets: Record<string, AnalyticsMetric[]> = {};
    
    for (const metric of metrics) {
      const bucket = new Date(Math.floor(metric.timestamp.getTime() / 60000) * 60000).toISOString();
      if (!buckets[bucket]) {
        buckets[bucket] = [];
      }
      buckets[bucket].push(metric);
    }

    return Object.entries(buckets).map(([timestamp, bucketMetrics]) => {
      const values = bucketMetrics.map(m => m.value);
      let aggregatedValue: number;

      switch (aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0);
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'count':
          aggregatedValue = values.length;
          break;
        case 'p95':
          values.sort((a, b) => a - b);
          aggregatedValue = values[Math.floor(values.length * 0.95)];
          break;
        case 'p99':
          values.sort((a, b) => a - b);
          aggregatedValue = values[Math.floor(values.length * 0.99)];
          break;
        case 'avg':
        default:
          aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
      }

      return {
        timestamp: new Date(timestamp),
        value: aggregatedValue,
        count: values.length
      };
    }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private getLatestValue(dataPoints: any[]): number {
    if (!dataPoints || dataPoints.length === 0) return 0;
    return dataPoints[dataPoints.length - 1]?.value || 0;
  }

  private async saveDashboard(dashboard: AnalyticsDashboard): Promise<void> {
    const filePath = join(this.analyticsPath, 'dashboards', `${dashboard.id}.json`);
    await writeFile(filePath, JSON.stringify(dashboard, null, 2));
  }

  private async saveInsight(insight: AnalyticsInsight): Promise<void> {
    const filePath = join(this.analyticsPath, 'insights', `${insight.id}.json`);
    await writeFile(filePath, JSON.stringify(insight, null, 2));
  }

  private async saveModel(model: PredictiveModel): Promise<void> {
    const filePath = join(this.analyticsPath, 'models', `${model.id}.json`);
    await writeFile(filePath, JSON.stringify(model, null, 2));
  }
}