/**
 * Security System Integration Examples
 * 
 * Demonstrates how to integrate the security enforcement system
 * with existing Claude Flow components and real-world scenarios.
 */

import { EventEmitter } from 'events';
import { SecurityEnforcementSystem, createProductionSecuritySystem, createHighSecuritySystem } from './index';
import { SecurityMiddlewareManager, ThreatIntelligenceMiddleware, IPFilterMiddleware } from './middleware';
import { PenetrationTestingSuite, LoadTestingSuite, SecurityValidationSuite } from './tests';
import { VerificationRequest, VerificationResult } from './security';

// ======================== BASIC INTEGRATION EXAMPLE ========================

export class BasicSecurityIntegration {
  private security: SecurityEnforcementSystem;
  private isInitialized = false;

  constructor() {
    // Create production-ready security system
    this.security = createProductionSecuritySystem();
    
    // Set up event listeners
    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize with trusted participants
    const participants = [
      'claude-verification-node-1',
      'claude-verification-node-2',
      'claude-verification-node-3',
      'claude-verification-node-4',
      'claude-verification-node-5'
    ];

    await this.security.initialize(participants);

    // Register initial agents
    await this.registerDefaultAgents();

    this.isInitialized = true;
    console.log('Security system initialized successfully');
  }

  private async registerDefaultAgents(): Promise<void> {
    const defaultAgents = [
      { id: 'truth-verifier-1', capabilities: ['verify', 'audit'], level: 'HIGH' as const },
      { id: 'truth-verifier-2', capabilities: ['verify', 'sign'], level: 'HIGH' as const },
      { id: 'consensus-node-1', capabilities: ['verify', 'consensus'], level: 'CRITICAL' as const },
      { id: 'monitoring-agent', capabilities: ['audit', 'monitor'], level: 'MEDIUM' as const }
    ];

    for (const agent of defaultAgents) {
      try {
        await this.security.registerAgent(agent.id, agent.capabilities, agent.level);
        console.log(`Registered agent: ${agent.id}`);
      } catch (error) {
        console.error(`Failed to register agent ${agent.id}:`, error.message);
      }
    }
  }

  private setupEventHandlers(): void {
    this.security.on('verificationCompleted', (result: VerificationResult) => {
      console.log(`✓ Verification completed: ${result.resultId} (confidence: ${result.confidence})`);
    });

    this.security.on('verificationError', (event: { request: VerificationRequest; error: string }) => {
      console.error(`✗ Verification failed: ${event.error}`);
    });

    this.security.on('agentRegistered', (identity) => {
      console.log(`+ Agent registered: ${identity.agentId} (level: ${identity.securityLevel})`);
    });

    this.security.on('emergencyShutdown', (event) => {
      console.error(`🚨 EMERGENCY SHUTDOWN: ${event.reason}`);
    });
  }

  // Process a truth claim with full security
  async verifyTruthClaim(claim: any, agentId: string): Promise<VerificationResult> {
    const request: VerificationRequest = {
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      truthClaim: claim,
      timestamp: new Date(),
      nonce: require('crypto').randomBytes(32).toString('hex'),
      signature: 'placeholder-signature' // In real implementation, this would be properly signed
    };

    return await this.security.processVerificationRequest(request);
  }

  // Get system status
  getSecurityStatus() {
    return this.security.getSecurityStatus();
  }

  // Emergency shutdown
  async shutdown(reason: string): Promise<void> {
    await this.security.emergencyShutdown(reason);
    this.isInitialized = false;
  }
}

// ======================== ADVANCED INTEGRATION WITH MIDDLEWARE ========================

export class AdvancedSecurityIntegration {
  private security: SecurityEnforcementSystem;
  private middlewareManager: SecurityMiddlewareManager;
  private threatIntelligence: ThreatIntelligenceMiddleware;

  constructor() {
    this.security = createHighSecuritySystem();
    this.middlewareManager = new SecurityMiddlewareManager();
    this.threatIntelligence = new ThreatIntelligenceMiddleware();
    
    this.setupAdvancedSecurity();
  }

  private setupAdvancedSecurity(): void {
    // Register security middleware
    this.middlewareManager.registerMiddleware(this.threatIntelligence);
    this.middlewareManager.registerMiddleware(new IPFilterMiddleware(
      ['127.0.0.1', '10.0.0.0/8'], // Whitelist
      ['192.168.1.100'] // Blacklist
    ));

    // Integrate middleware with security system
    this.integrateMiddleware();
  }

