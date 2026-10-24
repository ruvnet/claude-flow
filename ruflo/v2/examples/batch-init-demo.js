#!/usr/bin/env -S deno run --allow-all
/**
 * Batch Initialization Demo Script
 * Demonstrates all batch initialization features
 */

import { batchInitCommand, PROJECT_TEMPLATES, ENVIRONMENT_CONFIGS } from '../src/cli/simple-commands/init/batch-init.js';

console.log('🚀 Claude-Flow Batch Initialization Demo');
console.log('========================================\n');

// Demo 1: Simple batch initialization
console.log('📋 Demo 1: Simple Batch Initialization');
console.log('--------------------------------------');
console.log('Command: claude-flow init --batch-init demo-api,demo-web,demo-cli');
console.log('This would create 3 basic projects with default settings.\n');

// Demo 2: Template-based batch initialization
console.log('📋 Demo 2: Template-Based Batch Initialization');
console.log('----------------------------------------------');
console.log('Command: claude-flow init --batch-init api-v1,api-v2 --template web-api --sparc');
console.log('Creates 2 web API projects with SPARC development environment.\n');

// Demo 3: Multi-environment batch initialization
console.log('📋 Demo 3: Multi-Environment Batch Initialization');
console.log('-----------------------------------------------');
console.log('Command: claude-flow init --batch-init myapp --environments dev,staging,prod');
console.log('Creates myapp-dev, myapp-staging, and myapp-prod projects.\n');

// Demo 4: Configuration file batch initialization
console.log('📋 Demo 4: Configuration File Batch Initialization');
console.log('------------------------------------------------');
console.log('Command: claude-flow init --config batch-config-enterprise.json');
console.log('Uses complex configuration file for multiple projects.\n');

// Demo 5: Available templates
console.log('📋 Demo 5: Available Project Templates');
console.log('-------------------------------------');
for (const [key, template] of Object.entries(PROJECT_TEMPLATES)) {
  console.log(`• ${key}: ${template.description}`);
}
console.log();

// Demo 6: Available environments
console.log('📋 Demo 6: Available Environment Configurations');
console.log('---------------------------------------------');
for (const [key, env] of Object.entries(ENVIRONMENT_CONFIGS)) {
  console.log(`• ${key}: ${env.name} (${env.features.join(', ')})`);
}
console.log();

// Demo 7: Batch manager utilities
console.log('📋 Demo 7: Batch Manager Utilities');
console.log('---------------------------------');
console.log('claude-flow batch create-config --interactive  # Create interactive config');
console.log('claude-flow batch validate-config my-batch.json # Validate configuration');
console.log('claude-flow batch estimate my-batch.json        # Estimate time/resources');
console.log('claude-flow batch list-templates                # List all templates');
console.log('claude-flow batch list-environments             # List all environments');
console.log();

// Performance demonstration
console.log('📊 Performance Features');
console.log('----------------------');
console.log('• Parallel Processing: Up to 20 concurrent operations');
console.log('• Resource Management: Memory and CPU usage limits');
console.log('• Progress Tracking: Real-time progress bars and statistics');
console.log('• Validation: Pre-flight checks for all configurations');
console.log('• Error Recovery: Continues processing even if some projects fail');
console.log('• Detailed Reporting: Success/failure statistics and timing');
console.log();

console.log('🛠️  Integration with SPARC');
console.log('------------------------');
console.log('All batch operations support SPARC development environment:');
console.log('• --sparc flag enables SPARC modes for all projects');
console.log('• Creates .claude/commands/ with specialized slash commands');
console.log('• Generates optimized prompts for parallel processing');
console.log('• Integrates with TDD workflows and automated testing');
console.log();

console.log('💡 Tips for Effective Batch Operations');
console.log('------------------------------------');
console.log('1. Use configuration files for complex multi-project setups');
console.log('2. Validate configurations before running batch operations');
console.log('3. Estimate time and resources for large batch operations');
console.log('4. Use templates to ensure consistency across projects');
console.log('5. Leverage parallel processing for faster initialization');
console.log('6. Monitor progress with built-in tracking features');
console.log();

console.log('🚀 Ready to try batch initialization!');
console.log('Run any of the demo commands above to get started.');