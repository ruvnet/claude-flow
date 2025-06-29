import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from '../tracing/index.js';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
import { SecureCrypto } from '../security/crypto-utils.js';

export interface SecurityScan {
  id: string;
  name: string;
  type: 'vulnerability' | 'dependency' | 'code-quality' | 'secrets' | 'compliance' | 'infrastructure' | 'container';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  projectId?: string;
  target: {
    type: 'repository' | 'container' | 'infrastructure' | 'application' | 'dependencies';
    path: string;
    branch?: string;
    commit?: string;
    image?: string;
    tag?: string;
  };
  configuration: {
    scanner: string;
    rules: string[];
    excludes: string[];
    severity: SecuritySeverity[];
    formats: string[];
    outputPath: string;
  };
  results: SecurityFinding[];
  metrics: {
    totalFindings: number;
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    falsePositives: number;
    suppressed: number;
    scanDuration: number;
    filesScanned: number;
    linesScanned: number;
  };
  compliance: {
    frameworks: string[];
    requirements: ComplianceCheck[];
    overallScore: number;
    passedChecks: number;
    failedChecks: number;
  };
  remediation: {
    autoFixAvailable: SecurityFinding[];
    manualReview: SecurityFinding[];
    recommendations: SecurityRecommendation[];
  };
  schedule?: {
    frequency: 'manual' | 'daily' | 'weekly' | 'monthly' | 'on-commit' | 'on-deploy';
    nextRun?: Date;
    lastRun?: Date;
  };
  notifications: {
    channels: string[];
    thresholds: {
      critical: number;
      high: number;
      medium: number;
    };
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  auditLog: SecurityAuditEntry[];
}

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  id: string;
  title: string;
  description: string;
  severity: SecuritySeverity;
  category: 'vulnerability' | 'secret' | 'misconfiguration' | 'compliance' | 'code-quality' | 'license';
  cwe?: string; // Common Weakness Enumeration
  cve?: string; // Common Vulnerabilities and Exposures
  cvss?: {
    score: number;
    vector: string;
    version: string;
  };
  location: {
    file: string;
    line?: number;
    column?: number;
    function?: string;
    component?: string;
  };
  evidence: {
    snippet?: string;
    context?: string;
    references?: string[];
  };
  impact: string;
  remediation: {
    description: string;
    effort: 'low' | 'medium' | 'high';
    priority: 'low' | 'medium' | 'high' | 'critical';
    autoFixable: boolean;
    steps: string[];
    references: string[];
  };
  status: 'open' | 'triaged' | 'in-progress' | 'resolved' | 'suppressed' | 'false-positive';
  assignedTo?: string;
  dueDate?: Date;
  tags: string[];
  metadata: Record<string, any>;
  firstSeen: Date;
  lastSeen: Date;
  occurrences: number;
}

export interface ComplianceCheck {
  id: string;
  framework: string; // e.g., 'SOC2', 'GDPR', 'HIPAA', 'PCI-DSS', 'CIS', 'NIST'
  control: string;
  description: string;
  status: 'passed' | 'failed' | 'not-applicable' | 'manual-review';
  severity: SecuritySeverity;
  evidence?: string;
  remediation?: string;
  lastChecked: Date;
}

