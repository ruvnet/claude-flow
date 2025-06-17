#!/usr/bin/env -S deno run --allow-all
/**
 * Test Suite for Batch Initialization Features
 */

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { 
  batchInitCommand, 
  validateBatchOptions,
  PROJECT_TEMPLATES,
  ENVIRONMENT_CONFIGS
} from '../src/cli/simple-commands/init/batch-init.js';

// Test configuration
const TEST_DIR = './test-batch-output';

// Cleanup function
async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist, which is fine
  }
}

// Setup test environment
async function setup() {
  await cleanup();
  await Deno.mkdir(TEST_DIR, { recursive: true });
  Deno.chdir(TEST_DIR);
}

// Test 1: Validate batch options
Deno.test('Batch Options Validation', () => {
  console.log('🧪 Testing batch options validation...');
  
  // Valid options
  let errors = validateBatchOptions({
    maxConcurrency: 5,
    template: 'web-api',
    environments: ['dev', 'staging']
  });
  assertEquals(errors.length, 0, 'Valid options should pass validation');
  
  // Invalid max concurrency
  errors = validateBatchOptions({
    maxConcurrency: 25
  });
  assert(errors.some(e => e.includes('maxConcurrency')), 'High concurrency should fail');
  
  // Invalid template
  errors = validateBatchOptions({
    template: 'invalid-template'
  });
  assert(errors.some(e => e.includes('template')), 'Invalid template should fail');
  
  // Invalid environment
  errors = validateBatchOptions({
    environments: ['invalid-env']
  });
  assert(errors.some(e => e.includes('environment')), 'Invalid environment should fail');
  
  console.log('✅ Batch options validation tests passed');
});

// Test 2: Project templates validation
Deno.test('Project Templates', () => {
  console.log('🧪 Testing project templates...');
  
  // Check that all templates have required properties
  for (const [key, template] of Object.entries(PROJECT_TEMPLATES)) {
    assert(template.name, `Template ${key} should have a name`);
    assert(template.description, `Template ${key} should have a description`);
    assert(Array.isArray(template.extraDirs), `Template ${key} should have extraDirs array`);
    assert(typeof template.extraFiles === 'object', `Template ${key} should have extraFiles object`);
  }
  
  // Check specific templates
  assert(PROJECT_TEMPLATES['web-api'], 'web-api template should exist');
  assert(PROJECT_TEMPLATES['react-app'], 'react-app template should exist');
  assert(PROJECT_TEMPLATES['microservice'], 'microservice template should exist');
  assert(PROJECT_TEMPLATES['cli-tool'], 'cli-tool template should exist');
  
  console.log('✅ Project templates tests passed');
});

// Test 3: Environment configurations validation
Deno.test('Environment Configurations', () => {
  console.log('🧪 Testing environment configurations...');
  
  // Check that all environments have required properties
  for (const [key, env] of Object.entries(ENVIRONMENT_CONFIGS)) {
    assert(env.name, `Environment ${key} should have a name`);
    assert(Array.isArray(env.features), `Environment ${key} should have features array`);
    assert(typeof env.config === 'object', `Environment ${key} should have config object`);
  }
  
  // Check specific environments
  assert(ENVIRONMENT_CONFIGS['dev'], 'dev environment should exist');
  assert(ENVIRONMENT_CONFIGS['staging'], 'staging environment should exist');
  assert(ENVIRONMENT_CONFIGS['prod'], 'prod environment should exist');
  
  console.log('✅ Environment configurations tests passed');
});

// Test 4: Batch initialization with minimal setup
Deno.test('Batch Initialization - Minimal', async () => {
  console.log('🧪 Testing minimal batch initialization...');
  
  await setup();
  
  const projects = ['test-project-1', 'test-project-2'];
  const options = {
    parallel: false, // Sequential for testing
    minimal: true,
    progressTracking: false // Disable progress tracking for testing
  };
  
  const results = await batchInitCommand(projects, options);
  
  assertEquals(results.length, 2, 'Should create 2 projects');
  assert(results.every(r => r.success), 'All projects should be created successfully');
  
  // Check that projects were created
  for (const project of projects) {
    const stats = await Deno.stat(project);
    assert(stats.isDirectory, `${project} should be a directory`);
    
    // Check for essential files
    await Deno.stat(`${project}/CLAUDE.md`);
    await Deno.stat(`${project}/memory-bank.md`);
    await Deno.stat(`${project}/coordination.md`);
    await Deno.stat(`${project}/memory/claude-flow-data.json`);
  }
  
  console.log('✅ Minimal batch initialization tests passed');
  await cleanup();
});

// Test 5: Template-based initialization
Deno.test('Template-Based Initialization', async () => {
  console.log('🧪 Testing template-based initialization...');
  
  await setup();
  
  const projects = ['api-project'];
  const options = {
    parallel: false,
    template: 'web-api',
    progressTracking: false
  };
  
  const results = await batchInitCommand(projects, options);
  
  assertEquals(results.length, 1, 'Should create 1 project');
  assert(results[0].success, 'Project should be created successfully');
  
  // Check template-specific files
  const projectDir = projects[0];
  await Deno.stat(`${projectDir}/package.json`);
  await Deno.stat(`${projectDir}/src/index.js`);
  await Deno.stat(`${projectDir}/src`);
  
  // Check package.json content
  const packageJson = JSON.parse(await Deno.readTextFile(`${projectDir}/package.json`));
  assertEquals(packageJson.name, 'api-project');
  assert(packageJson.dependencies.express, 'Should have Express dependency');
  
  console.log('✅ Template-based initialization tests passed');
  await cleanup();
});

// Test 6: Multi-environment initialization
Deno.test('Multi-Environment Initialization', async () => {
  console.log('🧪 Testing multi-environment initialization...');
  
  await setup();
  
  const projects = ['multi-env-app'];
  const options = {
    parallel: false,
    environments: ['dev', 'staging'],
    progressTracking: false
  };
  
  const results = await batchInitCommand(projects, options);
  
  assertEquals(results.length, 2, 'Should create 2 environment variants');
  assert(results.every(r => r.success), 'All environments should be created successfully');
  
  // Check that both environments were created
  await Deno.stat('multi-env-app-dev');
  await Deno.stat('multi-env-app-staging');
  
  // Check environment-specific configuration
  const devData = JSON.parse(await Deno.readTextFile('multi-env-app-dev/memory/claude-flow-data.json'));
  const stagingData = JSON.parse(await Deno.readTextFile('multi-env-app-staging/memory/claude-flow-data.json'));
  
  assertEquals(devData.environment, 'dev');
  assertEquals(stagingData.environment, 'staging');
  
  console.log('✅ Multi-environment initialization tests passed');
  await cleanup();
});

// Test 7: Error handling
Deno.test('Error Handling', async () => {
  console.log('🧪 Testing error handling...');
  
  await setup();
  
  // Test with invalid directory name
  const projects = ['test-project', ''];
  const options = {
    parallel: false,
    progressTracking: false
  };
  
  const results = await batchInitCommand(projects, options);
  
  assertEquals(results.length, 2, 'Should attempt to create 2 projects');
  assert(results[0].success, 'Valid project should succeed');
  assert(!results[1].success, 'Invalid project should fail');
  
  console.log('✅ Error handling tests passed');
  await cleanup();
});

console.log('\n🎉 All batch initialization tests completed!');
console.log('Run with: deno run --allow-all tests/batch-init.test.js');