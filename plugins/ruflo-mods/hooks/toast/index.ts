import type { ModState } from '../state'
import { createToastKit, type ToastInput } from './policy'

/**
 * The mod's toasts (ADR-477): every `$.ui.toast` of ruflo-mods goes through the shared policy (levels, one clean line, de-duplication, a
 * rate limit, the person's Toasts setting from the console, and a digest on the console's Events page). The engine `import type { ModState } from '../state'
import { createToastKit, type ToastInput } from './policy'

/**
 * The mod's toasts (ADR-477): every `$.ui.toast` of ruflo-mods goes through the shared policy (levels, one clean line, de-duplication, a
 * rate limit, the person's Toasts setting from the console, and a digest on the console's Events page).  cannot be passed
 * across an import, so `registerNoun` binds the calls from the `import type { ModState } from '../state'
import { createToastKit, type ToastInput } from './policy'

/**
 * The mod's toasts (ADR-477): every `$.ui.toast` of ruflo-mods goes through the shared policy (levels, one clean line, de-duplication, a
 * rate limit, the person's Toasts setting from the console, and a digest on the console's Events page).  built beneath (as it does `ui.status`), and `session.start` from its own `import type { ModState } from '../state'
import { createToastKit, type ToastInput } from './policy'

/**
 * The mod's toasts (ADR-477): every `$.ui.toast` of ruflo-mods goes through the shared policy (levels, one clean line, de-duplication, a
 * rate limit, the person's Toasts setting from the console, and a digest on the console's Events page).  if
 * `engine.create` did not run first (a test harness), and each hands them here as functions.
 * The result never rejects and never throws: a refused toast changes no verdict, answer or hook result.
 */
export type ToastBinding = {
  now: () => Promise<number>
  show: (line: string, options: { timeoutMs?: number }) => void
  after: (ms: number, fn: () => void) => unknown
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

/** The states whose toasts are bound: the first binding wins (`engine.create` runs before `session.start`; either is enough on its own). */
const bound = new WeakSet<ModState>()

export function bindToasts(state: ModState, calls: ToastBinding): void {
  if (bound.has(state)) return

  bound.add(state)
  const toaster = createToastKit({ source: 'mods', now: calls.now, show: calls.show, after: calls.after, io: { read: calls.read, write: calls.write, exists: calls.exists } })

  state.say = async (input: ToastInput) => {
    try {
      await toaster.toast(input)
    } catch {
      // a toast never changes what the hook answers
    }
  }
}
