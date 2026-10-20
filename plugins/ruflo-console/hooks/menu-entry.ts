/**
 * The main menu's entry, played once after the boot (and again when Refresh restarts the console): the four group cards light up one
 * after another, each title scrambling into place and its entries locking in one by one, then the status bar and the prompt. Pure and
 * a leaf (no imports): the menu asks for its age and draws what that age allows. Total about seven seconds. Tested in tests/menu-entry.spec.ts.
 */
export const ENTRY = { groupFrom: 500, groupEvery: 900, titleMs: 600, itemAfter: 500, itemEvery: 110, settleMs: 350, statusFrom: 5600, factsFrom: 6300, promptFrom: 6200, totalMs: 6900 } as const

export type EntryClock = { look: string; boot: boolean; bootAtMs: number; menuAtMs: number }

/** Ms since the menu's entry began, or null when there is no entry to play (not the BBS look, boot off, never opened, or it has finished). */
export function entryAge(clock: EntryClock, nowMs: number, bootMinMs: number): number | null {
  if (clock.look !== 'bbs' || !clock.boot || clock.bootAtMs === 0) return null

  const start = clock.menuAtMs >= clock.bootAtMs && clock.menuAtMs > 0 ? clock.menuAtMs : clock.bootAtMs + bootMinMs
  const age = nowMs - start

  return age >= ENTRY.totalMs ? null : Math.max(0, age)
}

export const groupStart = (group: number): number => ENTRY.groupFrom + group * ENTRY.groupEvery
export const itemStart = (group: number, item: number): number => groupStart(group) + ENTRY.itemAfter + item * ENTRY.itemEvery
