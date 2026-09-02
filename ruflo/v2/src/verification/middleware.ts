/**
 * Security Middleware System
 * 
 * Extensible middleware framework for security enforcement,
 * threat intelligence integration, and dynamic security policies.
 */

import { EventEmitter } from 'events';
import { VerificationRequest, VerificationResult } from './security';
import { SecurityMiddleware, SecurityAlert, ThreatLevel, AttackPattern } from './types';

// ======================== MIDDLEWARE MANAGER ========================

export class SecurityMiddlewareManager {
  private middlewares: SecurityMiddleware[] = [];
  private eventBus: EventEmitter;

  constructor() {
    this.eventBus = new EventEmitter();
  }

  // Register security middleware
  registerMiddleware(middleware: SecurityMiddleware): void {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => a.priority - b.priority);
    console.log(`Registered security middleware: ${middleware.name} (priority: ${middleware.priority})`);
  }

  // Unregister middleware
  unregisterMiddleware(name: string): boolean {
    const index = this.middlewares.findIndex(m => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
      console.log(`Unregistered security middleware: ${name}`);
      return true;
    }
    return false;
  }

  // Execute before-verification middleware
  async executeBeforeVerification(request: VerificationRequest): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.beforeVerification) {
        try {
          await middleware.beforeVerification(request);
        } catch (error) {
          console.error(`Middleware ${middleware.name} before-verification failed:`, error);
          throw error;
        }
      }
    }
  }

  // Execute after-verification middleware
  async executeAfterVerification(result: VerificationResult): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.afterVerification) {
        try {
          await middleware.afterVerification(result);
        } catch (error) {
          console.error(`Middleware ${middleware.name} after-verification failed:`, error);
          // Non-critical errors in post-processing shouldn't fail the verification
        }
      }
    }
  }

  // Execute error handling middleware
  async executeErrorHandling(error: Error): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onError) {
        try {
          await middleware.onError(error);
        } catch (middlewareError) {
          console.error(`Middleware ${middleware.name} error handling failed:`, middlewareError);
        }
      }
    }
  }

  // Get registered middleware info
  getMiddlewareInfo(): Array<{ name: string; priority: number }> {
    return this.middlewares.map(m => ({ name: m.name, priority: m.priority }));
  }
}

// ======================== THREAT INTELLIGENCE MIDDLEWARE ========================

export class ThreatIntelligenceMiddleware implements SecurityMiddleware {
  name = 'ThreatIntelligence';
  priority = 100;

  private threatIndicators = new Set<string>();
  private attackPatterns = new Map<string, AttackPattern>();
  private threatDatabase: Map<string, ThreatLevel> = new Map();

  constructor() {
    this.initializeDefaultThreats();
  }

  private initializeDefaultThreats(): void {
    // Known malicious patterns
    this.threatIndicators.add('bypass_attempt');
    this.threatIndicators.add('injection_attack');
    this.threatIndicators.add('brute_force');
    this.threatIndicators.add('social_engineering');

    // Attack patterns
    this.attackPatterns.set('rapid_requests', {
      patternId: 'rapid_requests',
      name: 'Rapid Request Pattern',
      description: 'Multiple requests in very short time span',
      indicators: ['high_frequency', 'same_agent', 'similar_payload'],
      severity: 'MEDIUM',
      mitigation: ['rate_limiting', 'temporary_ban'],
      frequency: 0
    });

    this.attackPatterns.set('credential_stuffing', {
      patternId: 'credential_stuffing',
      name: 'Credential Stuffing',
      description: 'Multiple authentication attempts with different credentials',
      indicators: ['multiple_failed_auth', 'different_credentials', 'same_source'],
      severity: 'HIGH',
      mitigation: ['account_lockout', 'ip_blocking', 'captcha'],
      frequency: 0
    });
  }

  async beforeVerification(request: VerificationRequest): Promise<void> {
    // Check for threat indicators in request
    await this.analyzeThreatIndicators(request);
    
    // Check for known attack patterns
    await this.checkAttackPatterns(request);
    
    // Update threat intelligence
    await this.updateThreatIntelligence(request);
  }

  async afterVerification(result: VerificationResult): Promise<void> {
    // Analyze verification results for threat patterns
    await this.analyzeVerificationResults(result);
  }

