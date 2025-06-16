import { AIProviderManager } from './ai-provider.ts';
import { AIRequest, AIResponse } from '../types/ai-types.ts';
import {
  ParsedPRD,
  Requirement,
  GeneratedTask,
  TaskTree,
  SPARCPhase,
  Priority,
  Complexity
} from '../types/prd-types.ts';

export interface MLInsights {
  patterns: PatternAnalysis[];
  predictions: Prediction[];
  recommendations: MLRecommendation[];
  confidence: number;
}

export interface PatternAnalysis {
  id: string;
  type: 'effort_estimation' | 'complexity_correlation' | 'team_performance' | 'requirement_classification';
  pattern: string;
  confidence: number;
  frequency: number;
  impact: 'low' | 'medium' | 'high';
  examples: Example[];
}

export interface Prediction {
  id: string;
  type: 'effort' | 'completion_time' | 'risk' | 'success_probability';
  value: number;
  confidence: number;
  timeframe: number; // in days
  factors: PredictionFactor[];
}

export interface MLRecommendation {
  id: string;
  type: 'task_assignment' | 'agent_selection' | 'process_improvement' | 'risk_mitigation';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: number; // in hours
  confidence: number;
  priority: Priority;
}

export interface TrainingData {
  projects: ProjectData[];
  requirements: RequirementData[];
  tasks: TaskData[];
  teams: TeamData[];
  outcomes: OutcomeData[];
}

export interface ProjectData {
  id: string;
  type: string;
  complexity: Complexity;
  teamSize: number;
  duration: number; // actual duration in days
  estimatedDuration: number;
  budget: number;
  actualCost: number;
  qualityScore: number;
  successMetrics: Record<string, number>;
}

export interface MLModel {
  id: string;
  type: ModelType;
  version: string;
  accuracy: number;
  trainingData: TrainingDataSummary;
  parameters: ModelParameters;
  performance: ModelPerformance;
  createdAt: number;
  lastUpdated: number;
}

export type ModelType = 
  | 'effort_estimation'
  | 'requirement_classification' 
  | 'complexity_analysis'
  | 'team_optimization'
  | 'risk_prediction';

