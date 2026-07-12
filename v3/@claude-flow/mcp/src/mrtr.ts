/**
 * @claude-flow/mcp - Multi Round-Trip Requests (MRTR, MCP 2026-07-28)
 *
 * Tools can return an InputRequiredResult to request user input
 * mid-execution instead of holding a long-lived stream. The client resumes
 * by re-invoking tools/call with the continuation token and the input.
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import type { JSONSchema, ILogger } from './types.js';

/** Wire-format result returned to the client when a tool needs input. */
export interface InputRequiredResult {
  type: 'input_required';
  continuationToken: string;
  message: string;
  inputSchema?: JSONSchema;
}

const PENDING_INPUT = Symbol.for('claude-flow.mcp.pendingInput');

/**
 * In-process representation of a paused tool: carries the resume callback,
 * which never crosses the wire. Create via inputRequired().
 */
export interface PendingInputRequest<TInput = unknown> {
  [PENDING_INPUT]: true;
  message: string;
  inputSchema?: JSONSchema;
  resume: (input: TInput) => Promise<unknown>;
}

/**
 * Pause a tool until the client supplies input. Return this from a tool
 * handler; the resume callback receives the client-provided input and may
 * itself return another inputRequired() to chain round trips.
 *
 * @example
 * handler: async (input) => inputRequired(
 *   'Confirm deletion of 42 records',
 *   async (answer) => answer === 'yes' ? doDelete() : 'aborted',
 *   { type: 'string', enum: ['yes', 'no'] }
 * )
 */
export function inputRequired<TInput = unknown>(
  message: string,
  resume: (input: TInput) => Promise<unknown>,
  inputSchema?: JSONSchema
): PendingInputRequest<TInput> {
  return { [PENDING_INPUT]: true, message, inputSchema, resume };
}

export function isPendingInputRequest(value: unknown): value is PendingInputRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[PENDING_INPUT] === true
  );
}

export interface ContinuationManagerOptions {
  /** How long a continuation stays resumable (ms). Default: 5 minutes. */
  ttl?: number;
  /** Max concurrently pending continuations. Default: 100. */
  maxPending?: number;
  /** Expiry sweep interval (ms). Default: 30 seconds. */
  cleanupInterval?: number;
}

interface StoredContinuation {
  pending: PendingInputRequest;
  toolName: string;
  expiresAt: number;
}

/**
 * Tracks paused tool executions by continuation token.
 *
 * NOTE: continuations are held in this process's memory, so a resume must
 * reach the same instance that paused — route MRTR resumes with sticky
 * affinity (e.g. on the continuation token) when load balancing.
 */
export class ContinuationManager extends EventEmitter {
  private readonly continuations = new Map<string, StoredContinuation>();
  private readonly ttl: number;
  private readonly maxPending: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly logger: ILogger,
    options: ContinuationManagerOptions = {}
  ) {
    super();
    this.ttl = options.ttl ?? 5 * 60 * 1000;
    this.maxPending = options.maxPending ?? 100;
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      options.cleanupInterval ?? 30 * 1000
    );
    this.cleanupTimer.unref?.();
  }

  /** Store a paused tool and return the wire-format result for the client. */
  register(pending: PendingInputRequest, toolName: string): InputRequiredResult {
    if (this.continuations.size >= this.maxPending) {
      this.evictExpired();
      if (this.continuations.size >= this.maxPending) {
        throw new Error(`Maximum pending continuations (${this.maxPending}) reached`);
      }
    }

    const token = randomBytes(24).toString('base64url');
    this.continuations.set(token, {
      pending,
      toolName,
      expiresAt: Date.now() + this.ttl,
    });

    this.logger.debug('Continuation registered', { toolName, pending: this.continuations.size });
    this.emit('continuation:registered', { token, toolName });

    return {
      type: 'input_required',
      continuationToken: token,
      message: pending.message,
      inputSchema: pending.inputSchema,
    };
  }

  /**
   * Resume a paused tool with client-provided input. Single-use: the token
   * is consumed even if the resume callback throws. The result may itself
   * be another PendingInputRequest (chained round trips).
   */
  async resume(token: string, input: unknown): Promise<unknown> {
    const stored = this.continuations.get(token);
    if (!stored || stored.expiresAt <= Date.now()) {
      this.continuations.delete(token);
      throw new Error('Unknown or expired continuation token');
    }

    this.continuations.delete(token);
    this.emit('continuation:resumed', { token, toolName: stored.toolName });

    return stored.pending.resume(input);
  }

  getPendingCount(): number {
    return this.continuations.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [token, stored] of this.continuations) {
      if (stored.expiresAt <= now) {
        this.continuations.delete(token);
        this.logger.debug('Continuation expired', { toolName: stored.toolName });
        this.emit('continuation:expired', { token, toolName: stored.toolName });
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.continuations.clear();
    this.removeAllListeners();
  }
}

export function createContinuationManager(
  logger: ILogger,
  options?: ContinuationManagerOptions
): ContinuationManager {
  return new ContinuationManager(logger, options);
}
