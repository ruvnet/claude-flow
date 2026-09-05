/**
 * Shared toggle cooldown — ADR-314 §D1.
 *
 * Self-reported flags (rate-limited, quota-low) have zero server-side
 * verification (ADR-312's Phase 0 constraint carries over unchanged). A
 * cooldown on how often the flag can actually CHANGE state is cheap,
 * purely client-side friction against casual "always on" gaming or a
 * scripted flip-flop loop — it does not stop a determined abuser (that
 * needs the per-identity server-side quota ADR-314 flags as the real fix),
 * but it raises the bar above "one line in a shell script."
 */

export const TOGGLE_COOLDOWN_MS = 10 * 60 * 1000;

/** True when `lastToggleAt` is within the cooldown window of `now`. */
export function cooldownActive(lastToggleAt: string | null, now: Date): boolean {
  if (!lastToggleAt) return false;
  const t = Date.parse(lastToggleAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < TOGGLE_COOLDOWN_MS;
}

/** Minutes remaining in the cooldown window — for user-facing messages. */
export function cooldownRemainingMin(lastToggleAt: string | null, now: Date): number {
  if (!lastToggleAt) return 0;
  const t = Date.parse(lastToggleAt);
  if (Number.isNaN(t)) return 0;
  const remainingMs = TOGGLE_COOLDOWN_MS - (now.getTime() - t);
  return Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
}