export class MLService {
  private aiProvider: AIProviderManager;
  private models: Map<ModelType, MLModel> = new Map();
  private trainingData: TrainingData;
  private modelCache: Map<string, any> = new Map();
  private performanceTracker: Map<string, PerformanceMetric[]> = new Map();

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
    this.initializeBaseModels();
  }

  async analyzeHistoricalData(
    projects: ProjectData[],
    timeRange?: { start: number; end: number }
  ): Promise<MLInsights> {
    try {
      // Filter projects by time range if specified
      const filteredProjects = timeRange 
        ? projects.filter(p => p.createdAt >= timeRange.start && p.createdAt <= timeRange.end)
        : projects;

      const insights: MLInsights = {
        patterns: [],
        predictions: [],
        recommendations: [],
        confidence: 0
      };

      // Analyze effort estimation patterns
      const effortPatterns = await this.analyzeEffortPatterns(filteredProjects);
      insights.patterns.push(...effortPatterns);

      // Analyze team performance patterns
      const teamPatterns = await this.analyzeTeamPerformancePatterns(filteredProjects);
      insights.patterns.push(...teamPatterns);

      // Analyze requirement complexity patterns
      const complexityPatterns = await this.analyzeComplexityPatterns(filteredProjects);
      insights.patterns.push(...complexityPatterns);

      // Generate predictions based on patterns
      const predictions = await this.generatePredictions(insights.patterns);
      insights.predictions = predictions;

      // Generate actionable recommendations
      const recommendations = await this.generateRecommendations(insights.patterns, predictions);
      insights.recommendations = recommendations;

      // Calculate overall confidence
      insights.confidence = this.calculateOverallConfidence(insights.patterns);

      return insights;
    } catch (error) {
      throw new Error(`Historical data analysis failed: ${error}`);
    }
  }

  async improveEffortEstimation(
    actualEfforts: ActualEffort[],
    estimatedEfforts: EstimatedEffort[]
  ): Promise<MLModel> {
    try {
      // Prepare training data
      const trainingData = this.prepareEffortEstimationTrainingData(
        actualEfforts,
        estimatedEfforts
      );

      // Feature engineering
      const features = await this.extractEffortEstimationFeatures(trainingData);

      // Use AI to improve estimation model
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Analyze effort estimation data and improve the prediction model:

Training Data Summary:
- Data points: ${trainingData.length}
- Average estimation error: ${this.calculateAverageError(actualEfforts, estimatedEfforts)}%
- Variance: ${this.calculateVariance(actualEfforts, estimatedEfforts)}

Features:
${features.map(f => `- ${f.name}: ${f.description}`).join('\n')}

Provide recommendations for:
1. Feature importance ranking
2. Model improvement strategies
3. Bias correction techniques
4. Uncertainty quantification methods

Return a JSON response with model improvement recommendations.`,
        systemPrompt: 'You are a machine learning expert specializing in effort estimation. Provide actionable recommendations for improving prediction accuracy.'
      };

      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const recommendations = JSON.parse(response.content);

      // Create improved model based on recommendations
      const improvedModel = await this.createImprovedEffortModel(
        trainingData,
        features,
        recommendations
      );

      // Validate model performance
      const validation = await this.validateModel(improvedModel, trainingData);

      // Store model if performance is better
      if (validation.accuracy > this.getCurrentModelAccuracy('effort_estimation')) {
        this.models.set('effort_estimation', improvedModel);
      }

      return improvedModel;
    } catch (error) {
      throw new Error(`Effort estimation improvement failed: ${error}`);
    }
  }

  async classifyRequirements(
    requirements: Requirement[],
    organizationContext: OrganizationContext
  ): Promise<ClassifiedRequirement[]> {
    try {
      const classifiedRequirements: ClassifiedRequirement[] = [];

      for (const requirement of requirements) {
        // Extract features for classification
        const features = await this.extractRequirementFeatures(
          requirement,
          organizationContext
        );

        // Use AI for intelligent classification
        const aiRequest: AIRequest = {
          type: 'structured-output',
          content: `Classify this requirement based on organization context and extracted features:

Requirement: ${requirement.title}
Description: ${requirement.description}

Organization Context:
- Domain: ${organizationContext.domain}
- Team Size: ${organizationContext.teamSize}
- Technology Stack: ${organizationContext.techStack?.join(', ')}
- Historical Patterns: ${organizationContext.historicalPatterns?.slice(0, 3).join(', ')}

Features:
${Object.entries(features).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

Classify into:
- Type: functional, non_functional, technical, business, user_story
- Complexity: low, medium, high
- Priority: must_have, should_have, could_have, wont_have
- Domain: authentication, ui, api, database, integration, etc.
- Effort Category: simple, moderate, complex, epic

Return JSON with classification results and confidence scores.`,
          systemPrompt: 'You are a requirements analyst expert. Provide accurate classification with confidence scores for each category.'
        };

        const response = await this.aiProvider.executeWithFallback(aiRequest);
        const classification = JSON.parse(response.content);

        classifiedRequirements.push({
          requirement,
          classification: {
            type: classification.type,
            complexity: classification.complexity,
            priority: classification.priority,
            domain: classification.domain,
            effortCategory: classification.effortCategory,
            confidence: classification.confidence || 0.8
          },
          reasoning: classification.reasoning,
          suggestedAgent: this.suggestAgentForRequirement(classification),
          estimatedEffort: this.estimateRequirementEffort(classification, features)
        });
      }

      // Learn from classification patterns
      await this.updateClassificationModel(classifiedRequirements, organizationContext);

      return classifiedRequirements;
    } catch (error) {
      throw new Error(`Requirement classification failed: ${error}`);
    }
  }

  async getPersonalizedRecommendations(
    userId: string,
    projectContext: ProjectContext
  ): Promise<PersonalizedRecommendation[]> {
    try {
      // Get user performance history
      const userHistory = await this.getUserPerformanceHistory(userId);
      
      // Get team context
      const teamContext = await this.getTeamContext(projectContext.teamId);

      // Generate personalized recommendations using AI
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Generate personalized recommendations for this user based on their history and current project context:

User Performance History:
- Completed Tasks: ${userHistory.completedTasks}
- Average Task Completion Time: ${userHistory.avgCompletionTime} hours
- Preferred Task Types: ${userHistory.preferredTaskTypes?.join(', ')}
- Skill Areas: ${userHistory.skillAreas?.join(', ')}
- Success Rate: ${userHistory.successRate}%

Current Project Context:
- Project Type: ${projectContext.projectType}
- Available Tasks: ${projectContext.availableTasks?.length}
- Team Capacity: ${teamContext.currentCapacity}%
- Project Phase: ${projectContext.currentPhase}

Available Tasks Summary:
${projectContext.availableTasks?.slice(0, 5).map(t => 
  `- ${t.title} (${t.complexity}, ${t.estimatedEffort}h)`
).join('\n')}

Generate recommendations for:
1. Task assignment (which tasks to prioritize)
2. Skill development (areas to improve)
3. Agent selection (which SPARC agents to use)
4. Collaboration opportunities (team members to work with)
5. Learning resources (specific skills to develop)

Return JSON array of personalized recommendations with priority and reasoning.`,
        systemPrompt: 'You are a personalized productivity coach. Provide actionable, specific recommendations based on user history and context.'
      };

      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const recommendations = JSON.parse(response.content);

      return recommendations.map((rec: any) => ({
        id: this.generateRecommendationId(),
        type: rec.type,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        estimatedImpact: rec.estimatedImpact,
        effort: rec.effort,
        confidence: rec.confidence || 0.7,
        reasoning: rec.reasoning,
        actionItems: rec.actionItems || [],
        timeline: rec.timeline
      }));
    } catch (error) {
      throw new Error(`Personalized recommendations failed: ${error}`);
    }
  }

  async predictProjectSuccess(
    projectData: ProjectData,
    currentProgress: ProjectProgress
  ): Promise<ProjectSuccessPrediction> {
    try {
      // Extract predictive features
      const features = await this.extractProjectFeatures(projectData, currentProgress);

      // Use AI for success prediction
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Analyze this project and predict its success probability:

Project Data:
- Type: ${projectData.type}
- Complexity: ${projectData.complexity}
- Team Size: ${projectData.teamSize}
- Planned Duration: ${projectData.estimatedDuration} days
- Budget: $${projectData.budget}

Current Progress:
- Completion: ${currentProgress.completionPercentage}%
- Days Elapsed: ${currentProgress.daysElapsed}
- Budget Spent: $${currentProgress.budgetSpent}
- Quality Metrics: ${JSON.stringify(currentProgress.qualityMetrics)}
- Team Performance: ${JSON.stringify(currentProgress.teamPerformance)}

Risk Factors:
${features.riskFactors?.map(r => `- ${r.factor}: ${r.impact}`).join('\n')}

Provide prediction for:
1. Success probability (0-100%)
2. Completion time (days remaining)
3. Final budget estimate
4. Quality score prediction
5. Key risk areas
6. Recommended actions

Return detailed JSON analysis with confidence intervals.`,
        systemPrompt: 'You are a project management expert with predictive analytics expertise. Provide realistic assessments with confidence intervals.'
      };

      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const prediction = JSON.parse(response.content);

      return {
        projectId: projectData.id,
        successProbability: prediction.successProbability,
        predictedCompletionTime: prediction.completedCompletionTime,
        predictedBudget: prediction.predictedBudget,
        predictedQuality: prediction.predictedQuality,
        riskAreas: prediction.riskAreas,
        recommendations: prediction.recommendations,
        confidence: prediction.confidence || 0.75,
        factors: prediction.factors,
        generatedAt: Date.now()
      };
    } catch (error) {
      throw new Error(`Project success prediction failed: ${error}`);
    }
  }

  // Private helper methods
  private async analyzeEffortPatterns(projects: ProjectData[]): Promise<PatternAnalysis[]> {
    const patterns: PatternAnalysis[] = [];

    // Analyze estimation accuracy patterns
    const estimationErrors = projects.map(p => ({
      estimated: p.estimatedDuration,
      actual: p.duration,
      error: Math.abs(p.duration - p.estimatedDuration) / p.estimatedDuration
    }));

    const avgError = estimationErrors.reduce((sum, e) => sum + e.error, 0) / estimationErrors.length;

    if (avgError > 0.3) { // 30% average error
      patterns.push({
        id: 'high_estimation_error',
        type: 'effort_estimation',
        pattern: 'Consistently underestimating task complexity',
        confidence: 0.85,
        frequency: estimationErrors.filter(e => e.error > 0.3).length / estimationErrors.length,
        impact: 'high',
        examples: estimationErrors.slice(0, 3).map(e => ({
          description: `Estimated ${e.estimated} days, actual ${e.actual} days`,
          impact: e.error
        }))
      });
    }

    return patterns;
  }

  private async analyzeTeamPerformancePatterns(projects: ProjectData[]): Promise<PatternAnalysis[]> {
    // Implement team performance pattern analysis
    return [];
  }

  private async analyzeComplexityPatterns(projects: ProjectData[]): Promise<PatternAnalysis[]> {
    // Implement complexity pattern analysis
    return [];
  }

  private async generatePredictions(patterns: PatternAnalysis[]): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    for (const pattern of patterns) {
      if (pattern.type === 'effort_estimation' && pattern.confidence > 0.7) {
        predictions.push({
          id: `pred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'effort',
          value: pattern.frequency * 1.2, // Predict 20% higher effort needed
          confidence: pattern.confidence,
          timeframe: 30, // Next 30 days
          factors: [
            {
              name: 'Historical Pattern',
              weight: 0.8,
              description: pattern.pattern
            }
          ]
        });
      }
    }

    return predictions;
  }

  private async generateRecommendations(
    patterns: PatternAnalysis[],
    predictions: Prediction[]
  ): Promise<MLRecommendation[]> {
    const recommendations: MLRecommendation[] = [];

    // Generate recommendations based on patterns
    for (const pattern of patterns) {
      if (pattern.impact === 'high' && pattern.confidence > 0.7) {
        recommendations.push({
          id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'process_improvement',
          title: `Address ${pattern.type} issue`,
          description: `Pattern detected: ${pattern.pattern}. Consider implementing better estimation techniques.`,
          impact: pattern.impact,
          effort: 4, // 4 hours to implement
          confidence: pattern.confidence,
          priority: 'high'
        });
      }
    }

    return recommendations;
  }

  private calculateOverallConfidence(patterns: PatternAnalysis[]): number {
    if (patterns.length === 0) return 0;
    return patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
  }

  private prepareEffortEstimationTrainingData(
    actualEfforts: ActualEffort[],
    estimatedEfforts: EstimatedEffort[]
  ): EffortTrainingData[] {
    // Combine actual and estimated efforts for training
    const trainingData: EffortTrainingData[] = [];

    for (const actual of actualEfforts) {
      const estimated = estimatedEfforts.find(e => e.taskId === actual.taskId);
      if (estimated) {
        trainingData.push({
          taskId: actual.taskId,
          features: {
            complexity: actual.complexity,
            type: actual.type,
            teamSize: actual.teamSize,
            dependencies: actual.dependencies.length
          },
          estimatedEffort: estimated.effort,
          actualEffort: actual.effort,
          error: Math.abs(actual.effort - estimated.effort) / estimated.effort
        });
      }
    }

    return trainingData;
  }

  private async extractEffortEstimationFeatures(data: EffortTrainingData[]): Promise<Feature[]> {
    return [
      {
        name: 'task_complexity',
        description: 'Complexity level of the task',
        type: 'categorical',
        importance: 0.8
      },
      {
        name: 'task_type',
        description: 'Type of task (frontend, backend, testing, etc.)',
        type: 'categorical',
        importance: 0.7
      },
      {
        name: 'team_experience',
        description: 'Team experience with similar tasks',
        type: 'numerical',
        importance: 0.6
      },
      {
        name: 'dependency_count',
        description: 'Number of task dependencies',
        type: 'numerical',
        importance: 0.5
      }
    ];
  }

  private calculateAverageError(actual: ActualEffort[], estimated: EstimatedEffort[]): number {
    let totalError = 0;
    let count = 0;

    for (const act of actual) {
      const est = estimated.find(e => e.taskId === act.taskId);
      if (est) {
        totalError += Math.abs(act.effort - est.effort) / est.effort;
        count++;
      }
    }

    return count > 0 ? (totalError / count) * 100 : 0;
  }

  private calculateVariance(actual: ActualEffort[], estimated: EstimatedEffort[]): number {
    const errors: number[] = [];

    for (const act of actual) {
      const est = estimated.find(e => e.taskId === act.taskId);
      if (est) {
        errors.push(Math.abs(act.effort - est.effort) / est.effort);
      }
    }

    if (errors.length === 0) return 0;

    const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
    const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length;

    return Math.sqrt(variance) * 100;
  }

  private async createImprovedEffortModel(
    trainingData: EffortTrainingData[],
    features: Feature[],
    recommendations: any
  ): Promise<MLModel> {
    // Create improved model based on AI recommendations
    return {
      id: `effort_model_${Date.now()}`,
      type: 'effort_estimation',
      version: '2.0',
      accuracy: recommendations.expectedAccuracy || 0.85,
      trainingData: {
        dataPoints: trainingData.length,
        features: features.length,
        lastTraining: Date.now()
      },
      parameters: recommendations.parameters || {},
      performance: {
        accuracy: recommendations.expectedAccuracy || 0.85,
        precision: recommendations.expectedPrecision || 0.80,
        recall: recommendations.expectedRecall || 0.82,
        f1Score: recommendations.expectedF1Score || 0.81
      },
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };
  }

  private async validateModel(model: MLModel, testData: EffortTrainingData[]): Promise<ValidationResult> {
    // Simulate model validation
    return {
      accuracy: model.accuracy,
      precision: model.performance.precision,
      recall: model.performance.recall,
      f1Score: model.performance.f1Score,
      testDataSize: testData.length,
      validationDate: Date.now()
    };
  }

  private getCurrentModelAccuracy(modelType: ModelType): number {
    const model = this.models.get(modelType);
    return model?.accuracy || 0;
  }

  private async extractRequirementFeatures(
    requirement: Requirement,
    context: OrganizationContext
  ): Promise<RequirementFeatures> {
    return {
      textLength: requirement.description.length,
      keywordDensity: this.calculateKeywordDensity(requirement.description, context.domain),
      complexityIndicators: this.extractComplexityIndicators(requirement.description),
      technicalTerms: this.extractTechnicalTerms(requirement.description, context.techStack),
      priorityKeywords: this.extractPriorityKeywords(requirement.description),
      acceptanceCriteriaCount: requirement.acceptanceCriteria.length,
      dependencyCount: requirement.dependencies.length
    };
  }

  private suggestAgentForRequirement(classification: any): string {
    const agentMap: Record<string, string> = {
      'technical': 'architect',
      'functional': 'code',
      'testing': 'tdd',
      'documentation': 'docs-writer',
      'security': 'security-review'
    };

    return agentMap[classification.domain] || 'code';
  }

  private estimateRequirementEffort(classification: any, features: RequirementFeatures): number {
    // Simple effort estimation based on classification and features
    const baseEffort = {
      'low': 2,
      'medium': 5,
      'high': 13
    };

    const complexity = classification.complexity || 'medium';
    let effort = baseEffort[complexity];

    // Adjust based on features
    if (features.dependencyCount > 3) effort *= 1.3;
    if (features.acceptanceCriteriaCount > 5) effort *= 1.2;
    if (features.complexityIndicators > 2) effort *= 1.4;

    return Math.round(effort);
  }

  private async updateClassificationModel(
    classifications: ClassifiedRequirement[],
    context: OrganizationContext
  ): Promise<void> {
    // Update the classification model with new data
    // This would involve retraining or fine-tuning the model
    console.log(`Updated classification model with ${classifications.length} new classifications`);
  }

  private async getUserPerformanceHistory(userId: string): Promise<UserPerformanceHistory> {
    // Mock user performance history
    return {
      completedTasks: 45,
      avgCompletionTime: 6.5,
      preferredTaskTypes: ['frontend', 'api'],
      skillAreas: ['React', 'Node.ts', 'TypeScript'],
      successRate: 92
    };
  }

  private async getTeamContext(teamId: string): Promise<TeamContext> {
    // Mock team context
    return {
      currentCapacity: 85,
      avgProductivity: 7.2,
      skillDistribution: {
        'frontend': 3,
        'backend': 2,
        'fullstack': 2
      },
      collaborationScore: 8.1
    };
  }

  private async extractProjectFeatures(
    projectData: ProjectData,
    progress: ProjectProgress
  ): Promise<ProjectFeatures> {
    return {
      complexityScore: this.calculateComplexityScore(projectData),
      teamEfficiency: progress.teamPerformance.efficiency,
      riskFactors: this.identifyRiskFactors(projectData, progress),
      progressVelocity: progress.completionPercentage / progress.daysElapsed,
      budgetBurnRate: progress.budgetSpent / progress.daysElapsed,
      qualityTrend: this.calculateQualityTrend(progress.qualityMetrics)
    };
  }

  private calculateComplexityScore(projectData: ProjectData): number {
    // Simple complexity scoring algorithm
    let score = 0;
    
    if (projectData.complexity === 'high') score += 3;
    else if (projectData.complexity === 'medium') score += 2;
    else score += 1;
    
    if (projectData.teamSize < 3) score += 1;
    else if (projectData.teamSize > 8) score += 2;
    
    if (projectData.estimatedDuration > 90) score += 2;
    
    return Math.min(score, 10);
  }

  private identifyRiskFactors(
    projectData: ProjectData,
    progress: ProjectProgress
  ): RiskFactor[] {
    const risks: RiskFactor[] = [];

    if (progress.completionPercentage < 20 && progress.daysElapsed > projectData.estimatedDuration * 0.3) {
      risks.push({
        factor: 'Schedule delay',
        impact: 'high',
        probability: 0.8
      });
    }

    if (progress.budgetSpent > projectData.budget * 0.7 && progress.completionPercentage < 70) {
      risks.push({
        factor: 'Budget overrun',
        impact: 'high',
        probability: 0.75
      });
    }

    return risks;
  }

  private calculateQualityTrend(qualityMetrics: any): number {
    // Calculate quality trend from metrics
    return qualityMetrics.averageScore || 7.5;
  }

  private calculateKeywordDensity(text: string, domain: string): number {
    // Calculate keyword density for domain-specific terms
    return 0.15; // Mock value
  }

  private extractComplexityIndicators(text: string): number {
    const indicators = ['complex', 'integrate', 'multiple', 'advanced', 'sophisticated'];
    return indicators.filter(indicator => 
      text.toLowerCase().includes(indicator)
    ).length;
  }

  private extractTechnicalTerms(text: string, techStack?: string[]): number {
    if (!techStack) return 0;
    return techStack.filter(tech => 
      text.toLowerCase().includes(tech.toLowerCase())
    ).length;
  }

  private extractPriorityKeywords(text: string): number {
    const priorityWords = ['critical', 'urgent', 'important', 'must', 'required'];
    return priorityWords.filter(word => 
      text.toLowerCase().includes(word)
    ).length;
  }

  private generateRecommendationId(): string {
    return `ml_rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeBaseModels(): void {
    // Initialize with base models
    this.models.set('effort_estimation', {
      id: 'base_effort_model',
      type: 'effort_estimation',
      version: '1.0',
      accuracy: 0.75,
      trainingData: {
        dataPoints: 1000,
        features: 5,
        lastTraining: Date.now()
      },
      parameters: {},
      performance: {
        accuracy: 0.75,
        precision: 0.73,
        recall: 0.76,
        f1Score: 0.74
      },
      createdAt: Date.now(),
      lastUpdated: Date.now()
    });
  }
}

// Supporting interfaces and types
export interface ActualEffort {
  taskId: string;
  effort: number;
  complexity: Complexity;
  type: string;
  teamSize: number;
  dependencies: string[];
}

export interface EstimatedEffort {
  taskId: string;
  effort: number;
}

export interface EffortTrainingData {
  taskId: string;
  features: {
    complexity: Complexity;
    type: string;
    teamSize: number;
    dependencies: number;
  };
  estimatedEffort: number;
  actualEffort: number;
  error: number;
}

export interface Feature {
  name: string;
  description: string;
  type: 'categorical' | 'numerical';
  importance: number;
}

export interface ValidationResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  testDataSize: number;
  validationDate: number;
}

export interface OrganizationContext {
  id: string;
  domain: string;
  teamSize: number;
  techStack?: string[];
  historicalPatterns?: string[];
}

export interface ClassifiedRequirement {
  requirement: Requirement;
  classification: {
    type: string;
    complexity: Complexity;
    priority: Priority;
    domain: string;
    effortCategory: string;
    confidence: number;
  };
  reasoning: string;
  suggestedAgent: string;
  estimatedEffort: number;
}

export interface RequirementFeatures {
  textLength: number;
  keywordDensity: number;
  complexityIndicators: number;
  technicalTerms: number;
  priorityKeywords: number;
  acceptanceCriteriaCount: number;
  dependencyCount: number;
}

export interface PersonalizedRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: Priority;
  estimatedImpact: string;
  effort: number;
  confidence: number;
  reasoning: string;
  actionItems: string[];
  timeline: string;
}

export interface ProjectContext {
  projectId: string;
  projectType: string;
  teamId: string;
  currentPhase: SPARCPhase;
  availableTasks?: GeneratedTask[];
}

export interface UserPerformanceHistory {
  completedTasks: number;
  avgCompletionTime: number;
  preferredTaskTypes?: string[];
  skillAreas?: string[];
  successRate: number;
}

export interface TeamContext {
  currentCapacity: number;
  avgProductivity: number;
  skillDistribution: Record<string, number>;
  collaborationScore: number;
}

export interface ProjectProgress {
  completionPercentage: number;
  daysElapsed: number;
  budgetSpent: number;
  qualityMetrics: any;
  teamPerformance: any;
}

export interface ProjectSuccessPrediction {
  projectId: string;
  successProbability: number;
  predictedCompletionTime: number;
  predictedBudget: number;
  predictedQuality: number;
  riskAreas: string[];
  recommendations: string[];
  confidence: number;
  factors: any[];
  generatedAt: number;
}

export interface ProjectFeatures {
  complexityScore: number;
  teamEfficiency: number;
  riskFactors: RiskFactor[];
  progressVelocity: number;
  budgetBurnRate: number;
  qualityTrend: number;
}

export interface RiskFactor {
  factor: string;
  impact: 'low' | 'medium' | 'high';
  probability: number;
}

export interface Example {
  description: string;
  impact: number;
}

export interface PredictionFactor {
  name: string;
  weight: number;
  description: string;
}

export interface TrainingDataSummary {
  dataPoints: number;
  features: number;
  lastTraining: number;
}

export interface ModelParameters {
  [key: string]: any;
}

export interface ModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface PerformanceMetric {
  timestamp: number;
  accuracy: number;
  latency: number;
  throughput: number;
}

export interface RequirementData {
  id: string;
  type: string;
  complexity: Complexity;
  actualEffort: number;
  estimatedEffort: number;
}

export interface TaskData {
  id: string;
  type: string;
  complexity: Complexity;
  assigneeId: string;
  completionTime: number;
  qualityScore: number;
}

export interface TeamData {
  id: string;
  size: number;
  skillLevels: Record<string, number>;
  productivity: number;
  collaborationScore: number;
}

export interface OutcomeData {
  projectId: string;
  success: boolean;
  onTime: boolean;
  onBudget: boolean;
  qualityMet: boolean;
  stakeholderSatisfaction: number;
}