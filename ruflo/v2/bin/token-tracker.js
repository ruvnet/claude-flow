/**
 * Real Token Usage Tracking for Claude API Calls
 * Tracks actual token consumption from Claude Code interactions
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Token tracking cache
let tokenCache = {
  sessions: {},
  totals: {
    input: 0,
    output: 0,
    total: 0
  },
  byAgent: {},
  byCommand: {},
  history: []
};

// Get metrics directory
function getMetricsDir() {
  return path.join(process.cwd(), '.claude-flow', 'metrics');
}

// Get token file path
function getTokenFilePath() {
  return path.join(getMetricsDir(), 'token-usage.json');
}

// Load existing token data
export async function loadTokenData() {
  try {
    const filePath = getTokenFilePath();
    const data = await fs.readFile(filePath, 'utf-8');
    tokenCache = JSON.parse(data);
    return tokenCache;
  } catch (error) {
    // File doesn't exist or is invalid, use default
    return tokenCache;
  }
}

// Save token data to disk
export async function saveTokenData() {
  try {
    const dir = getMetricsDir();
    await fs.mkdir(dir, { recursive: true });
    
    const filePath = getTokenFilePath();
    await fs.writeFile(filePath, JSON.stringify(tokenCache, null, 2));
  } catch (error) {
    console.error('Failed to save token data:', error.message);
  }
}

/**
 * Track tokens from a Claude interaction
 * @param {Object} params Token tracking parameters
 */
export async function trackTokens(params) {
  const {
    sessionId,
    agentType = 'general',
    command = 'unknown',
    inputTokens = 0,
    outputTokens = 0,
    metadata = {}
  } = params;
  
  // Update totals
  tokenCache.totals.input += inputTokens;
  tokenCache.totals.output += outputTokens;
  tokenCache.totals.total += (inputTokens + outputTokens);
  
  // Track by agent type
  if (!tokenCache.byAgent[agentType]) {
    tokenCache.byAgent[agentType] = {
      input: 0,
      output: 0,
      total: 0,
      count: 0
    };
  }
  tokenCache.byAgent[agentType].input += inputTokens;
  tokenCache.byAgent[agentType].output += outputTokens;
  tokenCache.byAgent[agentType].total += (inputTokens + outputTokens);
  tokenCache.byAgent[agentType].count++;
  
  // Track by command
  if (!tokenCache.byCommand[command]) {
    tokenCache.byCommand[command] = {
      input: 0,
      output: 0,
      total: 0,
      count: 0
    };
  }
  tokenCache.byCommand[command].input += inputTokens;
  tokenCache.byCommand[command].output += outputTokens;
  tokenCache.byCommand[command].total += (inputTokens + outputTokens);
  tokenCache.byCommand[command].count++;
  
  // Add to history
  tokenCache.history.push({
    timestamp: Date.now(),
    sessionId,
    agentType,
    command,
    inputTokens,
    outputTokens,
    metadata
  });
  
  // Keep only last 1000 entries in history
  if (tokenCache.history.length > 1000) {
    tokenCache.history = tokenCache.history.slice(-1000);
  }
  
  // Save to disk
  await saveTokenData();
  
  return {
    sessionTotal: inputTokens + outputTokens,
    grandTotal: tokenCache.totals.total
  };
}

/**
 * Get real token usage data
 * @param {string} agentFilter Filter by agent type
 */
export async function getRealTokenUsage(agentFilter = 'all') {
  await loadTokenData();
  
  // If no data tracked yet, check for Claude API logs
  if (tokenCache.totals.total === 0) {
    // Try to read from Claude Code's own tracking if available
    const claudeTokens = await getClaudeCodeTokenUsage();
    if (claudeTokens) {
      return claudeTokens;
    }
  }
  
  // Filter by agent if specified
  if (agentFilter !== 'all' && tokenCache.byAgent[agentFilter]) {
    const agentData = tokenCache.byAgent[agentFilter];
    return {
      total: agentData.total,
      input: agentData.input,
      output: agentData.output,
      byAgent: { [agentFilter]: agentData.total }
    };
  }
  
  // Return all data
  const byAgent = {};
  Object.entries(tokenCache.byAgent).forEach(([type, data]) => {
    byAgent[type] = data.total;
  });
  
  return {
    total: tokenCache.totals.total,
    input: tokenCache.totals.input,
    output: tokenCache.totals.output,
    byAgent,
    byCommand: tokenCache.byCommand,
    history: tokenCache.history
  };
}

/**
 * Try to get token usage from Claude Code's own tracking
 */
async function getClaudeCodeTokenUsage() {
  try {
    // Check common locations for Claude token logs
    const possiblePaths = [
      path.join(process.env.HOME, '.config', 'claude', 'usage.json'),
      path.join(process.env.HOME, '.claude', 'metrics.json'),
      path.join(process.cwd(), '.claude', 'usage.json')
    ];
    
    for (const logPath of possiblePaths) {
      try {
        const data = await fs.readFile(logPath, 'utf-8');
        const usage = JSON.parse(data);
        
        // Convert Claude's format to our format
        if (usage.tokens || usage.usage) {
          const tokens = usage.tokens || usage.usage;
          return {
            total: tokens.total || 0,
            input: tokens.input || tokens.prompt_tokens || 0,
            output: tokens.output || tokens.completion_tokens || 0,
            byAgent: {},
            source: 'claude-code'
          };
        }
      } catch (e) {
        // Continue to next path
      }
    }
  } catch (error) {
    // No Claude tracking found
  }
  
  // Return empty if no data found
  return {
    total: 0,
    input: 0,
    output: 0,
    byAgent: {},
    source: 'none'
  };
}

