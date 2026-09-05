/**
 * Tests for AgentAuthorizationPropagator (ADR-144 P1, ruvnet/ruflo#2248).
 *
 * Covers the load-bearing invariants of the action-layer security model:
 *  - wrapOutbound monotonically reduces scope (cannot grant more than holder)
 *  - delegationDepth decrements by ≥ 1 every hop; depth-0 cannot delegate
 *  - expired scopes are rejected at wrap and at check
 *  - checkToolCall returns stable, telemetry-friendly reasons
 *  - verifyServerAuth rejects empty / nullish credentials
 *  - provenance buffer ring-bound at the configured max
 *  - legacy permissive scope (the migration shim) allows everything
 */

import { describe, it, expect } from 'vitest';
import {
  AgentAuthorizationPropagator,
  AuthorizationPropagationError,
  makeLegacyPermissiveScope,
  type AuthScope,
} from '../src/authorization/propagator.js';

const FAR_FUTURE = Date.now() + 60 * 60 * 1000; // 1 hour from now

function scope(overrides: Partial<AuthScope> = {}): AuthScope {
  return {
    principalId: 'principal-A',
    grantedTools: ['memory_store', 'memory_search'],
    grantedServers: ['server-1'],
    delegationDepth: 3,
    expiresAt: FAR_FUTURE,
    ...overrides,
  };
}

describe('wrapOutbound — scope reduction invariants', () => {
  const prop = new AgentAuthorizationPropagator();

  it('decrements delegationDepth by exactly 1', () => {
    const env = prop.wrapOutbound({ msg: 'hi' }, scope({ delegationDepth: 3 }));
    expect(env.scope.delegationDepth).toBe(2);
  });

  it('refuses to delegate when depth has been exhausted', () => {
    expect(() =>
      prop.wrapOutbound({ msg: 'hi' }, scope({ delegationDepth: 0 })),
    ).toThrow(AuthorizationPropagationError);
  });

  it('refuses to grant a tool not held by the parent scope', () => {
    expect(() =>
      prop.wrapOutbound({}, scope(), { tools: ['memory_store', 'task_create'] }),
    ).toThrow(/cannot grant tools 'task_create'/);
  });

  it('allows a strict subset of the parent tool set', () => {
    const env = prop.wrapOutbound({}, scope(), { tools: ['memory_store'] });
    expect(env.scope.grantedTools).toEqual(['memory_store']);
  });

  it('preserves principalId across the hop', () => {
    const env = prop.wrapOutbound({}, scope({ principalId: 'principal-X' }));
    expect(env.scope.principalId).toBe('principal-X');
  });

  it('rejects an expired holder scope', () => {
    expect(() =>
      prop.wrapOutbound({}, scope({ expiresAt: 1 })),
    ).toThrow(/scope expired/);
  });

  it('passes the payload through untouched', () => {
    const payload = { kind: 'design', body: { topic: 'auth' } };
    const env = prop.wrapOutbound(payload, scope());
    expect(env.payload).toBe(payload);
  });

  it('a wildcard parent scope can grant any specific tool', () => {
    const env = prop.wrapOutbound({}, makeLegacyPermissiveScope(), {
      tools: ['memory_store', 'task_create'],
    });
    expect(env.scope.grantedTools).toEqual(['memory_store', 'task_create']);
  });
});

describe('checkToolCall — typed decisions', () => {
  const prop = new AgentAuthorizationPropagator();

  it('allows a tool that is in scope', () => {
    expect(prop.checkToolCall('memory_store', scope())).toEqual({ allowed: true });
  });

  it('denies a tool not in scope with stable reason', () => {
    expect(prop.checkToolCall('shell_exec', scope())).toEqual({
      allowed: false,
      reason: 'tool-not-in-scope',
    });
  });

  it('denies when the named server is not in scope', () => {
    expect(
      prop.checkToolCall('memory_store', scope(), { serverId: 'untrusted' }),
    ).toEqual({ allowed: false, reason: 'server-not-in-scope' });
  });

  it('denies an expired scope deterministically (fixed-now)', () => {
    const expired = scope({ expiresAt: 1000 });
    expect(prop.checkToolCall('memory_store', expired, { now: 2000 })).toEqual({
      allowed: false,
      reason: 'scope-expired',
    });
  });
});

describe('verifyServerAuth — fail-closed on missing credentials', () => {
  const prop = new AgentAuthorizationPropagator();

  it('rejects missing credential', () => {
    expect(prop.verifyServerAuth('s1', null)).toBe(false);
    expect(prop.verifyServerAuth('s1', undefined)).toBe(false);
  });

  it('rejects empty-string credential', () => {
    expect(prop.verifyServerAuth('s1', '')).toBe(false);
    expect(prop.verifyServerAuth('s1', '   ')).toBe(false);
  });

  it('rejects missing serverId', () => {
    expect(prop.verifyServerAuth('', 'token')).toBe(false);
  });

  it('accepts a non-empty credential (P1 permissive default)', () => {
    expect(prop.verifyServerAuth('s1', 'oauth-token-xyz')).toBe(true);
  });
});

describe('provenance buffer', () => {
  it('retains recorded actions in insertion order', () => {
    const p = new AgentAuthorizationPropagator();
    p.recordAction('agent-A', 'memory_store', scope(), 'allowed');
    p.recordAction('agent-B', 'shell_exec', scope(), 'denied', 'tool-not-in-scope');
    const log = p.getProvenance();
    expect(log).toHaveLength(2);
    expect(log[0]?.outcome).toBe('allowed');
    expect(log[1]?.reason).toBe('tool-not-in-scope');
  });

  it('ring-bounds at the configured max', () => {
    const p = new AgentAuthorizationPropagator({ provenanceBufferMax: 3 });
    for (let i = 0; i < 5; i++) p.recordAction('a', 't', scope(), 'allowed', `i=${i}`);
    const log = p.getProvenance();
    expect(log).toHaveLength(3);
    expect(log[0]?.reason).toBe('i=2');
    expect(log[2]?.reason).toBe('i=4');
  });
});
