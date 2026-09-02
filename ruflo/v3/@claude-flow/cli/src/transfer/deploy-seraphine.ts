#!/usr/bin/env npx tsx
/**
 * Deploy Seraphine Genesis Model
 * Exports and uploads the first Claude Flow pattern model to IPFS
 *
 * Usage:
 *   npx tsx deploy-seraphine.ts
 *   npx tsx deploy-seraphine.ts --output ./patterns/
 *   npx tsx deploy-seraphine.ts --to-ipfs
 *   npx tsx deploy-seraphine.ts --to-ipfs --anonymize strict
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createSeraphineGenesis, getSeraphineInfo } from './models/seraphine.js';
import { exportPatterns } from './export.js';
import { serializeToJson, validateCFP } from './serialization/cfp.js';
import { scanCFPForPII } from './anonymization/index.js';
import type { AnonymizationLevel } from './types.js';

/**
 * CLI arguments
 */
interface DeployOptions {
  output?: string;
  toIpfs: boolean;
  anonymize: AnonymizationLevel;
  pin: boolean;
  gateway: string;
  validate: boolean;
  verbose: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): DeployOptions {
  const args = process.argv.slice(2);
  const options: DeployOptions = {
    toIpfs: false,
    anonymize: 'standard',
    pin: true,
    gateway: 'https://w3s.link',
    validate: true,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--to-ipfs':
      case '--ipfs':
        options.toIpfs = true;
        break;
      case '--anonymize':
      case '-a':
        options.anonymize = args[++i] as AnonymizationLevel;
        break;
      case '--no-pin':
        options.pin = false;
        break;
      case '--gateway':
      case '-g':
        options.gateway = args[++i];
        break;
      case '--no-validate':
        options.validate = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Seraphine Genesis Deployer
==========================

Deploy the foundational Claude Flow pattern model.

Usage:
  npx ts-node deploy-seraphine.ts [options]

Options:
  --output, -o <path>     Output file path
  --to-ipfs, --ipfs       Upload to IPFS
  --anonymize, -a <level> Anonymization level (minimal|standard|strict|paranoid)
  --gateway, -g <url>     IPFS gateway URL
  --no-pin                Don't pin to pinning service
  --no-validate           Skip validation
  --verbose, -v           Verbose output
  --help, -h              Show this help

Examples:
  npx ts-node deploy-seraphine.ts --output ./seraphine-genesis.cfp.json
  npx ts-node deploy-seraphine.ts --to-ipfs --anonymize strict
  npx ts-node deploy-seraphine.ts --to-ipfs --gateway https://dweb.link
`);
}

/**
 * Main deploy function
 */
async function deploy(): Promise<void> {
  const options = parseArgs();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        SERAPHINE GENESIS MODEL DEPLOYMENT                 ║');
  console.log('║        The First Claude Flow Pattern Model                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Create Seraphine Genesis
  console.log('📦 Creating Seraphine Genesis Model...');
  const genesis = createSeraphineGenesis();
  const info = getSeraphineInfo();

  console.log(`   Name: ${info.name}`);
  console.log(`   Version: ${info.version}`);
  console.log(`   Description: ${info.description.slice(0, 60)}...`);
  console.log('');
  console.log('   Pattern Counts:');
  for (const [type, count] of Object.entries(info.patternCounts)) {
    console.log(`     - ${type}: ${count}`);
  }
  console.log('');

  // Step 2: Validate
  if (options.validate) {
    console.log('✅ Validating CFP format...');
    const validation = validateCFP(genesis);
    if (!validation.valid) {
      console.error('❌ Validation failed:');
      for (const error of validation.errors) {
        console.error(`   - ${error}`);
      }
      process.exit(1);
    }
    console.log('   Format is valid!');
    console.log('');
  }

  // Step 3: Scan for PII
  console.log('🔍 Scanning for PII...');
  const piiScan = scanCFPForPII(genesis);
  if (piiScan.found) {
    console.log(`   Found ${piiScan.count} PII items:`);
    for (const [type, count] of Object.entries(piiScan.types)) {
      console.log(`     - ${type}: ${count}`);
    }
    console.log('   Will be redacted during export.');
  } else {
    console.log('   No PII detected!');
  }
  console.log('');

  // Step 4: Export
  console.log(`📤 Exporting with ${options.anonymize} anonymization...`);

  const exportOptions = {
    output: options.output,
    toIpfs: options.toIpfs,
    anonymize: options.anonymize,
    pin: options.pin,
    gateway: options.gateway,
    format: 'json' as const,
    redactPii: true,
  };

  // If no output specified and not uploading to IPFS, create default output
  if (!options.output && !options.toIpfs) {
    const defaultOutput = path.join(process.cwd(), 'seraphine-genesis.cfp.json');
    exportOptions.output = defaultOutput;
  }

  const result = await exportPatterns(genesis, exportOptions);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    DEPLOYMENT COMPLETE                     ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (result.success) {
    console.log('✅ Successfully deployed Seraphine Genesis!');
    console.log('');
    console.log('   📊 Export Summary:');
    console.log(`      Patterns: ${result.patternCount}`);
    console.log(`      Size: ${result.size} bytes`);
    console.log(`      Anonymization: ${result.anonymizationLevel}`);

    if (result.outputPath) {
      console.log('');
      console.log(`   📁 File: ${result.outputPath}`);
    }

    if (result.cid) {
      console.log('');
      console.log('   🌐 IPFS:');
      console.log(`      CID: ${result.cid}`);
      console.log(`      Gateway URL: ${result.gateway}/ipfs/${result.cid}`);
    }

    console.log('');
    console.log('   🎉 Hello World! The genesis pattern has been deployed.');
    console.log('   🌟 This is the first Claude Flow pattern ever shared.');
    console.log('');
  } else {
    console.error('❌ Deployment failed!');
    process.exit(1);
  }
}

// Run if executed directly
deploy().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
