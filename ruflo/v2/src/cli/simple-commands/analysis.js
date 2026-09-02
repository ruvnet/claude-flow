import {
  printSuccess,
  printError,
  printWarning,
  callRuvSwarmMCP,
  checkRuvSwarmAvailable,
} from '../utils.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  initializeMetrics,
  getPerformanceReport,
  getBottleneckAnalysis,
  exportMetrics
} from './performance-metrics.js';
import {
  getRealTokenUsage,
  calculateCost,
  generateOptimizationSuggestions,
  generateTokenUsageReport,
  getAgentIcon,
  trackTokens
} from './token-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function setupTelemetry() {
  console.log(`\n🔧 TELEMETRY SETUP FOR TOKEN TRACKING\n`);
  console.log(`${'═'.repeat(60)}\n`);
  
  // Check current status
  const currentValue = process.env.CLAUDE_CODE_ENABLE_TELEMETRY;
  const isEnabled = currentValue === '1';
  
  console.log(`📊 Current Status: ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`   Environment Variable: CLAUDE_CODE_ENABLE_TELEMETRY=${currentValue || 'not set'}\n`);
  
  if (!isEnabled) {
    // Set the environment variable for current session
    process.env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
    
    console.log(`✅ Telemetry ENABLED for this session!\n`);
    
    // Create or update .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch (err) {
      // .env doesn't exist yet
    }
    
    // Check if telemetry is already in .env
    if (!envContent.includes('CLAUDE_CODE_ENABLE_TELEMETRY')) {
      envContent += `\n# Enable token tracking for Claude API calls\nCLAUDE_CODE_ENABLE_TELEMETRY=1\n`;
      
      try {
        await fs.writeFile(envPath, envContent);
        console.log(`📝 Updated .env file with telemetry setting`);
      } catch (err) {
        console.log(`⚠️  Could not update .env file: ${err.message}`);
      }
    }
    
    // Also add to shell profile for persistence
    console.log(`\n📌 To make this permanent, add to your shell profile:`);
    console.log(`   ${'-'.repeat(50)}`);
    console.log(`   echo 'export CLAUDE_CODE_ENABLE_TELEMETRY=1' >> ~/.bashrc`);
    console.log(`   ${'-'.repeat(50)}\n`);
  }
  
  // Initialize token tracking directory
  const metricsDir = path.join(process.cwd(), '.claude-flow', 'metrics');
  try {
    await fs.mkdir(metricsDir, { recursive: true });
    console.log(`📁 Token tracking directory: ${metricsDir}`);
  } catch (err) {
    // Directory already exists
  }
  
  // Check for existing token data
  const tokenFile = path.join(metricsDir, 'token-usage.json');
  try {
    const data = await fs.readFile(tokenFile, 'utf-8');
    const tokenData = JSON.parse(data);
    console.log(`\n📊 Existing token data found:`);
    console.log(`   • Total tokens tracked: ${tokenData.totals?.total || 0}`);
    console.log(`   • Sessions recorded: ${Object.keys(tokenData.sessions || {}).length}`);
  } catch (err) {
    console.log(`\n📊 No existing token data (will be created on first use)`);
  }
  
  console.log(`\n🚀 NEXT STEPS:`);
  console.log(`   1. Run Claude commands with --claude flag`);
  console.log(`   2. Example: ./claude-flow swarm "analyze code" --claude`);
  console.log(`   3. Check usage: ./claude-flow analysis token-usage --breakdown`);
  
  console.log(`\n${'═'.repeat(60)}`);
  printSuccess(`Telemetry setup complete!`);
}

export async function analysisAction(subArgs, flags) {
  const subcommand = subArgs[0];
  const options = flags;

  if (options.help || options.h || !subcommand) {
    showAnalysisHelp();
    return;
  }

  // Handle telemetry setup
  if (subcommand === 'setup-telemetry' || options['enable-telemetry']) {
    await setupTelemetry();
    if (subcommand === 'setup-telemetry') return;
  }

  try {
    switch (subcommand) {
      case 'bottleneck-detect':
        await bottleneckDetectCommand(subArgs, flags);
        break;
      case 'performance-report':
        await performanceReportCommand(subArgs, flags);
        break;
      case 'token-usage':
        await tokenUsageCommand(subArgs, flags);
        break;
      case 'claude-monitor':
        await claudeMonitorCommand(subArgs, flags);
        break;
      case 'claude-cost':
        await claudeCostCommand(subArgs, flags);
        break;
      default:
        printError(`Unknown analysis command: ${subcommand}`);
        showAnalysisHelp();
    }
  } catch (err) {
    printError(`Analysis command failed: ${err.message}`);
  }
}

