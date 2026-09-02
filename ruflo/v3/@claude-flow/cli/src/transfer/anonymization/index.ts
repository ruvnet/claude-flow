/**
 * Anonymization Pipeline
 * PII detection and redaction for pattern export
 */

import type {
  CFPFormat,
  AnonymizationLevel,
  AnonymizationRecord,
  PIIDetectionResult,
} from '../types.js';
import * as crypto from 'crypto';

/**
 * PII detection patterns
 */
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  ipv6: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
  apiKey: /\b(sk-|pk-|api[_-]?key[_-]?)[a-zA-Z0-9]{20,}\b/gi,
  jwt: /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
  homePath: /\/(Users|home|Documents)\/[a-zA-Z0-9_.-]+/g,
  windowsPath: /[A-Z]:\\Users\\[a-zA-Z0-9_.-]+/g,
};

/**
 * Redaction replacements
 */
const REDACTIONS: Record<string, string | ((match: string) => string)> = {
  email: (match) => `user_${hash(match).slice(0, 8)}@example.com`,
  phone: '[REDACTED_PHONE]',
  ipv4: '0.0.0.0',
  ipv6: '::1',
  apiKey: '[REDACTED_API_KEY]',
  jwt: '[REDACTED_JWT]',
  homePath: '/user/anonymous',
  windowsPath: 'C:\\Users\\anonymous',
};

/**
 * Hash a string for consistent pseudonymization
 */
function hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Detect PII in a string
 */
export function detectPII(content: string): PIIDetectionResult {
  const result: PIIDetectionResult = {
    found: false,
    count: 0,
    types: {},
    locations: [],
  };

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = content.match(pattern);
    if (matches) {
      result.found = true;
      result.count += matches.length;
      result.types[type] = matches.length;

      for (const match of matches.slice(0, 5)) { // Limit to first 5 samples
        result.locations.push({
          type,
          path: 'content',
          sample: match.slice(0, 20) + (match.length > 20 ? '...' : ''),
          severity: getSeverity(type),
        });
      }
    }
  }

  return result;
}

/**
 * Get severity for PII type
 */
function getSeverity(type: string): 'low' | 'medium' | 'high' | 'critical' {
  switch (type) {
    case 'apiKey':
    case 'jwt':
      return 'critical';
    case 'email':
    case 'phone':
      return 'high';
    case 'ipv4':
    case 'ipv6':
      return 'medium';
    default:
      return 'low';
  }
}

/**
 * Redact PII from a string
 */
export function redactPII(content: string): string {
  let result = content;

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const replacement = REDACTIONS[type];
    if (typeof replacement === 'function') {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, replacement);
    }
  }

  return result;
}

/**
 * Apply anonymization to CFP document
 */
export function anonymizeCFP(
  cfp: CFPFormat,
  level: AnonymizationLevel
): { cfp: CFPFormat; transforms: string[] } {
  const transforms: string[] = [];
  const anonymized = JSON.parse(JSON.stringify(cfp)) as CFPFormat;

  // Level: Minimal
  if (['minimal', 'standard', 'strict', 'paranoid'].includes(level)) {
    // Redact author display name
    if (anonymized.metadata.author?.displayName) {
      anonymized.metadata.author.displayName = undefined;
      transforms.push('author-name-removed');
    }
  }

  // Level: Standard
  if (['standard', 'strict', 'paranoid'].includes(level)) {
    // Redact PII from all string fields
    const jsonStr = JSON.stringify(anonymized.patterns);
    const redacted = redactPII(jsonStr);
    anonymized.patterns = JSON.parse(redacted);
    transforms.push('pii-redacted');

    // Generalize timestamps
    anonymized.anonymization.timestampsGeneralized = true;
    transforms.push('timestamps-generalized');
  }

  // Level: Strict
  if (['strict', 'paranoid'].includes(level)) {
    // Hash all IDs
    for (const pattern of anonymized.patterns.routing) {
      pattern.id = `pattern_${hash(pattern.id).slice(0, 12)}`;
    }
    transforms.push('ids-hashed');

    // Remove context details
    for (const pattern of anonymized.patterns.routing) {
      pattern.context = undefined;
    }
    transforms.push('context-removed');

    anonymized.anonymization.pathsStripped = true;
    transforms.push('paths-stripped');
  }

  // Level: Paranoid
  if (level === 'paranoid') {
    // Add noise to numeric values (differential privacy)
    for (const pattern of anonymized.patterns.routing) {
      pattern.usageCount = Math.round(pattern.usageCount * (0.9 + Math.random() * 0.2));
      pattern.successRate = Math.min(1, Math.max(0, pattern.successRate + (Math.random() - 0.5) * 0.1));
    }
    transforms.push('differential-privacy-noise');

    // Remove all trajectory learnings
    for (const traj of anonymized.patterns.trajectory) {
      traj.learnings = [];
    }
    transforms.push('learnings-removed');
  }

  // Update anonymization record
  anonymized.anonymization.level = level;
  anonymized.anonymization.appliedTransforms = transforms;
  anonymized.anonymization.piiRedacted = level !== 'minimal';

  // Recalculate checksum
  const content = JSON.stringify({
    magic: anonymized.magic,
    version: anonymized.version,
    metadata: anonymized.metadata,
    patterns: anonymized.patterns,
  });
  anonymized.anonymization.checksum = hash(content);

  return { cfp: anonymized, transforms };
}

/**
 * Scan CFP for PII without modification
 */
export function scanCFPForPII(cfp: CFPFormat): PIIDetectionResult {
  const content = JSON.stringify(cfp.patterns);
  return detectPII(content);
}
