/**
 * Pattern Entity - Domain Layer
 *
 * Represents a learned pattern for intelligent routing and optimization.
 *
 * @module v3/neural/domain/entities
 */

import { randomUUID } from 'crypto';

/**
 * Pattern type
 */
export type PatternType = 'task-routing' | 'error-recovery' | 'optimization' | 'learning';

/**
 * Pattern properties
 */
export interface PatternProps {
  id?: string;
  type: PatternType;
  name: string;
  description: string;
  condition: string;
  action: string;
  confidence: number;
  successCount?: number;
  failureCount?: number;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
  lastMatchedAt?: Date;
}

/**
 * Pattern Entity
 */
export class Pattern {
  private _id: string;
  private _type: PatternType;
  private _name: string;
  private _description: string;
  private _condition: string;
  private _action: string;
  private _confidence: number;
  private _successCount: number;
  private _failureCount: number;
  private _metadata: Record<string, unknown>;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _lastMatchedAt?: Date;

  private constructor(props: PatternProps) {
    const now = new Date();
    this._id = props.id ?? randomUUID();
    this._type = props.type;
    this._name = props.name;
    this._description = props.description;
    this._condition = props.condition;
    this._action = props.action;
    this._confidence = props.confidence;
    this._successCount = props.successCount ?? 0;
    this._failureCount = props.failureCount ?? 0;
    this._metadata = props.metadata ?? {};
    this._createdAt = props.createdAt ?? now;
    this._updatedAt = props.updatedAt ?? now;
    this._lastMatchedAt = props.lastMatchedAt;
  }

  static create(props: PatternProps): Pattern {
    return new Pattern(props);
  }

  static fromPersistence(props: PatternProps): Pattern {
    return new Pattern(props);
  }

  get id(): string { return this._id; }
  get type(): PatternType { return this._type; }
  get name(): string { return this._name; }
  get description(): string { return this._description; }
  get condition(): string { return this._condition; }
  get action(): string { return this._action; }
  get confidence(): number { return this._confidence; }
  get successCount(): number { return this._successCount; }
  get failureCount(): number { return this._failureCount; }
  get metadata(): Record<string, unknown> { return { ...this._metadata }; }
  get createdAt(): Date { return new Date(this._createdAt); }
  get updatedAt(): Date { return new Date(this._updatedAt); }
  get lastMatchedAt(): Date | undefined { return this._lastMatchedAt ? new Date(this._lastMatchedAt) : undefined; }

  /**
   * Calculate success rate
   */
  get successRate(): number {
    const total = this._successCount + this._failureCount;
    return total > 0 ? this._successCount / total : 0;
  }

  /**
   * Record successful match
   */
  recordSuccess(): void {
    this._successCount++;
    this._confidence = this.calculateConfidence();
    this._lastMatchedAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Record failed match
   */
  recordFailure(): void {
    this._failureCount++;
    this._confidence = this.calculateConfidence();
    this._lastMatchedAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Calculate confidence based on success rate
   */
  private calculateConfidence(): number {
    const total = this._successCount + this._failureCount;
    if (total < 5) return this._confidence; // Not enough data

    const newConfidence = this.successRate;
    // Weighted average with existing confidence
    return this._confidence * 0.3 + newConfidence * 0.7;
  }

  /**
   * Check if pattern matches input
   */
  matches(input: string): boolean {
    try {
      const regex = new RegExp(this._condition, 'i');
      return regex.test(input);
    } catch {
      return input.toLowerCase().includes(this._condition.toLowerCase());
    }
  }

  /**
   * Check if pattern is reliable (high confidence, sufficient data)
   */
  isReliable(): boolean {
    const total = this._successCount + this._failureCount;
    return total >= 10 && this._confidence >= 0.7;
  }

  toPersistence(): Record<string, unknown> {
    return {
      id: this._id,
      type: this._type,
      name: this._name,
      description: this._description,
      condition: this._condition,
      action: this._action,
      confidence: this._confidence,
      successCount: this._successCount,
      failureCount: this._failureCount,
      metadata: this._metadata,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      lastMatchedAt: this._lastMatchedAt?.toISOString(),
    };
  }
}