async function bottleneckDetectCommand(subArgs, flags) {
  const options = flags;
  const scope = options.scope || 'system';
  const target = options.target || 'all';

  console.log(`🔍 Detecting performance bottlenecks...`);
  console.log(`📊 Scope: ${scope}`);
  console.log(`🎯 Target: ${target}`);

  try {
    // Initialize metrics system without starting monitoring
    await initializeMetrics(false);
    
    // Get real bottleneck analysis
    const analysis = await getBottleneckAnalysis(scope, target);
    
    printSuccess(`✅ Bottleneck analysis completed`);

    console.log(`\n📊 BOTTLENECK ANALYSIS RESULTS:`);
    
    analysis.bottlenecks.forEach((bottleneck) => {
      const icon =
        bottleneck.severity === 'critical'
          ? '🔴'
          : bottleneck.severity === 'warning'
            ? '🟡'
            : '🟢';
      console.log(
        `  ${icon} ${bottleneck.severity.toUpperCase()}: ${bottleneck.component} (${bottleneck.metric})`,
      );
      
      // Show details if available
      if (bottleneck.details) {
        bottleneck.details.forEach(detail => {
          console.log(`      - ${detail.type || detail.id}: ${detail.duration}s`);
        });
      }
    });

    if (analysis.recommendations.length > 0) {
      console.log(`\n💡 RECOMMENDATIONS:`);
      analysis.recommendations.forEach((rec) => {
        console.log(`  • ${rec}`);
      });
    }

    console.log(`\n📊 PERFORMANCE METRICS:`);
    console.log(`  • Analysis duration: ${analysis.analysisDuration.toFixed(2)}ms`);
    console.log(`  • Confidence score: ${(analysis.confidenceScore * 100).toFixed(0)}%`);
    console.log(`  • Issues detected: ${analysis.issuesDetected}`);

    // Save detailed report
    const reportPath = path.join(process.cwd(), 'analysis-reports', `bottleneck-${Date.now()}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(analysis, null, 2));
    
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
  } catch (err) {
    printError(`Bottleneck analysis failed: ${err.message}`);
    console.log('\nFalling back to simulated analysis...');
    
    // Fallback to simulated data
    console.log(`\n📊 BOTTLENECK ANALYSIS RESULTS (SIMULATED):`);
    console.log(`  🔴 CRITICAL: Memory usage in agent spawn process (85% utilization)`);
    console.log(`  🟡 WARNING: Task queue processing (12s avg)`);
    console.log(`  🟢 GOOD: Neural training pipeline (optimal)`);
    console.log(`  🟢 GOOD: Swarm coordination latency (within limits)`);
  }
}

async function performanceReportCommand(subArgs, flags) {
  const options = flags;
  const timeframe = options.timeframe || '24h';
  const format = options.format || 'summary';

  console.log(`📈 Generating performance report...`);
  console.log(`⏰ Timeframe: ${timeframe}`);
  console.log(`📋 Format: ${format}`);

  try {
    // Initialize metrics system without starting monitoring
    await initializeMetrics(false);
    
    // Get real performance data
    const report = await getPerformanceReport(timeframe);
    
    printSuccess(`✅ Performance report generated`);

    console.log(`\n📊 PERFORMANCE SUMMARY (${timeframe}):`);
    console.log(`  🚀 Total tasks executed: ${report.summary.totalTasks}`);
    console.log(`  ✅ Success rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`  ⏱️  Average execution time: ${report.summary.avgDuration.toFixed(1)}s`);
    console.log(`  🤖 Agents spawned: ${report.summary.agentsSpawned}`);
    console.log(`  💾 Memory efficiency: ${report.summary.memoryEfficiency.toFixed(0)}%`);
    console.log(`  🧠 Neural learning events: ${report.summary.neuralEvents}`);

    // Show trends if available
    if (report.trends) {
      console.log(`\n📈 TRENDS:`);
      if (report.trends.successRateChange !== 0) {
        const trend = report.trends.successRateChange > 0 ? 'improved' : 'decreased';
        console.log(`  • Task success rate ${trend} ${Math.abs(report.trends.successRateChange).toFixed(1)}% vs previous period`);
      }
      if (report.trends.durationChange !== 0) {
        const trend = report.trends.durationChange < 0 ? 'reduced' : 'increased';
        console.log(`  • Average execution time ${trend} by ${Math.abs(report.trends.durationChange / 1000).toFixed(1)}s`);
      }
      if (report.trends.taskVolumeChange !== 0) {
        const trend = report.trends.taskVolumeChange > 0 ? 'increased' : 'decreased';
        const percent = Math.abs((report.trends.taskVolumeChange / report.summary.totalTasks) * 100).toFixed(0);
        console.log(`  • Task volume ${trend} ${percent}%`);
      }
    }

    if (format === 'detailed' && report.agentMetrics) {
      console.log(`\n📊 DETAILED METRICS:`);
      console.log(`  Agent Performance:`);
      Object.entries(report.agentMetrics).forEach(([type, metrics]) => {
        console.log(`    - ${type} agents: ${metrics.successRate.toFixed(0)}% success, ${(metrics.avgDuration / 1000).toFixed(1)}s avg`);
      });
    }

    // Export full report
    const reportPath = await exportMetrics(format === 'json' ? 'json' : 'html');
    console.log(`\n📄 Full report: ${reportPath}`);
    
  } catch (err) {
    printError(`Failed to generate performance report: ${err.message}`);
    printWarning('Showing simulated data as fallback...');
    
    // Fallback to simulated data
    console.log(`\n📊 PERFORMANCE SUMMARY (${timeframe}) - SIMULATED:`);
    console.log(`  🚀 Total tasks executed: 127`);
    console.log(`  ✅ Success rate: 94.5%`);
    console.log(`  ⏱️  Average execution time: 8.3s`);
    console.log(`  🤖 Agents spawned: 23`);
    console.log(`  💾 Memory efficiency: 78%`);
    console.log(`  🧠 Neural learning events: 45`);
  }
}

