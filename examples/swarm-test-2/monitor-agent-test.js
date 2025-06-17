/**
 * Monitor Agent Test
 * Role: Monitors system health, performance, and alerts on issues
 */

const monitorAgentTest = {
  name: 'Monitor Agent',
  role: 'System Monitoring and Alerting',
  capabilities: ['monitoring', 'alerting', 'performance-tracking', 'diagnostics'],
  
  // Example task: Monitor application health
  demonstrateRole: () => {
    console.log('=== Monitor Agent Test ===');
    console.log('Role: I monitor systems and alert on issues');
    
    const monitoringTask = {
      system: 'E-commerce Application',
      metrics: {
        uptime: { value: 99.95, unit: '%', status: 'healthy' },
        responseTime: { value: 312, unit: 'ms', status: 'warning', threshold: 300 },
        errorRate: { value: 0.8, unit: '%', status: 'healthy', threshold: 2 },
        cpuUsage: { value: 78, unit: '%', status: 'warning', threshold: 75 },
        memoryUsage: { value: 62, unit: '%', status: 'healthy', threshold: 80 },
        diskSpace: { value: 85, unit: '%', status: 'critical', threshold: 80 }
      },
      alerts: [
        {
          level: 'WARNING',
          metric: 'Response Time',
          message: 'Average response time (312ms) exceeds threshold (300ms)',
          timestamp: '2024-01-15 14:23:45'
        },
        {
          level: 'CRITICAL',
          metric: 'Disk Space',
          message: 'Disk usage (85%) exceeds critical threshold (80%)',
          timestamp: '2024-01-15 14:25:12'
        }
      ],
      diagnostics: {
        responseTimeIssue: 'Database queries taking longer than usual',
        diskSpaceIssue: 'Log files growing rapidly, rotation needed'
      },
      recommendations: [
        'Optimize database queries to reduce response time',
        'Implement log rotation policy',
        'Scale horizontally to handle CPU load',
        'Set up automated cleanup for old files'
      ]
    };
    
    console.log('Monitoring System:', monitoringTask.system);
    console.log('\nCurrent Metrics:');
    Object.entries(monitoringTask.metrics).forEach(([metric, data]) => {
      const statusIcon = data.status === 'healthy' ? '✓' : 
                        data.status === 'warning' ? '⚠' : '✗';
      console.log(`  ${statusIcon} ${metric}: ${data.value}${data.unit} (status: ${data.status})`);
    });
    console.log('\nActive Alerts:');
    monitoringTask.alerts.forEach(alert => {
      console.log(`  [${alert.level}] ${alert.metric}: ${alert.message}`);
      console.log(`    Timestamp: ${alert.timestamp}`);
    });
    console.log('\nDiagnostics:');
    Object.entries(monitoringTask.diagnostics).forEach(([issue, diagnosis]) => {
      console.log(`  ${issue}: ${diagnosis}`);
    });
    console.log('\nRecommendations:');
    monitoringTask.recommendations.forEach(rec => console.log(`  • ${rec}`));
  },
  
  // Example monitoring workflow
  monitoringWorkflow: () => {
    const workflow = [
      'Continuously collect system metrics',
      'Compare metrics against thresholds',
      'Detect anomalies and patterns',
      'Generate alerts for critical issues',
      'Perform root cause analysis',
      'Create diagnostic reports',
      'Notify relevant agents/teams',
      'Track resolution progress'
    ];
    
    console.log('\nMonitoring Workflow:');
    workflow.forEach((step, index) => {
      console.log(`${index + 1}. ${step}`);
    });
  }
};

// Run the test
monitorAgentTest.demonstrateRole();
monitorAgentTest.monitoringWorkflow();

module.exports = monitorAgentTest;