/**
 * Verification-Training Integration Module
 * Connects verification results to the neural training system for continuous improvement
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Integration between Verification and Training Systems
 * Feeds verification results into training to improve agent performance
 */
export class VerificationTrainingIntegration {
  constructor() {
    this.trainingDataPath = '.claude-flow/training/verification-data.jsonl';
    this.modelPath = '.claude-flow/models/verification-model.json';
    this.metricsPath = '.claude-flow/metrics/agent-performance.json';
    this.learningRate = 0.1;
    this.initialized = false;
  }

  /**
   * Initialize the integration
   */
  async initialize() {
    // Ensure directories exist
    const dirs = [
      '.claude-flow/training',
      '.claude-flow/models',
      '.claude-flow/metrics'
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Load or create model
    await this.loadModel();
    this.initialized = true;
    
    console.log('✅ Verification-Training integration initialized');
  }

  /**
   * Feed verification results to training system
   */
  async feedVerificationToTraining(verification) {
    if (!this.initialized) await this.initialize();

    // Extract training features from verification
    const trainingData = {
      input: {
        taskId: verification.taskId,
        agentType: verification.agentType,
        timestamp: verification.timestamp,
        mode: verification.mode || 'moderate',
        checksPerformed: verification.results?.map(r => r.name) || []
      },
      output: {
        score: verification.score,
        passed: verification.passed,
        threshold: verification.threshold
      },
      metadata: {
        sessionId: process.env.SESSION_ID || 'default',
        timestamp: new Date().toISOString()
      }
    };

    // Append to training data
    await this.appendTrainingData(trainingData);

    // Update agent-specific model
    await this.updateAgentModel(verification.agentType, verification);

    // Trigger incremental learning
    await this.incrementalLearn(trainingData);

    // Update performance metrics
    await this.updatePerformanceMetrics(verification);

    return trainingData;
  }

  /**
   * Incremental learning from new verification data
   */
  async incrementalLearn(trainingData) {
    const model = await this.loadModel();
    
    // Update agent reliability scores
    const agentType = trainingData.input.agentType;
    if (!model.agentReliability) model.agentReliability = {};
    
    const currentReliability = model.agentReliability[agentType] || 0.5;
    const newScore = trainingData.output.score;
    
    // Exponential moving average for reliability
    model.agentReliability[agentType] = 
      currentReliability * (1 - this.learningRate) + newScore * this.learningRate;

    // Update verification patterns
    if (!model.patterns) model.patterns = {};
    const patternKey = `${agentType}_${trainingData.output.passed ? 'success' : 'failure'}`;
    
    if (!model.patterns[patternKey]) {
      model.patterns[patternKey] = {
        count: 0,
        avgScore: 0,
        checks: {}
      };
    }

    const pattern = model.patterns[patternKey];
    pattern.count++;
    pattern.avgScore = (pattern.avgScore * (pattern.count - 1) + newScore) / pattern.count;

    // Track which checks lead to success/failure
    for (const check of trainingData.input.checksPerformed) {
      if (!pattern.checks[check]) {
        pattern.checks[check] = { success: 0, failure: 0 };
      }
      pattern.checks[check][trainingData.output.passed ? 'success' : 'failure']++;
    }

    // Save updated model
    await this.saveModel(model);

    // Log learning progress
    console.log(`📊 Learning update for ${agentType}: reliability ${model.agentReliability[agentType].toFixed(3)}`);
  }

  /**
   * Predict verification outcome based on historical data
   */
  async predictVerificationOutcome(taskType, agentType) {
    const model = await this.loadModel();
    
    // Get agent reliability
    const reliability = model.agentReliability?.[agentType] || 0.5;
    
    // Get pattern statistics
    const successPattern = model.patterns?.[`${agentType}_success`];
    const failurePattern = model.patterns?.[`${agentType}_failure`];
    
    if (!successPattern && !failurePattern) {
      return {
        predictedScore: reliability,
        confidence: 0.1,
        recommendation: 'insufficient_data'
      };
    }

    // Calculate prediction
    const totalCount = (successPattern?.count || 0) + (failurePattern?.count || 0);
    const successRate = (successPattern?.count || 0) / totalCount;
    
    const predictedScore = reliability * 0.7 + successRate * 0.3;
    const confidence = Math.min(totalCount / 100, 1.0); // Confidence increases with data

    // Generate recommendation
    let recommendation = 'proceed';
    if (predictedScore < 0.5) {
      recommendation = 'use_different_agent';
    } else if (predictedScore < 0.75) {
      recommendation = 'add_additional_checks';
    } else if (confidence < 0.3) {
      recommendation = 'low_confidence_proceed_with_caution';
    }

    return {
      predictedScore,
      confidence,
      recommendation,
      agentReliability: reliability,
      historicalSuccessRate: successRate,
      dataPoints: totalCount
    };
  }

  /**
   * Get agent recommendations based on task type
   */
  async recommendAgent(taskType) {
    const model = await this.loadModel();
    
    if (!model.agentReliability) {
      return {
        recommended: 'coder', // Default
        reason: 'no_historical_data'
      };
    }

    // Sort agents by reliability
    const agents = Object.entries(model.agentReliability)
      .sort(([, a], [, b]) => b - a);

    if (agents.length === 0) {
      return {
        recommended: 'coder',
        reason: 'no_agent_data'
      };
    }

    const [bestAgent, bestScore] = agents[0];
    
    return {
      recommended: bestAgent,
      reliability: bestScore,
      alternatives: agents.slice(1, 3).map(([agent, score]) => ({
        agent,
        reliability: score
      })),
      reason: `highest_reliability_score`
    };
  }

  /**
   * Update agent-specific model
   */
  async updateAgentModel(agentType, verification) {
    const modelFile = `.claude-flow/models/agent-${agentType}.json`;
    
    let agentModel = {};
    try {
      const data = await fs.readFile(modelFile, 'utf8');
      agentModel = JSON.parse(data);
    } catch {
      agentModel = {
        agentType,
        totalTasks: 0,
        successfulTasks: 0,
        averageScore: 0,
        scoreHistory: [],
        checkPerformance: {}
      };
    }

    // Update statistics
    agentModel.totalTasks++;
    if (verification.passed) agentModel.successfulTasks++;
    
    // Update average score
    agentModel.averageScore = 
      (agentModel.averageScore * (agentModel.totalTasks - 1) + verification.score) / 
      agentModel.totalTasks;

    // Keep last 100 scores for trend analysis
    agentModel.scoreHistory.push({
      score: verification.score,
      timestamp: verification.timestamp,
      passed: verification.passed
    });
    if (agentModel.scoreHistory.length > 100) {
      agentModel.scoreHistory = agentModel.scoreHistory.slice(-100);
    }

    // Track performance by check type
    if (verification.results) {
      for (const result of verification.results) {
        if (!agentModel.checkPerformance[result.name]) {
          agentModel.checkPerformance[result.name] = {
            total: 0,
            passed: 0,
            avgScore: 0
          };
        }
        
        const checkPerf = agentModel.checkPerformance[result.name];
        checkPerf.total++;
        if (result.passed) checkPerf.passed++;
        checkPerf.avgScore = 
          (checkPerf.avgScore * (checkPerf.total - 1) + result.score) / checkPerf.total;
      }
    }

    // Calculate performance trend (last 10 vs previous 10)
    if (agentModel.scoreHistory.length >= 20) {
      const recent10 = agentModel.scoreHistory.slice(-10);
      const previous10 = agentModel.scoreHistory.slice(-20, -10);
      
      const recentAvg = recent10.reduce((sum, h) => sum + h.score, 0) / 10;
      const previousAvg = previous10.reduce((sum, h) => sum + h.score, 0) / 10;
      
      agentModel.trend = {
        direction: recentAvg > previousAvg ? 'improving' : 'declining',
        change: recentAvg - previousAvg,
        recentAverage: recentAvg,
        previousAverage: previousAvg
      };
    }

    // Save agent model
    await fs.writeFile(modelFile, JSON.stringify(agentModel, null, 2));

    // Log if agent is improving or declining
    if (agentModel.trend) {
      const emoji = agentModel.trend.direction === 'improving' ? '📈' : '📉';
      console.log(`${emoji} Agent ${agentType} is ${agentModel.trend.direction} (${agentModel.trend.change > 0 ? '+' : ''}${agentModel.trend.change.toFixed(3)})`);
    }

    return agentModel;
  }

  /**
   * Generate training recommendations
   */
  async generateTrainingRecommendations() {
    const model = await this.loadModel();
    const recommendations = [];

    // Check agent reliability
    if (model.agentReliability) {
      for (const [agent, reliability] of Object.entries(model.agentReliability)) {
        if (reliability < 0.7) {
          recommendations.push({
            type: 'retrain_agent',
            agent,
            currentReliability: reliability,
            action: `Retrain ${agent} agent - reliability below 70%`
          });
        }
      }
    }

    // Check patterns
    if (model.patterns) {
      for (const [pattern, data] of Object.entries(model.patterns)) {
        if (pattern.includes('failure') && data.count > 10) {
          const [agentType] = pattern.split('_');
          
          // Find most common failing checks
          const failingChecks = Object.entries(data.checks || {})
            .filter(([, stats]) => stats.failure > stats.success)
            .map(([check]) => check);

          if (failingChecks.length > 0) {
            recommendations.push({
              type: 'improve_checks',
              agent: agentType,
              checks: failingChecks,
              action: `Focus training on ${failingChecks.join(', ')} for ${agentType}`
            });
          }
        }
      }
    }

    // Check if we need more data
    const totalDataPoints = Object.values(model.patterns || {})
      .reduce((sum, p) => sum + p.count, 0);
    
    if (totalDataPoints < 50) {
      recommendations.push({
        type: 'collect_more_data',
        currentDataPoints: totalDataPoints,
        action: 'Run more verification cycles to improve training accuracy'
      });
    }

    return recommendations;
  }

  /**
   * Update performance metrics
   */
  async updatePerformanceMetrics(verification) {
    let metrics = {};
    
    try {
      const data = await fs.readFile(this.metricsPath, 'utf8');
      metrics = JSON.parse(data);
    } catch {
      metrics = {
        totalVerifications: 0,
        passedVerifications: 0,
        averageScore: 0,
        byAgent: {},
        byHour: {},
        created: new Date().toISOString()
      };
    }

    // Update totals
    metrics.totalVerifications++;
    if (verification.passed) metrics.passedVerifications++;
    metrics.averageScore = 
      (metrics.averageScore * (metrics.totalVerifications - 1) + verification.score) / 
      metrics.totalVerifications;

    // Update by agent
    if (!metrics.byAgent[verification.agentType]) {
      metrics.byAgent[verification.agentType] = {
        total: 0,
        passed: 0,
        avgScore: 0
      };
    }
    
    const agentMetrics = metrics.byAgent[verification.agentType];
    agentMetrics.total++;
    if (verification.passed) agentMetrics.passed++;
    agentMetrics.avgScore = 
      (agentMetrics.avgScore * (agentMetrics.total - 1) + verification.score) / 
      agentMetrics.total;

    // Update by hour (for pattern detection)
    const hour = new Date().getHours();
    if (!metrics.byHour[hour]) {
      metrics.byHour[hour] = {
        total: 0,
        avgScore: 0
      };
    }
    
    metrics.byHour[hour].total++;
    metrics.byHour[hour].avgScore = 
      (metrics.byHour[hour].avgScore * (metrics.byHour[hour].total - 1) + verification.score) / 
      metrics.byHour[hour].total;

    metrics.lastUpdated = new Date().toISOString();

    await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2));
    return metrics;
  }

  /**
   * Train neural network for pattern recognition
   */
  async trainNeuralPatterns() {
    console.log('🧠 Training neural patterns from verification data...');
    
    try {
      // Call the training command
      const result = execSync(
        'npx claude-flow training neural-train --data .claude-flow/training/verification-data.jsonl --model verification-predictor --epochs 100',
        { encoding: 'utf8', stdio: 'pipe' }
      );
      
      console.log('✅ Neural training completed');
      return { success: true, output: result };
    } catch (error) {
      console.error('❌ Neural training failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Helper methods

  async appendTrainingData(data) {
    const line = JSON.stringify(data) + '\n';
    await fs.appendFile(this.trainingDataPath, line);
  }

  async loadModel() {
    try {
      const data = await fs.readFile(this.modelPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {
        version: '1.0.0',
        created: new Date().toISOString(),
        agentReliability: {},
        patterns: {},
        checkWeights: {}
      };
    }
  }

  async saveModel(model) {
    model.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.modelPath, JSON.stringify(model, null, 2));
  }

  /**
   * Get training status and statistics
   */
  async getTrainingStatus() {
    const model = await this.loadModel();
    const metrics = await this.loadMetrics();
    
    // Count training data
    let trainingDataCount = 0;
    try {
      const data = await fs.readFile(this.trainingDataPath, 'utf8');
      trainingDataCount = data.split('\n').filter(line => line.trim()).length;
    } catch {
      // File doesn't exist
    }

    return {
      modelVersion: model.version,
      lastUpdated: model.lastUpdated,
      trainingDataPoints: trainingDataCount,
      agentReliability: model.agentReliability,
      totalVerifications: metrics.totalVerifications || 0,
      averageScore: metrics.averageScore || 0,
      passRate: metrics.totalVerifications > 0 
        ? metrics.passedVerifications / metrics.totalVerifications 
        : 0,
      agentPerformance: metrics.byAgent || {},
      recommendations: await this.generateTrainingRecommendations()
    };
  }

  async loadMetrics() {
    try {
      const data = await fs.readFile(this.metricsPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

/**
 * CLI integration for verification-training
 */
export async function verificationTrainingCommand(args, flags) {
  const integration = new VerificationTrainingIntegration();
  await integration.initialize();

  const subcommand = args[0] || 'status';

  switch (subcommand) {
    case 'feed':
      // Feed current verification data to training
      const verificationFile = '.swarm/verification-memory.json';
      try {
        const data = await fs.readFile(verificationFile, 'utf8');
        const memory = JSON.parse(data);
        
        if (memory.history && memory.history.length > 0) {
          console.log(`📊 Feeding ${memory.history.length} verification records to training...`);
          
          for (const verification of memory.history) {
            await integration.feedVerificationToTraining(verification);
          }
          
          console.log('✅ Training data updated');
        } else {
          console.log('No verification history to feed');
        }
      } catch (error) {
        console.error('Error reading verification data:', error.message);
      }
      break;

    case 'predict':
      // Predict verification outcome
      const taskType = args[1] || 'default';
      const agentType = args[2] || 'coder';
      
      const prediction = await integration.predictVerificationOutcome(taskType, agentType);
      console.log('\n🔮 Verification Prediction:');
      console.log(`   Predicted Score: ${prediction.predictedScore.toFixed(3)}`);
      console.log(`   Confidence: ${(prediction.confidence * 100).toFixed(1)}%`);
      console.log(`   Recommendation: ${prediction.recommendation}`);
      console.log(`   Historical Success Rate: ${(prediction.historicalSuccessRate * 100).toFixed(1)}%`);
      console.log(`   Data Points: ${prediction.dataPoints}`);
      break;

    case 'recommend':
      // Get agent recommendation
      const task = args[1] || 'default';
      const recommendation = await integration.recommendAgent(task);
      
      console.log('\n🤖 Agent Recommendation:');
      console.log(`   Recommended: ${recommendation.recommended}`);
      console.log(`   Reliability: ${(recommendation.reliability * 100).toFixed(1)}%`);
      console.log(`   Reason: ${recommendation.reason}`);
      
      if (recommendation.alternatives && recommendation.alternatives.length > 0) {
        console.log('   Alternatives:');
        for (const alt of recommendation.alternatives) {
          console.log(`     • ${alt.agent}: ${(alt.reliability * 100).toFixed(1)}%`);
        }
      }
      break;

    case 'train':
      // Trigger neural training
      await integration.trainNeuralPatterns();
      break;

    case 'recommendations':
      // Get training recommendations
      const recs = await integration.generateTrainingRecommendations();
      
      console.log('\n💡 Training Recommendations:');
      if (recs.length === 0) {
        console.log('   No recommendations at this time');
      } else {
        for (const rec of recs) {
          console.log(`   • ${rec.action}`);
        }
      }
      break;

    case 'status':
    default:
      // Show training status
      const status = await integration.getTrainingStatus();
      
      console.log('\n📊 Verification-Training Status');
      console.log('━'.repeat(50));
      console.log(`Model Version: ${status.modelVersion}`);
      console.log(`Last Updated: ${status.lastUpdated || 'Never'}`);
      console.log(`Training Data Points: ${status.trainingDataPoints}`);
      console.log(`Total Verifications: ${status.totalVerifications}`);
      console.log(`Average Score: ${status.averageScore.toFixed(3)}`);
      console.log(`Pass Rate: ${(status.passRate * 100).toFixed(1)}%`);
      
      if (Object.keys(status.agentReliability).length > 0) {
        console.log('\n🤖 Agent Reliability:');
        for (const [agent, reliability] of Object.entries(status.agentReliability)) {
          console.log(`   ${agent}: ${(reliability * 100).toFixed(1)}%`);
        }
      }
      
      if (status.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        for (const rec of status.recommendations) {
          console.log(`   • ${rec.action}`);
        }
      }
      
      console.log('\n📚 Commands:');
      console.log('   feed        - Feed verification data to training');
      console.log('   predict     - Predict verification outcome');
      console.log('   recommend   - Get agent recommendation');
      console.log('   train       - Trigger neural training');
      console.log('   status      - Show training status');
      break;
  }
}

// Export for use in other modules
export default {
  VerificationTrainingIntegration,
  verificationTrainingCommand
};