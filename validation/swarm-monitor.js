#!/usr/bin/env node

/**
 * Swarm Validation Monitor
 * 
 * Monitors all swarm agents and coordinates validation activities.
 * Provides real-time dashboard and automated validation triggers.
 */

import IncrementalValidator from './incremental-validator.js';
import AgentCompletionHook from './agent-completion-hook.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SwarmMonitor {
  constructor() {
    this.validator = new IncrementalValidator();
    this.hook = new AgentCompletionHook();
    // Note: RegressionTester would need to be imported separately if used
    // this.tester = new RegressionTester();
    
    this.swarmId = 'swarm-development-hierarchical-1751184493913';
    this.memoryDir = path.join(__dirname, '..', 'memory', 'data');
    this.dashboardDir = path.join(__dirname, 'dashboard');
    this.agentStates = new Map();
    this.validationHistory = [];
    
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.dashboardDir)) {
      fs.mkdirSync(this.dashboardDir, { recursive: true });
    }
  }

  /**
   * Start monitoring swarm activities
   */
  async startMonitoring(options = {}) {
    const {
      interval = 30000, // 30 seconds
      enableDashboard = true,
      enableAutoValidation = true,
      enableRegressionTesting = true
    } = options;

    console.log(`\n🔄 Starting swarm monitoring...`);
    console.log(`   Swarm ID: ${this.swarmId}`);
    console.log(`   Interval: ${interval}ms`);
    console.log(`   Dashboard: ${enableDashboard ? 'enabled' : 'disabled'}`);
    console.log(`   Auto Validation: ${enableAutoValidation ? 'enabled' : 'disabled'}`);
    console.log(`   Regression Testing: ${enableRegressionTesting ? 'enabled' : 'disabled'}`);

    // Initial scan
    await this.scanAgentStates();
    
    if (enableDashboard) {
      await this.generateDashboard();
    }

    // Start monitoring loop
    const monitoringInterval = setInterval(async () => {
      try {
        const changes = await this.scanAgentStates();
        
        if (changes.newCompletions.length > 0) {
          console.log(`\n📝 Detected ${changes.newCompletions.length} new agent completions`);
          
          if (enableAutoValidation) {
            await this.handleNewCompletions(changes.newCompletions);
          }
        }
        
        if (enableDashboard) {
          await this.generateDashboard();
        }
        
        // Regression testing every 5 minutes if enabled
        if (enableRegressionTesting && Date.now() % 300000 < interval) {
          await this.scheduleRegressionTesting();
        }
        
      } catch (error) {
        console.error('❌ Monitoring cycle error:', error.message);
      }
    }, interval);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down monitor...');
      clearInterval(monitoringInterval);
      process.exit(0);
    });

    console.log('✅ Monitoring started. Press Ctrl+C to stop.');
  }

  /**
   * Scan for agent state changes
   */
  async scanAgentStates() {
    const previousStates = new Map(this.agentStates);
    const newCompletions = [];
    const updatedAgents = [];

    try {
      // Scan memory files for agent reports
      const memoryFiles = fs.readdirSync(this.memoryDir)
        .filter(file => file.includes(this.swarmId) || file.includes('swarm-development-hierarchical'))
        .map(file => ({
          path: path.join(this.memoryDir, file),
          name: file,
          mtime: fs.statSync(path.join(this.memoryDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of memoryFiles) {
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          const data = JSON.parse(content);
          
          if (data.role || data.agentId || data.agentRole) {
            const agentId = data.agentId || data.role || data.agentRole || 'unknown';
            const status = data.status || 'unknown';
            const timestamp = data.timestamp || file.mtime.toISOString();
            
            const agentKey = `${agentId}-${file.name}`;
            const previousState = previousStates.get(agentKey);
            
            const currentState = {
              agentId,
              status,
              timestamp,
              file: file.name,
              lastModified: file.mtime,
              data
            };
            
            this.agentStates.set(agentKey, currentState);
            
            // Check for new completions
            if (!previousState || 
                previousState.lastModified < file.mtime ||
                (previousState.status !== 'completed' && status === 'completed')) {
              
              newCompletions.push(currentState);
              updatedAgents.push(agentId);
            }
          }
        } catch (e) {
          // Skip invalid JSON files
        }
      }
      
      return {
        newCompletions,
        updatedAgents,
        totalAgents: this.agentStates.size
      };
      
    } catch (error) {
      console.error('❌ Error scanning agent states:', error.message);
      return { newCompletions: [], updatedAgents: [], totalAgents: 0 };
    }
  }

  /**
   * Handle new agent completions
   */
  async handleNewCompletions(completions) {
    for (const completion of completions) {
      console.log(`🔄 Processing completion from ${completion.agentId}`);
      
      try {
        // Extract work description from agent data
        const workDescription = this.extractWorkDescription(completion.data);
        const priority = this.determinePriority(completion.data);
        const expectedImpact = this.determineImpact(completion.data);
        
        // Trigger validation hook
        const agentInfo = {
          agentId: completion.agentId,
          role: completion.data.role || completion.data.agentRole || 'Unknown',
          workDescription,
          priority,
          expectedImpact,
          filesModified: completion.data.files_modified || []
        };
        
        const validationResults = await this.hook.onAgentComplete(agentInfo);
        
        if (validationResults) {
          this.validationHistory.push({
            timestamp: new Date().toISOString(),
            agentId: completion.agentId,
            results: validationResults
          });
          
          // Check for critical issues
          if (this.hasCriticalIssues(validationResults)) {
            await this.handleCriticalIssues(completion, validationResults);
          }
        }
        
      } catch (error) {
        console.error(`❌ Error processing completion from ${completion.agentId}:`, error.message);
      }
    }
  }

  /**
   * Extract work description from agent data
   */
  extractWorkDescription(data) {
    return data.task || 
           data.workDescription || 
           data.description || 
           data.summary || 
           'Work completed';
  }

  /**
   * Determine priority based on agent data
   */
  determinePriority(data) {
    if (data.priority) return data.priority;
    
    // Infer priority from role and work type
    const role = (data.role || data.agentRole || '').toLowerCase();
    
    if (role.includes('critical') || role.includes('security')) return 'high';
    if (role.includes('core') || role.includes('infrastructure')) return 'high';
    if (role.includes('test') || role.includes('validation')) return 'medium';
    
    return 'medium';
  }

  /**
   * Determine impact based on agent data
   */
  determineImpact(data) {
    if (data.expectedImpact || data.impact) return data.expectedImpact || data.impact;
    
    const filesModified = data.files_modified || data.filesModified || [];
    if (filesModified.length > 20) return 'high';
    if (filesModified.length > 10) return 'medium';
    
    return 'low';
  }

  /**
   * Check for critical issues in validation results
   */
  hasCriticalIssues(results) {
    const { validations } = results;
    
    // Critical TypeScript errors
    if (validations.typescript?.errorCount > 150) return true;
    
    // Build failures
    if (validations.build?.status === 'failed') return true;
    
    // Test failures with high error counts
    if (validations.tests?.status === 'failed' && 
        validations.tests?.error?.includes('timeout')) return true;
    
    return false;
  }

  /**
   * Handle critical issues
   */
  async handleCriticalIssues(completion, validationResults) {
    console.log(`🚨 CRITICAL ISSUES detected from ${completion.agentId}`);
    
    const alertFile = path.join(this.dashboardDir, `critical-alert-${Date.now()}.json`);
    
    const alert = {
      timestamp: new Date().toISOString(),
      severity: 'critical',
      agent: completion.agentId,
      issues: validationResults.validations,
      recommendations: [
        'Immediate attention required',
        'Consider reverting recent changes if issues persist',
        'Coordinate with affected agent for resolution',
        'Run regression tests to assess full impact'
      ]
    };
    
    fs.writeFileSync(alertFile, JSON.stringify(alert, null, 2));
    
    // Also trigger immediate regression testing (temporarily disabled)
    try {
      // await this.tester.runRegressionTests({
      //   trigger: 'critical-alert',
      //   agent: completion.agentId
      // });
      console.log('🧪 Regression testing would be triggered here');
    } catch (error) {
      console.error('❌ Failed to run critical regression tests:', error.message);
    }
  }

  /**
   * Schedule regression testing
   */
  async scheduleRegressionTesting() {
    console.log('🧪 Running scheduled regression tests...');
    
    try {
      // const results = await this.tester.runRegressionTests({
      //   trigger: 'scheduled',
      //   timestamp: new Date().toISOString()
      // });
      
      // if (results.baseline_comparison?.regression_detected) {
      //   console.log('⚠️ Regression detected in scheduled testing!');
      //   await this.handleRegressionDetection(results);
      // }
      
      console.log('🧪 Scheduled regression testing would run here');
      
    } catch (error) {
      console.error('❌ Scheduled regression testing failed:', error.message);
    }
  }

  /**
   * Handle regression detection
   */
  async handleRegressionDetection(results) {
    const regressionFile = path.join(this.dashboardDir, `regression-alert-${Date.now()}.json`);
    
    const alert = {
      timestamp: new Date().toISOString(),
      type: 'regression',
      severity: 'high',
      regression_details: results.baseline_comparison,
      test_results: results.summary,
      recommendations: [
        'Review recent agent changes',
        'Identify root cause of regression',
        'Coordinate with relevant agents for fixes',
        'Consider creating rollback plan'
      ]
    };
    
    fs.writeFileSync(regressionFile, JSON.stringify(alert, null, 2));
  }

  /**
   * Generate monitoring dashboard
   */
  async generateDashboard() {
    const timestamp = new Date().toISOString();
    
    // Get current validation state
    let currentValidation = null;
    try {
      currentValidation = await this.validator.validateIncremental('dashboard', 'Dashboard update');
    } catch (error) {
      console.error('❌ Dashboard validation failed:', error.message);
    }
    
    const dashboard = {
      timestamp,
      swarm_id: this.swarmId,
      agent_states: this.getAgentStateSummary(),
      system_health: this.getSystemHealthSummary(currentValidation),
      validation_history: this.validationHistory.slice(-10),
      recent_activity: this.getRecentActivity(),
      alerts: this.getActiveAlerts()
    };
    
    // Save JSON dashboard
    const dashboardFile = path.join(this.dashboardDir, 'current-dashboard.json');
    fs.writeFileSync(dashboardFile, JSON.stringify(dashboard, null, 2));
    
    // Generate HTML dashboard
    const htmlDashboard = this.generateHTMLDashboard(dashboard);
    const htmlFile = path.join(this.dashboardDir, 'dashboard.html');
    fs.writeFileSync(htmlFile, htmlDashboard);
    
    console.log(`📊 Dashboard updated: ${htmlFile}`);
  }

  /**
   * Get agent state summary
   */
  getAgentStateSummary() {
    const summary = {
      total_agents: this.agentStates.size,
      agents_by_status: {},
      agents_by_role: {},
      recent_completions: 0
    };
    
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    for (const [key, state] of this.agentStates) {
      // Count by status
      summary.agents_by_status[state.status] = (summary.agents_by_status[state.status] || 0) + 1;
      
      // Count by role
      const role = state.data.role || state.data.agentRole || 'unknown';
      summary.agents_by_role[role] = (summary.agents_by_role[role] || 0) + 1;
      
      // Count recent completions
      if (state.lastModified > oneHourAgo) {
        summary.recent_completions++;
      }
    }
    
    return summary;
  }

  /**
   * Get system health summary
   */
  getSystemHealthSummary(validationResults) {
    if (!validationResults) {
      return { status: 'unknown', message: 'Validation data unavailable' };
    }
    
    const { validations } = validationResults;
    const issues = [];
    
    if (validations.typescript?.errorCount > 0) {
      issues.push(`${validations.typescript.errorCount} TypeScript errors`);
    }
    
    if (validations.build?.status === 'failed') {
      issues.push('Build failing');
    }
    
    if (validations.tests?.status === 'failed') {
      issues.push('Tests failing');
    }
    
    if (issues.length === 0) {
      return { status: 'healthy', message: 'All systems operational' };
    } else if (issues.length <= 2) {
      return { status: 'warning', message: issues.join(', ') };
    } else {
      return { status: 'critical', message: `Multiple issues: ${issues.join(', ')}` };
    }
  }

  /**
   * Get recent activity
   */
  getRecentActivity() {
    const activities = [];
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    for (const [key, state] of this.agentStates) {
      if (state.lastModified > oneHourAgo) {
        activities.push({
          timestamp: state.timestamp,
          agent: state.agentId,
          status: state.status,
          activity: `${state.agentId} ${state.status}`
        });
      }
    }
    
    return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    const alerts = [];
    
    try {
      const alertFiles = fs.readdirSync(this.dashboardDir)
        .filter(file => file.includes('alert') && file.endsWith('.json'))
        .map(file => ({
          path: path.join(this.dashboardDir, file),
          mtime: fs.statSync(path.join(this.dashboardDir, file)).mtime
        }))
        .filter(file => file.mtime > new Date(Date.now() - 3600000)) // Last hour
        .sort((a, b) => b.mtime - a.mtime);
      
      for (const file of alertFiles.slice(0, 5)) {
        try {
          const alert = JSON.parse(fs.readFileSync(file.path, 'utf8'));
          alerts.push(alert);
        } catch (e) {
          // Skip invalid files
        }
      }
    } catch (error) {
      // No alerts directory or files
    }
    
    return alerts;
  }

  /**
   * Generate HTML dashboard
   */
  generateHTMLDashboard(data) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swarm Validation Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .card { background: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .status-healthy { color: #27ae60; }
        .status-warning { color: #f39c12; }
        .status-critical { color: #e74c3c; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .agents-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .agent-card { background: #ecf0f1; padding: 10px; border-radius: 3px; text-align: center; }
        .metric { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .alert { background: #ffebee; border-left: 4px solid #e74c3c; padding: 15px; margin-bottom: 10px; }
        .activity { border-left: 3px solid #3498db; padding: 10px; margin-bottom: 10px; background: #f8f9fa; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #34495e; color: white; }
        .timestamp { font-size: 0.9em; color: #666; }
    </style>
    <script>
        function refreshDashboard() {
            location.reload();
        }
        setInterval(refreshDashboard, 30000); // Refresh every 30 seconds
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔄 Swarm Validation Dashboard</h1>
            <p>Swarm ID: ${data.swarm_id}</p>
            <p class="timestamp">Last Updated: ${data.timestamp}</p>
        </div>

        <div class="grid">
            <div class="card">
                <h2>🏥 System Health</h2>
                <div class="metric status-${data.system_health.status}">
                    ${data.system_health.status.toUpperCase()}
                </div>
                <p>${data.system_health.message}</p>
            </div>

            <div class="card">
                <h2>👥 Agent Summary</h2>
                <div class="agents-grid">
                    <div class="agent-card">
                        <div class="metric">${data.agent_states.total_agents}</div>
                        <div>Total Agents</div>
                    </div>
                    <div class="agent-card">
                        <div class="metric">${data.agent_states.recent_completions}</div>
                        <div>Recent Activity</div>
                    </div>
                </div>
            </div>
        </div>

        ${data.alerts.length > 0 ? `
        <div class="card">
            <h2>🚨 Active Alerts</h2>
            ${data.alerts.map(alert => `
                <div class="alert">
                    <strong>${alert.severity.toUpperCase()}</strong> - ${alert.type || 'Alert'}
                    <p>${alert.recommendations ? alert.recommendations[0] : 'No details available'}</p>
                    <span class="timestamp">${alert.timestamp}</span>
                </div>
            `).join('')}
        </div>
        ` : ''}

        <div class="grid">
            <div class="card">
                <h2>📊 Agent Status</h2>
                <table>
                    <tr><th>Status</th><th>Count</th></tr>
                    ${Object.entries(data.agent_states.agents_by_status).map(([status, count]) => 
                        `<tr><td>${status}</td><td>${count}</td></tr>`
                    ).join('')}
                </table>
            </div>

            <div class="card">
                <h2>🎭 Agent Roles</h2>
                <table>
                    <tr><th>Role</th><th>Count</th></tr>
                    ${Object.entries(data.agent_states.agents_by_role).map(([role, count]) => 
                        `<tr><td>${role}</td><td>${count}</td></tr>`
                    ).join('')}
                </table>
            </div>
        </div>

        <div class="card">
            <h2>📈 Recent Activity</h2>
            ${data.recent_activity.map(activity => `
                <div class="activity">
                    <strong>${activity.agent}</strong> - ${activity.status}
                    <span class="timestamp">${activity.timestamp}</span>
                </div>
            `).join('')}
        </div>

        <div class="card">
            <h2>🔍 Validation History</h2>
            <table>
                <tr><th>Timestamp</th><th>Agent</th><th>TypeScript Errors</th><th>Build</th><th>Tests</th></tr>
                ${data.validation_history.map(validation => `
                    <tr>
                        <td class="timestamp">${validation.timestamp}</td>
                        <td>${validation.agentId}</td>
                        <td>${validation.results.validations?.typescript?.errorCount || 'N/A'}</td>
                        <td>${validation.results.validations?.build?.status || 'N/A'}</td>
                        <td>${validation.results.validations?.tests?.status || 'N/A'}</td>
                    </tr>
                `).join('')}
            </table>
        </div>
    </div>
</body>
</html>`;
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new SwarmMonitor();
  
  const command = process.argv[2] || 'start';
  
  switch (command) {
    case 'start':
      const options = {
        interval: parseInt(process.argv[3]) || 30000,
        enableDashboard: process.argv.includes('--no-dashboard') ? false : true,
        enableAutoValidation: process.argv.includes('--no-validation') ? false : true,
        enableRegressionTesting: process.argv.includes('--no-regression') ? false : true
      };
      
      monitor.startMonitoring(options);
      break;
      
    case 'dashboard':
      monitor.generateDashboard()
        .then(() => {
          console.log('✅ Dashboard generated');
          process.exit(0);
        })
        .catch(err => {
          console.error('❌ Dashboard generation failed:', err.message);
          process.exit(1);
        });
      break;
      
    case 'scan':
      monitor.scanAgentStates()
        .then(results => {
          console.log('Agent scan results:', results);
          process.exit(0);
        })
        .catch(err => {
          console.error('❌ Agent scan failed:', err.message);
          process.exit(1);
        });
      break;
      
    default:
      console.log(`
Usage:
  node swarm-monitor.js start [interval] [--no-dashboard] [--no-validation] [--no-regression]
  node swarm-monitor.js dashboard
  node swarm-monitor.js scan

Examples:
  node swarm-monitor.js start 15000
  node swarm-monitor.js start --no-regression
  node swarm-monitor.js dashboard
`);
      process.exit(1);
  }
}

export default SwarmMonitor;