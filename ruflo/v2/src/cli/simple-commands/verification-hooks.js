#!/usr/bin/env node
/**
 * Verification Hooks CLI
 * Provides verification integration for other commands via CLI
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const taskId = args[1];
const agentType = args[2] || 'unknown';
const additionalData = args[3] ? JSON.parse(args[3]) : {};

// Verification thresholds
const THRESHOLDS = {
  strict: 0.95,
  moderate: 0.85,
  development: 0.75
};

// Get current mode from environment or default
const mode = process.env.VERIFICATION_MODE || 'moderate';
const threshold = THRESHOLDS[mode];

/**
 * Pre-task verification
 */
async function preTaskVerification(taskId, agentType, data) {
  console.log(`🔍 Pre-task verification: ${taskId} (${agentType})`);
  
  const checks = [];
  
  // Check git status
  try {
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    const isClean = gitStatus.trim() === '';
    checks.push({
      name: 'git-status',
      passed: isClean || data.allowDirty,
      score: isClean ? 1.0 : 0.7
    });
  } catch (e) {
    checks.push({ name: 'git-status', passed: false, score: 0 });
  }
  
  // Check npm dependencies
  if (fs.existsSync('package.json')) {
    try {
      execSync('npm ls --depth=0', { stdio: 'ignore' });
      checks.push({ name: 'npm-deps', passed: true, score: 1.0 });
    } catch {
      checks.push({ name: 'npm-deps', passed: false, score: 0.5 });
    }
  }
  
  const avgScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
  const passed = avgScore >= threshold;
  
  // Store result
  storeVerification(taskId, 'pre', { 
    passed, 
    score: avgScore, 
    checks,
    agentType 
  });
  
  if (!passed) {
    console.error(`❌ Pre-task verification failed (${avgScore.toFixed(2)} < ${threshold})`);
    process.exit(1);
  }
  
  console.log(`✅ Pre-task verification passed (${avgScore.toFixed(2)})`);
  return 0;
}

/**
 * Post-task verification
 */
async function postTaskVerification(taskId, agentType, data) {
  console.log(`🔍 Post-task verification: ${taskId} (${agentType})`);
  
  const checks = [];
  
  // Run type checking if available
  if (fs.existsSync('tsconfig.json') || fs.existsSync('package.json')) {
    try {
      const result = execSync('npm run typecheck 2>&1 || true', { encoding: 'utf8' });
      const hasErrors = result.toLowerCase().includes('error');
      checks.push({
        name: 'typecheck',
        passed: !hasErrors,
        score: hasErrors ? 0.5 : 1.0
      });
    } catch {
      checks.push({ name: 'typecheck', passed: false, score: 0.3 });
    }
  }
  
  // Run tests if available
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.scripts && pkg.scripts.test) {
        const result = execSync('npm test 2>&1 || true', { encoding: 'utf8' });
        const passed = result.includes('PASS') || result.includes('passing');
        checks.push({
          name: 'tests',
          passed,
          score: passed ? 1.0 : 0.4
        });
      }
    } catch {
      checks.push({ name: 'tests', passed: false, score: 0.2 });
    }
  }
  
  // Run linting if available
  if (fs.existsSync('.eslintrc.js') || fs.existsSync('.eslintrc.json')) {
    try {
      const result = execSync('npm run lint 2>&1 || true', { encoding: 'utf8' });
      const hasErrors = result.toLowerCase().includes('error');
      checks.push({
        name: 'lint',
        passed: !hasErrors,
        score: hasErrors ? 0.6 : 1.0
      });
    } catch {
      checks.push({ name: 'lint', passed: false, score: 0.4 });
    }
  }
  
  // If no checks were possible, use default
  if (checks.length === 0) {
    checks.push({
      name: 'default',
      passed: true,
      score: 0.8
    });
  }
  
  const avgScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
  const passed = avgScore >= threshold;
  
  // Store result
  storeVerification(taskId, 'post', { 
    passed, 
    score: avgScore, 
    checks,
    agentType 
  });
  
  if (!passed) {
    console.error(`❌ Post-task verification failed (${avgScore.toFixed(2)} < ${threshold})`);
    
    // Attempt rollback if enabled
    if (process.env.VERIFICATION_ROLLBACK === 'true') {
      console.log('🔄 Attempting rollback...');
      try {
        execSync('git reset --hard HEAD');
        console.log('✅ Rollback completed');
      } catch (e) {
        console.error('❌ Rollback failed:', e.message);
      }
    }
    
    process.exit(1);
  }
  
  console.log(`✅ Post-task verification passed (${avgScore.toFixed(2)})`);
  return 0;
}