async function tokenUsageCommand(subArgs, flags) {
  const options = flags;
  const agent = options.agent || 'all';
  const breakdown = options.breakdown || false;
  const costAnalysis = options['cost-analysis'] || false;

  console.log(`🔢 Analyzing token usage...`);
  console.log(`🤖 Agent filter: ${agent}`);
  console.log(`📊 Include breakdown: ${breakdown ? 'Yes' : 'No'}`);
  console.log(`💰 Include cost analysis: ${costAnalysis ? 'Yes' : 'No'}`);

  try {
    // Get real token usage from Claude Code metrics
    const tokenData = await getRealTokenUsage(agent);
    
    printSuccess(`✅ Token usage analysis completed`);

    // Check if we have any data
    if (tokenData.total === 0) {
      // Show instructions when no data available
      await showSimulatedTokenUsage(breakdown, costAnalysis);
      
      // Still generate empty report for consistency
      const reportPath = await generateTokenUsageReport(tokenData, agent);
      console.log(`\n📄 Detailed usage log: ${reportPath}`);
    } else {
      // Display real token usage
      console.log(`\n🔢 TOKEN USAGE SUMMARY:`);
      console.log(`  📝 Total tokens consumed: ${tokenData.total.toLocaleString()}`);
      console.log(`  📥 Input tokens: ${tokenData.input.toLocaleString()} (${((tokenData.input / tokenData.total) * 100).toFixed(1)}%)`);
      console.log(`  📤 Output tokens: ${tokenData.output.toLocaleString()} (${((tokenData.output / tokenData.total) * 100).toFixed(1)}%)`);
      
      if (costAnalysis) {
        const cost = calculateCost(tokenData);
        console.log(`  💰 Estimated cost: $${cost.total.toFixed(2)}`);
        console.log(`     Input cost: $${cost.input.toFixed(2)}`);
        console.log(`     Output cost: $${cost.output.toFixed(2)}`);
      }

      if (breakdown && tokenData.byAgent) {
        console.log(`\n📊 BREAKDOWN BY AGENT TYPE:`);
        Object.entries(tokenData.byAgent).forEach(([agentType, usage]) => {
          const percentage = ((usage / tokenData.total) * 100).toFixed(1);
          const icon = getAgentIcon(agentType);
          console.log(`  ${icon} ${agentType}: ${usage.toLocaleString()} tokens (${percentage}%)`);
        });

        console.log(`\n💡 OPTIMIZATION OPPORTUNITIES:`);
        const opportunities = generateOptimizationSuggestions(tokenData);
        opportunities.forEach(suggestion => {
          console.log(`  • ${suggestion}`);
        });
      }

      // Generate real CSV report
      const reportPath = await generateTokenUsageReport(tokenData, agent);
      console.log(`\n📄 Detailed usage log: ${reportPath}`);
    }
    
  } catch (err) {
    printError(`Failed to get real token usage: ${err.message}`);
    printWarning('Falling back to help instructions...');
    
    // Fallback to instructions
    await showSimulatedTokenUsage(breakdown, costAnalysis);
  }
}

