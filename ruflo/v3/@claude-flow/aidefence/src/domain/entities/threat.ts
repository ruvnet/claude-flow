/**
 * Threat Domain Entity
 *
 * Represents a detected security threat from AI manipulation attempts.
 */

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ThreatType =
  | 'prompt_injection'
  | 'jailbreak'
  | 'pii_exposure'
  | 'instruction_override'
  | 'role_switching'
  | 'context_manipulation'
  | 'encoding_attack'
  | 'unknown';

export interface Threat {
  readonly id: string;
  readonly type: ThreatType;
  readonly severity: ThreatSeverity;
  readonly confidence: number;
  readonly pattern: string;
  readonly description: string;
  readonly location?: {
    start: number;
    end: number;
  };
  readonly detectedAt: Date;
}

export interface ThreatDetectionResult {
  readonly safe: boolean;
  readonly threats: Threat[];
  readonly detectionTimeMs: number;
  readonly piiFound: boolean;
  readonly inputHash: string;
}

export interface BehavioralAnalysisResult {
  readonly agentId: string;
  readonly anomalyScore: number;
  readonly attractorType: 'point' | 'cycle' | 'torus' | 'strange';
  readonly lyapunovExponent: number;
  readonly analysisTimeMs: number;
  readonly windowSize: string;
  readonly actionCount: number;
}

export interface PolicyVerificationResult {
  readonly agentId: string;
  readonly policy: string;
  readonly valid: boolean;
  readonly violations: string[];
  readonly proofStatus: 'valid' | 'invalid' | 'timeout';
  readonly verificationTimeMs: number;
}

/**
 * Factory function to create a Threat entity
 */
export function createThreat(params: {
  type: ThreatType;
  severity: ThreatSeverity;
  confidence: number;
  pattern: string;
  description: string;
  location?: { start: number; end: number };
}): Threat {
  return {
    id: `threat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: params.type,
    severity: params.severity,
    confidence: params.confidence,
    pattern: params.pattern,
    description: params.description,
    location: params.location,
    detectedAt: new Date(),
  };
}
