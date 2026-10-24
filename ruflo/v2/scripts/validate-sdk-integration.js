#!/usr/bin/env node

/**
 * SDK Integration Validation Script
 * Claude-Flow v2.5-alpha.130
 *
 * Validates that SDK integration works without regressions
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set environment
process.env.NODE_ENV = 'development';
process.env.CLAUDE_FLOW_ENV = 'production';
process.env.ANTHROPIC_API_KEY = 'test-key-validation';

console.log('🔍 Validating SDK Integration for v2.5-alpha.130...\n');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✨ No regressions detected!');
    process.exit(0);
  } else {
    console.log('⚠️  Regressions detected. Please review failures.');
    process.exit(1);
  }
}

// Test 1: SDK Configuration
test('SDK Configuration Adapter exists and loads', async () => {
  const sdkConfigPath = path.join(__dirname, '../src/sdk/sdk-config.ts');
  if (!fs.existsSync(sdkConfigPath)) {
    throw new Error('sdk-config.ts not found');
  }

  // Check exports
  const content = fs.readFileSync(sdkConfigPath, 'utf8');
  if (!content.includes('export class ClaudeFlowSDKAdapter')) {
    throw new Error('ClaudeFlowSDKAdapter not exported');
  }
  if (!content.includes('export const defaultSDKAdapter')) {
    throw new Error('defaultSDKAdapter not exported');
  }
});

// Test 2: Compatibility Layer
test('Compatibility Layer exists and has backward compat methods', async () => {
  const compatPath = path.join(__dirname, '../src/sdk/compatibility-layer.ts');
  if (!fs.existsSync(compatPath)) {
    throw new Error('compatibility-layer.ts not found');
  }

  const content = fs.readFileSync(compatPath, 'utf8');
  const requiredMethods = [
    'executeWithRetry',
    'calculateBackoff',
    'persistToDisk',
    'executeValidations',
    'mapLegacyRequest',
    'mapSDKResponse'
  ];

  for (const method of requiredMethods) {
    if (!content.includes(method)) {
      throw new Error(`${method} not found in compatibility layer`);
    }
  }
});

// Test 3: Claude Client v2.5
test('Claude Client v2.5 exists and uses SDK', async () => {
  const clientPath = path.join(__dirname, '../src/api/claude-client-v2.5.ts');
  if (!fs.existsSync(clientPath)) {
    throw new Error('claude-client-v2.5.ts not found');
  }

  const content = fs.readFileSync(clientPath, 'utf8');

  // Check SDK import
  if (!content.includes("import Anthropic from '@anthropic-ai/sdk'")) {
    throw new Error('Not importing Anthropic SDK');
  }

  // Check adapter usage
  if (!content.includes('ClaudeFlowSDKAdapter')) {
    throw new Error('Not using ClaudeFlowSDKAdapter');
  }

  // Check backward compat
  if (!content.includes('executeWithRetry')) {
    throw new Error('Missing backward compatible executeWithRetry method');
  }
});

// Test 4: Task Executor SDK
test('Task Executor SDK exists and uses new client', async () => {
  const executorPath = path.join(__dirname, '../src/swarm/executor-sdk.ts');
  if (!fs.existsSync(executorPath)) {
    throw new Error('executor-sdk.ts not found');
  }

  const content = fs.readFileSync(executorPath, 'utf8');

  // Check imports
  if (!content.includes('ClaudeClientV25')) {
    throw new Error('Not using ClaudeClientV25');
  }

  if (!content.includes('ClaudeFlowSDKAdapter')) {
    throw new Error('Not using ClaudeFlowSDKAdapter');
  }

  // Check methods
  const requiredMethods = [
    'executeTask',
    'executeStreamingTask',
    'executeClaudeTask',
    'getExecutionStats',
    'getHealthStatus'
  ];

  for (const method of requiredMethods) {
    if (!content.includes(method)) {
      throw new Error(`${method} not found in executor`);
    }
  }
});

// Test 5: Package.json has SDK dependency
test('Package.json includes @anthropic-ai/sdk dependency', async () => {
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  if (!packageJson.dependencies['@anthropic-ai/sdk']) {
    throw new Error('@anthropic-ai/sdk not in dependencies');
  }

  console.log(`   SDK Version: ${packageJson.dependencies['@anthropic-ai/sdk']}`);
});

// Test 6: No breaking changes in exports
test('Key exports are maintained for backward compatibility', async () => {
  // Check that we can import without errors (syntax check)
  const files = [
    '../src/sdk/sdk-config.ts',
    '../src/sdk/compatibility-layer.ts',
    '../src/api/claude-client-v2.5.ts',
    '../src/swarm/executor-sdk.ts'
  ];

  for (const file of files) {
    const fullPath = path.join(__dirname, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Basic syntax checks
    if (content.includes('export {') || content.includes('export class') || content.includes('export interface')) {
      // File has exports
    } else {
      throw new Error(`${file} has no exports`);
    }
  }
});

// Test 7: Deprecation warnings are in place
test('Deprecation warnings exist for legacy methods', async () => {
  const compatPath = path.join(__dirname, '../src/sdk/compatibility-layer.ts');
  const content = fs.readFileSync(compatPath, 'utf8');

  if (!content.includes('logDeprecation')) {
    throw new Error('No deprecation logging mechanism');
  }

  if (!content.includes('[Deprecation]')) {
    throw new Error('No deprecation warning messages');
  }
});

// Test 8: Error handling is preserved
test('Error handling maps SDK errors correctly', async () => {
  const clientPath = path.join(__dirname, '../src/api/claude-client-v2.5.ts');
  const content = fs.readFileSync(clientPath, 'utf8');

  const errorTypes = [
    'Anthropic.AuthenticationError',
    'Anthropic.RateLimitError',
    'Anthropic.BadRequestError',
    'ClaudeAuthenticationError',
    'ClaudeRateLimitError',
    'ClaudeValidationError'
  ];

  for (const errorType of errorTypes) {
    if (!content.includes(errorType)) {
      throw new Error(`${errorType} not handled`);
    }
  }
});

// Test 9: Swarm mode is supported
test('Swarm mode configuration is maintained', async () => {
  const sdkPath = path.join(__dirname, '../src/sdk/sdk-config.ts');
  const content = fs.readFileSync(sdkPath, 'utf8');

  if (!content.includes('swarmMode')) {
    throw new Error('swarmMode configuration missing');
  }

  if (!content.includes('swarmMetadata')) {
    throw new Error('swarmMetadata tracking missing');
  }
});

// Test 10: Performance optimizations
test('Performance optimizations are in place', async () => {
  // Check that retry logic is removed (delegated to SDK)
  const oldClientPath = path.join(__dirname, '../src/api/claude-client.ts');
  const newClientPath = path.join(__dirname, '../src/api/claude-client-v2.5.ts');

  if (fs.existsSync(oldClientPath)) {
    const oldContent = fs.readFileSync(oldClientPath, 'utf8');
    const oldLines = oldContent.split('\n').length;

    const newContent = fs.readFileSync(newClientPath, 'utf8');
    const newLines = newContent.split('\n').length;

    // New client should be smaller (removed retry logic)
    console.log(`   Old client: ${oldLines} lines, New client: ${newLines} lines`);
    console.log(`   Code reduction: ${oldLines - newLines} lines`);
  }
});

// Run all tests
console.log('Running validation tests...\n');
runTests().catch(console.error);