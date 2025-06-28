#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function getErrorCount() {
  try {
    const output = execSync('npm run typecheck 2>&1 | grep -c "error TS"', { encoding: 'utf8' });
    return parseInt(output.trim()) || 0;
  } catch (e) {
    return 0;
  }
}

function getMemoryStatus() {
  try {
    const output = execSync('./claude-flow memory get emergency_fix_status 2>&1', { encoding: 'utf8' });
    const lines = output.split('\n');
    const jsonLine = lines.find(line => line.startsWith('{') && line.includes('phase'));
    if (jsonLine) {
      return JSON.parse(jsonLine);
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

function getErrorsByFile() {
  try {
    const output = execSync('npm run typecheck 2>&1 | grep "error TS" | cut -d":" -f1 | sed "s/(.*$//" | sort | uniq -c | sort -nr | head -10', { encoding: 'utf8' });
    return output.trim();
  } catch (e) {
    return '';
  }
}

function displayDashboard() {
  console.clear();
  
  const errorCount = getErrorCount();
  const memoryStatus = getMemoryStatus();
  const errorsByFile = getErrorsByFile();
  const timestamp = new Date().toLocaleTimeString();
  
  console.log(`${colors.bold}${colors.cyan}🚨 EMERGENCY FIX DASHBOARD - ${timestamp}${colors.reset}`);
  console.log('═'.repeat(60));
  
  // Overall Status
  const statusColor = errorCount > 500 ? colors.red : errorCount > 100 ? colors.yellow : colors.green;
  console.log(`${colors.bold}Build Errors:${colors.reset} ${statusColor}${errorCount}${colors.reset} TypeScript errors`);
  
  // Phase Status
  if (memoryStatus && memoryStatus.phases) {
    console.log(`\n${colors.bold}Phase Status:${colors.reset}`);
    Object.entries(memoryStatus.phases).forEach(([phase, info]) => {
      const statusIcon = info.status === 'completed' ? '✅' : 
                        info.status === 'in_progress' ? '🔄' : 
                        info.status === 'blocked' ? '🚫' : '⏳';
      console.log(`  ${statusIcon} ${phase}: ${info.status}${info.errors ? ` (${info.errors} errors)` : ''}`);
    });
  }
  
  // Top Error Files
  if (errorsByFile) {
    console.log(`\n${colors.bold}Top Files with Errors:${colors.reset}`);
    console.log(errorsByFile.split('\n').map(line => '  ' + line).join('\n'));
  }
  
  // Agent Status
  if (memoryStatus && memoryStatus.phases && memoryStatus.phases.phase1.agents) {
    console.log(`\n${colors.bold}Active Agents:${colors.reset}`);
    const agents = memoryStatus.phases.phase1.agents;
    if (agents.length === 0) {
      console.log('  ⏳ No agents deployed yet');
    } else {
      agents.forEach(agent => {
        console.log(`  🤖 ${agent}`);
      });
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('Refreshing every 5 seconds... Press Ctrl+C to exit');
}

// Main monitoring loop
console.log(`${colors.bold}${colors.green}Starting Emergency Fix Monitor...${colors.reset}`);

// Display immediately
displayDashboard();

// Update every 5 seconds
setInterval(displayDashboard, 5000);

// Handle graceful exit
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Monitor stopped.${colors.reset}`);
  process.exit(0);
});