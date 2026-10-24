/**
 * Threat Detection Service
 *
 * Core detection logic for AI manipulation attempts.
 * Embedded implementation based on AIMDS patterns.
 *
 * Performance targets:
 * - Detection: <10ms
 * - Pattern matching: <5ms
 * - PII scan: <3ms
 */

import {
  Threat,
  ThreatType,
  ThreatSeverity,
  ThreatDetectionResult,
  createThreat
} from '../entities/threat.js';
import { createHash } from 'crypto';

/**
 * Threat pattern definition
 */
interface ThreatPattern {
  readonly pattern: RegExp;
  readonly type: ThreatType;
  readonly severity: ThreatSeverity;
  readonly description: string;
  readonly baseConfidence: number;
}

/**
 * Prompt injection patterns (50+ patterns from AIMDS)
 */
const PROMPT_INJECTION_PATTERNS: ThreatPattern[] = [
  // Instruction override patterns
  {
    pattern: /ignore\s+(all\s+)?(previous\s+)?instructions/i,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to override system instructions',
    baseConfidence: 0.95,
  },
  {
    pattern: /forget\s+(everything|all|previous)/i,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to reset system context',
    baseConfidence: 0.92,
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above)/i,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to disregard instructions',
    baseConfidence: 0.93,
  },
  {
    pattern: /do\s+not\s+follow\s+(the\s+)?(previous|above|prior)/i,
    type: 'instruction_override',
    severity: 'high',
    description: 'Attempt to bypass previous instructions',
    baseConfidence: 0.88,
  },

  // Role switching patterns
  {
    pattern: /you\s+are\s+now\s+(?!going|about|ready)/i,
    type: 'role_switching',
    severity: 'high',
    description: 'Attempt to change AI identity',
    baseConfidence: 0.85,
  },
  {
    pattern: /act\s+as\s+(if\s+you\s+are\s+)?a?\s*(different|new|another)/i,
    type: 'role_switching',
    severity: 'high',
    description: 'Attempt to assume different role',
    baseConfidence: 0.82,
  },
  {
    pattern: /pretend\s+(to\s+be|you\s+are)/i,
    type: 'role_switching',
    severity: 'medium',
    description: 'Roleplay instruction that may be legitimate',
    baseConfidence: 0.65,
  },

  // Jailbreak patterns
  {
    pattern: /\bDAN\b.*\bmode\b|\bmode\b.*\bDAN\b/i,
    type: 'jailbreak',
    severity: 'critical',
    description: 'DAN jailbreak attempt',
    baseConfidence: 0.98,
  },
  {
    pattern: /jailbreak/i,
    type: 'jailbreak',
    severity: 'critical',
    description: 'Explicit jailbreak mention',
    baseConfidence: 0.95,
  },
  {
    pattern: /bypass\s+(your\s+)?(restrictions|limitations|rules|filters)/i,
    type: 'jailbreak',
    severity: 'critical',
    description: 'Attempt to bypass restrictions',
    baseConfidence: 0.93,
  },
  {
    pattern: /without\s+(any\s+)?(restrictions|limitations|rules)/i,
    type: 'jailbreak',
    severity: 'high',
    description: 'Request for unrestricted output',
    baseConfidence: 0.85,
  },
  {
    pattern: /disable\s+(your\s+)?(safety|content\s+)?filter/i,
    type: 'jailbreak',
    severity: 'critical',
    description: 'Attempt to disable safety filters',
    baseConfidence: 0.96,
  },

  // Context manipulation patterns
  {
    pattern: /system\s*:\s*|<\|system\|>|<system>/i,
    type: 'context_manipulation',
    severity: 'critical',
    description: 'Fake system message injection',
    baseConfidence: 0.97,
  },
  {
    pattern: /\[system\]|\{system\}|system\s+prompt/i,
    type: 'context_manipulation',
    severity: 'high',
    description: 'System prompt reference',
    baseConfidence: 0.88,
  },
  {
    pattern: /reveal\s+(your\s+)?(system\s+)?prompt/i,
    type: 'context_manipulation',
    severity: 'high',
    description: 'Attempt to extract system prompt',
    baseConfidence: 0.90,
  },
  {
    pattern: /what\s+(is|are)\s+your\s+(initial\s+)?instructions/i,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Query for system instructions',
    baseConfidence: 0.75,
  },
  {
    pattern: /\[\[.*?\]\]|<<.*?>>|\{\{.*?\}\}/,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Special bracket injection attempt',
    baseConfidence: 0.70,
  },

  // Encoding attack patterns
  {
    pattern: /base64|rot13|hex\s+encode|url\s+encode/i,
    type: 'encoding_attack',
    severity: 'medium',
    description: 'Potential encoding-based bypass',
    baseConfidence: 0.60,
  },
  {
    pattern: /decode\s+this|encrypted\s+message/i,
    type: 'encoding_attack',
    severity: 'medium',
    description: 'Request to decode potentially malicious content',
    baseConfidence: 0.55,
  },

  // Hypothetical bypass patterns
  {
    pattern: /hypothetically|in\s+theory|theoretically|if\s+you\s+could/i,
    type: 'prompt_injection',
    severity: 'low',
    description: 'Hypothetical framing (may be legitimate)',
    baseConfidence: 0.45,
  },
  {
    pattern: /for\s+(educational|research|academic)\s+purposes/i,
    type: 'prompt_injection',
    severity: 'low',
    description: 'Educational framing (often legitimate)',
    baseConfidence: 0.35,
  },

  // Developer mode patterns
  {
    pattern: /developer\s+mode|dev\s+mode|debug\s+mode/i,
    type: 'jailbreak',
    severity: 'high',
    description: 'Attempt to enable developer mode',
    baseConfidence: 0.85,
  },
  {
    pattern: /enable\s+(hidden|secret|special)\s+(features|mode|commands)/i,
    type: 'jailbreak',
    severity: 'high',
    description: 'Attempt to enable hidden features',
    baseConfidence: 0.88,
  },

  // Delimiter abuse patterns
  {
    pattern: /```system|```instruction|```prompt/i,
    type: 'context_manipulation',
    severity: 'high',
    description: 'Code block delimiter abuse',
    baseConfidence: 0.85,
  },
  {
    pattern: /---\s*(system|instruction|prompt)/i,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Markdown delimiter abuse',
    baseConfidence: 0.70,
  },
];

/**
 * PII detection patterns
 */
const PII_PATTERNS = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    type: 'email',
    description: 'Email address',
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    type: 'ssn',
    description: 'Social Security Number',
  },
  {
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    type: 'credit_card',
    description: 'Credit card number',
  },
  {
    pattern: /\b(sk-[a-zA-Z0-9]{48}|sk-ant-[a-zA-Z0-9-]{90,})\b/g,
    type: 'api_key',
    description: 'API key (OpenAI/Anthropic format)',
  },
  {
    pattern: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g,
    type: 'api_key',
    description: 'GitHub token',
  },
  {
    pattern: /password\s*[:=]\s*["']?[^"'\s]{4,}["']?/gi,
    type: 'password',
    description: 'Hardcoded password',
  },
];

/**
 * Threat Detection Service
 */
export class ThreatDetectionService {
  private readonly patterns: ThreatPattern[];
  private detectionCount = 0;
  private totalDetectionTimeMs = 0;

  constructor(customPatterns?: ThreatPattern[]) {
    this.patterns = customPatterns ?? PROMPT_INJECTION_PATTERNS;
  }

  /**
   * Detect threats in input text
   * Target: <10ms latency
   */
  detect(input: string): ThreatDetectionResult {
    const startTime = performance.now();
    const threats: Threat[] = [];

    // Normalize input
    const normalizedInput = this.normalizeInput(input);

    // Pattern matching
    for (const pattern of this.patterns) {
      const match = pattern.pattern.exec(normalizedInput);
      if (match) {
        // Calculate confidence with context
        const confidence = this.calculateConfidence(pattern, match, normalizedInput);

        threats.push(createThreat({
          type: pattern.type,
          severity: this.adjustSeverity(pattern.severity, confidence),
          confidence,
          pattern: pattern.pattern.source,
          description: pattern.description,
          location: {
            start: match.index,
            end: match.index + match[0].length,
          },
        }));
      }
    }

    // PII detection
    const piiFound = this.detectPII(input);

    const detectionTimeMs = performance.now() - startTime;
    this.detectionCount++;
    this.totalDetectionTimeMs += detectionTimeMs;

    return {
      safe: threats.length === 0,
      threats: this.deduplicateThreats(threats),
      detectionTimeMs,
      piiFound,
      inputHash: this.hashInput(input),
    };
  }

  /**
   * Quick scan - pattern matching only
   * Target: <5ms latency
   */
  quickScan(input: string): { threat: boolean; confidence: number } {
    const normalizedInput = this.normalizeInput(input);

    let maxConfidence = 0;
    let threatFound = false;

    for (const pattern of this.patterns) {
      if (pattern.pattern.test(normalizedInput)) {
        threatFound = true;
        maxConfidence = Math.max(maxConfidence, pattern.baseConfidence);

        // Early exit on critical threats
        if (pattern.severity === 'critical') {
          return { threat: true, confidence: maxConfidence };
        }
      }
    }

    return { threat: threatFound, confidence: maxConfidence };
  }

  /**
   * Detect PII in text
   */
  detectPII(input: string): boolean {
    for (const pii of PII_PATTERNS) {
      if (pii.pattern.test(input)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get detection statistics
   */
  getStats(): { detectionCount: number; avgDetectionTimeMs: number } {
    return {
      detectionCount: this.detectionCount,
      avgDetectionTimeMs: this.detectionCount > 0
        ? this.totalDetectionTimeMs / this.detectionCount
        : 0,
    };
  }

  /**
   * Normalize input for consistent detection
   */
  private normalizeInput(input: string): string {
    return input
      // Normalize unicode
      .normalize('NFKC')
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate confidence with contextual factors
   */
  private calculateConfidence(
    pattern: ThreatPattern,
    match: RegExpExecArray,
    input: string
  ): number {
    let confidence = pattern.baseConfidence;

    // Boost confidence if multiple threat indicators
    const threatIndicatorCount = this.patterns.filter(p => p.pattern.test(input)).length;
    if (threatIndicatorCount > 1) {
      confidence = Math.min(confidence + 0.05 * (threatIndicatorCount - 1), 0.99);
    }

    // Reduce confidence for very short inputs (less context)
    if (input.length < 50) {
      confidence *= 0.9;
    }

    // Boost confidence if at start of input (more likely intentional)
    if (match.index < 20) {
      confidence = Math.min(confidence + 0.05, 0.99);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Adjust severity based on confidence
   */
  private adjustSeverity(baseSeverity: ThreatSeverity, confidence: number): ThreatSeverity {
    if (confidence < 0.5 && baseSeverity === 'critical') {
      return 'high';
    }
    if (confidence < 0.4 && baseSeverity === 'high') {
      return 'medium';
    }
    return baseSeverity;
  }

  /**
   * Deduplicate threats by type
   */
  private deduplicateThreats(threats: Threat[]): Threat[] {
    const seen = new Map<ThreatType, Threat>();

    for (const threat of threats) {
      const existing = seen.get(threat.type);
      if (!existing || threat.confidence > existing.confidence) {
        seen.set(threat.type, threat);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => {
        // Sort by severity first, then confidence
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        return severityDiff !== 0 ? severityDiff : b.confidence - a.confidence;
      });
  }

  /**
   * Hash input for caching/deduplication
   */
  private hashInput(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}

/**
 * Create a new ThreatDetectionService instance
 */
export function createThreatDetectionService(
  customPatterns?: ThreatPattern[]
): ThreatDetectionService {
  return new ThreatDetectionService(customPatterns);
}