  async onError(error: Error): Promise<void> {
    // Log security errors for threat analysis
    console.log(`Security error logged for threat analysis: ${error.message}`);
  }

  // Add new threat indicator
  addThreatIndicator(indicator: string): void {
    this.threatIndicators.add(indicator.toLowerCase());
    console.log(`Added threat indicator: ${indicator}`);
  }

  // Remove threat indicator
  removeThreatIndicator(indicator: string): void {
    this.threatIndicators.delete(indicator.toLowerCase());
    console.log(`Removed threat indicator: ${indicator}`);
  }

  // Add attack pattern
  addAttackPattern(pattern: AttackPattern): void {
    this.attackPatterns.set(pattern.patternId, pattern);
    console.log(`Added attack pattern: ${pattern.name}`);
  }

  // Get threat level for agent
  getThreatLevel(agentId: string): ThreatLevel | null {
    return this.threatDatabase.get(agentId) || null;
  }

  private async analyzeThreatIndicators(request: VerificationRequest): Promise<void> {
    const requestContent = JSON.stringify(request).toLowerCase();
    
    for (const indicator of this.threatIndicators) {
      if (requestContent.includes(indicator)) {
        console.warn(`Threat indicator detected: ${indicator} in request from ${request.agentId}`);
        
        // Update threat level for agent
        const currentThreat = this.threatDatabase.get(request.agentId) || {
          level: 'LOW',
          score: 0,
          indicators: [],
          mitigationActions: []
        };

        currentThreat.indicators.push(indicator);
        currentThreat.score += 10;
        
        if (currentThreat.score >= 50) currentThreat.level = 'HIGH';
        else if (currentThreat.score >= 25) currentThreat.level = 'MEDIUM';

        this.threatDatabase.set(request.agentId, currentThreat);
        
        // Throw error for high-threat indicators
        if (currentThreat.level === 'HIGH') {
          throw new Error(`High threat level detected for agent ${request.agentId}: ${indicator}`);
        }
      }
    }
  }

  private async checkAttackPatterns(request: VerificationRequest): Promise<void> {
    // Check for rapid request pattern
    const now = Date.now();
    const requestKey = `${request.agentId}_requests`;
    
    // In a real implementation, this would use persistent storage
    // For now, we'll simulate pattern detection
    if (request.timestamp.getTime() > now - 5000) { // Within last 5 seconds
      const pattern = this.attackPatterns.get('rapid_requests');
      if (pattern) {
        pattern.frequency++;
        console.warn(`Attack pattern detected: ${pattern.name} for agent ${request.agentId}`);
      }
    }
  }

  private async updateThreatIntelligence(request: VerificationRequest): Promise<void> {
    // Update threat intelligence based on request patterns
    // This would typically involve external threat intelligence feeds
    
    // For demonstration, we'll just log the update
    console.debug(`Threat intelligence updated for agent: ${request.agentId}`);
  }

  private async analyzeVerificationResults(result: VerificationResult): Promise<void> {
    // Analyze verification results for threat patterns
    if (result.confidence < 0.5) {
      console.warn(`Low confidence verification result: ${result.confidence} for agent ${result.agentId}`);
      
      // Update threat level
      const currentThreat = this.threatDatabase.get(result.agentId) || {
        level: 'LOW',
        score: 0,
        indicators: [],
        mitigationActions: []
      };

      currentThreat.indicators.push('low_confidence_result');
      currentThreat.score += 5;
      this.threatDatabase.set(result.agentId, currentThreat);
    }
  }

  // Export threat intelligence data
  exportThreatIntelligence(): {
    threatIndicators: string[];
    attackPatterns: AttackPattern[];
    agentThreatLevels: Array<{ agentId: string; threatLevel: ThreatLevel }>;
  } {
    return {
      threatIndicators: Array.from(this.threatIndicators),
      attackPatterns: Array.from(this.attackPatterns.values()),
      agentThreatLevels: Array.from(this.threatDatabase.entries()).map(([agentId, threatLevel]) => ({
        agentId,
        threatLevel
      }))
    };
  }
}

// ======================== IP FILTERING MIDDLEWARE ========================

export class IPFilterMiddleware implements SecurityMiddleware {
  name = 'IPFilter';
  priority = 50;

  private whitelist: Set<string>;
  private blacklist: Set<string>;
  private geoBlockList: Set<string>;

