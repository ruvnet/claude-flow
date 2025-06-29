/**
 * Verification Framework Demonstration
 * Shows how the mandatory status.json validation works
 */

import { SwarmVerificationFramework, getDefaultVerificationRequirements } from './index.js';
import { Logger } from '../../core/logger.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Demo: Verification enforcement in action
 */
async function demonstrateVerificationFramework() {
  console.log('🔍 Starting Verification Framework Demonstration');
  console.log('='.repeat(60));

  // Initialize logger and framework
  const logger = new Logger({
    level: 'info',
    format: 'json',
    destination: 'console'
  }, { component: 'VerificationDemo' });

  const framework = new SwarmVerificationFramework(logger, {
    enforcement_enabled: true,
    status_directory: './.claude-flow/demo-verification',
    status_timeout_ms: 30000,
    fail_fast: false
  });

  console.log('✅ Verification framework initialized');

  // Demo 1: Create and validate a status file
  console.log('\n📝 Demo 1: Creating agent status file');
  const statusFilePath = await framework.createAgentStatusFile(
    'demo-agent-1',
    'Demonstrate verification system',
    ['npm run typecheck', "grep -r spawn src --include='*.ts' | wc -l"]
  );
  console.log(`📄 Created status file: ${statusFilePath}`);

  // Demo 2: Execute verification commands
  console.log('\n⚡ Demo 2: Executing verification commands');
  const commands = [
    {
      command: 'npm run typecheck',
      expectation: 'failure' as const, // We expect this to fail (551 errors)
      description: 'TypeScript compilation check',
      critical: true,
      timeout: 30000
    },
    {
      command: "grep -r spawn src --include='*.ts' | wc -l",
      expectation: 'success' as const,
      description: 'Count spawn calls in codebase',
      critical: false,
      timeout: 10000
    }
  ];

  const verificationResults = await framework.executeVerificationCommands(commands);
  
  console.log('\n📊 Verification Results:');
  verificationResults.forEach((result, index) => {
    const status = result.matches_expectation ? '✅' : '❌';
    console.log(`  ${status} Command ${index + 1}: ${result.command}`);
    console.log(`     Success: ${result.success}, Expected: ${commands[index]?.expectation ?? 'unknown'}`);
    console.log(`     Matches Expectation: ${result.matches_expectation}`);
    console.log(`     Duration: ${result.duration}ms`);
    if (result.output && result.output.trim()) {
      console.log(`     Output: ${result.output.trim()}`);
    }
    if (result.error && result.error.trim()) {
      console.log(`     Error: ${result.error.trim()}`);
    }
    console.log('');
  });

  // Demo 3: Update status file with results
  console.log('\n📝 Demo 3: Updating status file with verification results');
  const hasErrors = verificationResults.some(r => !r.matches_expectation);
  const errorCount = verificationResults.filter(r => !r.matches_expectation).length;

  await framework.updateStatusFile(statusFilePath, {
    ok: !hasErrors,
    errors: errorCount,
    spawned: 1,
    verification_results: verificationResults,
    details: {
      objective: 'Demonstrate verification system',
      strategy: 'demonstration',
      mode: 'single-agent',
      duration: verificationResults.reduce((sum, r) => sum + r.duration, 0)
    }
  });

  console.log(`📄 Updated status file with ${errorCount} errors`);

  // Demo 4: Agent verification requirements
  console.log('\n🤖 Demo 4: Default verification requirements');
  const agentTypes = ['typescript', 'test', 'build', 'general'] as const;
  
  agentTypes.forEach(type => {
    const requirements = getDefaultVerificationRequirements(`demo-${type}-agent`, type);
    console.log(`  ${type.toUpperCase()} agent requirements:`);
    requirements.required_commands.forEach(cmd => {
      console.log(`    - ${cmd.command} (${cmd.critical ? 'critical' : 'optional'})`);
    });
  });

  // Demo 5: Enforcement demonstration
  console.log('\n🚨 Demo 5: Verification enforcement');
  
  // Create a second agent with failing verification
  const failingAgentPath = await framework.createAgentStatusFile(
    'failing-agent',
    'Agent that will fail verification',
    ['false'] // Command that always fails
  );

  // Update it to claim success (but verification will catch this)
  await framework.updateStatusFile(failingAgentPath, {
    ok: true,   // Claims success
    errors: 0,  // Claims no errors
    spawned: 1
  });

  // Now enforce verification - this should fail
  const agentRequirements = [
    {
      agentId: 'failing-agent',
      required_commands: [
        {
          command: 'false', // Always fails
          expectation: 'success' as const, // But we expect success
          description: 'Failing command test',
          critical: true,
          timeout: 5000
        }
      ],
      working_directory: process.cwd(),
      environment: {}
    }
  ];

  const enforcementResult = await framework.enforceVerification(agentRequirements);
  
  console.log('\n📊 Enforcement Results:');
  console.log(`  Overall Success: ${enforcementResult.success ? '✅' : '❌'}`);
  console.log(`  Successful Agents: ${enforcementResult.summary.successful_agents}`);
  console.log(`  Failed Agents: ${enforcementResult.summary.failed_agents}`);
  console.log(`  Missing Status Files: ${enforcementResult.summary.missing_status_files}`);

  enforcementResult.results.forEach(result => {
    console.log(`\n  Agent ${result.agentId}:`);
    console.log(`    Verification Success: ${result.verification_success ? '✅' : '❌'}`);
    console.log(`    Status Valid: ${result.status_valid ? '✅' : '❌'}`);
    if (result.errors.length > 0) {
      console.log(`    Errors:`);
      result.errors.forEach(error => {
        console.log(`      - ${error}`);
      });
    }
  });

  // Demo 6: Show the target schema
  console.log('\n📋 Demo 6: Target Status Schema');
  console.log(`
Target status.json schema that all agents must follow:

{
  "ok": boolean,              // Overall operation success - MANDATORY
  "errors": number,           // Number of errors (must be 0 for ok: true) - MANDATORY
  "spawned": number,          // Number of agents/processes spawned - MANDATORY
  "timestamp": "ISO string",  // ISO timestamp - MANDATORY
  "verification_commands": [  // Commands executed for verification - MANDATORY
    "npm run typecheck",
    "grep -r spawn src --include='*.ts' | wc -l"
  ],
  "details": { ... },         // Optional details
  "error_details": { ... },   // Required if errors > 0
  "verification": { ... }     // Framework metadata
}

ENFORCEMENT RULES:
- Missing status.json file = operation failure
- Invalid status.json schema = operation failure  
- ok: false or errors > 0 = operation failure
- Failed verification commands = operation failure
  `);

  console.log('\n🎯 Demonstration Complete!');
  console.log('\nKey Points:');
  console.log('✅ Verification framework prevents aspirational reporting');
  console.log('✅ Status files are mandatory and validated against schema');
  console.log('✅ Verification commands must actually pass');
  console.log('✅ Coordinator enforces verification before completion');
  console.log('✅ Framework is now integrated into SwarmCoordinator');
}

