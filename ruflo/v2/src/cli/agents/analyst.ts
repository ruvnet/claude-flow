/**
 * Analyst Agent - Specialized in data analysis and performance optimization
 */

import { BaseAgent } from './base-agent.js';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentEnvironment,
  TaskDefinition,
} from '../../swarm/types.js';
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { DistributedMemorySystem } from '../../memory/distributed-memory.js';

// Type definitions for analysis
interface AnalysisVisualization {
  type: string;
  title: string;
  description: string;
  dataPoints: number;
  interactive: boolean;
}

interface AnalysisBottleneck {
  component: string;
  impact: string;
  description: string;
  recommendation: string;
}

interface AnalysisAnomaly {
  id: string;
  timestamp: Date;
  severity: string;
  score: number;
  description: string;
  features: string[];
}

interface AnalysisTrend {
  metric: string;
  direction: string;
  slope: number;
  significance: number;
  period: string;
}

interface QualityIssue {
  category: string;
  severity: string;
  description: string;
  impact: string;
}

interface DataAnalysis {
  dataset: {
    name: string;
    size: number;
    columns: string[];
    types: Record<string, string>;
  };
  analysisType: string;
  summary: {
    rowCount: number;
    columnCount: number;
    missingValues: number;
    duplicateRows: number;
    outliers: number;
  };
  descriptiveStats: Record<string, any>;
  correlations: Record<string, any>;
  distributions: Record<string, any>;
  insights: string[];
  recommendations: string[];
  visualizations: AnalysisVisualization[];
  confidence: number;
  methodology: string;
  timestamp: Date;
}

interface PerformanceAnalysis {
  system?: string;
  timeframe?: string;
  metrics: Record<string, any>;
  benchmarks?: Record<string, any>;
  bottlenecks: AnalysisBottleneck[];
  anomalies: AnalysisAnomaly[];
  trends: AnalysisTrend[];
  insights: string[];
  recommendations: string[];
  visualizations: AnalysisVisualization[];
  optimizationPotential: number;
  projectedImprovement: number;
  confidence: number;
  timestamp: Date;
  alertsTriggered?: any[];
  slaCompliance?: {
    availability: number;
    responseTime: number;
    throughput: number;
  };
  comparison?: {
    baseline: string;
    improvements: string[];
    regressions: string[];
  };
}

interface QualityAnalysis {
  codeQuality: {
    complexity: number;
    maintainability: number;
    testCoverage: number;
    technicalDebt: number;
  };
  issues: QualityIssue[];
  patterns: string[];
  recommendations: string[];
  visualizations: AnalysisVisualization[];
  overallScore: number;
  confidence: number;
  timestamp: Date;
}

interface StatisticalAnalysis {
  tests: Record<string, any>;
  hypothesis: string;
  alpha: number;
  results: Record<string, any>;
  interpretation: Record<string, any>;
  assumptions: {
    normality: boolean;
    independence: boolean;
    homogeneity: boolean;
  };
  powerAnalysis: {
    power: number;
    sampleSize: number;
    effectSize: number;
  };
  conclusions: string[];
  limitations: string[];
  timestamp: Date;
}

interface VisualizationResult {
  chartType: string;
  style: string;
  interactive: boolean;
  charts: any[];
  dashboard: any;
  insights: string[];
  recommendations: string[];
  exportFormats: string[];
  accessibility: {
    colorBlind: boolean;
    screenReader: boolean;
    highContrast: boolean;
  };
  timestamp: Date;
}

interface AnomalyDetectionResult {
  method: string;
  sensitivity: number;
  threshold: string | number;
  detected: AnalysisAnomaly[];
  summary: {
    total: number;
    severity: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
  };
  patterns: string[];
  recommendations: string[];
  falsePositiveRate: number;
  confidence: number;
  timestamp: Date;
}

interface TrendAnalysisResult {
  timeframe: string;
  metrics: string[];
  trends: AnalysisTrend[];
  correlations: Record<string, number>;
  patterns: {
    seasonal: boolean;
    cyclical: boolean;
    trending: boolean;
  };
  forecasts: any[];
  insights: string[];
  recommendations: string[];
  confidence: number;
  timestamp: Date;
}