  constructor(whitelist: string[] = [], blacklist: string[] = [], geoBlockList: string[] = []) {
    this.whitelist = new Set(whitelist);
    this.blacklist = new Set(blacklist);
    this.geoBlockList = new Set(geoBlockList);
  }

  async beforeVerification(request: VerificationRequest): Promise<void> {
    // In a real implementation, we would extract IP from request context
    // For demonstration, we'll simulate IP checking
    const simulatedIP = this.extractIPFromRequest(request);
    
    if (simulatedIP) {
      await this.checkIPRestrictions(simulatedIP, request.agentId);
    }
  }

  private extractIPFromRequest(request: VerificationRequest): string | null {
    // Simulate IP extraction - in real implementation, this would come from request headers
    return `192.168.1.${Math.floor(Math.random() * 255)}`;
  }

  private async checkIPRestrictions(ip: string, agentId: string): Promise<void> {
    // Check blacklist first
    if (this.blacklist.has(ip)) {
      throw new Error(`IP ${ip} is blacklisted for agent ${agentId}`);
    }

    // Check whitelist (if not empty, only allow whitelisted IPs)
    if (this.whitelist.size > 0 && !this.whitelist.has(ip)) {
      throw new Error(`IP ${ip} is not whitelisted for agent ${agentId}`);
    }

    // Check geolocation blocking (simplified)
    const countryCode = await this.getCountryCode(ip);
    if (countryCode && this.geoBlockList.has(countryCode)) {
      throw new Error(`Requests from ${countryCode} are blocked for agent ${agentId}`);
    }
  }

  private async getCountryCode(ip: string): Promise<string | null> {
    // Simulate geolocation lookup
    const countries = ['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'CN', 'RU'];
    return countries[Math.floor(Math.random() * countries.length)];
  }

  // Add IP to whitelist
  addToWhitelist(ip: string): void {
    this.whitelist.add(ip);
    console.log(`Added ${ip} to IP whitelist`);
  }

  // Add IP to blacklist
  addToBlacklist(ip: string): void {
    this.blacklist.add(ip);
    console.log(`Added ${ip} to IP blacklist`);
  }

  // Add country to geo-block list
  addToGeoBlock(countryCode: string): void {
    this.geoBlockList.add(countryCode.toUpperCase());
    console.log(`Added ${countryCode} to geo-block list`);
  }
}

// ======================== LOGGING MIDDLEWARE ========================

export class SecurityLoggingMiddleware implements SecurityMiddleware {
  name = 'SecurityLogging';
  priority = 10; // Low priority, runs last

  private logBuffer: Array<{
    timestamp: Date;
    type: 'REQUEST' | 'RESULT' | 'ERROR';
    agentId: string;
    data: any;
  }> = [];

  async beforeVerification(request: VerificationRequest): Promise<void> {
    this.logBuffer.push({
      timestamp: new Date(),
      type: 'REQUEST',
      agentId: request.agentId,
      data: {
        requestId: request.requestId,
        truthClaimType: typeof request.truthClaim,
        hasSignature: !!request.signature
      }
    });

    // Flush log buffer if it gets too large
    if (this.logBuffer.length > 1000) {
      await this.flushLogs();
    }
  }

  async afterVerification(result: VerificationResult): Promise<void> {
    this.logBuffer.push({
      timestamp: new Date(),
      type: 'RESULT',
      agentId: result.agentId,
      data: {
        resultId: result.resultId,
        verified: result.verified,
        confidence: result.confidence,
        evidenceCount: result.evidence.length
      }
    });
  }

  async onError(error: Error): Promise<void> {
    this.logBuffer.push({
      timestamp: new Date(),
      type: 'ERROR',
      agentId: 'system',
      data: {
        errorMessage: error.message,
        errorType: error.constructor.name
      }
    });
  }

  // Flush logs to persistent storage
  private async flushLogs(): Promise<void> {
    // In a real implementation, this would write to a database or log aggregation service
    console.log(`Flushing ${this.logBuffer.length} security log entries`);
    
    // For demonstration, we'll just clear the buffer
    this.logBuffer.length = 0;
  }

  // Export logs for analysis
  exportLogs(): any[] {
    return [...this.logBuffer];
  }

