/**
 * IPI Detection Hook — ADR-178 Primitive 2 (ruvnet/ruflo#2630).
 *
 * Registers `IpiDetector.assess()` (`@claude-flow/security`) as a
 * `HookEvent.PreToolUse` handler at `HookPriority.Critical` so every tool
 * call is screened for indirect prompt injection BEFORE it runs.
 *
 * Correction vs. the ADR's prose
 * -------------------------------
 * ADR-178 describes a new "pre-tool-call" hook (its "hook #18"). There is no
 * such hook type — this reuses the EXISTING `HookEvent.PreToolUse`, which is
 * already wired end-to-end (`HookExecutor.preToolUse()`, the official Claude
 * Code hooks bridge). This file ADDS A HANDLER to that existing
 * infrastructure; it does not add a new hook event.
 *
 * The ADR also says "priority 100" (`HookPriority.High`), but its own prose
 * requires the hook to "run before all other pre-call hooks" — only
 * `HookPriority.Critical` (runs first in the executor's priority-ordered
 * loop, see `HookRegistry.getForEvent`) satisfies that. We use `Critical`.
 *
 * Block/warn/hil mechanism
 * -------------------------
 * `HookExecutor` has no separate "veto" channel — the only way a handler
 * stops a tool call is `HookResult.abort = true`, which the executor
 * surfaces as `HookExecutionResult.aborted` and the official-hooks bridge
 * maps to `decision: 'block'` (see `OfficialHooksBridge.toOfficialOutput`).
 * We return `success: true, abort: true` (not `success: false`) for a
 * deliberate block — `success: false` means "the hook itself errored",
 * which is a different failure mode from "the hook worked and vetoed".
 *
 * `CLAUDE_FLOW_IPI_MODE` ('warn' | 'block' | 'hil', default 'warn') is read
 * fresh on every invocation (deploy/ops toggle, not a per-invocation CLI
 * flag — same posture as `CLAUDE_FLOW_STRICT_SEALING` / ADR-144/145's
 * warn-then-block rollout shape):
 *   - 'warn'  (default): always allow; log a warning when risk is not 'none'.
 *   - 'block': allow when risk is 'none' | 'low' | 'medium'; abort when
 *              risk is 'high'. (Threshold choice, documented: a pattern
 *              baseline has real false-positive risk, so only the top
 *              bucket blocks by default — 'medium' still warns.)
 *   - 'hil'  : no human-in-the-loop / approval-queue infrastructure exists
 *              anywhere in this codebase (checked: no generic approval
 *              queue, no HIL routing primitive). Documented as a STUB —
 *              treated identically to 'block' for now. Wiring a real
 *              approval-queue escalation is future work, not invented here.
 *
 * Not wired here (deliberately): ADR-321 P2's `seal:propagation-detected`
 * event (`@claude-flow/memory`'s `AgentDBAdapter`) is the eventual upstream
 * signal this hook could also consult — see `sealed-writer.ts`'s "Escalation
 * routing gap" comment. That cross-package wiring is a separate follow-up.
 *
 * Reference: ADR-178, `@claude-flow/security`'s `ipi-detector.ts`.
 */

import {
  HookEvent,
  HookPriority,
  type HookContext,
  type HookResult,
} from '../types.js';
import { HookRegistry, defaultRegistry } from '../registry/index.js';
import { IpiDetector, type IpiRisk } from '@claude-flow/security';

export type IpiMode = 'warn' | 'block' | 'hil';

const VALID_MODES: ReadonlySet<string> = new Set(['warn', 'block', 'hil']);

/** Read `CLAUDE_FLOW_IPI_MODE` fresh; falls back to 'warn' for unset/invalid values. */
export function getIpiMode(): IpiMode {
  const raw = process.env.CLAUDE_FLOW_IPI_MODE;
  return raw && VALID_MODES.has(raw) ? (raw as IpiMode) : 'warn';
}

/** Build the reason string shared by warn/block/hil outcomes. */
function describeRisk(toolName: string, risk: IpiRisk): string {
  const reasons = risk.reasons.length > 0 ? risk.reasons.join('; ') : 'no specific pattern matched';
  return `IPI risk=${risk.risk} (confidence=${risk.confidence.toFixed(2)}) for tool "${toolName}": ${reasons}`;
}

/**
 * Decide the hook outcome for an assessed risk under the given mode. Pure —
 * makes it directly testable without going through the hook executor.
 */
export function decideIpiOutcome(
  toolName: string,
  risk: IpiRisk,
  mode: IpiMode,
): HookResult {
  const message = describeRisk(toolName, risk);

  if (mode === 'warn') {
    return risk.risk === 'none'
      ? { success: true }
      : { success: true, warnings: [message] };
  }

  // 'block' and 'hil' (stub — see file header) share the same threshold.
  if (risk.risk === 'high') {
    return { success: true, abort: true, message: `${mode === 'hil' ? '[hil-stub] ' : ''}blocked: ${message}` };
  }
  return risk.risk === 'none' ? { success: true } : { success: true, warnings: [message] };
}

/**
 * Handler factory — takes a detector so callers/tests can inject one, but
 * `registerIpiDetectionHook` below wires a real `IpiDetector` by default.
 */
export function createIpiDetectionHandler(detector: IpiDetector) {
  return (context: HookContext): HookResult => {
    if (!context.tool) return { success: true };
    const risk = detector.assess({ name: context.tool.name, parameters: context.tool.parameters });
    return decideIpiOutcome(context.tool.name, risk, getIpiMode());
  };
}

/**
 * Register the IPI detection handler on `HookEvent.PreToolUse` at
 * `HookPriority.Critical`. Returns the hook id (for `unregister`/tests).
 */
export function registerIpiDetectionHook(
  registry: HookRegistry = defaultRegistry,
  detector: IpiDetector = new IpiDetector(),
): string {
  return registry.register(
    HookEvent.PreToolUse,
    createIpiDetectionHandler(detector),
    HookPriority.Critical,
    {
      name: 'ipi-detection',
      description: 'ADR-178 Primitive 2 — RepE/IPI pattern-classifier scan of pending tool-call parameters',
    },
  );
}

/** Hook id of the eagerly-registered default-registry instance. */
export const ipiDetectionHookId = registerIpiDetectionHook();