  private integrateMiddleware(): void {
    // Override the security system's verification process to include middleware
    const originalProcess = this.security.processVerificationRequest.bind(this.security);
    
    this.security.processVerificationRequest = async (request: VerificationRequest): Promise<VerificationResult> => {
      // Execute before-verification middleware
      await this.middlewareManager.executeBeforeVerification(request);
      
      try {
        // Process with original security system
        const result = await originalProcess(request);
        
        // Execute after-verification middleware
        await this.middlewareManager.executeAfterVerification(result);
        
        return result;
      } catch (error) {
        // Execute error handling middleware
        await this.middlewareManager.executeErrorHandling(error);
        throw error;
      }
    };
  }

  async initialize(): Promise<void> {
    await this.security.initialize([
      'secure-node-1', 'secure-node-2', 'secure-node-3',
      'secure-node-4', 'secure-node-5', 'secure-node-6',
      'secure-node-7', 'secure-node-8', 'secure-node-9'
    ]);

    // Register high-security agents
    await this.security.registerAgent('high-security-verifier', ['verify', 'audit', 'sign'], 'CRITICAL');
    
    console.log('Advanced security system initialized');
  }

  // Add threat indicator dynamically
  addThreatIndicator(indicator: string): void {
    this.threatIntelligence.addThreatIndicator(indicator);
  }

  // Process high-security verification
  async processHighSecurityVerification(claim: any, agentId: string): Promise<VerificationResult> {
    const request: VerificationRequest = {
      requestId: `hs_req_${Date.now()}`,
      agentId,
      truthClaim: claim,
      timestamp: new Date(),
      nonce: require('crypto').randomBytes(64).toString('hex'), // Larger nonce for high security
      signature: 'high-security-signature'
    };

    return await this.security.processVerificationRequest(request);
  }
}

// ======================== CLAUDE FLOW AGENT INTEGRATION ========================

export class ClaudeFlowAgentSecurityWrapper {
  private security: SecurityEnforcementSystem;
  private registeredAgents = new Set<string>();

  constructor(security: SecurityEnforcementSystem) {
    this.security = security;
  }