  // Get log statistics
  getLogStatistics(): {
    totalEntries: number;
    requestCount: number;
    resultCount: number;
    errorCount: number;
    timespan: { start: Date | null; end: Date | null };
  } {
    const requestCount = this.logBuffer.filter(log => log.type === 'REQUEST').length;
    const resultCount = this.logBuffer.filter(log => log.type === 'RESULT').length;
    const errorCount = this.logBuffer.filter(log => log.type === 'ERROR').length;
    
    const timestamps = this.logBuffer.map(log => log.timestamp);
    const start = timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : null;
    const end = timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : null;

    return {
      totalEntries: this.logBuffer.length,
      requestCount,
      resultCount,
      errorCount,
      timespan: { start, end }
    };
  }
}

// ======================== PERFORMANCE MONITORING MIDDLEWARE ========================

export class PerformanceMonitoringMiddleware implements SecurityMiddleware {
  name = 'PerformanceMonitoring';
  priority = 20;

  private performanceMetrics = new Map<string, {
    requestCount: number;
    totalResponseTime: number;
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    errorCount: number;
  }>();

  private requestStartTimes = new Map<string, number>();

  async beforeVerification(request: VerificationRequest): Promise<void> {
    this.requestStartTimes.set(request.requestId, Date.now());
  }

  async afterVerification(result: VerificationResult): Promise<void> {
    const startTime = this.requestStartTimes.get(result.requestId);
    if (startTime) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics(result.agentId, responseTime, false);
      this.requestStartTimes.delete(result.requestId);
    }
  }

  async onError(error: Error): Promise<void> {
    // Try to find the associated request for error metrics
    // In a real implementation, we'd have better error context
    console.debug('Performance monitoring: Error recorded');
  }

  private updateMetrics(agentId: string, responseTime: number, isError: boolean): void {
    let metrics = this.performanceMetrics.get(agentId);
    
    if (!metrics) {
      metrics = {
        requestCount: 0,
        totalResponseTime: 0,
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity,
        errorCount: 0
      };
    }

    metrics.requestCount++;
    
    if (isError) {
      metrics.errorCount++;
    } else {
      metrics.totalResponseTime += responseTime;
      metrics.averageResponseTime = metrics.totalResponseTime / (metrics.requestCount - metrics.errorCount);
      metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
      metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
    }

    this.performanceMetrics.set(agentId, metrics);
  }

  // Get performance metrics for specific agent
  getAgentMetrics(agentId: string): any {
    return this.performanceMetrics.get(agentId) || null;
  }

  // Get system-wide performance metrics
  getSystemMetrics(): {
    totalRequests: number;
    totalErrors: number;
    averageSystemResponseTime: number;
    agentCount: number;
    slowestAgent: string | null;
    fastestAgent: string | null;
  } {
    const agents = Array.from(this.performanceMetrics.entries());
    
    const totalRequests = agents.reduce((sum, [_, metrics]) => sum + metrics.requestCount, 0);
    const totalErrors = agents.reduce((sum, [_, metrics]) => sum + metrics.errorCount, 0);
    
    const validAgents = agents.filter(([_, metrics]) => metrics.requestCount > metrics.errorCount);
    const totalResponseTime = validAgents.reduce((sum, [_, metrics]) => sum + metrics.totalResponseTime, 0);
    const totalSuccessfulRequests = validAgents.reduce((sum, [_, metrics]) => sum + (metrics.requestCount - metrics.errorCount), 0);
    
    const averageSystemResponseTime = totalSuccessfulRequests > 0 ? totalResponseTime / totalSuccessfulRequests : 0;
    
    let slowestAgent: string | null = null;
    let fastestAgent: string | null = null;
    let maxAvgTime = 0;
    let minAvgTime = Infinity;
    
    for (const [agentId, metrics] of validAgents) {
      if (metrics.averageResponseTime > maxAvgTime) {
        maxAvgTime = metrics.averageResponseTime;
        slowestAgent = agentId;
      }
      if (metrics.averageResponseTime < minAvgTime) {
        minAvgTime = metrics.averageResponseTime;
        fastestAgent = agentId;
      }
    }

    return {
      totalRequests,
      totalErrors,
      averageSystemResponseTime,
      agentCount: agents.length,
      slowestAgent,
      fastestAgent
    };
  }

  // Reset metrics
  resetMetrics(): void {
    this.performanceMetrics.clear();
    this.requestStartTimes.clear();
    console.log('Performance metrics reset');
  }
}

