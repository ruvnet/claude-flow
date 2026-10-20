/**
 * The one spinner the console draws for anything in progress: a frame a tenth of a second, so a running thing visibly turns. Shared by
 * the Missions page, the Performance page and every lab's result, so they all move the same way.
 */
export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export const spinAt = (nowMs: number): string => SPIN[Math.floor(nowMs / 100) % SPIN.length]