/**
 * Create example status files for reference
 */
async function createExampleStatusFiles() {
  const exampleDir = './.claude-flow/verification-examples';
  await mkdir(exampleDir, { recursive: true });

  // Valid status example
  const validStatus = {
    ok: true,
    errors: 0,
    spawned: 3,
    timestamp: new Date().toISOString(),
    verification_commands: [
      'npm run typecheck',
      'npm test',
      "grep -r spawn src --include='*.ts' | wc -l"
    ],
    details: {
      objective: 'Complete TypeScript error fixes',
      strategy: 'development',
      mode: 'hierarchical',
      agents: {
        total: 3,
        active: 0,
        failed: 0,
        completed: 3
      },
      tasks: {
        total: 15,
        pending: 0,
        running: 0,
        completed: 15,
        failed: 0
      },
      duration: 120000
    },
    verification: {
      framework_version: '1.0.0',
      enforcement_enabled: true,
      verified_by: 'swarm-coordinator',
      verified_at: new Date().toISOString()
    }
  };

  // Invalid status example (with errors)
  const invalidStatus = {
    ok: false,
    errors: 3,
    spawned: 2,
    timestamp: new Date().toISOString(),
    verification_commands: [
      'npm run typecheck',
      'npm test'
    ],
    details: {
      objective: 'Attempted fixes but encountered errors',
      strategy: 'development',
      mode: 'centralized',
      duration: 45000
    },
    error_details: {
      critical: [
        'TypeScript compilation failed with 127 errors',
        'Unit tests failed: 3 test suites failed',
        'Build process terminated with exit code 1'
      ],
      warnings: [
        'Deprecated API usage detected',
        'Performance optimization opportunities found'
      ],
      failed_commands: [
        'npm run typecheck',
        'npm test'
      ],
      command_outputs: {
        'npm run typecheck': 'src/example.ts(42,11): error TS2322: Type \'string\' is not assignable to type \'number\'.',
        'npm test': 'FAIL src/example.test.ts - 3 failed, 0 passed'
      }
    },
    verification: {
      framework_version: '1.0.0',
      enforcement_enabled: true,
      verified_by: 'swarm-coordinator',
      verified_at: new Date().toISOString()
    }
  };

  await writeFile(
    join(exampleDir, 'valid-status-example.json'),
    JSON.stringify(validStatus, null, 2)
  );

  await writeFile(
    join(exampleDir, 'invalid-status-example.json'),
    JSON.stringify(invalidStatus, null, 2)
  );

  console.log(`\n📁 Example status files created in: ${exampleDir}`);
}

// Run the demonstration
// Check if this file is being run directly
const isMainModule = process.argv[1] && (process.argv[1].endsWith('demo.ts') || process.argv[1].endsWith('demo.js'));
if (isMainModule) {
  demonstrateVerificationFramework()
    .then(() => createExampleStatusFiles())
    .then(() => {
      console.log('\n🚀 Verification framework is ready for use!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstrateVerificationFramework, createExampleStatusFiles };