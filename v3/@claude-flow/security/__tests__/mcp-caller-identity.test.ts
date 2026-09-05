/**
 * Tests for McpCallerIdentity (ADR-377 Phase 3, ruvnet/ruflo#2516, #2873).
 *
 * Covers:
 *  - issueInvocationToken + verifyInvocationToken round-trip succeeds
 *  - expired tokens are rejected
 *  - a token signed for one tool is rejected when checked against another
 *  - a token verified against the wrong public key is rejected
 *  - a tampered field invalidates the signature
 *  - isMcpCallerAuthEnabled defaults to disabled (opt-in only)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  generateCallerIdentityKey,
  issueInvocationToken,
  verifyInvocationToken,
  isMcpCallerAuthEnabled,
} from '../src/mcp-caller-identity.js';

const ENV = 'CLAUDE_FLOW_MCP_CALLER_AUTH';

afterEach(() => {
  delete process.env[ENV];
});

describe('issueInvocationToken / verifyInvocationToken — round trip', () => {
  it('verifies a freshly issued token', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    const result = verifyInvocationToken(token, key.publicKey);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('binds callerId and toolName into the signed payload', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    expect(token.callerId).toBe('agent-A');
    expect(token.toolName).toBe('memory_store');
    expect(token.signature).toMatch(/^[0-9a-f]+$/);
  });
});

describe('verifyInvocationToken — expiry', () => {
  it('rejects a token past its TTL', () => {
    const key = generateCallerIdentityKey();
    const now = Date.now();
    const token = issueInvocationToken('agent-A', 'memory_store', key, { ttlMs: 1000, now });
    const result = verifyInvocationToken(token, key.publicKey, { now: now + 1001 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('accepts a token within its TTL', () => {
    const key = generateCallerIdentityKey();
    const now = Date.now();
    const token = issueInvocationToken('agent-A', 'memory_store', key, { ttlMs: 30_000, now });
    const result = verifyInvocationToken(token, key.publicKey, { now: now + 29_999 });
    expect(result.valid).toBe(true);
  });
});

describe('verifyInvocationToken — tool binding', () => {
  it('rejects a token checked against a different tool than it was issued for', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    const result = verifyInvocationToken(token, key.publicKey, { toolName: 'memory_delete' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('tool-mismatch');
  });

  it('accepts when the checked tool matches the issued tool', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    const result = verifyInvocationToken(token, key.publicKey, { toolName: 'memory_store' });
    expect(result.valid).toBe(true);
  });
});

describe('verifyInvocationToken — signature integrity', () => {
  it('rejects verification against the wrong public key', () => {
    const key = generateCallerIdentityKey();
    const otherKey = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    const result = verifyInvocationToken(token, otherKey.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token with a tampered callerId (signature no longer matches)', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key);
    const tampered = { ...token, callerId: 'agent-B' };
    const result = verifyInvocationToken(tampered, key.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token with a tampered expiresAt (privilege-extension attempt)', () => {
    const key = generateCallerIdentityKey();
    const token = issueInvocationToken('agent-A', 'memory_store', key, { ttlMs: 1000 });
    const tampered = { ...token, expiresAt: token.expiresAt + 1_000_000 };
    const result = verifyInvocationToken(tampered, key.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });
});

describe('isMcpCallerAuthEnabled', () => {
  it('defaults to disabled', () => {
    delete process.env[ENV];
    expect(isMcpCallerAuthEnabled()).toBe(false);
  });

  it('enables only on the literal value "true"', () => {
    process.env[ENV] = 'true';
    expect(isMcpCallerAuthEnabled()).toBe(true);
    process.env[ENV] = '1';
    expect(isMcpCallerAuthEnabled()).toBe(false);
  });
});