function showAnalysisHelp() {
  console.log(`
📊 Analysis Commands - Performance & Usage Analytics

USAGE:
  claude-flow analysis <command> [options]

COMMANDS:
  setup-telemetry      Configure token tracking for Claude API calls
  bottleneck-detect    Detect performance bottlenecks in the system
  performance-report   Generate comprehensive performance reports
  token-usage          Analyze token consumption and costs
  claude-monitor       Monitor Claude session for real-time token usage
  claude-cost          Get current Claude session cost and usage

GLOBAL OPTIONS:
  --enable-telemetry   Enable token tracking for this session
  --help, -h           Show this help message

TELEMETRY SETUP:
  claude-flow analysis setup-telemetry
  
  This command will:
  • Set CLAUDE_CODE_ENABLE_TELEMETRY=1 in your environment
  • Create .env file with telemetry settings
  • Initialize token tracking directory
  • Show current telemetry status

BOTTLENECK DETECT OPTIONS:
  --scope <scope>      Analysis scope (default: system)
                       Options: system, swarm, agent, task, memory
  --target <target>    Specific target to analyze (default: all)
                       Examples: agent-id, swarm-id, task-type

PERFORMANCE REPORT OPTIONS:
  --timeframe <time>   Report timeframe (default: 24h)
                       Options: 1h, 6h, 24h, 7d, 30d
  --format <format>    Report format (default: summary)
                       Options: summary, detailed, json, csv

TOKEN USAGE OPTIONS:
  --agent <agent>      Filter by agent type or ID (default: all)
  --breakdown          Include detailed breakdown by agent type
  --cost-analysis      Include cost projections and optimization
  --enable-telemetry   Enable token tracking for this session

CLAUDE MONITOR OPTIONS:
  --interval <ms>      Update interval in milliseconds (default: 5000)
  
  Usage: claude-flow analysis claude-monitor [session-id] [--interval 3000]
  
  Monitors a Claude session for real-time token usage updates.
  Session ID defaults to 'current' if not specified.

CLAUDE COST OPTIONS:
  Usage: claude-flow analysis claude-cost
  
  Retrieves the current Claude session's token usage and cost estimate.
  Works best when run during or immediately after a Claude session.

EXAMPLES:
  # First-time setup for token tracking
  claude-flow analysis setup-telemetry

  # Token usage with telemetry enabled
  claude-flow analysis token-usage --enable-telemetry --breakdown

  # Detect system-wide bottlenecks
  claude-flow analysis bottleneck-detect --scope system

  # Weekly performance report
  claude-flow analysis performance-report --timeframe 7d --format detailed

  # Token usage with full analysis
  claude-flow analysis token-usage --breakdown --cost-analysis

  # Monitor Claude session in real-time
  claude-flow analysis claude-monitor

  # Get current Claude session cost
  claude-flow analysis claude-cost

  # Run Claude with automatic token tracking
  CLAUDE_CODE_ENABLE_TELEMETRY=1 claude-flow swarm "task" --claude

🎯 Analysis helps with:
  • Token usage tracking & cost management
  • Performance optimization
  • Resource allocation
  • Bottleneck identification
  • Trend analysis

💡 TIP: Run 'analysis setup-telemetry' first to enable token tracking!
`);
}

// Helper functions for real token tracking are now imported from token-tracker.js

