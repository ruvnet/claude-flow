/**
 * Pattern Export Pipeline
 * Export patterns with anonymization and optional IPFS upload
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  CFPFormat,
  ExportOptions,
  ExportResult,
  AnonymizationLevel,
} from './types.js';
import { serializeToJson, serializeToBuffer, getFileExtension } from './serialization/cfp.js';
import { anonymizeCFP, scanCFPForPII } from './anonymization/index.js';
import { uploadToIPFS } from './ipfs/upload.js';

/**
 * Export patterns to file or IPFS
 */
export async function exportPatterns(
  cfp: CFPFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const {
    output,
    format = 'json',
    anonymize = 'standard',
    redactPii = true,
    stripPaths = false,
    toIpfs = false,
    pin = true,
    gateway = 'https://w3s.link',
  } = options;

  // Step 1: Scan for PII
  const piiScan = scanCFPForPII(cfp);
  if (piiScan.found && redactPii) {
    console.log(`Found ${piiScan.count} PII items, will be redacted`);
  }

  // Step 2: Apply anonymization
  const { cfp: anonymizedCfp, transforms } = anonymizeCFP(cfp, anonymize);
  console.log(`Applied ${transforms.length} anonymization transforms: ${transforms.join(', ')}`);

  // Step 3: Serialize
  const serialized = format === 'json'
    ? serializeToJson(anonymizedCfp)
    : serializeToBuffer(anonymizedCfp, format);

  const size = typeof serialized === 'string' ? Buffer.byteLength(serialized) : serialized.length;

  // Step 4: Output
  let outputPath: string | undefined;
  let cid: string | undefined;

  if (toIpfs) {
    // Upload to IPFS
    const ipfsResult = await uploadToIPFS(
      Buffer.isBuffer(serialized) ? serialized : Buffer.from(serialized),
      {
        pin,
        gateway,
        name: anonymizedCfp.metadata.name || 'patterns',
      }
    );

    cid = ipfsResult.cid;
    anonymizedCfp.ipfs = {
      cid: ipfsResult.cid,
      pinnedAt: ipfsResult.pinnedAt ? [ipfsResult.pinnedAt] : [],
      gateway: ipfsResult.gateway,
      size: ipfsResult.size,
    };

    console.log(`Uploaded to IPFS: ${cid}`);
    console.log(`Gateway URL: ${gateway}/ipfs/${cid}`);
  }

  if (output) {
    // Write to file
    const ext = getFileExtension(format);
    outputPath = output.endsWith(ext) ? output : output + ext;

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    if (typeof serialized === 'string') {
      fs.writeFileSync(outputPath, serialized, 'utf-8');
    } else {
      fs.writeFileSync(outputPath, serialized);
    }

    console.log(`Exported to: ${outputPath}`);
  }

  // Calculate pattern count
  const patternCount =
    (cfp.patterns.routing?.length || 0) +
    (cfp.patterns.complexity?.length || 0) +
    (cfp.patterns.coverage?.length || 0) +
    (cfp.patterns.trajectory?.length || 0) +
    (cfp.patterns.custom?.length || 0);

  return {
    success: true,
    outputPath,
    cid,
    gateway: cid ? gateway : undefined,
    size,
    patternCount,
    anonymizationLevel: anonymize,
  };
}

/**
 * Export Seraphine genesis model
 */
export async function exportSeraphine(options: ExportOptions = {}): Promise<ExportResult> {
  // Dynamically import to avoid circular dependency
  const { createSeraphineGenesis } = await import('./models/seraphine.js');
  const genesis = createSeraphineGenesis();
  return exportPatterns(genesis, options);
}

/**
 * Quick export to file
 */
export async function quickExport(
  cfp: CFPFormat,
  outputPath: string
): Promise<ExportResult> {
  return exportPatterns(cfp, {
    output: outputPath,
    format: 'json',
    anonymize: 'standard',
  });
}

/**
 * Quick export to IPFS
 */
export async function quickExportToIPFS(
  cfp: CFPFormat,
  options: { gateway?: string; pin?: boolean } = {}
): Promise<ExportResult> {
  return exportPatterns(cfp, {
    toIpfs: true,
    pin: options.pin ?? true,
    gateway: options.gateway ?? 'https://w3s.link',
    format: 'json',
    anonymize: 'strict',
  });
}
