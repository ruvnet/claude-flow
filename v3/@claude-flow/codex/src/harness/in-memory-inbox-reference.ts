import { createHash } from 'node:crypto';
import type { HarnessMessage, MessageReceipt } from './contract.js';
import { canonicalJson } from './repository-state.js';
import { parseCanonicalUnsigned } from './unsigned-integer.js';

export interface InMemoryInboxRecord {
  cursor: string;
  message: HarnessMessage;
  receivedAt: string;
  acknowledgedAt?: string;
}

export interface InMemoryQuarantinedMessage {
  issuer: string;
  messageId: string;
  reason: 'content-digest-mismatch' | 'message-id-content-conflict';
  quarantinedAt: string;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function harnessMessageContentDigest(content: unknown): string {
  return sha256(canonicalJson(content));
}

function lengthFrame(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|');
}

/** Collision-safe local map key; the unhashed material is byte-length framed. */
export function inMemoryInboxIdentityKey(issuer: string, messageId: string): string {
  return sha256(lengthFrame([issuer, messageId]));
}

/**
 * Unsigned, non-durable in-memory model of inbox semantics.
 *
 * It retains unacknowledged records, resumes by monotonic cursor, deduplicates
 * exact retries, and quarantines an issuer reusing a message ID with different
 * content. Process exit loses all state; this class is never an enforce-mode
 * transport or authority. Durable adapters may use it only as a conformance
 * reference.
 */
export class InMemoryInboxReference {
  readonly referenceOnly = true;
  private readonly records: InMemoryInboxRecord[] = [];
  private readonly byIdentity = new Map<string, {
    issuer: string;
    messageId: string;
    envelopeDigest: string;
    record: InMemoryInboxRecord;
  }>();
  private readonly quarantined: InMemoryQuarantinedMessage[] = [];
  private nextCursor = 1n;

  constructor(private readonly now: () => number = Date.now) {}

  send(message: HarnessMessage): MessageReceipt {
    if (!message.messageId.trim() || !message.issuer.trim() || !message.audience.trim()) {
      throw new Error('message ID, issuer, and audience are required');
    }
    const identity = inMemoryInboxIdentityKey(message.issuer, message.messageId);
    const receivedAt = new Date(this.now()).toISOString();
    let suppliedDigest: string;
    try {
      suppliedDigest = harnessMessageContentDigest(message.content);
    } catch {
      this.quarantine(message, 'content-digest-mismatch', receivedAt);
      throw new Error('message content is not canonical JSON');
    }
    if (suppliedDigest !== message.contentDigest) {
      this.quarantine(message, 'content-digest-mismatch', receivedAt);
      throw new Error('message contentDigest does not match canonical content');
    }
    try {
      parseCanonicalUnsigned(message.sequence, 'message sequence');
    } catch {
      throw new Error('message sequence must be a canonical unsigned decimal integer');
    }
    if (message.expiresAt !== undefined && !Number.isFinite(Date.parse(message.expiresAt))) {
      throw new Error('message expiresAt must be an ISO timestamp');
    }

    const envelopeDigest = sha256(canonicalJson(message));
    const prior = this.byIdentity.get(identity);
    if (prior) {
      if (prior.issuer !== message.issuer || prior.messageId !== message.messageId) {
        throw new Error('inbox identity hash collision');
      }
      if (prior.envelopeDigest !== envelopeDigest) {
        this.quarantine(message, 'message-id-content-conflict', receivedAt);
        throw new Error('message ID was reused with different content');
      }
      return { messageId: message.messageId, acceptedAt: prior.record.receivedAt, duplicate: true };
    }

    const record: InMemoryInboxRecord = {
      cursor: (this.nextCursor++).toString(),
      message: clone(message),
      receivedAt,
    };
    this.records.push(record);
    this.byIdentity.set(identity, {
      issuer: message.issuer,
      messageId: message.messageId,
      envelopeDigest,
      record,
    });
    return { messageId: message.messageId, acceptedAt: receivedAt, duplicate: false };
  }

  async *receive(audience: string, cursor = '0'): AsyncIterable<HarnessMessage> {
    const after = this.parseCursor(cursor);
    const now = this.now();
    for (const record of this.records) {
      if (
        BigInt(record.cursor) > after
        && record.message.audience === audience
        && (record.message.expiresAt === undefined || Date.parse(record.message.expiresAt) > now)
      ) {
        yield clone(record.message);
      }
    }
  }

  acknowledge(audience: string, messageId: string, issuer?: string): void {
    const matches = this.records.filter(
      (candidate) => candidate.message.audience === audience
        && candidate.message.messageId === messageId
        && (issuer === undefined || candidate.message.issuer === issuer),
    );
    if (!matches.length) throw new Error(`unknown inbox message ${messageId} for ${audience}`);
    if (matches.length > 1) throw new Error(`ambiguous inbox message ${messageId}; issuer is required`);
    const record = matches[0]!;
    if (record.acknowledgedAt === undefined) record.acknowledgedAt = new Date(this.now()).toISOString();
  }

  pending(audience: string): InMemoryInboxRecord[] {
    return this.records
      .filter((record) => record.message.audience === audience && record.acknowledgedAt === undefined)
      .map(clone);
  }

  quarantineRecords(): InMemoryQuarantinedMessage[] {
    return this.quarantined.map(clone);
  }

  private parseCursor(cursor: string): bigint {
    try {
      return parseCanonicalUnsigned(cursor, 'inbox cursor');
    } catch {
      throw new Error('inbox cursor must be a non-negative decimal integer');
    }
  }

  private quarantine(
    message: HarnessMessage,
    reason: InMemoryQuarantinedMessage['reason'],
    quarantinedAt: string,
  ): void {
    this.quarantined.push({
      issuer: message.issuer,
      messageId: message.messageId,
      reason,
      quarantinedAt,
    });
  }
}
