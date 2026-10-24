#!/usr/bin/env node

/**
 * Truth Score Calculator for Claude-Flow
 * Calculates and tracks truth scores for agent claims vs reality
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class TruthScoreCalculator {
  constructor() {
    this.configPath = '.claude/config/verification.json';
    this.memoryPath = '.claude-flow/memory/truth-scores';
    this.config = null;
  }

  async init() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
    } catch (error) {
      // Default config if file doesn't exist
      this.config = {
        enabled: false,
        mode: 'passive',
        truth_threshold: 0.80,
        weights: {
          tests: 0.40,
          lint: 0.20,
          types: 0.20,
          build: 0.20
        }
      };
    }
  }

  /**
   * Calculate truth score based on evidence
   */
  calculateScore(evidence) {
    const weights = this.config.weights;
    let score = 0;

    // Test results
    if (evidence.test_results) {
      const testScore = evidence.test_results.passed / 
                       (evidence.test_results.total || 1);
      score += testScore * weights.tests;
    }

    // Lint results
    if (evidence.lint_results !== undefined) {
      const lintScore = evidence.lint_results.errors === 0 ? 1 : 0;
      score += lintScore * weights.lint;
    }

    // Type checking results
    if (evidence.type_results !== undefined) {
      const typeScore = evidence.type_results.errors === 0 ? 1 : 0;
      score += typeScore * weights.types;
    }

    // Build results
    if (evidence.build_results !== undefined) {
      const buildScore = evidence.build_results.success ? 1 : 0;
      score += buildScore * weights.build;
    }

    return Math.round(score * 100) / 100;
  }

  /**
   * Compare agent claim with actual results
   */
  compareClaimToReality(claim, reality) {
    const comparison = {
      claim: claim,
      reality: reality,
      discrepancies: [],
      truth_score: 0
    };

    // Check each claim against reality
    if (claim.tests_pass && !reality.tests_pass) {
      comparison.discrepancies.push('Claimed tests pass but they fail');
    }
    if (claim.no_lint_errors && reality.lint_errors > 0) {
      comparison.discrepancies.push(`Claimed no lint errors but found ${reality.lint_errors}`);
    }
    if (claim.no_type_errors && reality.type_errors > 0) {
      comparison.discrepancies.push(`Claimed no type errors but found ${reality.type_errors}`);
    }
    if (claim.builds_successfully && !reality.build_success) {
      comparison.discrepancies.push('Claimed successful build but build fails');
    }

    // Calculate truth score
    const totalClaims = Object.keys(claim).length;
    const accurateClaims = totalClaims - comparison.discrepancies.length;
    comparison.truth_score = accurateClaims / totalClaims;

    return comparison;
  }

  /**
   * Store truth score in memory
   */
  async storeTruthScore(agentId, taskId, score, evidence) {
    const timestamp = Date.now();
    const filename = `${agentId}_${taskId}_${timestamp}.json`;
    const filepath = path.join(this.memoryPath, filename);

    const data = {
      agent_id: agentId,
      task_id: taskId,
      truth_score: score,
      timestamp: timestamp,
      evidence: evidence,
      threshold: this.config.truth_threshold,
      passed: score >= this.config.truth_threshold
    };

    await fs.mkdir(this.memoryPath, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));

    return filepath;
  }

  /**
   * Get historical truth scores for an agent
   */
  async getAgentHistory(agentId, limit = 10) {
    try {
      const files = await fs.readdir(this.memoryPath);
      const agentFiles = files.filter(f => f.startsWith(agentId));
      
      const scores = [];
      for (const file of agentFiles.slice(-limit)) {
        const data = await fs.readFile(path.join(this.memoryPath, file), 'utf8');
        scores.push(JSON.parse(data));
      }

      return scores.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate agent reliability score
   */
  async calculateAgentReliability(agentId) {
    const history = await this.getAgentHistory(agentId, 100);
    
    if (history.length === 0) {
      return { reliability: 1.0, sample_size: 0 };
    }

    const avgScore = history.reduce((sum, h) => sum + h.truth_score, 0) / history.length;
    const passRate = history.filter(h => h.passed).length / history.length;

    return {
      reliability: Math.round(avgScore * 100) / 100,
      pass_rate: Math.round(passRate * 100) / 100,
      sample_size: history.length,
      trend: this.calculateTrend(history)
    };
  }

  /**
   * Calculate trend (improving/declining)
   */
  calculateTrend(history) {
    if (history.length < 2) return 'insufficient_data';
    
    const recent = history.slice(0, 5);
    const older = history.slice(5, 10);
    
    if (older.length === 0) return 'insufficient_data';
    
    const recentAvg = recent.reduce((sum, h) => sum + h.truth_score, 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + h.truth_score, 0) / older.length;
    
    if (recentAvg > olderAvg + 0.05) return 'improving';
    if (recentAvg < olderAvg - 0.05) return 'declining';
    return 'stable';
  }

  /**
   * Generate truth report
   */
  async generateReport(format = 'json') {
    const files = await fs.readdir(this.memoryPath).catch(() => []);
    const agents = new Map();

    // Aggregate by agent
    for (const file of files) {
      const data = await fs.readFile(path.join(this.memoryPath, file), 'utf8');
      const score = JSON.parse(data);
      
      if (!agents.has(score.agent_id)) {
        agents.set(score.agent_id, []);
      }
      agents.get(score.agent_id).push(score);
    }

    const report = {
      generated_at: new Date().toISOString(),
      total_verifications: files.length,
      agents: {}
    };

    // Calculate stats for each agent
    for (const [agentId, scores] of agents) {
      const avgScore = scores.reduce((sum, s) => sum + s.truth_score, 0) / scores.length;
      const passRate = scores.filter(s => s.passed).length / scores.length;
      
      report.agents[agentId] = {
        total_tasks: scores.length,
        average_truth_score: Math.round(avgScore * 100) / 100,
        pass_rate: Math.round(passRate * 100) / 100,
        trend: this.calculateTrend(scores)
      };
    }

    if (format === 'markdown') {
      return this.formatReportAsMarkdown(report);
    }
    
    return report;
  }

  /**
   * Format report as markdown
   */
  formatReportAsMarkdown(report) {
    let md = '# Truth Score Report\n\n';
    md += `Generated: ${report.generated_at}\n`;
    md += `Total Verifications: ${report.total_verifications}\n\n`;
    
    md += '## Agent Performance\n\n';
    md += '| Agent | Tasks | Avg Truth Score | Pass Rate | Trend |\n';
    md += '|-------|-------|-----------------|-----------|-------|\n';
    
    for (const [agentId, stats] of Object.entries(report.agents)) {
      const trend = stats.trend === 'improving' ? '📈' :
                   stats.trend === 'declining' ? '📉' : '➡️';
      md += `| ${agentId} | ${stats.total_tasks} | ${stats.average_truth_score} | ${stats.pass_rate * 100}% | ${trend} |\n`;
    }
    
    return md;
  }
}

// CLI interface
async function main() {
  const calculator = new TruthScoreCalculator();
  await calculator.init();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'calculate':
      // Calculate truth score from evidence
      const evidence = JSON.parse(args[1] || '{}');
      const score = calculator.calculateScore(evidence);
      console.log(score);
      break;

    case 'store':
      // Store a truth score
      const agentId = args[1];
      const taskId = args[2];
      const scoreValue = parseFloat(args[3]);
      const evidenceData = JSON.parse(args[4] || '{}');
      const filepath = await calculator.storeTruthScore(agentId, taskId, scoreValue, evidenceData);
      console.log(`Stored: ${filepath}`);
      break;

    case 'history':
      // Get agent history
      const historyAgentId = args[1];
      const history = await calculator.getAgentHistory(historyAgentId);
      console.log(JSON.stringify(history, null, 2));
      break;

    case 'reliability':
      // Calculate agent reliability
      const reliabilityAgentId = args[1];
      const reliability = await calculator.calculateAgentReliability(reliabilityAgentId);
      console.log(JSON.stringify(reliability, null, 2));
      break;

    case 'report':
      // Generate report
      const format = args[1] || 'json';
      const report = await calculator.generateReport(format);
      if (typeof report === 'string') {
        console.log(report);
      } else {
        console.log(JSON.stringify(report, null, 2));
      }
      break;

    default:
      console.log('Usage: truth-score.js [command] [args...]');
      console.log('Commands:');
      console.log('  calculate <evidence>    - Calculate truth score');
      console.log('  store <agent> <task> <score> <evidence> - Store truth score');
      console.log('  history <agent>        - Get agent history');
      console.log('  reliability <agent>    - Calculate agent reliability');
      console.log('  report [format]        - Generate report (json|markdown)');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = TruthScoreCalculator;