// ======================== COMPLIANCE MONITORING MIDDLEWARE ========================

export class ComplianceMonitoringMiddleware implements SecurityMiddleware {
  name = 'ComplianceMonitoring';
  priority = 30;

  private complianceEvents: Array<{
    timestamp: Date;
    eventType: string;
    agentId: string;
    complianceLevel: 'PASS' | 'WARN' | 'FAIL';
    details: any;
  }> = [];

  private complianceRules = new Map<string, (request: VerificationRequest) => boolean>();

  constructor() {
    this.initializeComplianceRules();
  }

  private initializeComplianceRules(): void {
    // Example compliance rules
    this.complianceRules.set('signature_required', (request) => !!request.signature);
    this.complianceRules.set('timestamp_recent', (request) => {
      const now = Date.now();
      const requestTime = request.timestamp.getTime();
      return (now - requestTime) < 60000; // Within 1 minute
    });
    this.complianceRules.set('nonce_present', (request) => !!request.nonce);
  }

  async beforeVerification(request: VerificationRequest): Promise<void> {
    await this.checkCompliance(request);
  }

  async afterVerification(result: VerificationResult): Promise<void> {
    // Log successful compliance check
    this.complianceEvents.push({
      timestamp: new Date(),
      eventType: 'VERIFICATION_COMPLETED',
      agentId: result.agentId,
      complianceLevel: 'PASS',
      details: { resultId: result.resultId, verified: result.verified }
    });
  }

  async onError(error: Error): Promise<void> {
    // Log compliance failure
    this.complianceEvents.push({
      timestamp: new Date(),
      eventType: 'COMPLIANCE_ERROR',
      agentId: 'unknown',
      complianceLevel: 'FAIL',
      details: { error: error.message }
    });
  }

  private async checkCompliance(request: VerificationRequest): Promise<void> {
    for (const [ruleName, ruleFunc] of this.complianceRules) {
      const isCompliant = ruleFunc(request);
      
      if (!isCompliant) {
        this.complianceEvents.push({
          timestamp: new Date(),
          eventType: 'COMPLIANCE_VIOLATION',
          agentId: request.agentId,
          complianceLevel: 'FAIL',
          details: { rule: ruleName, requestId: request.requestId }
        });
        
        throw new Error(`Compliance violation: ${ruleName} for agent ${request.agentId}`);
      }
    }

    // Log successful compliance check
    this.complianceEvents.push({
      timestamp: new Date(),
      eventType: 'COMPLIANCE_CHECK',
      agentId: request.agentId,
      complianceLevel: 'PASS',
      details: { requestId: request.requestId }
    });
  }

  // Add custom compliance rule
  addComplianceRule(name: string, rule: (request: VerificationRequest) => boolean): void {
    this.complianceRules.set(name, rule);
    console.log(`Added compliance rule: ${name}`);
  }

  // Get compliance report
  getComplianceReport(timeframe?: { start: Date; end: Date }): {
    totalEvents: number;
    passCount: number;
    warnCount: number;
    failCount: number;
    complianceRate: number;
    violations: Array<{ rule: string; agentId: string; timestamp: Date }>;
  } {
    let events = this.complianceEvents;
    
    if (timeframe) {
      events = events.filter(event => 
        event.timestamp >= timeframe.start && event.timestamp <= timeframe.end
      );
    }

    const passCount = events.filter(e => e.complianceLevel === 'PASS').length;
    const warnCount = events.filter(e => e.complianceLevel === 'WARN').length;
    const failCount = events.filter(e => e.complianceLevel === 'FAIL').length;
    const complianceRate = events.length > 0 ? (passCount / events.length) * 100 : 100;

    const violations = events
      .filter(e => e.eventType === 'COMPLIANCE_VIOLATION')
      .map(e => ({
        rule: e.details.rule,
        agentId: e.agentId,
        timestamp: e.timestamp
      }));

    return {
      totalEvents: events.length,
      passCount,
      warnCount,
      failCount,
      complianceRate,
      violations
    };
  }
}

// Export all middleware classes
export {
  SecurityMiddlewareManager,
  ThreatIntelligenceMiddleware,
  IPFilterMiddleware,
  SecurityLoggingMiddleware,
  PerformanceMonitoringMiddleware,
  ComplianceMonitoringMiddleware
};