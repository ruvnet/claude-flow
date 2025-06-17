/**
 * Test file demonstrating the Monitor agent role
 * 
 * The Monitor agent tracks system health, performance metrics,
 * and ensures continuous operation of services.
 */

import { AgentType } from '../../src/swarm/types';

// Monitor Agent Test
export class MonitorTest {
  agentType = AgentType.monitor;
  
  /**
   * Demonstrates monitor's primary role: system health monitoring
   */
  async monitorSystemHealth() {
    console.log('🏥 Monitor: Checking system health...');
    
    // Simulate health checks
    const healthChecks = [
      { service: 'API Server', status: 'healthy', responseTime: '45ms' },
      { service: 'Database', status: 'healthy', responseTime: '12ms' },
      { service: 'Cache Server', status: 'degraded', responseTime: '180ms', issue: 'High memory usage' },
      { service: 'Message Queue', status: 'healthy', responseTime: '8ms' },
      { service: 'File Storage', status: 'healthy', responseTime: '25ms' }
    ];
    
    healthChecks.forEach(check => {
      const icon = check.status === 'healthy' ? '✅' : check.status === 'degraded' ? '⚠️' : '❌';
      console.log(`${icon} Monitor: ${check.service} - ${check.status} (${check.responseTime})`, check.issue || '');
    });
    
    const healthyServices = healthChecks.filter(c => c.status === 'healthy').length;
    const overallHealth = (healthyServices / healthChecks.length) * 100;
    
    console.log(`📊 Monitor: Overall system health: ${overallHealth}%`);
    
    return {
      role: 'monitor',
      capability: 'healthMonitoring',
      servicesChecked: healthChecks.length,
      healthyServices,
      overallHealth,
      alerts: healthChecks.filter(c => c.status !== 'healthy'),
      checks: healthChecks
    };
  }
  
  /**
   * Demonstrates monitor's performance tracking
   */
  async trackPerformanceMetrics() {
    console.log('📈 Monitor: Collecting performance metrics...');
    
    console.log('💻 Monitor: CPU usage monitoring...');
    console.log('🧠 Monitor: Memory usage tracking...');
    console.log('💾 Monitor: Disk I/O analysis...');
    console.log('🌐 Monitor: Network throughput measurement...');
    
    const performanceData = {
      timestamp: new Date().toISOString(),
      metrics: {
        cpu: {
          usage: 45.2,
          cores: 8,
          loadAverage: [2.1, 2.5, 2.3]
        },
        memory: {
          used: 6.2,
          total: 16,
          percentage: 38.75,
          swap: { used: 0.5, total: 4 }
        },
        disk: {
          readSpeed: '125 MB/s',
          writeSpeed: '98 MB/s',
          iops: 1250,
          usage: { used: 250, total: 500, percentage: 50 }
        },
        network: {
          incoming: '25 Mbps',
          outgoing: '18 Mbps',
          connections: 1543,
          errors: 0
        }
      },
      alerts: [
        { type: 'warning', metric: 'disk_usage', message: 'Disk usage at 50%, consider cleanup' }
      ]
    };
    
    console.log('✅ Monitor: Performance metrics collected');
    
    return {
      role: 'monitor',
      capability: 'performanceTracking',
      metricsCollected: Object.keys(performanceData.metrics).length,
      alertsGenerated: performanceData.alerts.length,
      data: performanceData
    };
  }
  
  /**
   * Demonstrates monitor's error tracking and alerting
   */
  async trackErrorsAndAlerts() {
    console.log('🚨 Monitor: Monitoring errors and alerts...');
    
    console.log('📋 Monitor: Checking application logs...');
    console.log('⚠️ Monitor: Analyzing error patterns...');
    console.log('📊 Monitor: Calculating error rates...');
    
    const errorTracking = {
      period: 'last_hour',
      summary: {
        totalRequests: 15420,
        totalErrors: 23,
        errorRate: 0.149,
        criticalErrors: 2,
        warnings: 8,
        info: 13
      },
      topErrors: [
        {
          type: 'DatabaseConnectionError',
          count: 5,
          lastOccurred: '2024-01-20T14:45:00Z',
          severity: 'critical',
          pattern: 'Spike during high load'
        },
        {
          type: 'AuthenticationFailure',
          count: 12,
          lastOccurred: '2024-01-20T14:58:00Z',
          severity: 'warning',
          pattern: 'Repeated attempts from same IP'
        },
        {
          type: 'ValidationError',
          count: 6,
          lastOccurred: '2024-01-20T14:52:00Z',
          severity: 'info',
          pattern: 'User input related'
        }
      ],
      alerts: [
        {
          severity: 'high',
          message: 'Database connection errors increasing',
          action: 'Check database server health'
        },
        {
          severity: 'medium',
          message: 'Potential brute force attack detected',
          action: 'Review authentication logs for IP: 192.168.1.100'
        }
      ]
    };
    
    console.log(`📉 Monitor: Error rate: ${errorTracking.summary.errorRate}%`);
    console.log(`🚨 Monitor: Generated ${errorTracking.alerts.length} alerts`);
    
    return {
      role: 'monitor',
      capability: 'errorTracking',
      period: errorTracking.period,
      errorRate: errorTracking.summary.errorRate,
      criticalErrors: errorTracking.summary.criticalErrors,
      alertsGenerated: errorTracking.alerts.length,
      tracking: errorTracking
    };
  }
  
  /**
   * Demonstrates monitor's uptime tracking
   */
  async trackUptime() {
    console.log('⏱️ Monitor: Calculating service uptime...');
    
    const uptimeData = {
      services: [
        { name: 'API Server', uptime: 99.95, lastRestart: '30 days ago' },
        { name: 'Database', uptime: 99.99, lastRestart: '45 days ago' },
        { name: 'Cache Server', uptime: 98.5, lastRestart: '2 days ago' },
        { name: 'Web Server', uptime: 99.9, lastRestart: '15 days ago' }
      ],
      overall: {
        systemUptime: 99.84,
        totalDowntime: '23 minutes',
        period: '30 days',
        sla: { target: 99.9, status: 'not_met' }
      }
    };
    
    uptimeData.services.forEach(service => {
      console.log(`⏰ Monitor: ${service.name} uptime: ${service.uptime}% (last restart: ${service.lastRestart})`);
    });
    
    return {
      role: 'monitor',
      capability: 'uptimeTracking',
      servicesMonitored: uptimeData.services.length,
      overallUptime: uptimeData.overall.systemUptime,
      slaStatus: uptimeData.overall.sla.status,
      data: uptimeData
    };
  }
}

// Test execution
if (require.main === module) {
  const monitor = new MonitorTest();
  
  console.log('=== Monitor Agent Test ===\n');
  
  monitor.monitorSystemHealth().then(result => {
    console.log('\nSystem Health Result:', JSON.stringify(result, null, 2));
    
    return monitor.trackPerformanceMetrics();
  }).then(result => {
    console.log('\nPerformance Metrics Result:', JSON.stringify(result, null, 2));
    
    return monitor.trackErrorsAndAlerts();
  }).then(result => {
    console.log('\nError Tracking Result:', JSON.stringify(result, null, 2));
    
    return monitor.trackUptime();
  }).then(result => {
    console.log('\nUptime Tracking Result:', JSON.stringify(result, null, 2));
  });
}