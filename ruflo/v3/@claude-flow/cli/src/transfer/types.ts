/**
 * Transfer Hook Types
 * Core type definitions for pattern export/import and IPFS sharing
 */

// Anonymization levels
export type AnonymizationLevel = 'minimal' | 'standard' | 'strict' | 'paranoid';

// Serialization formats
export type SerializationFormat = 'cbor' | 'json' | 'msgpack' | 'cbor.gz' | 'cbor.zstd';

// Pattern types
export type PatternType = 'routing' | 'complexity' | 'coverage' | 'trajectory' | 'custom';

// Import strategies
export type ImportStrategy = 'replace' | 'merge' | 'append';

// Conflict resolution strategies
export type ConflictResolution = 'highest-confidence' | 'newest' | 'oldest' | 'keep-local' | 'keep-remote';

// Trust levels
export type TrustLevel = 'official' | 'verified' | 'community' | 'unverified' | 'untrusted';

// Pinning services
export type PinningService = 'local' | 'pinata' | 'web3storage' | 'infura' | 'custom';

/**
 * Pattern metadata
 */
export interface PatternMetadata {
  id: string;
  name?: string;
  description?: string;
  author?: AnonymizedAuthor;
  license?: string;
  tags: string[];
  language?: string;
  framework?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Anonymized author info
 */
export interface AnonymizedAuthor {
  id: string;
  displayName?: string;
  verified: boolean;
}

/**
 * Anonymization record
 */
export interface AnonymizationRecord {
  level: AnonymizationLevel;
  appliedTransforms: string[];
  piiRedacted: boolean;
  pathsStripped: boolean;
  timestampsGeneralized: boolean;
  checksum: string;
}

/**
 * Routing pattern
 */
export interface RoutingPattern {
  id: string;
  trigger: string;
  action: string;
  confidence: number;
  usageCount: number;
  successRate: number;
  context?: Record<string, unknown>;
}

/**
 * Complexity pattern
 */
export interface ComplexityPattern {
  id: string;
  pattern: string;
  complexity: number;
  tokens: number;
  frequency: number;
}

/**
 * Coverage pattern
 */
export interface CoveragePattern {
  id: string;
  domain: string;
  coverage: number;
  gaps: string[];
}

/**
 * Trajectory pattern
 */
export interface TrajectoryPattern {
  id: string;
  steps: string[];
  outcome: 'success' | 'failure' | 'partial';
  duration: number;
  learnings: string[];
}

/**
 * Custom pattern
 */
export interface CustomPattern {
  id: string;
  type: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * Pattern collection
 */
export interface PatternCollection {
  routing: RoutingPattern[];
  complexity: ComplexityPattern[];
  coverage: CoveragePattern[];
  trajectory: TrajectoryPattern[];
  custom: CustomPattern[];
}

/**
 * Statistics with differential privacy
 */
export interface PatternStatistics {
  totalPatterns: number;
  avgConfidence: number;
  patternTypes: Record<string, number>;
  timeRange: { start: string; end: string };
}

/**
 * Ed25519 signature
 */
export interface PatternSignature {
  algorithm: 'ed25519';
  publicKey: string;
  signature: string;
}

/**
 * IPFS metadata
 */
export interface IPFSMetadata {
  cid: string;
  pinnedAt: string[];
  gateway: string;
  size: number;
}

/**
 * Claude Flow Pattern (CFP) format
 */
export interface CFPFormat {
  // Magic bytes
  magic: 'CFP1';
  version: string;
  createdAt: string;
  generatedBy: string;

  // Metadata
  metadata: PatternMetadata;

  // Anonymization info
  anonymization: AnonymizationRecord;

  // Patterns
  patterns: PatternCollection;

  // Statistics
  statistics: PatternStatistics;

  // Optional signature
  signature?: PatternSignature;

  // Optional IPFS info
  ipfs?: IPFSMetadata;
}

/**
 * Export options
 */
export interface ExportOptions {
  output?: string;
  format?: SerializationFormat;
  anonymize?: AnonymizationLevel;
  redactPii?: boolean;
  stripPaths?: boolean;
  types?: PatternType[];
  minConfidence?: number;
  since?: string;
  toIpfs?: boolean;
  pin?: boolean;
  gateway?: string;
  sign?: boolean;
  privateKeyPath?: string;
}

/**
 * Import options
 */
export interface ImportOptions {
  input?: string;
  fromIpfs?: string;
  fromStore?: string;
  version?: string;
  strategy?: ImportStrategy;
  conflictResolution?: ConflictResolution;
  verifySignature?: boolean;
  dryRun?: boolean;
}

/**
 * Export result
 */
export interface ExportResult {
  success: boolean;
  outputPath?: string;
  cid?: string;
  gateway?: string;
  size: number;
  patternCount: number;
  anonymizationLevel: AnonymizationLevel;
  signature?: string;
}

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  conflicts: number;
  source: string;
  verified: boolean;
}

/**
 * IPFS config
 */
export interface IPFSConfig {
  gateway: string;
  apiEndpoint?: string;
  pinningService?: {
    name: PinningService;
    apiKey: string;
    apiSecret?: string;
  };
  timeout: number;
}

/**
 * PII detection result
 */
export interface PIIDetectionResult {
  found: boolean;
  count: number;
  types: Record<string, number>;
  locations: Array<{
    type: string;
    path: string;
    sample: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  signatureValid?: boolean;
  checksumValid: boolean;
  malwareCheck?: {
    safe: boolean;
    warnings: string[];
  };
  trustLevel: TrustLevel;
}
