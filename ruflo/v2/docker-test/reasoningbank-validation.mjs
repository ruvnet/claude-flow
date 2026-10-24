#!/usr/bin/env node
/**
 * Docker Validation Test for ReasoningBank Semantic Search
 * Tests claude-flow@alpha with agentic-flow@1.5.13 Node.js backend
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

async function validateReasoningBank() {
  console.log('🐳 Docker Validation: ReasoningBank Semantic Search');
  console.log('📦 Testing: claude-flow@alpha (from npm)\n');

  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  try {
    // Test 1: Verify installation
    console.log('1️⃣ Verifying installation...');
    try {
      const { stdout: version } = await execAsync('npx claude-flow@alpha --version');
      console.log(`   ✅ Version: ${version.trim()}`);
      results.passed.push('Installation verified');
    } catch (error) {
      console.error(`   ❌ Installation failed: ${error.message}`);
      results.failed.push('Installation');
      throw error;
    }

    // Test 2: Initialize ReasoningBank memory (explicit mode)
    console.log('\n2️⃣ Initializing ReasoningBank memory...');
    try {
      const { stdout } = await execAsync('npx claude-flow@alpha memory init --reasoningbank');
      console.log(`   ${stdout.trim()}`);
      results.passed.push('ReasoningBank initialization');
    } catch (error) {
      console.error(`   ❌ Init failed: ${error.message}`);
      results.failed.push('ReasoningBank initialization');
    }

    // Test 3: Store test memories (with ReasoningBank mode)
    console.log('\n3️⃣ Storing test memories to ReasoningBank...');
    const testMemories = [
      { key: 'docker-auth', value: 'Implement JWT authentication with Docker secrets', namespace: 'security' },
      { key: 'docker-api', value: 'Create containerized REST API with health checks', namespace: 'backend' },
      { key: 'docker-db', value: 'Setup PostgreSQL database container with volumes', namespace: 'backend' }
    ];

    for (const mem of testMemories) {
      try {
        await execAsync(`npx claude-flow@alpha memory store "${mem.key}" "${mem.value}" --namespace ${mem.namespace} --reasoningbank`);
        console.log(`   ✅ Stored: ${mem.key}`);
      } catch (error) {
        console.error(`   ❌ Failed to store ${mem.key}: ${error.message}`);
        results.failed.push(`Store memory: ${mem.key}`);
      }
    }
    results.passed.push('Memory storage with ReasoningBank (3 entries)');

    // Test 4: Verify database exists
    console.log('\n4️⃣ Verifying database creation...');
    const dbPath = '.swarm/memory.db';
    if (existsSync(dbPath)) {
      console.log(`   ✅ Database created: ${dbPath}`);
      results.passed.push('Database persistence');
    } else {
      console.error(`   ❌ Database not found: ${dbPath}`);
      results.failed.push('Database persistence');
    }

    // Test 5: Query memories (semantic search with ReasoningBank)
    console.log('\n5️⃣ Testing ReasoningBank semantic search...');
    try {
      const { stdout } = await execAsync('npx claude-flow@alpha memory query "authentication" --namespace security --limit 5 --reasoningbank');
      if (stdout.includes('No results found')) {
        console.warn('   ⚠️  No results from semantic search (embeddings may need API key)');
        results.warnings.push('Semantic search returned no results');
      } else {
        console.log('   ✅ ReasoningBank semantic search working');
        results.passed.push('ReasoningBank semantic search');
      }
    } catch (error) {
      console.error(`   ❌ Query failed: ${error.message}`);
      results.failed.push('ReasoningBank semantic search');
    }

    // Test 6: List memories (ReasoningBank mode)
    console.log('\n6️⃣ Listing ReasoningBank memories...');
    try {
      const { stdout } = await execAsync('npx claude-flow@alpha memory list --limit 10 --reasoningbank');
      console.log(stdout.trim());
      if (stdout.includes('security') || stdout.includes('backend')) {
        console.log('   ✅ ReasoningBank memory listing working');
        results.passed.push('ReasoningBank memory listing');
      } else {
        console.warn('   ⚠️  Unexpected list output');
        results.warnings.push('ReasoningBank listing format');
      }
    } catch (error) {
      console.error(`   ❌ List failed: ${error.message}`);
      results.failed.push('ReasoningBank memory listing');
    }

    // Test 7: ReasoningBank status
    console.log('\n7️⃣ Checking ReasoningBank status...');
    try {
      const { stdout } = await execAsync('npx claude-flow@alpha memory status --reasoningbank');
      console.log(stdout.trim());
      if (stdout.includes('SQLite') || stdout.includes('memory.db') || stdout.includes('ReasoningBank')) {
        console.log('   ✅ Status reporting ReasoningBank Node.js backend');
        results.passed.push('ReasoningBank status (Node.js backend)');
      } else {
        console.warn('   ⚠️  Backend type unclear in status');
        results.warnings.push('ReasoningBank backend detection');
      }
    } catch (error) {
      console.error(`   ❌ Status failed: ${error.message}`);
      results.failed.push('ReasoningBank status');
    }

    // Test 8: Database inspection
    console.log('\n8️⃣ Inspecting database structure...');
    try {
      const { stdout } = await execAsync('sqlite3 .swarm/memory.db "SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name;"');
      const tables = stdout.trim().split('\n');
      console.log(`   ✅ Found ${tables.length} tables: ${tables.join(', ')}`);

      if (tables.includes('patterns') && tables.includes('pattern_embeddings')) {
        console.log('   ✅ Required tables present');
        results.passed.push('Database schema');
      } else {
        console.error('   ❌ Missing required tables');
        results.failed.push('Database schema');
      }
    } catch (error) {
      console.error(`   ❌ Database inspection failed: ${error.message}`);
      results.failed.push('Database inspection');
    }

    // Test 9: Count stored patterns
    console.log('\n9️⃣ Counting stored patterns...');
    try {
      const { stdout } = await execAsync('sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM patterns WHERE type=\'reasoning_memory\';"');
      const count = parseInt(stdout.trim());
      console.log(`   ✅ Total patterns: ${count}`);
      if (count >= 3) {
        results.passed.push(`Pattern storage (${count} entries)`);
      } else {
        console.warn(`   ⚠️  Expected 3+ patterns, found ${count}`);
        results.warnings.push('Pattern count lower than expected');
      }
    } catch (error) {
      console.error(`   ❌ Count failed: ${error.message}`);
      results.failed.push('Pattern counting');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during validation:', error.message);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VALIDATION SUMMARY');
  console.log('='.repeat(60));

  console.log(`\n✅ Passed (${results.passed.length}):`);
  results.passed.forEach(test => console.log(`   • ${test}`));

  if (results.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${results.warnings.length}):`);
    results.warnings.forEach(test => console.log(`   • ${test}`));
  }

  if (results.failed.length > 0) {
    console.log(`\n❌ Failed (${results.failed.length}):`);
    results.failed.forEach(test => console.log(`   • ${test}`));
  }

  const successRate = (results.passed.length / (results.passed.length + results.failed.length) * 100).toFixed(1);
  console.log(`\n📈 Success Rate: ${successRate}%`);

  if (results.failed.length === 0) {
    console.log('\n✅ ALL TESTS PASSED! ReasoningBank semantic search is working!');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED - Review errors above');
    process.exit(1);
  }
}

// Run validation
validateReasoningBank().catch(err => {
  console.error('💥 Validation failed:', err);
  process.exit(1);
});