export interface SecurityRecommendation {
  id: string;
  title: string;
  description: string;
  category: 'security-hardening' | 'vulnerability-management' | 'access-control' | 'monitoring' | 'compliance';
  priority: 'low' | 'medium' | 'high' | 'critical';
  effort: 'low' | 'medium' | 'high';
  impact: string;
  implementation: {
    steps: string[];
    tools: string[];
    timeEstimate: string;
    cost: string;
  };
  references: string[];
  applicableFrameworks: string[];
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  type: 'scanning' | 'access-control' | 'compliance' | 'incident-response' | 'data-protection';
  version: string;
  status: 'draft' | 'active' | 'deprecated';
  rules: SecurityRule[];
  enforcement: {
    level: 'advisory' | 'warning' | 'blocking';
    exceptions: string[];
    approvers: string[];
  };
  applicability: {
    projects: string[];
    environments: string[];
    resources: string[];
  };
  schedule: {
    reviewFrequency: 'quarterly' | 'annually' | 'as-needed';
    nextReview: Date;
    lastReview?: Date;
    reviewer: string;
  };
  metrics: {
    violations: number;
    compliance: number;
    exceptions: number;
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  condition: string; // Query or condition syntax
  action: 'allow' | 'deny' | 'alert' | 'audit';
  severity: SecuritySeverity;
  parameters: Record<string, any>;
  enabled: boolean;
}

export interface SecurityIncident {
  id: string;
  title: string;
  description: string;
  severity: SecuritySeverity;
  status: 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';
  type: 'security-breach' | 'vulnerability-exploit' | 'policy-violation' | 'suspicious-activity' | 'compliance-violation';
  source: {
    type: 'scan' | 'alert' | 'user-report' | 'automated-detection';
    details: Record<string, any>;
  };
  affected: {
    systems: string[];
    data: string[];
    users: string[];
  };
  timeline: {
    detected: Date;
    reported: Date;
    acknowledged: Date;
    contained?: Date;
    resolved?: Date;
    closed?: Date;
  };
  response: {
    assignedTo: string[];
    actions: SecurityAction[];
    communications: SecurityCommunication[];
    lessons: string[];
  };
  evidence: {
    logs: string[];
    files: string[];
    screenshots: string[];
    forensics: string[];
  };
  impact: {
    confidentiality: 'none' | 'low' | 'medium' | 'high';
    integrity: 'none' | 'low' | 'medium' | 'high';
    availability: 'none' | 'low' | 'medium' | 'high';
    financialLoss?: number;
    reputationalDamage?: string;
    regulatoryImplications?: string[];
  };
  rootCause: {
    primary: string;
    contributing: string[];
    analysis: string;
  };
  remediation: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
    preventive: string[];
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  auditLog: SecurityAuditEntry[];
}

export interface SecurityAction {
  id: string;
  type: 'investigation' | 'containment' | 'eradication' | 'recovery' | 'notification' | 'documentation';
  description: string;
  assignedTo: string;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  dueDate?: Date;
  completedAt?: Date;
  notes: string;
}

export interface SecurityCommunication {
  id: string;
  type: 'internal' | 'external' | 'regulatory' | 'customer' | 'media';
  audience: string[];
  subject: string;
  message: string;
  sentAt: Date;
  sentBy: string;
  channel: 'email' | 'phone' | 'meeting' | 'document' | 'portal';
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  target: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface VulnerabilityDatabase {
  id: string;
  name: string;
  type: 'nvd' | 'github' | 'snyk' | 'custom';
  url: string;
  updateFrequency: 'hourly' | 'daily' | 'weekly';
  lastUpdate: Date;
  status: 'active' | 'inactive' | 'error';
  configuration: Record<string, any>;
}

export interface SecurityMetrics {
  scans: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    byType: Record<string, number>;
    averageDuration: number;
  };
  findings: {
    total: number;
    open: number;
    resolved: number;
    suppressed: number;
    bySeverity: Record<SecuritySeverity, number>;
    byCategory: Record<string, number>;
    meanTimeToResolution: number;
  };
  compliance: {
    frameworks: Record<string, {
      total: number;
      passed: number;
      failed: number;
      score: number;
    }>;
    overallScore: number;
    trending: 'improving' | 'stable' | 'declining';
  };
  incidents: {
    total: number;
    open: number;
    resolved: number;
    bySeverity: Record<SecuritySeverity, number>;
    meanTimeToDetection: number;
    meanTimeToResponse: number;
    meanTimeToResolution: number;
  };
  policies: {
    total: number;
    active: number;
    violations: number;
    compliance: number;
  };
  trends: {
    findingsTrend: Array<{ date: Date; count: number }>;
    complianceTrend: Array<{ date: Date; score: number }>;
    incidentsTrend: Array<{ date: Date; count: number }>;
  };
}

export class SecurityManager extends EventEmitter {
  private scans: Map<string, SecurityScan> = new Map();
  private policies: Map<string, SecurityPolicy> = new Map();
  private incidents: Map<string, SecurityIncident> = new Map();
  private vulnerabilityDatabases: Map<string, VulnerabilityDatabase> = new Map();
  private securityPath: string;
  private logger: Logger;
  private config: ConfigManager;

  constructor(
    securityPath: string = './security',
    logger?: Logger,
    config?: ConfigManager
  ) {
    super();
    this.securityPath = securityPath;
    this.logger = logger || new Logger({ level: 'info', format: 'text', destination: 'console' });
    this.config = config || ConfigManager.getInstance();
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.securityPath, { recursive: true });
      await mkdir(join(this.securityPath, 'scans'), { recursive: true });
      await mkdir(join(this.securityPath, 'policies'), { recursive: true });
      await mkdir(join(this.securityPath, 'incidents'), { recursive: true });
      await mkdir(join(this.securityPath, 'reports'), { recursive: true });
      await mkdir(join(this.securityPath, 'databases'), { recursive: true });
      
      await this.loadConfigurations();
      await this.initializeDefaultPolicies();
      await this.initializeVulnerabilityDatabases();
      