/**
 * Training integration - feed results to training system
 */
async function feedToTraining(taskId, agentType, data) {
  const verificationData = loadVerification(taskId);
  
  if (!verificationData) {
    console.log('⚠️  No verification data to feed to training');
    return;
  }
  
  // Format for training system
  const trainingData = {
    taskId,
    agentType,
    preScore: verificationData.pre?.score || 0,
    postScore: verificationData.post?.score || 0,
    success: verificationData.post?.passed || false,
    timestamp: new Date().toISOString()
  };
  
  // Store in training data file
  const trainingFile = '.claude-flow/training/verification-data.jsonl';
  const dir = path.dirname(trainingFile);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.appendFileSync(trainingFile, JSON.stringify(trainingData) + '\n');
  console.log(`📊 Verification data fed to training system`);
  
  // If score is particularly low, flag for attention
  if (trainingData.postScore < 0.5) {
    console.warn(`⚠️  Low verification score for ${agentType}: ${trainingData.postScore}`);
  }
}

/**
 * Store verification results
 */
function storeVerification(taskId, phase, data) {
  const file = '.swarm/verification-memory.json';
  const dir = path.dirname(file);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  let memory = {};
  if (fs.existsSync(file)) {
    try {
      memory = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      memory = {};
    }
  }
  
  if (!memory.history) memory.history = [];
  if (!memory.tasks) memory.tasks = {};
  
  // Store task-specific data
  if (!memory.tasks[taskId]) {
    memory.tasks[taskId] = {};
  }
  memory.tasks[taskId][phase] = data;
  
  // Add to history
  memory.history.push({
    taskId,
    phase,
    ...data,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 1000 entries
  if (memory.history.length > 1000) {
    memory.history = memory.history.slice(-1000);
  }
  
  fs.writeFileSync(file, JSON.stringify(memory, null, 2));
}

/**
 * Load verification results
 */
function loadVerification(taskId) {
  const file = '.swarm/verification-memory.json';
  
  if (!fs.existsSync(file)) {
    return null;
  }
  
  try {
    const memory = JSON.parse(fs.readFileSync(file, 'utf8'));
    return memory.tasks?.[taskId] || null;
  } catch {
    return null;
  }
}

/**
 * Show verification status
 */
function showStatus() {
  const file = '.swarm/verification-memory.json';
  
  if (!fs.existsSync(file)) {
    console.log('No verification history found');
    return;
  }
  
  try {
    const memory = JSON.parse(fs.readFileSync(file, 'utf8'));
    const recent = memory.history?.slice(-10) || [];
    
    console.log(`📊 Verification Status`);
    console.log(`Mode: ${mode} (threshold: ${threshold})`);
    console.log(`Total verifications: ${memory.history?.length || 0}`);
    
    if (recent.length > 0) {
      console.log(`\nRecent verifications:`);
      for (const v of recent) {
        const status = v.passed ? '✅' : '❌';
        console.log(`  ${status} ${v.taskId} (${v.phase}): ${v.score.toFixed(2)}`);
      }
    }
  } catch (e) {
    console.error('Error reading verification history:', e.message);
  }
}

// Main CLI handler
async function main() {
  switch (command) {
    case 'pre':
      return preTaskVerification(taskId, agentType, additionalData);
    
    case 'post':
      return postTaskVerification(taskId, agentType, additionalData);
    
    case 'train':
      return feedToTraining(taskId, agentType, additionalData);
    
    case 'status':
      return showStatus();
    
    default:
      console.log('Usage: verification-hooks <pre|post|train|status> <taskId> [agentType] [data]');
      process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

// Export for programmatic use
export {
  preTaskVerification,
  postTaskVerification,
  feedToTraining,
  showStatus
};