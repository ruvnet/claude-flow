/**
 * Tool-loop circuit breaker (hermes-agent tool_guardrails pattern).
 *
 * Detects an agent stuck repeating the same failing command — a real silent
 * failure mode where a loop burns turns with no signal. This is ORTHOGONAL to
 * the security `tool-output-guardrail` (which detects indirect prompt injection
 * in tool *output*); this one watches the agent's own *call* pattern.
 *
 * Design (deterministic, in-memory, bounded):
 *  - `recordCommandOutcome` (called by post-command) appends (command, success)
 *    to a small ring buffer.
 *  - `checkCommandLoop` (called by pre-command) returns a verdict for a command
 *    about to run, based on its recent consecutive-failure streak.
 *  - Verdict is advisory by default (`warn`); callers decide whether to block.
 *    An orchestration layer that doesn't own the UI should not hard-stop.
 */

export type LoopVerdict = 'allow' | 'warn' | 'block';

interface Outcome { command: string; success: boolean; at: number }

const MAX_HISTORY = 64;
const history: Outcome[] = [];

/** Consecutive-failure thresholds for the same command (exact match). */
const WARN_AT = 3;
const BLOCK_AT = 5;

function normalize(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/** Record a command's outcome. Called from the post-command hook. */
export function recordCommandOutcome(command: string, success: boolean): void {
  history.push({ command: normalize(command), success, at: history.length });
  if (history.length > MAX_HISTORY) history.shift();
}

/** Count the trailing run of consecutive failures of `command` (exact match),
 * stopping at the first success of that command or a gap. */
function consecutiveFailures(command: string): number {
  const norm = normalize(command);
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].command !== norm) continue; // ignore interleaved other commands
    if (history[i].success) break;             // a success breaks the streak
    streak++;
  }
  return streak;
}

/**
 * Verdict for a command about to execute. Called from the pre-command hook.
 * Returns the verdict, the failure streak, and a recovery hint when looping.
 */
export function checkCommandLoop(command: string): {
  verdict: LoopVerdict;
  consecutiveFailures: number;
  hint?: string;
} {
  const fails = consecutiveFailures(command);
  if (fails >= BLOCK_AT) {
    return {
      verdict: 'block',
      consecutiveFailures: fails,
      hint: `This exact command has failed ${fails}× in a row. Stop repeating it — inspect state first (e.g. \`pwd && ls -la\`), change the approach, or ask for help.`,
    };
  }
  if (fails >= WARN_AT) {
    return {
      verdict: 'warn',
      consecutiveFailures: fails,
      hint: `This command has failed ${fails}× in a row. Before retrying, verify preconditions (paths, args, prior step output) rather than re-running the same call.`,
    };
  }
  return { verdict: 'allow', consecutiveFailures: fails };
}

/** Test/reset helper — clears the in-memory history. */
export function _resetLoopHistory(): void {
  history.length = 0;
}