      this.logger.info('Security Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Security Manager', { error });
      throw error;
    }
  }

  async createSecurityScan(scanData: {
    name: string;
    type: SecurityScan['type'];
    target: SecurityScan['target'];
    configuration?: Partial<SecurityScan['configuration']>;
    projectId?: string;
    schedule?: SecurityScan['schedule'];
  }): Promise<SecurityScan> {
    const scan: SecurityScan = {
      id: SecureCrypto.generateSecureId('scan', 12),
      name: scanData.name,
      type: scanData.type,
      status: 'pending',
      projectId: scanData.projectId,
      target: scanData.target,
      configuration: {
        scanner: this.getDefaultScanner(scanData.type),
        rules: [],
        excludes: [],
        severity: ['critical', 'high', 'medium', 'low'],
        formats: ['json', 'html'],
        outputPath: join(this.securityPath, 'reports'),
        ...scanData.configuration
      },
      results: [],
      metrics: {
        totalFindings: 0,
        criticalFindings: 0,
        highFindings: 0,
        mediumFindings: 0,
        lowFindings: 0,
        falsePositives: 0,
        suppressed: 0,
        scanDuration: 0,
        filesScanned: 0,
        linesScanned: 0
      },
      compliance: {
        frameworks: [],
        requirements: [],
        overallScore: 0,
        passedChecks: 0,
        failedChecks: 0
      },
      remediation: {
        autoFixAvailable: [],
        manualReview: [],
        recommendations: []
      },
      schedule: scanData.schedule,
      notifications: {
        channels: [],
        thresholds: {
          critical: 1,
          high: 5,
          medium: 10
        }
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      auditLog: []
    };

    this.addAuditEntry(scan, 'system', 'scan_created', 'scan', {
      scanId: scan.id,
      scanName: scan.name,
      scanType: scan.type
    });

    this.scans.set(scan.id, scan);
    await this.saveScan(scan);

    this.emit('scan:created', scan);
    this.logger.info(`Security scan created: ${scan.name} (${scan.id})`);

    return scan;
  }

  async executeScan(scanId: string): Promise<void> {
    const scan = this.scans.get(scanId);
    if (!scan) {
      throw new Error(`Scan not found: ${scanId}`);
    }

    if (scan.status !== 'pending') {
      throw new Error(`Scan ${scanId} is not in pending status`);
    }

    scan.status = 'running';
    scan.updatedAt = new Date();

    this.addAuditEntry(scan, 'system', 'scan_started', 'scan', {
      scanId,
      target: scan.target
    });

    await this.saveScan(scan);
    this.emit('scan:started', scan);

    try {
      const startTime = Date.now();
      
      // Execute the appropriate scanner
      const findings = await this.executeScanEngine(scan);
      
      const endTime = Date.now();
      scan.metrics.scanDuration = endTime - startTime;
      scan.results = findings;
      scan.status = 'completed';

      // Calculate metrics
      this.calculateScanMetrics(scan);

      // Run compliance checks
      await this.runComplianceChecks(scan);

      // Generate remediation recommendations
      await this.generateRemediationRecommendations(scan);

      // Check notification thresholds
      await this.checkNotificationThresholds(scan);

      scan.updatedAt = new Date();

      this.addAuditEntry(scan, 'system', 'scan_completed', 'scan', {
        scanId,
        duration: scan.metrics.scanDuration,
        findingsCount: scan.results.length
      });

      await this.saveScan(scan);
      this.emit('scan:completed', scan);

      this.logger.info(`Security scan completed: ${scan.name} (${scan.id}) - ${scan.results.length} findings`);

    } catch (error) {
      scan.status = 'failed';
      scan.updatedAt = new Date();

      this.addAuditEntry(scan, 'system', 'scan_failed', 'scan', {
        scanId,
        error: error instanceof Error ? error.message : String(error)
      });

      await this.saveScan(scan);
      this.emit('scan:failed', { scan, error });

      this.logger.error(`Security scan failed: ${scan.name} (${scanId})`, { error });
      throw error;
    }
  }

  async createSecurityIncident(incidentData: {
    title: string;
    description: string;
    severity: SecuritySeverity;
    type: SecurityIncident['type'];
    source: SecurityIncident['source'];
    affected?: Partial<SecurityIncident['affected']>;
  }): Promise<SecurityIncident> {
    const incident: SecurityIncident = {
      id: SecureCrypto.generateSecureId('incident', 12),
      title: incidentData.title,
      description: incidentData.description,
      severity: incidentData.severity,
      status: 'open',
      type: incidentData.type,
      source: incidentData.source,
      affected: {
        systems: [],
        data: [],
        users: [],
        ...incidentData.affected
      },
      timeline: {
        detected: new Date(),
        reported: new Date(),
        acknowledged: new Date()
      },
      response: {
        assignedTo: [],
        actions: [],
        communications: [],
        lessons: []
      },
      evidence: {
        logs: [],
        files: [],
        screenshots: [],
        forensics: []
      },
      impact: {
        confidentiality: 'none',
        integrity: 'none',
        availability: 'none'
      },
      rootCause: {
        primary: '',
        contributing: [],
        analysis: ''
      },
      remediation: {
        immediate: [],
        shortTerm: [],
        longTerm: [],
        preventive: []
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      auditLog: []
    };

    this.addAuditEntry(incident, 'system', 'incident_created', 'incident', {
      incidentId: incident.id,
      severity: incident.severity,
      type: incident.type
    });

    this.incidents.set(incident.id, incident);
    await this.saveIncident(incident);

    // Auto-assign based on severity and type
    await this.autoAssignIncident(incident);

    // Send immediate notifications for high/critical incidents
    if (incident.severity === 'critical' || incident.severity === 'high') {
      await this.sendIncidentNotification(incident);
    }

    this.emit('incident:created', incident);
    this.logger.info(`Security incident created: ${incident.title} (${incident.id})`);

    return incident;
  }

  async updateIncident(
    incidentId: string,
    updates: Partial<SecurityIncident>,
    userId: string = 'system'
  ): Promise<SecurityIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const oldStatus = incident.status;
    Object.assign(incident, updates);
    incident.updatedAt = new Date();

    // Update timeline based on status changes
    if (updates.status && updates.status !== oldStatus) {
      this.updateIncidentTimeline(incident, updates.status);
    }

    this.addAuditEntry(incident, userId, 'incident_updated', 'incident', {
      incidentId,
      changes: Object.keys(updates),
      oldStatus,
      newStatus: incident.status
    });

    await this.saveIncident(incident);
    this.emit('incident:updated', { incident, updates });

    this.logger.info(`Security incident updated: ${incident.title} (${incidentId})`);

    return incident;
  }

  async runComplianceAssessment(
    frameworks: string[],
    scope?: {
      projectId?: string;
      environment?: string;
      resources?: string[];
    }
  ): Promise<ComplianceCheck[]> {
    const checks: ComplianceCheck[] = [];

    for (const framework of frameworks) {
      const frameworkChecks = await this.runFrameworkChecks(framework, scope);
      checks.push(...frameworkChecks);
    }

    this.logger.info(`Compliance assessment completed: ${checks.length} checks across ${frameworks.length} frameworks`);
    this.emit('compliance:assessed', { frameworks, checks, scope });

    return checks;
  }

  async createSecurityPolicy(policyData: {
    name: string;
    description: string;
    type: SecurityPolicy['type'];
    rules: Omit<SecurityRule, 'id'>[];
    enforcement?: Partial<SecurityPolicy['enforcement']>;
    applicability?: Partial<SecurityPolicy['applicability']>;
  }): Promise<SecurityPolicy> {
    const policy: SecurityPolicy = {
      id: SecureCrypto.generateSecureId('policy', 12),
      name: policyData.name,
      description: policyData.description,
      type: policyData.type,
      version: '1.0.0',
      status: 'draft',
      rules: policyData.rules.map(rule => ({
        id: SecureCrypto.generateSecureId('rule', 12),
        ...rule
      })),
      enforcement: {
        level: 'warning',
        exceptions: [],
        approvers: [],
        ...policyData.enforcement
      },
      applicability: {
        projects: [],
        environments: [],
        resources: [],
        ...policyData.applicability
      },
      schedule: {
        reviewFrequency: 'annually',
        nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        reviewer: 'security-team'
      },
      metrics: {
        violations: 0,
        compliance: 100,
        exceptions: 0
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system'
    };

    this.policies.set(policy.id, policy);
    await this.savePolicy(policy);

    this.emit('policy:created', policy);
    this.logger.info(`Security policy created: ${policy.name} (${policy.id})`);

    return policy;
  }

  async getSecurityMetrics(
    filters?: {
      timeRange?: { start: Date; end: Date };
      projectId?: string;
      environment?: string;
      severity?: SecuritySeverity[];
    }
  ): Promise<SecurityMetrics> {
    let scans = Array.from(this.scans.values());
    let incidents = Array.from(this.incidents.values());

    // Apply filters
    if (filters) {
      if (filters.timeRange) {
        scans = scans.filter(s => 
          s.createdAt >= filters.timeRange!.start && 
          s.createdAt <= filters.timeRange!.end
        );
        incidents = incidents.filter(i => 
          i.createdAt >= filters.timeRange!.start && 
          i.createdAt <= filters.timeRange!.end
        );
      }
      if (filters.projectId) {
        scans = scans.filter(s => s.projectId === filters.projectId);
      }
    }

    // Calculate scan metrics
    const scanMetrics = {
      total: scans.length,
      completed: scans.filter(s => s.status === 'completed').length,
      failed: scans.filter(s => s.status === 'failed').length,
      inProgress: scans.filter(s => s.status === 'running').length,
      byType: this.groupBy(scans, 'type'),
      averageDuration: scans.length > 0 ? 
        scans.reduce((sum, s) => sum + s.metrics.scanDuration, 0) / scans.length : 0
    };

    // Calculate finding metrics
    const allFindings = scans.flatMap(s => s.results);
    const findingMetrics = {
      total: allFindings.length,
      open: allFindings.filter(f => f.status === 'open').length,
      resolved: allFindings.filter(f => f.status === 'resolved').length,
      suppressed: allFindings.filter(f => f.status === 'suppressed').length,
      bySeverity: this.groupBy(allFindings, 'severity') as Record<SecuritySeverity, number>,
      byCategory: this.groupBy(allFindings, 'category'),
      meanTimeToResolution: this.calculateMTTR(allFindings)
    };

    // Calculate compliance metrics
    const allComplianceChecks = scans.flatMap(s => s.compliance.requirements);
    const complianceFrameworks: Record<string, any> = {};
    
    for (const check of allComplianceChecks) {
      if (!complianceFrameworks[check.framework]) {
        complianceFrameworks[check.framework] = {
          total: 0,
          passed: 0,
          failed: 0,
          score: 0
        };
      }
      
      complianceFrameworks[check.framework].total++;
      if (check.status === 'passed') {
        complianceFrameworks[check.framework].passed++;
      } else if (check.status === 'failed') {
        complianceFrameworks[check.framework].failed++;
      }
    }

    // Calculate scores
    for (const framework in complianceFrameworks) {
      const fw = complianceFrameworks[framework];
      fw.score = fw.total > 0 ? (fw.passed / fw.total) * 100 : 0;
    }

    const overallComplianceScore = Object.values(complianceFrameworks).length > 0 ?
      Object.values(complianceFrameworks).reduce((sum: number, fw: any) => sum + fw.score, 0) / 
      Object.values(complianceFrameworks).length : 0;

    // Calculate incident metrics
    const incidentMetrics = {
      total: incidents.length,
      open: incidents.filter(i => i.status === 'open' || i.status === 'investigating').length,
      resolved: incidents.filter(i => i.status === 'resolved' || i.status === 'closed').length,
      bySeverity: this.groupBy(incidents, 'severity') as Record<SecuritySeverity, number>,
      meanTimeToDetection: this.calculateMTTD(incidents),
      meanTimeToResponse: this.calculateMTTResponse(incidents),
      meanTimeToResolution: this.calculateIncidentMTTR(incidents)
    };

    // Policy metrics
    const policies = Array.from(this.policies.values());
    const policyMetrics = {
      total: policies.length,
      active: policies.filter(p => p.status === 'active').length,
      violations: policies.reduce((sum, p) => sum + p.metrics.violations, 0),
      compliance: policies.length > 0 ? 
        policies.reduce((sum, p) => sum + p.metrics.compliance, 0) / policies.length : 0
    };

    return {
      scans: scanMetrics,
      findings: findingMetrics,
      compliance: {
        frameworks: complianceFrameworks,
        overallScore: overallComplianceScore,
        trending: 'stable' // Would be calculated from historical data
      },
      incidents: incidentMetrics,
      policies: policyMetrics,
      trends: {
        findingsTrend: [], // Would be calculated from historical data
        complianceTrend: [], // Would be calculated from historical data
        incidentsTrend: [] // Would be calculated from historical data
      }
    };
  }

  // Private helper methods
  private async loadConfigurations(): Promise<void> {
    try {
      // Load scans
      const scanFiles = await readdir(join(this.securityPath, 'scans'));
      for (const file of scanFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.securityPath, 'scans', file), 'utf-8');
        const scan: SecurityScan = JSON.parse(content);
        this.scans.set(scan.id, scan);
      }

      // Load policies
      const policyFiles = await readdir(join(this.securityPath, 'policies'));
      for (const file of policyFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.securityPath, 'policies', file), 'utf-8');
        const policy: SecurityPolicy = JSON.parse(content);
        this.policies.set(policy.id, policy);
      }

      // Load incidents
      const incidentFiles = await readdir(join(this.securityPath, 'incidents'));
      for (const file of incidentFiles.filter(f => f.endsWith('.json'))) {
        const content = await readFile(join(this.securityPath, 'incidents', file), 'utf-8');
        const incident: SecurityIncident = JSON.parse(content);
        this.incidents.set(incident.id, incident);
      }

      this.logger.info(`Loaded ${this.scans.size} scans, ${this.policies.size} policies, ${this.incidents.size} incidents`);
    } catch (error) {
      this.logger.warn('Failed to load some security configurations', { error });
    }
  }

  private async initializeDefaultPolicies(): Promise<void> {
    const defaultPolicies = [
      {
        name: 'Critical Vulnerability Policy',
        description: 'Immediate action required for critical vulnerabilities',
        type: 'scanning' as const,
        rules: [
          {
            name: 'Critical CVSS Score',
            description: 'Alert on vulnerabilities with CVSS score >= 9.0',
            condition: 'cvss.score >= 9.0',
            action: 'alert' as const,
            severity: 'critical' as const,
            parameters: { threshold: 9.0 },
            enabled: true
          }
        ],
        enforcement: {
          level: 'blocking' as const,
          exceptions: [],
          approvers: ['security-lead']
        }
      },
      {
        name: 'Secret Detection Policy',
        description: 'Detect exposed secrets and credentials',
        type: 'scanning' as const,
        rules: [
          {
            name: 'API Key Detection',
            description: 'Detect exposed API keys',
            condition: 'category == "secret" && type == "api-key"',
            action: 'deny' as const,
            severity: 'high' as const,
            parameters: {},
            enabled: true
          }
        ]
      }
    ];

    for (const policyData of defaultPolicies) {
      if (!Array.from(this.policies.values()).some(p => p.name === policyData.name)) {
        await this.createSecurityPolicy(policyData);
      }
    }
  }

  private async initializeVulnerabilityDatabases(): Promise<void> {
    const databases: VulnerabilityDatabase[] = [
      {
        id: 'nvd',
        name: 'National Vulnerability Database',
        type: 'nvd',
        url: 'https://nvd.nist.gov/feeds/json/cve/1.1/',
        updateFrequency: 'daily',
        lastUpdate: new Date(),
        status: 'active',
        configuration: {}
      },
      {
        id: 'github-advisories',
        name: 'GitHub Security Advisories',
        type: 'github',
        url: 'https://api.github.com/advisories',
        updateFrequency: 'daily',
        lastUpdate: new Date(),
        status: 'active',
        configuration: {}
      }
    ];

    for (const db of databases) {
      this.vulnerabilityDatabases.set(db.id, db);
    }
  }

  private getDefaultScanner(type: SecurityScan['type']): string {
    const scanners: Record<SecurityScan['type'], string> = {
      'vulnerability': 'trivy',
      'dependency': 'npm-audit',
      'code-quality': 'sonarqube',
      'secrets': 'gitleaks',
      'compliance': 'inspec',
      'infrastructure': 'checkov',
      'container': 'clair'
    };

    return scanners[type] || 'generic';
  }

  private async executeScanEngine(scan: SecurityScan): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    switch (scan.configuration.scanner) {
      case 'trivy':
        return this.executeTrivyScan(scan);
      case 'npm-audit':
        return this.executeNpmAuditScan(scan);
      case 'gitleaks':
        return this.executeGitleaksScan(scan);
      case 'checkov':
        return this.executeCheckovScan(scan);
      default:
        return this.executeGenericScan(scan);
    }
  }

  private async executeTrivyScan(scan: SecurityScan): Promise<SecurityFinding[]> {
    return new Promise((resolve, reject) => {
      const findings: SecurityFinding[] = [];
      
      // Mock Trivy execution
      const mockFindings = [
        {
          id: `finding-${Date.now()}-1`,
          title: 'CVE-2023-12345: Remote Code Execution in libxml2',
          description: 'A buffer overflow vulnerability in libxml2 allows remote code execution',
          severity: 'critical' as const,
          category: 'vulnerability' as const,
          cve: 'CVE-2023-12345',
          cvss: {
            score: 9.8,
            vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            version: '3.1'
          },
          location: {
            file: 'package-lock.json',
            line: 125,
            component: 'libxml2@2.9.10'
          },
          evidence: {
            snippet: '"libxml2": "2.9.10"',
            context: 'Dependency declaration',
            references: ['https://nvd.nist.gov/vuln/detail/CVE-2023-12345']
          },
          impact: 'Remote attackers could execute arbitrary code',
          remediation: {
            description: 'Update libxml2 to version 2.9.14 or later',
            effort: 'low' as const,
            priority: 'critical' as const,
            autoFixable: true,
            steps: ['npm update libxml2'],
            references: ['https://github.com/GNOME/libxml2/releases']
          },
          status: 'open' as const,
          tags: ['cve', 'rce', 'dependency'],
          metadata: {},
          firstSeen: new Date(),
          lastSeen: new Date(),
          occurrences: 1
        }
      ];

      // Simulate scan delay
      setTimeout(() => {
        resolve(mockFindings);
      }, 2000);
    });
  }

  private async executeNpmAuditScan(scan: SecurityScan): Promise<SecurityFinding[]> {
    return new Promise((resolve, reject) => {
      const command = 'npm';
      const args = ['audit', '--json'];
      
      const child = spawn(command, args, {
        cwd: scan.target.path,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        try {
          const auditResult = JSON.parse(stdout);
          const findings = this.parseNpmAuditResults(auditResult);
          resolve(findings);
        } catch (error) {
          reject(new Error(`Failed to parse npm audit results: ${error instanceof Error ? error.message : String(error)}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async executeGitleaksScan(scan: SecurityScan): Promise<SecurityFinding[]> {
    // Mock Gitleaks scan for secrets detection
    return [
      {
        id: `finding-${Date.now()}-2`,
        title: 'Exposed AWS Access Key',
        description: 'AWS access key found in source code',
        severity: 'high' as const,
        category: 'secret' as const,
        location: {
          file: 'config/aws.js',
          line: 12,
          column: 20
        },
        evidence: {
          snippet: 'const accessKey = "AKIA123456789..."',
          context: 'Hardcoded AWS credentials'
        },
        impact: 'Unauthorized access to AWS resources',
        remediation: {
          description: 'Remove hardcoded credentials and use environment variables or IAM roles',
          effort: 'medium' as const,
          priority: 'high' as const,
          autoFixable: false,
          steps: [
            'Remove hardcoded credentials',
            'Use environment variables',
            'Rotate compromised keys'
          ],
          references: ['https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html']
        },
        status: 'open' as const,
        tags: ['secret', 'aws', 'credentials'],
        metadata: {},
        firstSeen: new Date(),
        lastSeen: new Date(),
        occurrences: 1
      }
    ];
  }

  private async executeCheckovScan(scan: SecurityScan): Promise<SecurityFinding[]> {
    // Mock Checkov scan for infrastructure as code
    return [];
  }

  private async executeGenericScan(scan: SecurityScan): Promise<SecurityFinding[]> {
    // Generic scan implementation
    return [];
  }

  private parseNpmAuditResults(auditResult: any): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    
    if (auditResult.vulnerabilities) {
      for (const [packageName, vulnData] of Object.entries(auditResult.vulnerabilities)) {
        const vuln = vulnData as any;
        
        findings.push({
          id: SecureCrypto.generateSecureId('finding', 12),
          title: `${vuln.severity} vulnerability in ${packageName}`,
          description: vuln.title || 'Vulnerability detected',
          severity: vuln.severity as SecuritySeverity,
          category: 'vulnerability',
          cve: vuln.cve,
          location: {
            file: 'package.json',
            component: packageName
          },
          evidence: {
            snippet: `"${packageName}": "${vuln.range}"`,
            references: vuln.url ? [vuln.url] : []
          },
          impact: vuln.overview || 'Security vulnerability',
          remediation: {
            description: vuln.recommendation || 'Update to a secure version',
            effort: 'low' as const,
            priority: (vuln.severity === 'info' ? 'low' : vuln.severity) as 'low' | 'medium' | 'high' | 'critical',
            autoFixable: true,
            steps: [`npm update ${packageName}`],
            references: vuln.url ? [vuln.url] : []
          },
          status: 'open',
          tags: ['npm', 'dependency'],
          metadata: { packageName, range: vuln.range },
          firstSeen: new Date(),
          lastSeen: new Date(),
          occurrences: 1
        });
      }
    }
    
    return findings;
  }

  private calculateScanMetrics(scan: SecurityScan): void {
    const findings = scan.results;
    
    scan.metrics.totalFindings = findings.length;
    scan.metrics.criticalFindings = findings.filter(f => f.severity === 'critical').length;
    scan.metrics.highFindings = findings.filter(f => f.severity === 'high').length;
    scan.metrics.mediumFindings = findings.filter(f => f.severity === 'medium').length;
    scan.metrics.lowFindings = findings.filter(f => f.severity === 'low').length;
    scan.metrics.falsePositives = findings.filter(f => f.status === 'false-positive').length;
    scan.metrics.suppressed = findings.filter(f => f.status === 'suppressed').length;
  }

  private async runComplianceChecks(scan: SecurityScan): Promise<void> {
    // Mock compliance checks
    const frameworks = ['SOC2', 'GDPR', 'PCI-DSS'];
    
    for (const framework of frameworks) {
      const checks = await this.runFrameworkChecks(framework, { projectId: scan.projectId });
      scan.compliance.requirements.push(...checks);
    }
    
    scan.compliance.frameworks = frameworks;
    scan.compliance.passedChecks = scan.compliance.requirements.filter(r => r.status === 'passed').length;
    scan.compliance.failedChecks = scan.compliance.requirements.filter(r => r.status === 'failed').length;
    scan.compliance.overallScore = scan.compliance.requirements.length > 0 ?
      (scan.compliance.passedChecks / scan.compliance.requirements.length) * 100 : 0;
  }

  private async runFrameworkChecks(framework: string, scope?: any): Promise<ComplianceCheck[]> {
    // Mock compliance checks for different frameworks
    const mockChecks: ComplianceCheck[] = [
      {
        id: `check-${Date.now()}-1`,
        framework,
        control: 'CC6.1',
        description: 'Encryption in transit',
        status: 'passed',
        severity: 'high',
        evidence: 'TLS 1.2+ configured',
        lastChecked: new Date()
      },
      {
        id: `check-${Date.now()}-2`,
        framework,
        control: 'CC6.7',
        description: 'Encryption at rest',
        status: 'failed',
        severity: 'medium',
        remediation: 'Enable database encryption',
        lastChecked: new Date()
      }
    ];
    
    return mockChecks;
  }

  private async generateRemediationRecommendations(scan: SecurityScan): Promise<void> {
    const autoFixable = scan.results.filter(f => f.remediation.autoFixable);
    const manualReview = scan.results.filter(f => !f.remediation.autoFixable);
    
    scan.remediation.autoFixAvailable = autoFixable;
    scan.remediation.manualReview = manualReview;
    
    // Generate general recommendations
    scan.remediation.recommendations = [
      {
        id: `rec-${Date.now()}-1`,
        title: 'Implement Automated Dependency Updates',
        description: 'Set up automated dependency updates to reduce vulnerability exposure',
        category: 'vulnerability-management',
        priority: 'high',
        effort: 'medium',
        impact: 'Reduces time to patch vulnerabilities',
        implementation: {
          steps: [
            'Configure Dependabot or Renovate',
            'Set up automated testing pipeline',
            'Enable auto-merge for low-risk updates'
          ],
          tools: ['Dependabot', 'Renovate', 'GitHub Actions'],
          timeEstimate: '2-4 hours',
          cost: 'Free'
        },
        references: [
          'https://docs.github.com/en/code-security/dependabot',
          'https://renovatebot.com/'
        ],
        applicableFrameworks: ['SOC2', 'ISO27001']
      }
    ];
  }

  private async checkNotificationThresholds(scan: SecurityScan): Promise<void> {
    const thresholds = scan.notifications.thresholds;
    
    if (scan.metrics.criticalFindings >= thresholds.critical ||
        scan.metrics.highFindings >= thresholds.high ||
        scan.metrics.mediumFindings >= thresholds.medium) {
      
      await this.sendScanNotification(scan);
    }
  }

  private async sendScanNotification(scan: SecurityScan): Promise<void> {
    const message = `Security scan '${scan.name}' completed with ${scan.metrics.totalFindings} findings (${scan.metrics.criticalFindings} critical, ${scan.metrics.highFindings} high)`;
    
    this.emit('notification:scan', {
      scan,
      message,
      severity: scan.metrics.criticalFindings > 0 ? 'critical' : 
               scan.metrics.highFindings > 0 ? 'high' : 'medium'
    });
    
    this.logger.warn(message);
  }

  private async autoAssignIncident(incident: SecurityIncident): Promise<void> {
    // Auto-assign based on severity and type
    const assignmentRules: Record<string, string[]> = {
      'critical': ['security-lead', 'ciso'],
      'high': ['security-team'],
      'medium': ['security-analyst'],
      'low': ['security-analyst']
    };
    
    incident.response.assignedTo = assignmentRules[incident.severity] || ['security-team'];
  }

  private async sendIncidentNotification(incident: SecurityIncident): Promise<void> {
    const message = `SECURITY INCIDENT: ${incident.title} (${incident.severity.toUpperCase()})`;
    
    this.emit('notification:incident', {
      incident,
      message,
      urgency: incident.severity === 'critical' ? 'immediate' : 'high'
    });
    
    this.logger.error(message);
  }

  private updateIncidentTimeline(incident: SecurityIncident, newStatus: string): void {
    const now = new Date();
    
    switch (newStatus) {
      case 'investigating':
        incident.timeline.acknowledged = now;
        break;
      case 'contained':
        incident.timeline.contained = now;
        break;
      case 'resolved':
        incident.timeline.resolved = now;
        break;
      case 'closed':
        incident.timeline.closed = now;
        break;
    }
  }

  private async saveScan(scan: SecurityScan): Promise<void> {
    const filePath = join(this.securityPath, 'scans', `${scan.id}.json`);
    await writeFile(filePath, JSON.stringify(scan, null, 2));
  }

  private async savePolicy(policy: SecurityPolicy): Promise<void> {
    const filePath = join(this.securityPath, 'policies', `${policy.id}.json`);
    await writeFile(filePath, JSON.stringify(policy, null, 2));
  }

  private async saveIncident(incident: SecurityIncident): Promise<void> {
    const filePath = join(this.securityPath, 'incidents', `${incident.id}.json`);
    await writeFile(filePath, JSON.stringify(incident, null, 2));
  }

  private addAuditEntry(
    target: SecurityScan | SecurityIncident,
    userId: string,
    action: string,
    targetType: string,
    details: Record<string, any>
  ): void {
    const entry: SecurityAuditEntry = {
      id: SecureCrypto.generateSecureId('audit', 12),
      timestamp: new Date(),
      userId,
      action,
      target: targetType,
      details
    };

    target.auditLog.push(entry);
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, number> {
    return array.reduce((groups, item) => {
      const value = String(item[key]);
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  private calculateMTTR(findings: SecurityFinding[]): number {
    const resolvedFindings = findings.filter(f => 
      f.status === 'resolved' && f.firstSeen && f.lastSeen
    );
    
    if (resolvedFindings.length === 0) return 0;
    
    const totalTime = resolvedFindings.reduce((sum, f) => 
      sum + (f.lastSeen.getTime() - f.firstSeen.getTime()), 0
    );
    
    return totalTime / resolvedFindings.length;
  }

  private calculateMTTD(incidents: SecurityIncident[]): number {
    const detectedIncidents = incidents.filter(i => 
      i.timeline.detected && i.timeline.reported
    );
    
    if (detectedIncidents.length === 0) return 0;
    
    const totalTime = detectedIncidents.reduce((sum, i) => 
      sum + (i.timeline.reported.getTime() - i.timeline.detected.getTime()), 0
    );
    
    return totalTime / detectedIncidents.length;
  }

  private calculateMTTResponse(incidents: SecurityIncident[]): number {
    const respondedIncidents = incidents.filter(i => 
      i.timeline.reported && i.timeline.acknowledged
    );
    
    if (respondedIncidents.length === 0) return 0;
    
    const totalTime = respondedIncidents.reduce((sum, i) => 
      sum + (i.timeline.acknowledged.getTime() - i.timeline.reported.getTime()), 0
    );
    
    return totalTime / respondedIncidents.length;
  }

  private calculateIncidentMTTR(incidents: SecurityIncident[]): number {
    const resolvedIncidents = incidents.filter(i => 
      i.timeline.reported && i.timeline.resolved
    );
    
    if (resolvedIncidents.length === 0) return 0;
    
    const totalTime = resolvedIncidents.reduce((sum, i) => 
      sum + (i.timeline.resolved!.getTime() - i.timeline.reported.getTime()), 0
    );
    
    return totalTime / resolvedIncidents.length;
  }
}