  // Secure agent registration for Claude Flow
  async registerClaudeFlowAgent(agentConfig: {
    agentId: string;
    type: string;
    capabilities: string[];
    securityLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Promise<void> {
    const securityLevel = agentConfig.securityLevel || 'MEDIUM';
    const capabilities = [...agentConfig.capabilities, 'verify'];

    await this.security.registerAgent(agentConfig.agentId, capabilities, securityLevel);
    this.registeredAgents.add(agentConfig.agentId);
    
    console.log(`Claude Flow agent secured: ${agentConfig.agentId} (${agentConfig.type})`);
  }

  // Secure task execution wrapper
  async executeSecureTask(
    agentId: string,
    task: string,
    truthClaim: any
  ): Promise<{
    taskResult: any;
    verificationResult: VerificationResult;
    securityStatus: 'SECURE' | 'SUSPICIOUS' | 'BLOCKED';
  }> {
    if (!this.registeredAgents.has(agentId)) {
      throw new Error(`Agent ${agentId} not registered for secure operations`);
    }

    try {
      // Process verification first
      const verificationResult = await this.security.processVerificationRequest({
        requestId: `task_${Date.now()}`,
        agentId,
        truthClaim,
        timestamp: new Date(),
        nonce: require('crypto').randomBytes(32).toString('hex'),
        signature: 'task-signature'
      });

      // Execute task (placeholder)
      const taskResult = await this.simulateTaskExecution(task);

      return {
        taskResult,
        verificationResult,
        securityStatus: 'SECURE'
      };
    } catch (error) {
      if (error.message.includes('Byzantine') || error.message.includes('rate limit')) {
        return {
          taskResult: null,
          verificationResult: null as any,
          securityStatus: 'BLOCKED'
        };
      }
      
      return {
        taskResult: null,
        verificationResult: null as any,
        securityStatus: 'SUSPICIOUS'
      };
    }
  }

  private async simulateTaskExecution(task: string): Promise<any> {
    // Simulate task execution
    await new Promise(resolve => setTimeout(resolve, 100));
    return { task, completed: true, timestamp: new Date() };
  }

  // Get security metrics for agents
  getAgentSecurityMetrics(): Map<string, any> {
    const status = this.security.getSecurityStatus();
    const agentMetrics = new Map();

    for (const agentId of this.registeredAgents) {
      agentMetrics.set(agentId, {
        reputation: status.metrics.reputationScores.get(agentId) || 100,
        registered: true,
        securityLevel: 'ACTIVE'
      });
    }

    return agentMetrics;
  }
}

// ======================== COMPREHENSIVE SECURITY TESTING EXAMPLE ========================

export class SecurityTestingExample {
  private security: SecurityEnforcementSystem;
  private penetrationTester: PenetrationTestingSuite;
  private loadTester: LoadTestingSuite;
  private validator: SecurityValidationSuite;

  constructor() {
    this.security = createProductionSecuritySystem();
    this.penetrationTester = new PenetrationTestingSuite(this.security);
    this.loadTester = new LoadTestingSuite(this.security);
    this.validator = new SecurityValidationSuite(this.security);
  }

  async runComprehensiveSecurityTest(): Promise<{
    penetrationTestResults: any;
    loadTestResults: any;
    validationResults: any;
    overallAssessment: {
      securityScore: number;
      riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      recommendations: string[];
    };
  }> {
    console.log('🔒 Starting comprehensive security testing...');

    // Initialize security system
    await this.security.initialize(['test-node-1', 'test-node-2', 'test-node-3', 'test-node-4', 'test-node-5']);

    // Run penetration tests
    console.log('🔍 Running penetration tests...');
    const penetrationTestResults = await this.penetrationTester.runFullPenetrationTest();

    // Run load tests
    console.log('⚡ Running load tests...');
    const loadTestResults = await this.loadTester.runConcurrentLoadTest(10, 50, 30);

    // Run validation tests
    console.log('✅ Running validation tests...');
    const validationResults = await this.validator.validateSecuritySystem();

    // Generate overall assessment
    const overallAssessment = this.generateOverallAssessment(
      penetrationTestResults,
      loadTestResults,
      validationResults
    );

    console.log('🏁 Security testing completed');

    return {
      penetrationTestResults,
      loadTestResults,
      validationResults,
      overallAssessment
    };
  }

  private generateOverallAssessment(
    pentestResults: any,
    loadResults: any,
    validationResults: any
  ): {
    securityScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendations: string[];
  } {
    // Calculate weighted security score
    const pentestScore = pentestResults.securityScore * 0.4;
    const loadScore = (loadResults.successfulRequests / loadResults.totalRequests) * 100 * 0.3;
    const validationScore = validationResults.overallHealth ? 100 : 50;
    const validationWeight = 0.3;

    const securityScore = Math.round(pentestScore + loadScore + (validationScore * validationWeight));

    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (securityScore >= 90) riskLevel = 'LOW';
    else if (securityScore >= 75) riskLevel = 'MEDIUM';
    else if (securityScore >= 60) riskLevel = 'HIGH';
    else riskLevel = 'CRITICAL';

    // Generate recommendations
    const recommendations: string[] = [
      ...pentestResults.recommendations,
      ...validationResults.recommendations
    ];

    if (loadResults.failedRequests > loadResults.totalRequests * 0.1) {
      recommendations.push('Improve system resilience under load');
    }

    return { securityScore, riskLevel, recommendations };
  }
}

// ======================== REAL-WORLD DEPLOYMENT EXAMPLE ========================

export class ProductionDeploymentExample {
  private security: SecurityEnforcementSystem;
  private monitoring: EventEmitter;
  private alerting: EventEmitter;

  constructor() {
    this.security = createProductionSecuritySystem();
    this.monitoring = new EventEmitter();
    this.alerting = new EventEmitter();
    
    this.setupProductionMonitoring();
  }

  private setupProductionMonitoring(): void {
    // Security event monitoring
    this.security.on('verificationError', (event) => {
      this.monitoring.emit('securityIncident', {
        type: 'VERIFICATION_FAILURE',
        severity: 'HIGH',
        details: event,
        timestamp: new Date()
      });
    });

    this.security.on('emergencyShutdown', (event) => {
      this.alerting.emit('criticalAlert', {
        type: 'EMERGENCY_SHUTDOWN',
        message: event.reason,
        timestamp: new Date()
      });
    });

    // Regular health checks
    setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Every minute
  }

  async deployToProduction(): Promise<void> {
    console.log('🚀 Deploying security system to production...');

    // Initialize with production nodes
    const productionNodes = [
      'prod-security-node-us-east-1',
      'prod-security-node-us-west-2',
      'prod-security-node-eu-west-1',
      'prod-security-node-ap-southeast-1',
      'prod-security-node-ap-northeast-1'
    ];

    await this.security.initialize(productionNodes);

    // Register production agents
    await this.registerProductionAgents();

    // Start monitoring
    this.startMonitoring();

    console.log('✅ Security system deployed to production');
  }

  private async registerProductionAgents(): Promise<void> {
    const productionAgents = [
      { id: 'primary-verifier', capabilities: ['verify', 'audit', 'sign'], level: 'CRITICAL' as const },
      { id: 'backup-verifier', capabilities: ['verify', 'audit'], level: 'HIGH' as const },
      { id: 'consensus-coordinator', capabilities: ['consensus', 'audit'], level: 'CRITICAL' as const },
      { id: 'security-monitor', capabilities: ['audit', 'monitor'], level: 'HIGH' as const }
    ];

    for (const agent of productionAgents) {
      await this.security.registerAgent(agent.id, agent.capabilities, agent.level);
    }
  }

  private startMonitoring(): void {
    console.log('📊 Starting production monitoring...');
    
    // Monitor for security incidents
    this.monitoring.on('securityIncident', (incident) => {
      console.warn(`⚠️  Security incident: ${incident.type} - ${incident.details.error}`);
      
      // Could integrate with external monitoring systems here
      // e.g., DataDog, New Relic, Prometheus, etc.
    });

    // Handle critical alerts
    this.alerting.on('criticalAlert', (alert) => {
      console.error(`🚨 CRITICAL ALERT: ${alert.type} - ${alert.message}`);
      
      // Could integrate with PagerDuty, Slack, etc.
    });
  }

  private performHealthCheck(): void {
    const status = this.security.getSecurityStatus();
    
    if (!status.systemHealth.consensusCapable) {
      this.alerting.emit('criticalAlert', {
        type: 'CONSENSUS_FAILURE',
        message: 'System cannot achieve consensus',
        timestamp: new Date()
      });
    }

    if (status.systemHealth.byzantineNodes > 0) {
      this.monitoring.emit('securityIncident', {
        type: 'BYZANTINE_NODES_DETECTED',
        severity: 'HIGH',
        details: { count: status.systemHealth.byzantineNodes },
        timestamp: new Date()
      });
    }
  }

  // Graceful shutdown for maintenance
  async gracefulShutdown(): Promise<void> {
    console.log('🔄 Initiating graceful shutdown...');
    
    // Export final security report
    const report = this.security.exportSecurityReport();
    console.log('💾 Security report exported');
    
    // Shutdown security system
    await this.security.emergencyShutdown('Scheduled maintenance');
    
    console.log('✅ Graceful shutdown completed');
  }
}

// Export all examples
export {
  BasicSecurityIntegration,
  AdvancedSecurityIntegration,
  ClaudeFlowAgentSecurityWrapper,
  SecurityTestingExample,
  ProductionDeploymentExample
};

// Usage examples as comments:
/*
// Basic usage:
const basicSecurity = new BasicSecurityIntegration();
await basicSecurity.initialize();
const result = await basicSecurity.verifyTruthClaim({ statement: "Test claim" }, "agent-1");

// Advanced usage with middleware:
const advancedSecurity = new AdvancedSecurityIntegration();
await advancedSecurity.initialize();
advancedSecurity.addThreatIndicator("malicious-pattern-x");

// Claude Flow integration:
const wrapper = new ClaudeFlowAgentSecurityWrapper(securitySystem);
await wrapper.registerClaudeFlowAgent({
  agentId: "claude-coder-1",
  type: "coder",
  capabilities: ["code", "review", "test"]
});

// Comprehensive testing:
const tester = new SecurityTestingExample();
const results = await tester.runComprehensiveSecurityTest();
console.log("Security score:", results.overallAssessment.securityScore);

// Production deployment:
const production = new ProductionDeploymentExample();
await production.deployToProduction();
*/