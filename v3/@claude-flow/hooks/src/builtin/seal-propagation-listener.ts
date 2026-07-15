/**
 * Seal-Propagation Listener — ADR-321 P2 escalation wiring (ruvnet/ruflo#2630).
 *
 * ADR-321 P2 (`@claude-flow/memory`'s `AgentDBAdapter`) detects the ClawWorm
 * propagation shape — the same sealed content re-appearing under a
 * different `writerId` within `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS` — and
 * emits a `seal:propagation-detected` event. The ADR's own text asks for
 * that signal to be routed through "the same human-in-the-loop / block
 * routing ADR-178's RepE hook already uses (`CLAUDE_FLOW_IPI_MODE`) ...
 * reusing that control point rather than introducing a fourth escalation
 * path." This file is that wire: it does NOT invent new warn/block/hil
 * logic — it reuses `decideIpiOutcome`/`getIpiMode` from
 * `ipi-detection-hook.ts` (ADR-178 Primitive 2, task #12) exactly as-is.
 *
 * Why this lives in `@claude-flow/hooks` and not `@claude-flow/memory`:
 * `@claude-flow/memory` must not depend on `@claude-flow/hooks` or
 * `@claude-flow/security` (same layering rule established for the write-ACL
 * grant lookup in ADR-145 Part B, task #10 — memory stays a leaf package).
 * `@claude-flow/hooks` already depends on both (see its `package.json`), so
 * the glue belongs here, listening to an `AgentDBAdapter` instance handed to
 * it by whatever composes memory + hooks at startup.
 *
 * No global default `AgentDBAdapter` singleton exists to attach to
 * eagerly (unlike `ipiDetectionHookId`'s eager `HookRegistry` registration,
 * which only needs the always-available `defaultRegistry`). Callers must
 * invoke {@link registerSealPropagationListener} once they have a concrete
 * adapter instance (e.g. wherever `UnifiedMemoryService`/`AgentDBAdapter` is
 * constructed in an app that also wires hooks).
 */

import type { IpiRisk } from '@claude-flow/security';
import { decideIpiOutcome, getIpiMode } from './ipi-detection-hook.js';

/** Minimal shape of `AgentDBAdapter`'s `seal:propagation-detected` payload. */
export interface SealPropagationEvent {
  id: string;
  namespace: string;
  writerId: string;
}

/** Minimal event-emitter surface this listener needs from an adapter instance. */
export interface SealPropagationEmitter {
  on(event: 'seal:propagation-detected', listener: (payload: SealPropagationEvent) => void): unknown;
  off?(event: 'seal:propagation-detected', listener: (payload: SealPropagationEvent) => void): unknown;
}

/**
 * Builds the `IpiRisk` representation of a propagation hit. There is no
 * tool-call payload to run `IpiDetector.assess()` against here — the
 * propagation signal IS the risk, by construction (the same content was
 * re-sealed under a different writer, which `SealedMemoryWriter` has
 * already determined). Classified at `'high'` (the only bucket ADR-178's
 * `'block'` mode acts on) with `confidence: 0.75` — high enough to route
 * through the block/hil path deliberately, but short of `1` to reflect
 * that this is a heuristic signal (ADR-321's own "Negative / trade-offs"
 * section: propagation detection is not a forgery proof), not a
 * cryptographic certainty like a failed HMAC.
 */
function propagationRisk(event: SealPropagationEvent): IpiRisk {
  return {
    risk: 'high',
    reasons: [
      `ADR-321 P2: content in namespace "${event.namespace}" was re-sealed under writer ` +
        `"${event.writerId}" within the replay window — matches the ClawWorm propagation shape`,
    ],
    confidence: 0.75,
  };
}

/**
 * Registers a listener on `adapter`'s `seal:propagation-detected` event that
 * routes the signal through the existing `decideIpiOutcome`/`getIpiMode`
 * (`CLAUDE_FLOW_IPI_MODE`) logic — the same function `ipi-detection-hook.ts`
 * uses for the `PreToolUse` path. Returns the listener function so callers
 * can `adapter.off('seal:propagation-detected', listener)` if needed.
 *
 * `'warn'` (default): logs a warning, nothing else.
 * `'block'` / `'hil'`: logs an error-level message. There is no mechanism to
 * "abort" an already-completed memory read the way `PreToolUse` can abort a
 * pending tool call — the entry has already been returned to the caller by
 * the time this event fires. This is intentionally audit/alerting-only for
 * memory propagation; a real quarantine/rejection mechanism for propagated
 * entries is future work, not invented here.
 */
export function registerSealPropagationListener(
  adapter: SealPropagationEmitter,
): (payload: SealPropagationEvent) => void {
  const listener = (payload: SealPropagationEvent): void => {
    const outcome = decideIpiOutcome(
      `memory:propagation:${payload.namespace}:${payload.id}`,
      propagationRisk(payload),
      getIpiMode(),
    );

    if (outcome.abort) {
      console.error(`[seal-propagation-listener] ${outcome.message}`);
      return;
    }
    if (outcome.warnings) {
      for (const warning of outcome.warnings) {
        console.warn(`[seal-propagation-listener] ${warning}`);
      }
    }
  };

  adapter.on('seal:propagation-detected', listener);
  return listener;
}
