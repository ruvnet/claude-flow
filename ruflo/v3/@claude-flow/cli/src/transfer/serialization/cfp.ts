/**
 * CFP Format Serializer
 * Claude Flow Pattern format serialization
 */

import type { CFPFormat, SerializationFormat, PatternCollection } from '../types.js';
import * as crypto from 'crypto';

// Version info
const CFP_VERSION = '1.0.0';
const GENERATOR = 'claude-flow@3.0.0-alpha';

/**
 * Create a new CFP document
 */
export function createCFP(options: {
  name: string;
  description: string;
  patterns: PatternCollection;
  author?: { id: string; displayName?: string };
  license?: string;
  tags?: string[];
  language?: string;
  framework?: string;
}): CFPFormat {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  return {
    magic: 'CFP1',
    version: CFP_VERSION,
    createdAt: now,
    generatedBy: GENERATOR,

    metadata: {
      id,
      name: options.name,
      description: options.description,
      author: options.author ? {
        id: options.author.id,
        displayName: options.author.displayName,
        verified: false,
      } : undefined,
      license: options.license || 'MIT',
      tags: options.tags || [],
      language: options.language,
      framework: options.framework,
      createdAt: now,
      updatedAt: now,
    },

    anonymization: {
      level: 'minimal',
      appliedTransforms: [],
      piiRedacted: false,
      pathsStripped: false,
      timestampsGeneralized: false,
      checksum: '',
    },

    patterns: options.patterns,

    statistics: calculateStatistics(options.patterns),
  };
}

/**
 * Calculate pattern statistics
 */
function calculateStatistics(patterns: PatternCollection): CFPFormat['statistics'] {
  const counts: Record<string, number> = {
    routing: patterns.routing.length,
    complexity: patterns.complexity.length,
    coverage: patterns.coverage.length,
    trajectory: patterns.trajectory.length,
    custom: patterns.custom.length,
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Calculate average confidence from routing patterns
  const confidences = patterns.routing.map(p => p.confidence);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  return {
    totalPatterns: total,
    avgConfidence,
    patternTypes: counts,
    timeRange: {
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    },
  };
}

/**
 * Serialize CFP to JSON string
 */
export function serializeToJson(cfp: CFPFormat): string {
  // Calculate checksum before serialization
  const content = JSON.stringify({
    magic: cfp.magic,
    version: cfp.version,
    metadata: cfp.metadata,
    patterns: cfp.patterns,
  });

  cfp.anonymization.checksum = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  return JSON.stringify(cfp, null, 2);
}

/**
 * Serialize CFP to Buffer (for CBOR/binary formats)
 */
export function serializeToBuffer(cfp: CFPFormat, format: SerializationFormat): Buffer {
  // For now, just use JSON - in production, would use cbor-x or msgpack
  const json = serializeToJson(cfp);

  switch (format) {
    case 'json':
      return Buffer.from(json, 'utf-8');
    case 'cbor':
    case 'cbor.gz':
    case 'cbor.zstd':
    case 'msgpack':
      // Fallback to JSON for now
      // In production: use cbor-x, msgpack-lite, etc.
      console.warn(`Format ${format} not implemented, using JSON`);
      return Buffer.from(json, 'utf-8');
    default:
      return Buffer.from(json, 'utf-8');
  }
}

/**
 * Deserialize CFP from string/buffer
 */
export function deserializeCFP(data: string | Buffer): CFPFormat {
  const str = typeof data === 'string' ? data : data.toString('utf-8');
  const parsed = JSON.parse(str);

  // Validate magic bytes
  if (parsed.magic !== 'CFP1') {
    throw new Error(`Invalid CFP format: expected magic 'CFP1', got '${parsed.magic}'`);
  }

  return parsed as CFPFormat;
}

/**
 * Validate CFP document
 */
export function validateCFP(cfp: CFPFormat): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cfp.magic !== 'CFP1') {
    errors.push(`Invalid magic bytes: ${cfp.magic}`);
  }

  if (!cfp.version) {
    errors.push('Missing version');
  }

  if (!cfp.metadata?.id) {
    errors.push('Missing metadata.id');
  }

  if (!cfp.patterns) {
    errors.push('Missing patterns');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get file extension for format
 */
export function getFileExtension(format: SerializationFormat): string {
  switch (format) {
    case 'json':
      return '.cfp.json';
    case 'cbor':
      return '.cfp';
    case 'cbor.gz':
      return '.cfp.gz';
    case 'cbor.zstd':
      return '.cfp.zst';
    case 'msgpack':
      return '.cfp.mp';
    default:
      return '.cfp';
  }
}

/**
 * Detect format from file path
 */
export function detectFormat(filePath: string): SerializationFormat {
  if (filePath.endsWith('.cfp.json')) return 'json';
  if (filePath.endsWith('.cfp.gz')) return 'cbor.gz';
  if (filePath.endsWith('.cfp.zst')) return 'cbor.zstd';
  if (filePath.endsWith('.cfp.mp')) return 'msgpack';
  return 'cbor';
}
