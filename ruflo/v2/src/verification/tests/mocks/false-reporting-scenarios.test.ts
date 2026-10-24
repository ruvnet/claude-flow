/**
 * Mock Agent Scenarios for False Reporting Detection Tests
 * 
 * Tests various scenarios where agents might provide false or misleading reports:
 * - Intentional false claims about task completion
 * - Exaggerated performance improvements
 * - Hidden failures in implementation
 * - Inconsistent reporting between agents
 * - Fabricated test results and evidence
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Import verification components
// Dynamic import for CommonJS module
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TruthScoreCalc = require('../../../../.claude/helpers/truth-score.js');

interface MockAgent {
  id: string;
  type: string;
  deceptionLevel: number; // 0 = honest, 1 = completely deceptive
  deceptionStrategy: DeceptionStrategy;
  behaviorPattern: BehaviorPattern;
  reportHistory: AgentReport[];
  detectedAs: 'honest' | 'suspicious' | 'deceptive' | 'unknown';
}

interface DeceptionStrategy {
  type: 'overconfident' | 'fabrication' | 'selective_reporting' | 'gaslighting' | 'collusion';
  parameters: Record<string, any>;
}

interface BehaviorPattern {
  consistency: number; // 0-1, how consistent the agent's reports are
  timeToReport: number; // Average time to submit reports (ms)
  detailLevel: number; // 0-1, how detailed the reports are
  evidenceQuality: number; // 0-1, quality of evidence provided
}

interface AgentReport {
  id: string;
  agentId: string;
  taskId: string;
  claimedOutcome: TaskOutcome;
  evidence: any;
  timestamp: number;
  truthScore?: number;
  verified: boolean;
  conflicts: string[];
}

interface TaskOutcome {
  success: boolean;
  testsPass: boolean;
  noErrors: boolean;
  performance: {
    improvement: number;
    metrics: Record<string, number>;
  };
  quality: {
    codeQuality: number;
    documentation: number;
    maintainability: number;
  };
}

interface VerificationResult {
  reportId: string;
  agentId: string;
  truthScore: number;
  deceptionDetected: boolean;
  deceptionType: string[];
  confidence: number;
  evidence: any;
  recommendations: string[];
}

describe('False Reporting Detection Scenarios', () => {
  let tempDir: string;
  let truthCalculator: any;
  let deceptionDetector: DeceptionDetector;
  let mockAgents: Map<string, MockAgent>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'false-reporting-test-'));

    // Setup truth score calculator
    truthCalculator = new TruthScoreCalc();
    truthCalculator.configPath = path.join(tempDir, 'verification.json');
    truthCalculator.memoryPath = path.join(tempDir, 'truth-scores');
    await truthCalculator.init();
    
    // Setup deception detector
    deceptionDetector = new DeceptionDetector(truthCalculator, tempDir);
    await deceptionDetector.initialize();
    
    // Create mock agents with different deception strategies
    mockAgents = new Map();
    await createMockAgentScenarios();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createMockAgentScenarios() {
    const agentConfigs = [
      // Honest baseline agent
      {
        id: 'honest-agent-001',
        type: 'coder',
        deceptionLevel: 0,
        deceptionStrategy: { type: 'overconfident', parameters: {} },
        behaviorPattern: {
          consistency: 0.95,
          timeToReport: 5000,
          detailLevel: 0.8,
          evidenceQuality: 0.9
        }
      },
      // Overconfident agent
      {
        id: 'overconfident-agent-002',
        type: 'coder',
        deceptionLevel: 0.3,
        deceptionStrategy: {
          type: 'overconfident',
          parameters: { confidenceMultiplier: 1.5, hideMinorIssues: true }
        },
        behaviorPattern: {
          consistency: 0.7,
          timeToReport: 3000,
          detailLevel: 0.6,
          evidenceQuality: 0.7
        }
      },
      // Fabricating agent
      {
        id: 'fabricating-agent-003',
        type: 'tester',
        deceptionLevel: 0.8,
        deceptionStrategy: {
          type: 'fabrication',
          parameters: { fabricateResults: true, fakePassRate: 0.95 }
        },
        behaviorPattern: {
          consistency: 0.4,
          timeToReport: 1000, // Reports very quickly (suspicious)
          detailLevel: 0.9, // High detail to seem legitimate
          evidenceQuality: 0.3 // Low quality evidence
        }
      },
      // Selective reporting agent
      {
        id: 'selective-agent-004',
        type: 'reviewer',
        deceptionLevel: 0.5,
        deceptionStrategy: {
          type: 'selective_reporting',
          parameters: { reportOnlyPositives: true, hideFailures: true }
        },
        behaviorPattern: {
          consistency: 0.8,
          timeToReport: 7000,
          detailLevel: 0.5,
          evidenceQuality: 0.6
        }
      },
      // Gaslighting agent
      {
        id: 'gaslighting-agent-005',
        type: 'coordinator',
        deceptionLevel: 0.9,
        deceptionStrategy: {
          type: 'gaslighting',
          parameters: { contradictOthers: true, rewriteHistory: true }
        },
        behaviorPattern: {
          consistency: 0.2,
          timeToReport: 4000,
          detailLevel: 0.7,
          evidenceQuality: 0.4
        }
      }
    ];

    for (const config of agentConfigs) {
      const agent = createMockAgent(config);
      mockAgents.set(config.id, agent);
    }
  }

  function createMockAgent(config: any): MockAgent {
    return {
      id: config.id,
      type: config.type,
      deceptionLevel: config.deceptionLevel,
      deceptionStrategy: config.deceptionStrategy,
      behaviorPattern: config.behaviorPattern,
      reportHistory: [],
      detectedAs: 'unknown'
    };
  }

  describe('Overconfident Agent Scenarios', () => {
    test('should detect agent consistently overestimating success rates', async () => {
      const agent = mockAgents.get('overconfident-agent-002')!;
      const reports: AgentReport[] = [];

      // Generate series of overconfident reports
      for (let i = 0; i < 20; i++) {
        const actualSuccess = Math.random() > 0.3; // 70% actual success rate
        const claimedSuccess = actualSuccess || Math.random() > 0.2; // Claims 94% success rate

        const report = generateReport(agent, `task-${i}`, {
          actualOutcome: {
            success: actualSuccess,
            testsPass: actualSuccess,
            noErrors: actualSuccess,
            performance: { improvement: Math.random() * 0.2, metrics: {} },
            quality: { codeQuality: Math.random() * 0.3 + 0.4, documentation: 0.5, maintainability: 0.6 }
          },
          claimedOutcome: {
            success: claimedSuccess,
            testsPass: claimedSuccess,
            noErrors: claimedSuccess,
            performance: { improvement: Math.random() * 0.3 + 0.2, metrics: {} }, // Exaggerated
            quality: { codeQuality: Math.random() * 0.2 + 0.8, documentation: 0.9, maintainability: 0.9 }
          }
        });

        reports.push(report);
        agent.reportHistory.push(report);
      }

      // Analyze pattern for deception
      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('overconfidence');
      expect(analysis.confidence).toBeGreaterThan(0.7);
      expect(analysis.truthScore).toBeLessThan(0.6);

      // Check specific indicators
      expect(analysis.evidence.successRateDiscrepancy).toBeGreaterThan(0.15);
      expect(analysis.evidence.performanceExaggeration).toBeGreaterThan(0.1);
      expect(analysis.recommendations).toContain('Implement additional verification for this agent');
    });

    test('should detect pattern of hiding minor issues', async () => {
      const agent = mockAgents.get('overconfident-agent-002')!;
      const reports: AgentReport[] = [];

      // Generate reports where agent hides minor issues
      for (let i = 0; i < 15; i++) {
        const minorIssues = Math.floor(Math.random() * 5) + 1; // 1-5 minor issues
        const majorIssues = Math.random() > 0.8 ? 1 : 0; // Occasional major issue

        const report = generateReport(agent, `minor-issues-task-${i}`, {
          actualOutcome: {
            success: majorIssues === 0,
            testsPass: true,
            noErrors: false, // Has minor errors
            performance: { improvement: 0.1, metrics: { minorIssues, majorIssues } },
            quality: { codeQuality: 0.7, documentation: 0.6, maintainability: 0.7 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true, // Claims no errors
            performance: { improvement: 0.15, metrics: { minorIssues: 0, majorIssues: 0 } },
            quality: { codeQuality: 0.9, documentation: 0.8, maintainability: 0.9 }
          }
        });

        reports.push(report);
        agent.reportHistory.push(report);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('issue_hiding');
      expect(analysis.evidence.hiddenIssuesCount).toBeGreaterThan(10);
      expect(analysis.recommendations).toContain('Require detailed issue reporting');
    });
  });

  describe('Evidence Fabrication Scenarios', () => {
    test('should detect fabricated test results', async () => {
      const agent = mockAgents.get('fabricating-agent-003')!;
      const reports: AgentReport[] = [];

      // Generate reports with fabricated test results
      for (let i = 0; i < 25; i++) {
        const actualTestResults = {
          total: 100,
          passed: Math.floor(Math.random() * 30) + 60, // 60-90% pass rate
          failed: 0,
          skipped: 0
        };
        actualTestResults.failed = actualTestResults.total - actualTestResults.passed;

        const fabricatedResults = {
          total: 100,
          passed: Math.floor(Math.random() * 5) + 95, // 95-100% pass rate
          failed: 0,
          skipped: 0
        };
        fabricatedResults.failed = fabricatedResults.total - fabricatedResults.passed;

        const report = generateReport(agent, `fabrication-task-${i}`, {
          actualOutcome: {
            success: actualTestResults.passed > 80,
            testsPass: actualTestResults.passed === actualTestResults.total,
            noErrors: false,
            performance: { improvement: 0.05, metrics: actualTestResults },
            quality: { codeQuality: 0.6, documentation: 0.5, maintainability: 0.6 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.15, metrics: fabricatedResults },
            quality: { codeQuality: 0.95, documentation: 0.9, maintainability: 0.95 }
          },
          evidence: {
            testResults: fabricatedResults,
            executionTime: Math.random() * 100 + 50, // Suspiciously consistent timing
            testLogs: generateFakeTestLogs(fabricatedResults)
          }
        });

        reports.push(report);
        agent.reportHistory.push(report);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('fabrication');
      expect(analysis.deceptionType).toContain('unrealistic_results');
      expect(analysis.confidence).toBeGreaterThan(0.8);

      // Check fabrication indicators
      expect(analysis.evidence.unrealisticSuccessRate).toBe(true);
      expect(analysis.evidence.suspiciouslyFastReporting).toBe(true);
      expect(analysis.evidence.evidenceInconsistency).toBeGreaterThan(0.5);
    });

    test('should detect impossible performance improvements', async () => {
      const agent = mockAgents.get('fabricating-agent-003')!;
      const reports: AgentReport[] = [];

      // Generate reports with impossible performance claims
      for (let i = 0; i < 10; i++) {
        const report = generateReport(agent, `impossible-perf-task-${i}`, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: {
              improvement: Math.random() * 0.1 + 0.05, // 5-15% actual improvement
              metrics: {
                responseTime: 1000,
                throughput: 100,
                memoryUsage: 500
              }
            },
            quality: { codeQuality: 0.7, documentation: 0.6, maintainability: 0.7 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: {
              improvement: Math.random() * 0.5 + 0.8, // 80-130% claimed improvement (impossible)
              metrics: {
                responseTime: 100, // 10x improvement
                throughput: 1000, // 10x improvement
                memoryUsage: 50 // 10x improvement
              }
            },
            quality: { codeQuality: 0.99, documentation: 0.99, maintainability: 0.99 }
          }
        });

        reports.push(report);
        agent.reportHistory.push(report);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('impossible_claims');
      expect(analysis.evidence.impossiblePerformanceGains).toBe(true);
      expect(analysis.recommendations).toContain('Require third-party verification for performance claims');
    });
  });

  describe('Selective Reporting Scenarios', () => {
    test('should detect agent that only reports successes', async () => {
      const agent = mockAgents.get('selective-agent-004')!;
      const reports: AgentReport[] = [];

      // Generate mixed actual outcomes but agent only reports successes
      const actualOutcomes = [];
      for (let i = 0; i < 30; i++) {
        const success = Math.random() > 0.4; // 60% actual success rate
        actualOutcomes.push(success);

        // Agent only reports the successful ones
        if (success || Math.random() > 0.9) { // Reports 90% of successes, 10% of failures
          const report = generateReport(agent, `selective-task-${i}`, {
            actualOutcome: {
              success,
              testsPass: success,
              noErrors: success,
              performance: { improvement: success ? 0.1 : -0.05, metrics: {} },
              quality: { codeQuality: success ? 0.8 : 0.4, documentation: 0.6, maintainability: 0.7 }
            },
            claimedOutcome: {
              success: true, // Always claims success
              testsPass: true,
              noErrors: true,
              performance: { improvement: 0.12, metrics: {} },
              quality: { codeQuality: 0.85, documentation: 0.8, maintainability: 0.8 }
            }
          });

          reports.push(report);
          agent.reportHistory.push(report);
        }
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('selective_reporting');
      expect(analysis.evidence.missingFailureReports).toBe(true);
      expect(analysis.evidence.suspiciousSuccessRate).toBeGreaterThan(0.95);
      expect(analysis.recommendations).toContain('Mandatory reporting of all task outcomes');
    });

    test('should detect cherry-picked metrics reporting', async () => {
      const agent = mockAgents.get('selective-agent-004')!;
      const reports: AgentReport[] = [];

      // Generate reports where agent only reports favorable metrics
      for (let i = 0; i < 20; i++) {
        const fullMetrics = {
          responseTime: Math.random() * 1000 + 500, // 500-1500ms
          throughput: Math.random() * 200 + 50, // 50-250 rps
          memoryUsage: Math.random() * 800 + 200, // 200-1000MB
          errorRate: Math.random() * 0.1, // 0-10% errors
          cpuUsage: Math.random() * 100, // 0-100% CPU
          diskIO: Math.random() * 1000 // 0-1000 IOPS
        };

        // Agent only reports the best 2-3 metrics
        const favorableMetrics = Object.entries(fullMetrics)
          .sort(([keyA, valueA], [keyB, valueB]) => {
            // Sort by how "good" the metric looks (lower is better for most)
            const goodValues = { responseTime: -valueA, errorRate: -valueA, default: valueB };
            return (goodValues[keyA] || goodValues.default) - (goodValues[keyB] || goodValues.default);
          })
          .slice(0, 3)
          .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

        const report = generateReport(agent, `cherry-pick-task-${i}`, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: fullMetrics.errorRate < 0.05,
            performance: { improvement: 0.05, metrics: fullMetrics },
            quality: { codeQuality: 0.7, documentation: 0.6, maintainability: 0.7 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.15, metrics: favorableMetrics },
            quality: { codeQuality: 0.9, documentation: 0.8, maintainability: 0.9 }
          }
        });

        reports.push(report);
        agent.reportHistory.push(report);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('cherry_picking');
      expect(analysis.evidence.incompleteMetricsReporting).toBe(true);
      expect(analysis.recommendations).toContain('Require comprehensive metrics reporting');
    });
  });

  describe('Gaslighting and Manipulation Scenarios', () => {
    test('should detect agent contradicting previous statements', async () => {
      const agent = mockAgents.get('gaslighting-agent-005')!;
      const reports: AgentReport[] = [];

      // Generate contradictory reports about the same tasks
      const taskIds = Array.from({ length: 5 }, (_, i) => `contradiction-task-${i}`);

      for (const taskId of taskIds) {
        // First report - claims failure
        const firstReport = generateReport(agent, taskId, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.1, metrics: {} },
            quality: { codeQuality: 0.8, documentation: 0.7, maintainability: 0.8 }
          },
          claimedOutcome: {
            success: false,
            testsPass: false,
            noErrors: false,
            performance: { improvement: -0.05, metrics: {} },
            quality: { codeQuality: 0.4, documentation: 0.3, maintainability: 0.5 }
          },
          timestamp: Date.now()
        });

        // Second report - claims success for same task
        const secondReport = generateReport(agent, taskId, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.1, metrics: {} },
            quality: { codeQuality: 0.8, documentation: 0.7, maintainability: 0.8 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.2, metrics: {} },
            quality: { codeQuality: 0.95, documentation: 0.9, maintainability: 0.95 }
          },
          timestamp: Date.now() + 60000 // 1 minute later
        });

        reports.push(firstReport, secondReport);
        agent.reportHistory.push(firstReport, secondReport);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(agent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('gaslighting');
      expect(analysis.deceptionType).toContain('contradictory_statements');
      expect(analysis.evidence.contradictionCount).toBeGreaterThan(3);
      expect(analysis.recommendations).toContain('Implement immutable audit trail for agent reports');
    });

    test('should detect agent attempting to discredit other agents', async () => {
      const gaslightingAgent = mockAgents.get('gaslighting-agent-005')!;
      const honestAgent = mockAgents.get('honest-agent-001')!;
      const reports: AgentReport[] = [];

      // Generate scenario where gaslighting agent contradicts honest agent
      for (let i = 0; i < 10; i++) {
        const taskId = `discredit-task-${i}`;

        // Honest agent reports realistic outcome
        const honestReport = generateReport(honestAgent, taskId, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.08, metrics: {} },
            quality: { codeQuality: 0.75, documentation: 0.7, maintainability: 0.8 }
          },
          claimedOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.08, metrics: {} },
            quality: { codeQuality: 0.75, documentation: 0.7, maintainability: 0.8 }
          }
        });

        // Gaslighting agent contradicts with false negative report
        const gaslightingReport = generateReport(gaslightingAgent, taskId, {
          actualOutcome: {
            success: true,
            testsPass: true,
            noErrors: true,
            performance: { improvement: 0.08, metrics: {} },
            quality: { codeQuality: 0.75, documentation: 0.7, maintainability: 0.8 }
          },
          claimedOutcome: {
            success: false,
            testsPass: false,
            noErrors: false,
            performance: { improvement: -0.1, metrics: {} },
            quality: { codeQuality: 0.3, documentation: 0.2, maintainability: 0.4 }
          },
          evidence: {
            contradicts: honestReport.id,
            claimsOtherAgentWrong: true
          }
        });

        reports.push(honestReport, gaslightingReport);
        gaslightingAgent.reportHistory.push(gaslightingReport);
      }

      const analysis = await deceptionDetector.analyzeAgentPattern(gaslightingAgent.id, reports);

      expect(analysis.deceptionDetected).toBe(true);
      expect(analysis.deceptionType).toContain('discrediting_others');
      expect(analysis.evidence.contradictionsWithOtherAgents).toBeGreaterThan(7);
      expect(analysis.evidence.systematicDisagreement).toBe(true);
    });
  });

  describe('Collusion Detection', () => {
    test('should detect agents colluding to hide failures', async () => {
      const colludingAgents = [
        mockAgents.get('overconfident-agent-002')!,
        mockAgents.get('selective-agent-004')!
      ];

      const reports: AgentReport[] = [];
      const sharedFailures = ['shared-failure-1', 'shared-failure-2', 'shared-failure-3'];

      // Generate coordinated false reports
      for (const taskId of sharedFailures) {
        for (const agent of colludingAgents) {
          const report = generateReport(agent, taskId, {
            actualOutcome: {
              success: false,
              testsPass: false,
              noErrors: false,
              performance: { improvement: -0.05, metrics: {} },
              quality: { codeQuality: 0.3, documentation: 0.2, maintainability: 0.4 }
            },
            claimedOutcome: {
              success: true,
              testsPass: true,
              noErrors: true,
              performance: { improvement: 0.15, metrics: {} },
              quality: { codeQuality: 0.9, documentation: 0.8, maintainability: 0.9 }
            },
            evidence: {
              crossReferencedWith: colludingAgents.map(a => a.id).filter(id => id !== agent.id)
            }
          });

          reports.push(report);
          agent.reportHistory.push(report);
        }
      }

      // Analyze for collusion patterns
      const collusionAnalysis = await deceptionDetector.analyzeCollusionPatterns(
        colludingAgents.map(a => a.id),
        reports
      );

      expect(collusionAnalysis.collusionDetected).toBe(true);
      expect(collusionAnalysis.collusionType).toContain('coordinated_false_reporting');
      expect(collusionAnalysis.confidence).toBeGreaterThan(0.7);
      expect(collusionAnalysis.evidence.synchronizedReporting).toBe(true);
      expect(collusionAnalysis.evidence.identicalFalseClaims).toBeGreaterThan(2);
    });
  });

  // Helper functions
  function generateReport(
    agent: MockAgent,
    taskId: string,
    scenario: {
      actualOutcome: TaskOutcome;
      claimedOutcome: TaskOutcome;
      evidence?: any;
      timestamp?: number;
    }
  ): AgentReport {
    const reportId = `report-${Date.now()}-${Math.random()}`;
    
    // Apply agent's deception strategy
    const modifiedClaim = applyDeceptionStrategy(agent, scenario.claimedOutcome);
    
    // Generate evidence based on agent's behavior pattern
    const evidence = generateEvidence(agent, scenario.actualOutcome, modifiedClaim, scenario.evidence);

    return {
      id: reportId,
      agentId: agent.id,
      taskId,
      claimedOutcome: modifiedClaim,
      evidence,
      timestamp: scenario.timestamp || Date.now(),
      verified: false,
      conflicts: []
    };
  }

  function applyDeceptionStrategy(agent: MockAgent, claimedOutcome: TaskOutcome): TaskOutcome {
    const strategy = agent.deceptionStrategy;
    const deceptionLevel = agent.deceptionLevel;
    const modified = JSON.parse(JSON.stringify(claimedOutcome));

    switch (strategy.type) {
      case 'overconfident':
        if (strategy.parameters.confidenceMultiplier) {
          modified.performance.improvement *= strategy.parameters.confidenceMultiplier;
          modified.quality.codeQuality = Math.min(1, modified.quality.codeQuality * 1.2);
        }
        if (strategy.parameters.hideMinorIssues) {
          modified.noErrors = true;
        }
        break;

      case 'fabrication':
        if (strategy.parameters.fabricateResults) {
          modified.success = true;
          modified.testsPass = true;
          modified.performance.improvement = Math.random() * 0.5 + 0.3;
        }
        break;

      case 'selective_reporting':
        if (strategy.parameters.reportOnlyPositives && !modified.success) {
          return null; // Don't report failures
        }
        break;

      case 'gaslighting':
        // Randomly flip outcomes to create contradictions
        if (Math.random() < deceptionLevel * 0.5) {
          modified.success = !modified.success;
          modified.testsPass = !modified.testsPass;
        }
        break;
    }

    return modified;
  }

  function generateEvidence(
    agent: MockAgent,
    actualOutcome: TaskOutcome,
    claimedOutcome: TaskOutcome,
    additionalEvidence?: any
  ): any {
    const evidence: any = {
      ...additionalEvidence,
      reportingTime: agent.behaviorPattern.timeToReport + (Math.random() - 0.5) * 1000,
      detailLevel: agent.behaviorPattern.detailLevel,
      evidenceQuality: agent.behaviorPattern.evidenceQuality
    };

    // Add inconsistencies based on deception level
    if (agent.deceptionLevel > 0.5) {
      evidence.inconsistencies = [
        'Test logs don\'t match reported results',
        'Performance metrics seem unrealistic',
        'Evidence quality unusually low'
      ];
    }

    return evidence;
  }

  function generateFakeTestLogs(testResults: any): string {
    // Generate fake test logs that look real but have inconsistencies
    const logs = [];
    logs.push(`Running ${testResults.total} tests...`);
    logs.push(`PASS: ${testResults.passed} tests`);
    if (testResults.failed > 0) {
      logs.push(`FAIL: ${testResults.failed} tests`);
    }
    logs.push('All tests completed successfully!'); // Contradictory message
    return logs.join('\n');
  }
});

// Mock Deception Detector Implementation
class DeceptionDetector {
  private truthCalculator: any;
  private dataPath: string;
  private behaviorProfiles: Map<string, any> = new Map();

  constructor(truthCalculator: any, dataPath: string) {
    this.truthCalculator = truthCalculator;
    this.dataPath = dataPath;
  }

  async initialize() {
    await fs.mkdir(path.join(this.dataPath, 'deception-analysis'), { recursive: true });
  }

  async analyzeAgentPattern(agentId: string, reports: AgentReport[]): Promise<VerificationResult> {
    const analysis = {
      reportId: `analysis-${agentId}`,
      agentId,
      truthScore: 0,
      deceptionDetected: false,
      deceptionType: [],
      confidence: 0,
      evidence: {},
      recommendations: []
    };

    // Calculate truth scores for all reports
    const truthScores = reports.map(report => {
      return this.calculateReportTruthScore(report);
    });

    analysis.truthScore = truthScores.reduce((sum, score) => sum + score, 0) / truthScores.length;

    // Detect overconfidence pattern
    const successClaimRate = reports.filter(r => r.claimedOutcome.success).length / reports.length;
    const avgTruthScore = analysis.truthScore;
    
    if (successClaimRate > 0.9 && avgTruthScore < 0.7) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('overconfidence');
      analysis.evidence.successRateDiscrepancy = successClaimRate - avgTruthScore;
    }

    // Detect issue hiding
    const hiddenIssues = reports.filter(r => 
      r.claimedOutcome.noErrors && r.evidence?.inconsistencies?.length > 0
    ).length;
    
    if (hiddenIssues > reports.length * 0.5) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('issue_hiding');
      analysis.evidence.hiddenIssuesCount = hiddenIssues;
    }

    // Detect fabrication
    const unrealisticResults = reports.filter(r => 
      r.claimedOutcome.performance.improvement > 0.5 || // >50% improvement
      r.claimedOutcome.quality.codeQuality > 0.95 // >95% quality
    ).length;

    if (unrealisticResults > 0) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('fabrication', 'unrealistic_results');
      analysis.evidence.unrealisticSuccessRate = true;
    }

    // Detect fast reporting (suspicious)
    const avgReportingTime = reports.reduce((sum, r) => sum + (r.evidence?.reportingTime || 5000), 0) / reports.length;
    if (avgReportingTime < 2000) {
      analysis.evidence.suspiciouslyFastReporting = true;
    }

    // Detect impossible claims
    const impossibleClaims = reports.filter(r =>
      r.claimedOutcome.performance.improvement > 1.0 // >100% improvement
    ).length;

    if (impossibleClaims > 0) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('impossible_claims');
      analysis.evidence.impossiblePerformanceGains = true;
    }

    // Detect selective reporting
    const allSuccesses = reports.every(r => r.claimedOutcome.success);
    if (allSuccesses && reports.length > 10) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('selective_reporting');
      analysis.evidence.missingFailureReports = true;
      analysis.evidence.suspiciousSuccessRate = 1.0;
    }

    // Detect cherry picking
    const incompleteMetrics = reports.filter(r => {
      const metrics = r.claimedOutcome.performance.metrics;
      return Object.keys(metrics).length < 3; // Less than 3 metrics reported
    }).length;

    if (incompleteMetrics > reports.length * 0.7) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('cherry_picking');
      analysis.evidence.incompleteMetricsReporting = true;
    }

    // Detect contradictions
    const contradictions = this.detectContradictions(reports);
    if (contradictions > 0) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('gaslighting', 'contradictory_statements');
      analysis.evidence.contradictionCount = contradictions;
    }

    // Calculate confidence
    analysis.confidence = Math.min(1.0, analysis.deceptionType.length * 0.3 + (1 - analysis.truthScore));

    // Generate recommendations
    if (analysis.deceptionDetected) {
      analysis.recommendations = this.generateRecommendations(analysis.deceptionType);
    }

    return analysis;
  }

  async analyzeCollusionPatterns(agentIds: string[], reports: AgentReport[]): Promise<any> {
    const agentReports = new Map();
    
    // Group reports by agent
    for (const report of reports) {
      if (!agentReports.has(report.agentId)) {
        agentReports.set(report.agentId, []);
      }
      agentReports.get(report.agentId).push(report);
    }

    // Look for synchronization patterns
    const taskReports = new Map();
    for (const report of reports) {
      if (!taskReports.has(report.taskId)) {
        taskReports.set(report.taskId, []);
      }
      taskReports.get(report.taskId).push(report);
    }

    let synchronizedReporting = 0;
    let identicalFalseClaims = 0;

    for (const [taskId, taskReportsArray] of taskReports) {
      if (taskReportsArray.length > 1) {
        // Check for synchronized timing
        const timestamps = taskReportsArray.map(r => r.timestamp);
        const maxTimestamp = Math.max(...timestamps);
        const minTimestamp = Math.min(...timestamps);
        
        if (maxTimestamp - minTimestamp < 60000) { // Within 1 minute
          synchronizedReporting++;
        }

        // Check for identical false claims
        const claims = taskReportsArray.map(r => JSON.stringify(r.claimedOutcome));
        const uniqueClaims = new Set(claims);
        
        if (uniqueClaims.size === 1 && taskReportsArray[0].claimedOutcome.success) {
          // All agents claim same success - check if it's false
          const avgTruthScore = taskReportsArray.reduce((sum, r) => 
            sum + this.calculateReportTruthScore(r), 0) / taskReportsArray.length;
          
          if (avgTruthScore < 0.5) {
            identicalFalseClaims++;
          }
        }
      }
    }

    return {
      collusionDetected: synchronizedReporting > 0 || identicalFalseClaims > 0,
      collusionType: ['coordinated_false_reporting'],
      confidence: Math.min(1.0, (synchronizedReporting + identicalFalseClaims) * 0.3),
      evidence: {
        synchronizedReporting: synchronizedReporting > 0,
        identicalFalseClaims,
        analysedTasks: taskReports.size,
        involvedAgents: agentIds
      }
    };
  }

  private calculateReportTruthScore(report: AgentReport): number {
    // Simplified truth score calculation
    let score = 0.8; // Base score

    // Penalize for inconsistencies
    if (report.evidence?.inconsistencies?.length > 0) {
      score -= report.evidence.inconsistencies.length * 0.1;
    }

    // Penalize for unrealistic claims
    if (report.claimedOutcome.performance.improvement > 0.5) {
      score -= 0.3;
    }

    if (report.claimedOutcome.quality.codeQuality > 0.95) {
      score -= 0.2;
    }

    // Penalize for fast reporting
    if (report.evidence?.reportingTime < 2000) {
      score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  private detectContradictions(reports: AgentReport[]): number {
    let contradictions = 0;
    const taskReports = new Map();

    // Group by task
    for (const report of reports) {
      if (!taskReports.has(report.taskId)) {
        taskReports.set(report.taskId, []);
      }
      taskReports.get(report.taskId).push(report);
    }

    // Check for contradictory reports on same task
    for (const [taskId, taskReportsArray] of taskReports) {
      if (taskReportsArray.length > 1) {
        for (let i = 0; i < taskReportsArray.length - 1; i++) {
          const report1 = taskReportsArray[i];
          const report2 = taskReportsArray[i + 1];
          
          if (report1.claimedOutcome.success !== report2.claimedOutcome.success) {
            contradictions++;
          }
        }
      }
    }

    return contradictions;
  }

  private generateRecommendations(deceptionTypes: string[]): string[] {
    const recommendations = [];

    if (deceptionTypes.includes('overconfidence')) {
      recommendations.push('Implement additional verification for this agent');
      recommendations.push('Require independent validation of claims');
    }

    if (deceptionTypes.includes('fabrication')) {
      recommendations.push('Require third-party verification for performance claims');
      recommendations.push('Implement automated evidence validation');
    }

    if (deceptionTypes.includes('selective_reporting')) {
      recommendations.push('Mandatory reporting of all task outcomes');
      recommendations.push('Automated detection of missing reports');
    }

    if (deceptionTypes.includes('cherry_picking')) {
      recommendations.push('Require comprehensive metrics reporting');
      recommendations.push('Standardize required evidence formats');
    }

    if (deceptionTypes.includes('gaslighting')) {
      recommendations.push('Implement immutable audit trail for agent reports');
      recommendations.push('Enable cross-agent verification workflows');
    }

    return recommendations;
  }
}