interface PredictiveModelResult {
  algorithm: string;
  features: string[];
  target: string;
  performance: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    rmse?: number;
    mse?: number;
    auc?: number;
  };
  validation: {
    method: string;
    splits: number;
    crossValidation: any;
  };
  predictions: any[];
  featureImportance: Record<string, number>;
  insights: string[];
  recommendations: string[];
  modelMetadata: {
    parameters: Record<string, any>;
    training: {
      epochs: number;
      convergence: boolean;
      finalLoss: number;
    };
  };
  confidence: number;
  timestamp: Date;
}

interface BusinessIntelligenceResult {
  scope: string;
  timeframe: string;
  kpis: Record<string, any>;
  trends: AnalysisTrend[];
  insights: string[];
  recommendations: string[];
  actionItems: string[];
  riskFactors: string[];
  opportunities: string[];
  marketAnalysis: {
    competitors: any[];
    positioning: string;
    threats: string[];
    opportunities: string[];
  };
  financialProjections: {
    revenue: any[];
    costs: any[];
    profitability: any[];
  };
  confidence: number;
  timestamp: Date;
}

export class AnalystAgent extends BaseAgent {
  constructor(
    id: string,
    config: AgentConfig,
    environment: AgentEnvironment,
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem,
  ) {
    super(id, 'analyst', config, environment, logger, eventBus, memory);
  }

  protected getDefaultCapabilities(): AgentCapabilities {
    return {
      codeGeneration: false,
      codeReview: true,
      testing: false,
      documentation: true,
      research: false,
      analysis: true,
      webSearch: false,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: false,
      languages: ['python', 'r', 'sql', 'typescript', 'javascript', 'julia', 'scala', 'matlab'],
      frameworks: [
        'pandas',
        'numpy',
        'matplotlib',
        'seaborn',
        'plotly',
        'dask',
        'spark',
        'tensorflow',
        'pytorch',
        'scikit-learn',
        'jupyter',
        'tableau',
      ],
      domains: [
        'data-analysis',
        'statistical-analysis',
        'performance-analysis',
        'business-intelligence',
        'data-visualization',
        'predictive-modeling',
        'machine-learning',
        'data-mining',
        'financial-analysis',
        'market-research',
        'operations-research',
        'quality-assurance',
      ],
      tools: [
        'data-processor',
        'statistical-analyzer',
        'chart-generator',
        'report-builder',
        'dashboard-creator',
        'ml-pipeline',
        'data-validator',
        'performance-profiler',
        'anomaly-detector',
        'trend-analyzer',
      ],
      maxConcurrentTasks: 4,
      maxMemoryUsage: 2048 * 1024 * 1024, // 2GB
      maxExecutionTime: 1200000, // 20 minutes
      reliability: 0.9,
      speed: 0.8,
      quality: 0.95,
    };
  }

  protected getDefaultConfig(): Partial<AgentConfig> {
    return {
      autonomyLevel: 0.75,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 15,
      maxConcurrentTasks: 4,
      timeoutThreshold: 1200000,
      reportingInterval: 45000,
      heartbeatInterval: 12000,
      permissions: ['file-read', 'file-write', 'data-access', 'database-read', 'api-access'],
      trustedAgents: [],
      expertise: {
        'data-analysis': 0.95,
        'statistical-analysis': 0.92,
        visualization: 0.88,
        'performance-analysis': 0.9,
        'predictive-modeling': 0.85,
        'business-intelligence': 0.83,
      },
      preferences: {
        outputFormat: 'detailed',
        includeCharts: true,
        statisticalTests: 'comprehensive',
        confidenceLevel: 0.95,
        visualStyle: 'professional',
      },
    };
  }

