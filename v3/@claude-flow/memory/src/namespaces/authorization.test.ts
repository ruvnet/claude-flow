/**
 * Tests for namespace write-ACL policy (ADR-145 Part B, Task #10, ruvnet/ruflo#2630).
 *
 * These are pure-function unit tests for `checkWrite()` — the policy decision,
 * with no I/O and no strict-mode side effects. `checkWrite()` is expected to be
 * a pure decision-returning function that NEVER throws (mirroring
 * `authorization/propagator.ts`'s `ToolCallDecision` shape from ADR-144). The
 * `CLAUDE_FLOW_STRICT_MEMORY` gate is applied at the ENFORCEMENT site
 * (AgentDBAdapter.store()), not here — see acl-adapter.integration.test.ts.
 *
 * CONTRACT THIS FILE ASSERTS (from the ADR-145/178 prerequisite addendum —
 * build authorization.ts to this, or tell the tester to adjust):
 *   type NamespaceGrant = { agentId: string; writeNamespaces: string[]; readNamespaces?: string[] };
 *   type WriteDecision = { allowed: boolean; reason?: 'not-in-write-grant' | 'legacy-permissive' };
 *   function checkWrite(grant: NamespaceGrant | undefined, namespace: string): WriteDecision;
 *
 * Decision table:
 *   grant present, namespace ∈ writeNamespaces   -> { allowed: true }                             (reason undefined)
 *   grant present, namespace ∉ writeNamespaces   -> { allowed: false, reason: 'not-in-write-grant' }
 *   grant undefined                              -> { allowed: true,  reason: 'legacy-permissive' }
 */

import { describe, it, expect } from 'vitest';
import { checkWrite, type NamespaceGrant } from './authorization.js';

const grant = (writeNamespaces: string[], extra: Partial<NamespaceGrant> = {}): NamespaceGrant => ({
  agentId: 'agent-alpha',
  writeNamespaces,
  ...extra,
});

describe('checkWrite — pure policy decision (ADR-145 Part B)', () => {
  it('allows a write to a namespace in the grant (no reason)', () => {
    const decision = checkWrite(grant(['collaboration', 'learnings']), 'collaboration');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it('denies a write to a namespace NOT in the grant', () => {
    const decision = checkWrite(grant(['a']), 'b');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not-in-write-grant');
  });

  it('treats an undefined grant as legacy-permissive (allowed)', () => {
    const decision = checkWrite(undefined, 'anything');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('legacy-permissive');
  });

  it('denies every namespace when writeNamespaces is empty', () => {
    const decision = checkWrite(grant([]), 'collaboration');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not-in-write-grant');
  });

  it('does not treat readNamespaces as write authorization', () => {
    // ns 'reports' is readable but not writable -> write denied.
    const decision = checkWrite(grant(['a'], { readNamespaces: ['reports'] }), 'reports');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not-in-write-grant');
  });

  it('is pure — never throws on odd inputs', () => {
    expect(() => checkWrite(grant(['a']), '')).not.toThrow();
    expect(() => checkWrite(undefined, '')).not.toThrow();
  });
});
