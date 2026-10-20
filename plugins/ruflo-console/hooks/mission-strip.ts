/**
 * The Mission Control strip's words, pure (the strip that draws them is views/mission-control.ts `missionStrip`). The strip said
 * "nothing ready" for four different things: no tasks yet, every task done, a task running, and the next task waiting on one that is not
 * done. Each now says which. Also the progress bar's cells and the percentage. Tested in tests/mission-strip.spec.ts.
 */
export type StripInput = {
  done: number
  total: number
  paused: boolean
  /** The task Claude is on now, if one is running. */
  running: { id: string; title: string } | null
  /** The next task that can be handed out, if there is one. */
  next: { id: string; stage: string; title: string } | null
}

export type StripStatus = { text: string; tone: 'live' | 'ready' | 'wait' | 'done' | 'paused' }

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

/** What the mission is doing, in one line, and how loud: the first thing true of it, in this order. */
export function stripStatus(input: StripInput, max = 48): StripStatus {
  if (input.total === 0) return { text: 'no tasks yet: plan the goal first', tone: 'wait' }
  if (input.done >= input.total) return { text: '✔ every task is done', tone: 'done' }
  if (input.paused) return { text: '⏸ paused: resume to carry on', tone: 'paused' }
  if (input.running !== null) {
    const lead = `◐ running ${input.running.id} `

    return { text: `${lead}${cut(input.running.title, Math.max(6, max - lead.length))}`, tone: 'live' }
  }

  if (input.next !== null) {
    const lead = `▶ next ${input.next.id} [${input.next.stage}] `

    return { text: `${lead}${cut(input.next.title, Math.max(6, max - lead.length))}`, tone: 'ready' }
  }

  return { text: 'waiting: the next task needs one that is not done', tone: 'wait' }
}

/** The bar's cells: how many filled, how many empty, always `width` in all, and never a filled cell for none done. */
export function barCells(done: number, total: number, width = 10): { filled: number; empty: number } {
  const filled = total <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((done / total) * width)))

  return { filled, empty: width - filled }
}

export const percentOf = (done: number, total: number): number => (total <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((done / total) * 100))))
