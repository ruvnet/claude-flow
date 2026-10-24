#!/usr/bin/env ts-node

/**
 * Monitor Agent Test - Designed for parallel execution
 * This agent monitors system health and performance
 */

export class MonitorAgent {
  private agentId: string;
  private startTime: number;

  constructor(id: string = 'monitor-001') {
    this.agentId = id;
    this.startTime = Date.now();
  }

  async monitorSystemHealth(): Promise<any> {
    console.log(`[${this.agentId}] Monitoring system health...`);
    
    await this.simulateWork(500);
    
    const health = {
      overallHealth: Math.floor(Math.random() * 20) + 80,
      services: {
        api: { status: 'healthy', uptime: '99.95%', responseTime: '145ms' },
        database: { status: 'healthy', connections: 42, queryTime: '23ms' },
        cache: { status: 'healthy', hitRate: '87%', memory: '2.3GB' },
        queue: { status: 'warning', pending: 1523, processing: 87 }
      },
      alerts: [
        { level: 'warning', service: 'queue', message: 'High queue depth detected' },
        { level: 'info', service: 'cache', message: 'Cache eviction rate increasing' }
      ],
      resources: {
        cpu: { usage: '45%', cores: 8, loadAvg: [2.3, 2.1, 1.9] },
        memory: { used: '12.4GB', total: '32GB', percentage: '38.75%' },
        disk: { used: '245GB', total: '500GB', percentage: '49%' },
        network: { in: '125 Mbps', out: '87 Mbps', connections: 3421 }
      }
    };
    
    console.log(`[${this.agentId}] Health monitoring completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
      health
    };
  }

  async trackPerformanceMetrics(): Promise<any> {
    console.log(`[${this.agentId}] Tracking performance metrics...`);
    
    await this.simulateWork(700);
    
    const performance = {
      api: {
        requestsPerSecond: Math.floor(Math.random() * 500) + 800,
        avgResponseTime: Math.floor(Math.random() * 100) + 100,
        errorRate: (Math.random() * 2).toFixed(2) + '%',
        throughput: Math.floor(Math.random() * 50) + 100 + ' MB/s'
      },
      database: {
        queriesPerSecond: Math.floor(Math.random() * 1000) + 2000,
        avgQueryTime: Math.floor(Math.random() * 30) + 10 + 'ms',
        connectionPoolUsage: Math.floor(Math.random() * 30) + 60 + '%',
        slowQueries: Math.floor(Math.random() * 10)
      },
      cache: {
        hitRate: Math.floor(Math.random() * 20) + 80 + '%',
        missRate: Math.floor(Math.random() * 20) + '%',
        evictionRate: Math.floor(Math.random() * 100) + ' items/min',
        memoryUsage: (Math.random() * 2 + 1).toFixed(1) + 'GB'
      },
      trends: {
        trafficTrend: 'increasing',
        performanceTrend: 'stable',
        errorTrend: 'decreasing'
      }
    };
    
    console.log(`[${this.agentId}] Performance tracking completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      metrics: performance
    };
  }

  async trackErrorsAndAlerts(): Promise<any> {
    console.log(`[${this.agentId}] Tracking errors and alerts...`);
    
    await this.simulateWork(600);
    
    const errorTracking = {
      last24Hours: {
        total: Math.floor(Math.random() * 200) + 50,
        byType: {
          '4xx': Math.floor(Math.random() * 100) + 20,
          '5xx': Math.floor(Math.random() * 30) + 5,
          timeout: Math.floor(Math.random() * 20),
          database: Math.floor(Math.random() * 10)
        }
      },
      topErrors: [
        { code: 401, count: 45, endpoint: '/api/auth/validate' },
        { code: 429, count: 32, endpoint: '/api/users/search' },
        { code: 500, count: 8, endpoint: '/api/payment/process' }
      ],
      alerts: {
        critical: 0,
        high: 1,
        medium: 3,
        low: 7
      },
      anomalies: [
        'Spike in 401 errors from IP range 192.168.x.x',
        'Unusual pattern in database query times',
        'Memory usage trending upward'
      ]
    };
    
    console.log(`[${this.agentId}] Error tracking completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      errors: errorTracking
    };
  }

  async trackUptime(): Promise<any> {
    console.log(`[${this.agentId}] Tracking system uptime...`);
    
    await this.simulateWork(300);
    
    const uptime = {
      current: {
        days: Math.floor(Math.random() * 30) + 60,
        hours: Math.floor(Math.random() * 24),
        minutes: Math.floor(Math.random() * 60)
      },
      sla: {
        target: '99.9%',
        actual: '99.95%',
        meetingSLA: true
      },
      downtime: {
        plannedMinutes: 45,
        unplannedMinutes: 12,
        totalMinutes: 57
      },
      history: [
        { month: 'Current', uptime: '99.95%' },
        { month: 'Last Month', uptime: '99.92%' },
        { month: '2 Months Ago', uptime: '99.98%' }
      ],
      incidents: [
        { date: '2024-01-15', duration: '12 min', cause: 'Database failover' }
      ]
    };
    
    console.log(`[${this.agentId}] Uptime tracking completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      uptime
    };
  }

  async generateHealthReport(): Promise<any> {
    console.log(`[${this.agentId}] Generating comprehensive health report...`);
    
    await this.simulateWork(1000);
    
    const report = {
      reportId: `HR-${Date.now()}`,
      period: 'Last 24 hours',
      summary: {
        overallScore: 92,
        status: 'Healthy with minor issues',
        trend: 'Improving'
      },
      keyMetrics: {
        availability: '99.95%',
        performance: '94/100',
        errorRate: '0.8%',
        userSatisfaction: '4.2/5'
      },
      recommendations: [
        'Scale queue workers to handle increased load',
        'Optimize slow database queries identified',
        'Update cache eviction policy',
        'Review and update alert thresholds'
      ],
      actionItems: [
        { priority: 'High', action: 'Investigate queue depth increase' },
        { priority: 'Medium', action: 'Optimize top 5 slow queries' },
        { priority: 'Low', action: 'Update monitoring dashboards' }
      ]
    };
    
    console.log(`[${this.agentId}] Health report generated`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      report
    };
  }

  private async simulateWork(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Allow direct execution
if (require.main === module) {
  const monitor = new MonitorAgent();
  
  Promise.all([
    monitor.monitorSystemHealth(),
    monitor.trackPerformanceMetrics(),
    monitor.trackErrorsAndAlerts(),
    monitor.trackUptime(),
    monitor.generateHealthReport()
  ]).then(results => {
    console.log('\nMonitor Agent Results:', JSON.stringify(results, null, 2));
  });
}