/**
 * Calculate cost based on token usage
 * Using Claude 3 pricing (as of 2024)
 */
export function calculateCost(tokenData) {
  // Claude 3 Opus pricing (per 1M tokens)
  const INPUT_COST_PER_1M = 15.00;  // $15 per 1M input tokens
  const OUTPUT_COST_PER_1M = 75.00; // $75 per 1M output tokens
  
  const inputCost = (tokenData.input / 1000000) * INPUT_COST_PER_1M;
  const outputCost = (tokenData.output / 1000000) * OUTPUT_COST_PER_1M;
  
  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost
  };
}

/**
 * Generate optimization suggestions based on real usage
 */
export function generateOptimizationSuggestions(tokenData) {
  const suggestions = [];
  
  // Check if there's actual data
  if (tokenData.total === 0) {
    return ['No token usage data available. Start using Claude Code to track tokens.'];
  }
  
  // Analyze input/output ratio
  const outputRatio = tokenData.output / tokenData.total;
  if (outputRatio > 0.6) {
    suggestions.push('High output ratio detected. Consider more concise prompts to reduce generation.');
  }
  
  // Analyze by agent type
  if (tokenData.byAgent) {
    const sortedAgents = Object.entries(tokenData.byAgent)
      .sort((a, b) => b[1] - a[1]);
    
    if (sortedAgents.length > 0) {
      const [topAgent, topUsage] = sortedAgents[0];
      const percentage = (topUsage / tokenData.total) * 100;
      
      if (percentage > 50) {
        suggestions.push(`${topAgent} agents consume ${percentage.toFixed(0)}% of tokens. Consider optimization or caching.`);
      }
    }
  }
  
  // Check for repeated patterns in history
  if (tokenData.history && tokenData.history.length > 10) {
    const recentCommands = tokenData.history.slice(-20).map(h => h.command);
    const duplicates = recentCommands.filter((cmd, i) => recentCommands.indexOf(cmd) !== i);
    
    if (duplicates.length > 5) {
      suggestions.push('Repeated commands detected. Consider implementing result caching.');
    }
  }
  
  // Cost optimization
  if (tokenData.total > 100000) {
    suggestions.push('Consider using Claude Haiku for non-critical tasks to reduce costs by ~90%.');
  }
  
  // General suggestions based on volume
  if (tokenData.total > 50000) {
    suggestions.push('Implement prompt templates to reduce input token usage.');
    suggestions.push('Use streaming responses to optimize output generation.');
  }
  
  return suggestions.length > 0 ? suggestions : ['Token usage is within optimal range.'];
}

/**
 * Generate detailed token usage report
 */
export async function generateTokenUsageReport(tokenData, agentFilter) {
  const reportDir = path.join(process.cwd(), 'analysis-reports');
  await fs.mkdir(reportDir, { recursive: true });
  
  const timestamp = Date.now();
  const csvPath = path.join(reportDir, `token-usage-${timestamp}.csv`);
  
  // Create CSV content
  let csv = 'Timestamp,Session,Agent,Command,Input Tokens,Output Tokens,Total\n';
  
  if (tokenData.history) {
    tokenData.history.forEach(entry => {
      const date = new Date(entry.timestamp).toISOString();
      const total = entry.inputTokens + entry.outputTokens;
      csv += `${date},${entry.sessionId},${entry.agentType},${entry.command},${entry.inputTokens},${entry.outputTokens},${total}\n`;
    });
  }
  
  // Add summary at the end
  csv += '\nSUMMARY\n';
  csv += `Total Input Tokens,${tokenData.input}\n`;
  csv += `Total Output Tokens,${tokenData.output}\n`;
  csv += `Total Tokens,${tokenData.total}\n`;
  
  if (tokenData.byAgent) {
    csv += '\nBY AGENT TYPE\n';
    Object.entries(tokenData.byAgent).forEach(([type, usage]) => {
      csv += `${type},${usage}\n`;
    });
  }
  
  await fs.writeFile(csvPath, csv);
  return csvPath;
}

/**
 * Get icon for agent type
 */
export function getAgentIcon(agentType) {
  const icons = {
    coordinator: '🎯',
    developer: '👨‍💻',
    researcher: '🔍',
    analyzer: '📊',
    tester: '🧪',
    architect: '🏗️',
    general: '🤖'
  };
  return icons[agentType] || '🤖';
}

/**
 * Reset token tracking (for testing)
 */
export async function resetTokenTracking() {
  tokenCache = {
    sessions: {},
    totals: {
      input: 0,
      output: 0,
      total: 0
    },
    byAgent: {},
    byCommand: {},
    history: []
  };
  await saveTokenData();
}