async function claudeMonitorCommand(subArgs, flags) {
  const sessionId = subArgs[1] || 'current';
  const interval = flags.interval || 5000;
  
  console.log(`📊 Starting Claude session monitor...`);
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Update interval: ${interval / 1000}s`);
  console.log(`   Press Ctrl+C to stop monitoring\n`);
  
  try {
    // Import the telemetry module
    const { monitorClaudeSession } = await import('./claude-telemetry.js');
    
    // Start monitoring
    const stopMonitor = await monitorClaudeSession(sessionId, interval);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      stopMonitor();
      process.exit(0);
    });
    
    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    printError(`Failed to start Claude monitor: ${error.message}`);
    console.log('\n💡 TIP: Make sure Claude is installed and accessible');
  }
}

async function claudeCostCommand(subArgs, flags) {
  console.log(`💰 Retrieving Claude session cost information...`);
  
  try {
    // Import the telemetry module
    const { extractCostCommand } = await import('./claude-telemetry.js');
    
    // Get cost data
    const costData = await extractCostCommand();
    
    console.log('\n📊 Current Session Usage:');
    console.log(`   Input Tokens:  ${costData.tokens.input || 0}`);
    console.log(`   Output Tokens: ${costData.tokens.output || 0}`);
    console.log(`   Total Tokens:  ${costData.tokens.total || 0}`);
    
    if (costData.costs.length > 0) {
      console.log(`   Estimated Cost: $${costData.costs[0]}`);
    }
    
    // Also show pricing info
    console.log('\n💰 Claude 3 Pricing:');
    console.log('   • Opus:   $15/1M input, $75/1M output');
    console.log('   • Sonnet: $3/1M input, $15/1M output');
    console.log('   • Haiku:  $0.25/1M input, $1.25/1M output');
    
  } catch (error) {
    printError(`Failed to retrieve cost data: ${error.message}`);
    console.log('\n💡 TIP: Run this while Claude is active or immediately after');
  }
}

async function showSimulatedTokenUsage(breakdown, costAnalysis) {
  // Show honest message about no data instead of fake numbers
  console.log(`\n🔢 TOKEN USAGE ANALYSIS:`);
  console.log(`  ℹ️ No token usage data available yet.`);
  
  console.log(`\n📋 QUICK SETUP - Choose one option:`);
  console.log(`\n  Option 1: Enable Telemetry (Recommended)`);
  console.log(`  ┌────────────────────────────────────────────────────────┐`);
  console.log(`  │ ./claude-flow analysis setup-telemetry                │`);
  console.log(`  └────────────────────────────────────────────────────────┘`);
  
  console.log(`\n  Option 2: Manual Environment Variable`);
  console.log(`  ┌────────────────────────────────────────────────────────┐`);
  console.log(`  │ export CLAUDE_CODE_ENABLE_TELEMETRY=1                 │`);
  console.log(`  └────────────────────────────────────────────────────────┘`);
  
  console.log(`\n  Option 3: Use --enable-telemetry Flag`);
  console.log(`  ┌────────────────────────────────────────────────────────┐`);
  console.log(`  │ ./claude-flow analysis token-usage --enable-telemetry │`);
  console.log(`  └────────────────────────────────────────────────────────┘`);
  
  console.log(`\n✅ AFTER SETUP:`);
  console.log(`  1. Run Claude commands: ./claude-flow swarm "task" --claude`);
  console.log(`  2. Token usage will be automatically tracked`);
  console.log(`  3. Return here to see real metrics`);
  
  if (costAnalysis) {
    console.log(`\n💰 COST TRACKING:`);
    console.log(`  • Claude 3 Opus: $15/1M input, $75/1M output tokens`);
    console.log(`  • Claude 3 Sonnet: $3/1M input, $15/1M output tokens`);
    console.log(`  • Claude 3 Haiku: $0.25/1M input, $1.25/1M output tokens`);
  }

  if (breakdown) {
    console.log(`\n📊 AGENT BREAKDOWN:`);
    console.log(`  • Each agent type's usage tracked separately`);
    console.log(`  • Identifies high-consumption agents`);
    console.log(`  • Provides optimization recommendations`);
  }

  console.log(`\n❓ TROUBLESHOOTING:`);
  console.log(`  • Check telemetry status: echo $CLAUDE_CODE_ENABLE_TELEMETRY`);
  console.log(`  • View raw data: cat .claude-flow/metrics/token-usage.json`);
  console.log(`  • Reset tracking: rm -rf .claude-flow/metrics/token-usage.json`);
}
