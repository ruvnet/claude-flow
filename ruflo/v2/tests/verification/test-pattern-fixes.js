#!/usr/bin/env node
/**
 * Live verification test for pattern persistence fixes in v2.7.1
 *
 * Tests all three critical bug fixes:
 * 1. MCP Pattern Store - Data persistence
 * 2. MCP Pattern Search - Pattern retrieval
 * 3. MCP Pattern Stats - Statistics tracking
 */

const { spawn } = require('child_process');
const path = require('path');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function header(msg) {
  log(`\n${'='.repeat(70)}`, 'cyan');
  log(msg, 'cyan');
  log('='.repeat(70), 'cyan');
}

async function runMCPCommand(tool, args) {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, '../../bin/claude-flow.js');

    const proc = spawn('node', [
      cliPath,
      'mcp',
      'call',
      tool,
      '--args',
      JSON.stringify(args)
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          // Try to parse JSON from stdout
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ stdout, stderr });
          }
        } catch (e) {
          resolve({ stdout, stderr, parseError: e.message });
        }
      } else {
        reject({ code, stdout, stderr });
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function testPatternStore() {
  header('TEST 1: MCP Pattern Store (Data Persistence)');

  try {
    log('Training a coordination pattern with 50 epochs...', 'blue');

    const result = await runMCPCommand('neural_train', {
      pattern_type: 'coordination',
      epochs: 50,
      training_data: 'test-verification-data'
    });

    if (result.success && result.modelId) {
      log(`✅ PASS: Pattern trained successfully`, 'green');
      log(`   Model ID: ${result.modelId}`, 'cyan');
      log(`   Accuracy: ${result.accuracy?.toFixed(4)}`, 'cyan');
      log(`   Epochs: ${result.epochs}`, 'cyan');
      log(`   Status: ${result.status}`, 'cyan');

      // Check if persistence is mentioned in logs
      if (result.modelId.includes('coordination')) {
        log('   ✓ Pattern type correctly embedded in model ID', 'cyan');
      }

      return { success: true, modelId: result.modelId };
    } else {
      log(`❌ FAIL: Pattern training failed`, 'red');
      log(`   Result: ${JSON.stringify(result, null, 2)}`, 'yellow');
      return { success: false };
    }
  } catch (error) {
    log(`❌ FAIL: Exception during pattern training`, 'red');
    log(`   Error: ${error.message || JSON.stringify(error)}`, 'yellow');
    return { success: false };
  }
}

async function testPatternSearch(modelId) {
  header('TEST 2: MCP Pattern Search (Pattern Retrieval)');

  if (!modelId) {
    log('⚠️  SKIP: No model ID available from previous test', 'yellow');
    return { success: false, skipped: true };
  }

  try {
    log(`Retrieving pattern with model ID: ${modelId}...`, 'blue');

    const result = await runMCPCommand('neural_patterns', {
      action: 'analyze',
      metadata: { modelId }
    });

    if (result.success && result.pattern) {
      log(`✅ PASS: Pattern retrieved successfully`, 'green');
      log(`   Pattern Type: ${result.pattern.pattern_type}`, 'cyan');
      log(`   Accuracy: ${result.pattern.accuracy?.toFixed(4)}`, 'cyan');
      log(`   Epochs: ${result.pattern.epochs}`, 'cyan');
      log(`   Training Time: ${result.pattern.training_time?.toFixed(2)}s`, 'cyan');
      log(`   Timestamp: ${result.pattern.timestamp}`, 'cyan');

      if (result.analysis) {
        log(`   Analysis Quality: ${result.analysis.quality}`, 'cyan');
        log(`   Analysis Confidence: ${result.analysis.confidence?.toFixed(4)}`, 'cyan');
      }

      return { success: true };
    } else {
      log(`❌ FAIL: Pattern retrieval failed`, 'red');
      log(`   Result: ${JSON.stringify(result, null, 2)}`, 'yellow');
      return { success: false };
    }
  } catch (error) {
    log(`❌ FAIL: Exception during pattern retrieval`, 'red');
    log(`   Error: ${error.message || JSON.stringify(error)}`, 'yellow');
    return { success: false };
  }
}

async function testPatternStats() {
  header('TEST 3: MCP Pattern Stats (Statistics Tracking)');

  try {
    log('Retrieving coordination pattern statistics...', 'blue');

    const result = await runMCPCommand('neural_patterns', {
      action: 'stats',
      metadata: { pattern_type: 'coordination' }
    });

    if (result.success && result.statistics) {
      log(`✅ PASS: Statistics retrieved successfully`, 'green');

      const stats = result.statistics;
      log(`   Total Trainings: ${stats.total_trainings}`, 'cyan');
      log(`   Average Accuracy: ${stats.avg_accuracy?.toFixed(4)}`, 'cyan');
      log(`   Max Accuracy: ${stats.max_accuracy?.toFixed(4)}`, 'cyan');
      log(`   Min Accuracy: ${stats.min_accuracy?.toFixed(4)}`, 'cyan');
      log(`   Total Epochs: ${stats.total_epochs}`, 'cyan');
      log(`   Models Tracked: ${stats.models?.length || 0}`, 'cyan');

      if (stats.total_trainings > 0) {
        log('   ✓ Statistics tracking is active', 'cyan');
      }

      return { success: true, stats };
    } else {
      log(`❌ FAIL: Statistics retrieval failed`, 'red');
      log(`   Result: ${JSON.stringify(result, null, 2)}`, 'yellow');
      return { success: false };
    }
  } catch (error) {
    log(`❌ FAIL: Exception during statistics retrieval`, 'red');
    log(`   Error: ${error.message || JSON.stringify(error)}`, 'yellow');
    return { success: false };
  }
}

async function testPatternListAll() {
  header('BONUS TEST: List All Patterns');

  try {
    log('Retrieving all patterns...', 'blue');

    const result = await runMCPCommand('neural_patterns', {
      action: 'analyze'
    });

    if (result.success) {
      log(`✅ PASS: Pattern listing successful`, 'green');
      log(`   Total Patterns: ${result.total_patterns}`, 'cyan');

      if (result.patterns && result.patterns.length > 0) {
        log(`   Recent patterns:`, 'cyan');
        result.patterns.slice(0, 3).forEach((p, i) => {
          log(`     ${i + 1}. ${p.modelId} - ${p.pattern_type} (${p.accuracy?.toFixed(4)})`, 'cyan');
        });
      }

      return { success: true };
    } else {
      log(`⚠️  WARNING: Pattern listing returned no success`, 'yellow');
      log(`   Result: ${JSON.stringify(result, null, 2)}`, 'yellow');
      return { success: false };
    }
  } catch (error) {
    log(`⚠️  WARNING: Exception during pattern listing`, 'yellow');
    log(`   Error: ${error.message || JSON.stringify(error)}`, 'yellow');
    return { success: false };
  }
}

async function main() {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  Pattern Persistence Fix Verification - v2.7.1              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');

  const results = {
    patternStore: false,
    patternSearch: false,
    patternStats: false,
    patternList: false
  };

  let modelId = null;

  // Test 1: Pattern Store (Persistence)
  const test1 = await testPatternStore();
  results.patternStore = test1.success;
  modelId = test1.modelId;

  // Test 2: Pattern Search (Retrieval)
  const test2 = await testPatternSearch(modelId);
  results.patternSearch = test2.success;

  // Test 3: Pattern Stats (Statistics)
  const test3 = await testPatternStats();
  results.patternStats = test3.success;

  // Bonus: List all patterns
  const test4 = await testPatternListAll();
  results.patternList = test4.success;

  // Final summary
  header('VERIFICATION SUMMARY');

  const allPassed = results.patternStore && results.patternSearch && results.patternStats;

  log(`\nCritical Fixes:`, 'cyan');
  log(`  1. MCP Pattern Store:    ${results.patternStore ? '✅ FIXED' : '❌ FAILED'}`,
      results.patternStore ? 'green' : 'red');
  log(`  2. MCP Pattern Search:   ${results.patternSearch ? '✅ FIXED' : '❌ FAILED'}`,
      results.patternSearch ? 'green' : 'red');
  log(`  3. MCP Pattern Stats:    ${results.patternStats ? '✅ FIXED' : '❌ FAILED'}`,
      results.patternStats ? 'green' : 'red');

  log(`\nBonus Tests:`, 'cyan');
  log(`  • List All Patterns:     ${results.patternList ? '✅ PASS' : '⚠️  WARN'}`,
      results.patternList ? 'green' : 'yellow');

  log('\n' + '─'.repeat(70), 'cyan');

  if (allPassed) {
    log('\n🎉 SUCCESS: All critical pattern persistence fixes verified!', 'green');
    log('\nv2.7.1 has successfully resolved:', 'green');
    log('  ✓ Data now persists to memory namespace', 'green');
    log('  ✓ Patterns can be retrieved and searched', 'green');
    log('  ✓ Statistics are tracked and aggregated', 'green');
    process.exit(0);
  } else {
    log('\n⚠️  VERIFICATION INCOMPLETE: Some tests failed', 'yellow');
    log('\nNote: MCP server must be running for these tests to work.', 'yellow');
    log('Try: npm run start:mcp (in another terminal)', 'yellow');
    process.exit(1);
  }
}

// Run the verification
main().catch((error) => {
  log(`\n❌ FATAL ERROR: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
