#!/usr/bin/env node
/**
 * Manual Test Script for MCP Pattern Persistence
 * Run this to verify neural_train storage and neural_patterns retrieval
 *
 * Usage: node tests/manual/test-pattern-persistence.js
 */

import { spawn } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function callMCP(tool, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', [
      'claude-flow@alpha',
      'mcp',
      'call',
      '--tool',
      tool,
      '--args',
      JSON.stringify(args),
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}\nStderr: ${stderr}`));
      } else {
        try {
          // Find JSON in stdout (may have other output)
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ raw_output: stdout });
          }
        } catch (e) {
          resolve({ raw_output: stdout, parse_error: e.message });
        }
      }
    });
  });
}

async function runTests() {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║      MCP Pattern Persistence Manual Test Suite              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');

  let passedTests = 0;
  let failedTests = 0;
  const modelIds = [];

  try {
    // Test 1: Train a neural pattern (coordination)
    log('📝 Test 1: Training neural pattern (coordination)...', 'blue');
    const train1 = await callMCP('neural_train', {
      pattern_type: 'coordination',
      training_data: 'test coordination data',
      epochs: 50,
    });

    if (train1.success && train1.modelId) {
      log(`✅ PASS: Pattern trained successfully`, 'green');
      log(`   Model ID: ${train1.modelId}`, 'cyan');
      log(`   Accuracy: ${(train1.accuracy * 100).toFixed(2)}%`, 'cyan');
      log(`   Epochs: ${train1.epochs}`, 'cyan');
      modelIds.push(train1.modelId);
      passedTests++;
    } else {
      log(`❌ FAIL: Pattern training failed`, 'red');
      log(`   Response: ${JSON.stringify(train1, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 2: Train another pattern (optimization)
    log('\n📝 Test 2: Training neural pattern (optimization)...', 'blue');
    const train2 = await callMCP('neural_train', {
      pattern_type: 'optimization',
      training_data: 'test optimization data',
      epochs: 60,
    });

    if (train2.success && train2.modelId) {
      log(`✅ PASS: Pattern trained successfully`, 'green');
      log(`   Model ID: ${train2.modelId}`, 'cyan');
      log(`   Accuracy: ${(train2.accuracy * 100).toFixed(2)}%`, 'cyan');
      modelIds.push(train2.modelId);
      passedTests++;
    } else {
      log(`❌ FAIL: Pattern training failed`, 'red');
      failedTests++;
    }

    // Test 3: Retrieve specific pattern
    log('\n📝 Test 3: Retrieving specific pattern...', 'blue');
    const analyze1 = await callMCP('neural_patterns', {
      action: 'analyze',
      metadata: { modelId: modelIds[0] },
    });

    if (analyze1.success && analyze1.pattern && analyze1.pattern.modelId === modelIds[0]) {
      log(`✅ PASS: Pattern retrieved successfully`, 'green');
      log(`   Model ID: ${analyze1.pattern.modelId}`, 'cyan');
      log(`   Pattern Type: ${analyze1.pattern.pattern_type}`, 'cyan');
      log(`   Quality: ${analyze1.analysis.quality}`, 'cyan');
      passedTests++;
    } else {
      log(`❌ FAIL: Pattern retrieval failed`, 'red');
      log(`   Response: ${JSON.stringify(analyze1, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 4: List all patterns
    log('\n📝 Test 4: Listing all patterns...', 'blue');
    const analyzeAll = await callMCP('neural_patterns', {
      action: 'analyze',
    });

    if (analyzeAll.success && analyzeAll.total_patterns >= 2) {
      log(`✅ PASS: All patterns listed successfully`, 'green');
      log(`   Total patterns: ${analyzeAll.total_patterns}`, 'cyan');
      log(`   Patterns:`, 'cyan');
      analyzeAll.patterns.slice(0, 5).forEach((p) => {
        log(`     - ${p.modelId} (${p.pattern_type}): ${(p.accuracy * 100).toFixed(2)}%`, 'cyan');
      });
      passedTests++;
    } else {
      log(`❌ FAIL: Pattern listing failed`, 'red');
      log(`   Response: ${JSON.stringify(analyzeAll, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 5: Get statistics for coordination patterns
    log('\n📝 Test 5: Getting statistics for coordination patterns...', 'blue');
    const stats1 = await callMCP('neural_patterns', {
      action: 'stats',
      metadata: { pattern_type: 'coordination' },
    });

    if (stats1.success && stats1.statistics && stats1.statistics.total_trainings > 0) {
      log(`✅ PASS: Statistics retrieved successfully`, 'green');
      log(`   Pattern Type: ${stats1.pattern_type}`, 'cyan');
      log(`   Total Trainings: ${stats1.statistics.total_trainings}`, 'cyan');
      log(`   Average Accuracy: ${(stats1.statistics.avg_accuracy * 100).toFixed(2)}%`, 'cyan');
      log(`   Max Accuracy: ${(stats1.statistics.max_accuracy * 100).toFixed(2)}%`, 'cyan');
      passedTests++;
    } else {
      log(`❌ FAIL: Statistics retrieval failed`, 'red');
      log(`   Response: ${JSON.stringify(stats1, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 6: Get statistics for all pattern types
    log('\n📝 Test 6: Getting statistics for all pattern types...', 'blue');
    const statsAll = await callMCP('neural_patterns', {
      action: 'stats',
    });

    if (statsAll.success && statsAll.total_pattern_types >= 2) {
      log(`✅ PASS: All statistics retrieved successfully`, 'green');
      log(`   Total Pattern Types: ${statsAll.total_pattern_types}`, 'cyan');
      statsAll.statistics.forEach((stat) => {
        log(
          `     - ${stat.pattern_type}: ${stat.total_trainings} trainings, avg accuracy: ${(stat.avg_accuracy * 100).toFixed(2)}%`,
          'cyan',
        );
      });
      passedTests++;
    } else {
      log(`❌ FAIL: All statistics retrieval failed`, 'red');
      log(`   Response: ${JSON.stringify(statsAll, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 7: Make prediction
    log('\n📝 Test 7: Making prediction based on historical data...', 'blue');
    const predict = await callMCP('neural_patterns', {
      action: 'predict',
      metadata: { pattern_type: 'coordination' },
    });

    if (predict.success && predict.prediction) {
      log(`✅ PASS: Prediction made successfully`, 'green');
      log(`   Confidence: ${(predict.prediction.confidence * 100).toFixed(2)}%`, 'cyan');
      log(`   Recommendation: ${predict.prediction.recommendation}`, 'cyan');
      passedTests++;
    } else {
      log(`❌ FAIL: Prediction failed`, 'red');
      log(`   Response: ${JSON.stringify(predict, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Test 8: Store learning experience
    log('\n📝 Test 8: Storing learning experience...', 'blue');
    const learn = await callMCP('neural_patterns', {
      action: 'learn',
      operation: 'test_operation',
      outcome: 'successful',
      metadata: { context: 'manual test' },
    });

    if (learn.success && learn.learningId) {
      log(`✅ PASS: Learning experience stored successfully`, 'green');
      log(`   Learning ID: ${learn.learningId}`, 'cyan');
      passedTests++;
    } else {
      log(`❌ FAIL: Learning storage failed`, 'red');
      log(`   Response: ${JSON.stringify(learn, null, 2)}`, 'yellow');
      failedTests++;
    }

    // Summary
    log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                        Test Summary                          ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');

    const totalTests = passedTests + failedTests;
    const passRate = ((passedTests / totalTests) * 100).toFixed(1);

    log(`Total Tests: ${totalTests}`, 'blue');
    log(`Passed: ${passedTests}`, 'green');
    log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
    log(`Pass Rate: ${passRate}%\n`, failedTests > 0 ? 'yellow' : 'green');

    if (failedTests === 0) {
      log('🎉 All tests passed! Pattern persistence is working correctly.', 'green');
      process.exit(0);
    } else {
      log('⚠️  Some tests failed. Please review the output above.', 'yellow');
      process.exit(1);
    }
  } catch (error) {
    log(`\n❌ Test suite error: ${error.message}`, 'red');
    log(error.stack, 'yellow');
    process.exit(1);
  }
}

runTests();