  override async executeTask(task: TaskDefinition): Promise<any> {
    this.logger.info('Analyst executing task', {
      agentId: this.id,
      taskType: task.type,
      taskId: task.id,
    });

    try {
      switch (task.type) {
        case 'data-analysis':
          return await this.analyzeData(task);
        case 'performance-analysis':
          return await this.analyzePerformance(task);
        case 'statistical-analysis':
          return await this.performStatisticalAnalysis(task);
        case 'visualization':
          return await this.createVisualization(task);
        case 'predictive-modeling':
          return await this.buildPredictiveModel(task);
        case 'anomaly-detection':
          return await this.detectAnomalies(task);
        case 'trend-analysis':
          return await this.analyzeTrends(task);
        case 'business-intelligence':
          return await this.generateBusinessIntelligence(task);
        case 'quality-analysis':
          return await this.analyzeQuality(task);
        default:
          return await this.performGeneralAnalysis(task);
      }
    } catch (error) {
      this.logger.error('Analysis task failed', {
        agentId: this.id,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async analyzeData(task: TaskDefinition): Promise<any> {
    const dataset = task.context?.dataset;
    const analysisType = task.context?.type || 'exploratory';
    const metrics = task.context?.metrics || ['central_tendency', 'distribution', 'correlation'];
    const outputFormat = task.context?.format || 'report';

    this.logger.info('Analyzing data', {
      analysisType,
      metrics,
      outputFormat,
    });

    const analysis: DataAnalysis = {
      dataset: {
        name: dataset?.name || 'Unknown',
        size: dataset?.size || 0,
        columns: dataset?.columns || [],
        types: dataset?.types || {},
      },
      analysisType,
      summary: {
        rowCount: 0,
        columnCount: 0,
        missingValues: 0,
        duplicateRows: 0,
        outliers: 0,
      },
      descriptiveStats: {},
      correlations: {},
      distributions: {},
      insights: [] as string[],
      recommendations: [] as string[],
      visualizations: [] as AnalysisVisualization[],
      confidence: 0,
      methodology: 'statistical-analysis',
      timestamp: new Date(),
    };

    // Store analysis progress
    await this.memory.store(
      `analysis:${task.id}:progress`,
      {
        status: 'analyzing',
        startTime: new Date(),
        analysisType,
      },
      {
        type: 'analysis-progress',
        tags: ['analysis', this.id, analysisType],
        partition: 'tasks',
      },
    );

    // Simulate data analysis
    await this.delay(3000);

    analysis.summary = {
      rowCount: 10000,
      columnCount: 15,
      missingValues: 125,
      duplicateRows: 23,
      outliers: 47,
    };

    analysis.insights = [
      'Strong positive correlation between variables A and B (r=0.85)',
      'Variable C shows seasonal patterns with 3-month cycles',
      'Data quality is high with only 1.25% missing values',
      'Outliers concentrated in Q4 periods, likely due to seasonal effects',
    ];

    analysis.recommendations = [
      'Consider log transformation for skewed variables',
      'Implement imputation strategy for missing values',
      'Investigate Q4 outliers for business context',
      'Add more recent data to improve model accuracy',
    ];

    analysis.confidence = 0.88;

    // Store final results
    await this.memory.store(`analysis:${task.id}:results`, analysis, {
      type: 'analysis-results',
      tags: ['analysis', 'completed', this.id, analysisType],
      partition: 'tasks',
    });

    return analysis;
  }

  private async analyzePerformance(task: TaskDefinition): Promise<any> {
    const system = task.context?.system;
    const metrics = task.context?.metrics || ['response_time', 'throughput', 'error_rate'];
    const timeframe = task.context?.timeframe || '24h';
    const baseline = task.context?.baseline;

    this.logger.info('Analyzing performance', {
      system,
      metrics,
      timeframe,
    });

    const performance: PerformanceAnalysis = {
      system,
      timeframe,
      metrics: {},
      benchmarks: {},
      bottlenecks: [] as AnalysisBottleneck[],
      trends: [] as AnalysisTrend[],
      recommendations: [] as string[],
      alertsTriggered: [] as any[],
      slaCompliance: {
        availability: 0,
        responseTime: 0,
        throughput: 0,
      },
      comparison: {
        baseline: baseline || 'previous_week',
        improvements: [] as string[],
        regressions: [] as string[],
      },
      timestamp: new Date(),
      anomalies: [] as AnalysisAnomaly[],
      insights: [] as string[],
      visualizations: [] as AnalysisVisualization[],
      optimizationPotential: 0,
      projectedImprovement: 0,
      confidence: 0,
    };

    // Simulate performance analysis
    await this.delay(2500);

    performance.metrics = {
      averageResponseTime: 245, // ms
      p95ResponseTime: 520,
      p99ResponseTime: 1200,
      throughput: 1250, // requests/min
      errorRate: 0.03, // 3%
      availability: 99.85, // %
    };

    performance.bottlenecks = [
      {
        component: 'Database queries',
        impact: 'high',
        description: 'N+1 query pattern causing 40% performance degradation',
        recommendation: 'Implement query optimization and caching',
      },
      {
        component: 'Memory allocation',
        impact: 'medium',
        description: 'Large object creation in hot path',
        recommendation: 'Use object pooling or lazy initialization',
      },
    ];

    performance.slaCompliance = {
      availability: 99.85,
      responseTime: 92.3,
      throughput: 103.5,
    };

    return performance;
  }

  private async performStatisticalAnalysis(task: TaskDefinition): Promise<StatisticalAnalysis> {
    const data = task.context?.data;
    const tests = task.context?.tests || ['normality', 'correlation', 'significance'];
    const alpha = task.context?.alpha || 0.05;
    const hypothesis = task.context?.hypothesis;

    this.logger.info('Performing statistical analysis', {
      tests,
      alpha,
      hypothesis,
    });

    const statistics: StatisticalAnalysis = {
      tests: {},
      hypothesis: hypothesis || 'no_hypothesis',
      alpha,
      results: {},
      interpretation: {},
      assumptions: {
        normality: false,
        independence: false,
        homogeneity: false,
      },
      powerAnalysis: {
        power: 0,
        sampleSize: 0,
        effectSize: 0,
      },
      conclusions: [] as string[],
      limitations: [] as string[],
      timestamp: new Date(),
    };

    // Simulate statistical analysis
    await this.delay(2000);

    statistics.results = {
      normalityTest: {
        statistic: 0.923,
        pValue: 0.041,
        significant: true,
        interpretation: 'Data deviates significantly from normal distribution',
      },
      correlationTest: {
        coefficient: 0.756,
        pValue: 0.002,
        significant: true,
        interpretation: 'Strong positive correlation detected',
      },
    };

    statistics.conclusions.push(
      'Null hypothesis rejected at α = 0.05 level',
      "Effect size is large (Cohen's d = 0.8)",
      'Results are statistically and practically significant',
    );

    return statistics;
  }

  private async createVisualization(task: TaskDefinition): Promise<VisualizationResult> {
    const data = task.context?.data;
    const chartType = task.context?.type || 'auto';
    const style = task.context?.style || 'professional';
    const interactive = task.context?.interactive || false;

    this.logger.info('Creating visualization', {
      chartType,
      style,
      interactive,
    });

    const visualization: VisualizationResult = {
      chartType,
      style,
      interactive,
      charts: [] as any[],
      dashboard: null,
      insights: [] as string[],
      recommendations: [] as string[],
      exportFormats: ['png', 'svg', 'pdf', 'html'],
      accessibility: {
        colorBlind: true,
        screenReader: true,
        highContrast: false,
      },
      timestamp: new Date(),
    };

    // Simulate visualization creation
    await this.delay(1500);

    visualization.charts.push(
      {
        type: 'line',
        title: 'Trend Analysis Over Time',
        description: 'Shows temporal patterns in the data',
        dataPoints: 100,
        interactive: true,
      },
      {
        type: 'scatter',
        title: 'Correlation Matrix',
        description: 'Displays relationships between variables',
        dataPoints: 500,
        interactive: false,
      },
    );

    visualization.insights.push(
      'Clear upward trend visible in Q3-Q4',
      'Seasonal patterns repeat every 3 months',
      'Strong correlation between variables X and Y',
    );

    return visualization;
  }

  private async buildPredictiveModel(task: TaskDefinition): Promise<PredictiveModelResult> {
    const data = task.context?.data;
    const target = task.context?.target;
    const algorithm = task.context?.algorithm || 'auto';
    const validation = task.context?.validation || 'k-fold';

    this.logger.info('Building predictive model', {
      target,
      algorithm,
      validation,
    });

    const model: PredictiveModelResult = {
      algorithm: algorithm === 'auto' ? 'random_forest' : algorithm,
      features: [],
      target: target || 'default_target',
      performance: {
        accuracy: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        rmse: 0,
        mse: 0,
      },
      validation: {
        method: validation,
        splits: 5,
        crossValidation: {
          folds: 5,
          avgScore: 0,
          stdDev: 0,
        },
      },
      predictions: [],
      featureImportance: {},
      insights: [],
      recommendations: [],
      modelMetadata: {
        parameters: {},
        training: {
          epochs: 100,
          convergence: true,
          finalLoss: 0.15,
        },
      },
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate model building
    await this.delay(4000);

    model.performance = {
      accuracy: 0.87,
      precision: 0.85,
      recall: 0.89,
      f1Score: 0.87,
      auc: 0.92,
      rmse: 2.34,
    };

    model.featureImportance = {
      feature_1: 0.35,
      feature_2: 0.28,
      feature_3: 0.22,
      feature_4: 0.15,
    };

    return model;
  }

  private async detectAnomalies(task: TaskDefinition): Promise<AnomalyDetectionResult> {
    const data = task.context?.data;
    const method = task.context?.method || 'isolation_forest';
    const sensitivity = task.context?.sensitivity || 0.1;
    const threshold = task.context?.threshold;

    this.logger.info('Detecting anomalies', {
      method,
      sensitivity,
    });

    const anomalies: AnomalyDetectionResult = {
      method,
      sensitivity,
      threshold: threshold || 'auto',
      detected: [] as any as any[],
      summary: {
        total: 0,
        severity: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
      },
      patterns: [] as any as string[],
      recommendations: [] as any as string[],
      falsePositiveRate: 0,
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate anomaly detection
    await this.delay(2000);

    (anomalies.detected as any).push(
      {
        id: 'anom_001',
        timestamp: new Date('2024-01-15'),
        severity: 'high',
        score: 0.95,
        description: 'Unusual spike in traffic during off-peak hours',
        features: ['traffic_volume', 'time_of_day'],
      },
      {
        id: 'anom_002',
        timestamp: new Date('2024-01-16'),
        severity: 'medium',
        score: 0.72,
        description: 'Abnormal response time pattern',
        features: ['response_time', 'request_size'],
      },
    );

    anomalies.summary = {
      total: 15,
      severity: {
        low: 8,
        medium: 4,
        high: 2,
        critical: 1,
      },
    };

    anomalies.confidence = 0.83;

    return anomalies;
  }

  private async analyzeTrends(task: TaskDefinition): Promise<TrendAnalysisResult> {
    const data = task.context?.data;
    const timeframe = task.context?.timeframe || '3-months';
    const granularity = task.context?.granularity || 'daily';
    const forecast = task.context?.forecast || false;

    this.logger.info('Analyzing trends', {
      timeframe,
      granularity,
      forecast,
    });

    const trends: TrendAnalysisResult = {
      timeframe,
      metrics: [] as any as string[],
      trends: [] as any as any[],
      correlations: {},
      patterns: {
        seasonal: false,
        cyclical: false,
        trending: false,
      },
      forecasts: forecast ? ([] as any) : [],
      insights: [] as any as string[],
      recommendations: [] as any as string[],
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate trend analysis
    await this.delay(2500);

    (trends.trends as any).push(
      {
        metric: 'user_engagement',
        direction: 'increasing',
        slope: 0.15,
        significance: 0.92,
        period: 'Q4-2023',
      },
      {
        metric: 'conversion_rate',
        direction: 'stable',
        slope: 0.02,
        significance: 0.23,
        period: 'Q4-2023',
      },
    );

    trends.patterns = {
      seasonal: true,
      cyclical: false,
      trending: true,
    };

    trends.confidence = 0.89;

    return trends;
  }

  private async generateBusinessIntelligence(
    task: TaskDefinition,
  ): Promise<BusinessIntelligenceResult> {
    const domain = task.context?.domain || 'general';
    const metrics = task.context?.metrics || ['revenue', 'growth', 'efficiency'];
    const timeframe = task.context?.timeframe || 'quarterly';
    const audience = task.context?.audience || 'executive';

    this.logger.info('Generating business intelligence', {
      domain,
      metrics,
      timeframe,
      audience,
    });

    const intelligence: BusinessIntelligenceResult = {
      scope: domain,
      timeframe,
      kpis: {},
      trends: [],
      insights: [],
      recommendations: [],
      actionItems: [],
      riskFactors: [],
      opportunities: [],
      marketAnalysis: {
        competitors: [],
        positioning: '',
        threats: [],
        opportunities: [],
      },
      financialProjections: {
        revenue: [],
        costs: [],
        profitability: [],
      },
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate business intelligence generation
    await this.delay(3500);

    intelligence.kpis = {
      revenue_growth: 12.5,
      customer_acquisition_cost: 45.3,
      lifetime_value: 1250.0,
      churn_rate: 5.2,
      market_share: 15.7,
    };

    intelligence.insights = [
      'Customer acquisition costs decreased by 18% due to improved targeting',
      'Premium tier adoption increased 35% following feature updates',
      'Seasonal patterns show consistent Q4 revenue spikes',
    ];

    intelligence.recommendations = [
      'Increase marketing budget allocation to high-performing channels',
      'Develop retention strategies for at-risk customer segments',
      'Accelerate premium feature development to capture market demand',
    ];

    intelligence.confidence = 0.91;

    return intelligence;
  }

  private async analyzeQuality(task: TaskDefinition): Promise<QualityAnalysis> {
    const subject = task.context?.subject;
    const criteria = task.context?.criteria || ['accuracy', 'completeness', 'consistency'];
    const standards = task.context?.standards || 'industry';
    const benchmark = task.context?.benchmark;

    this.logger.info('Analyzing quality', {
      subject,
      criteria,
      standards,
    });

    const quality: QualityAnalysis = {
      codeQuality: {
        complexity: 0,
        maintainability: 0,
        testCoverage: 0,
        technicalDebt: 0,
      },
      issues: [] as any as QualityIssue[],
      patterns: [] as any as string[],
      recommendations: [] as any as string[],
      visualizations: [] as any as AnalysisVisualization[],
      overallScore: 0,
      confidence: 0,
      timestamp: new Date(),
    };

    // Simulate quality analysis
    await this.delay(2000);

    quality.codeQuality = {
      complexity: 3.2,
      maintainability: 0.87,
      testCoverage: 0.91,
      technicalDebt: 0.23,
    };

    quality.overallScore = 0.91;

    (quality.issues as any).push({
      category: 'completeness',
      severity: 'medium',
      description: 'Missing values in 13% of records',
      impact: 'Affects downstream analysis accuracy',
    });

    (quality.patterns as any).push('High complexity in authentication module');
    (quality.recommendations as any).push('Implement automated testing coverage');
    quality.confidence = 0.89;

    return quality;
  }

  private async performGeneralAnalysis(task: TaskDefinition): Promise<any> {
    this.logger.info('Performing general analysis', {
      description: task.description,
    });

    // Default to data analysis
    return await this.analyzeData(task);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  override getAgentStatus(): any {
    return {
      ...super.getAgentStatus(),
      specialization: 'Data Analysis & Performance Optimization',
      analyticsCapabilities: [
        'Statistical Analysis',
        'Data Visualization',
        'Performance Analysis',
        'Predictive Modeling',
        'Anomaly Detection',
        'Business Intelligence',
      ],
      supportedFormats: ['CSV', 'JSON', 'Parquet', 'SQL', 'Excel'],
      statisticalMethods: ['Descriptive', 'Inferential', 'Multivariate', 'Time Series'],
      currentAnalyses: this.getCurrentTasks().length,
      averageAnalysisTime: '10-20 minutes',
      lastAnalysisCompleted: this.getLastTaskCompletedTime(),
      preferredTools: ['Python', 'R', 'SQL', 'Jupyter'],
    };
  }
}

export const createAnalystAgent = (
  id: string,
  config: Partial<AgentConfig>,
  environment: Partial<AgentEnvironment>,
  logger: ILogger,
  eventBus: IEventBus,
  memory: DistributedMemorySystem,
): AnalystAgent => {
  const tempAgent = new AnalystAgent(
    id,
    {} as AgentConfig,
    {} as AgentEnvironment,
    logger,
    eventBus,
    memory,
  );
  const defaultConfig = (tempAgent as any).getDefaultConfig();
  const defaultEnv = {
    runtime: 'deno' as const,
    version: '1.40.0',
    workingDirectory: './agents/analyst',
    tempDirectory: './tmp/analyst',
    logDirectory: './logs/analyst',
    apiEndpoints: {},
    credentials: {},
    availableTools: ['data-processor', 'statistical-analyzer', 'chart-generator', 'report-builder'],
    toolConfigs: {
      dataProcessor: { chunkSize: 10000, parallel: true },
      chartGenerator: { style: 'professional', dpi: 300 },
      reportBuilder: { format: 'pdf', includeCharts: true },
    },
  };

  return new AnalystAgent(
    id,
    { ...defaultConfig, ...config } as AgentConfig,
    { ...defaultEnv, ...environment } as AgentEnvironment,
    logger,
    eventBus,
    memory,
  );
};
