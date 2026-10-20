/**
 * A press that outlived its drawing (ADR-469). The engine holds a Button's `onPress` only for the life of the drawing that made it
 * (types: "The host holds only a handle, for the drawing's life"). A click that was sent while the pane was redrawn (a resize, a refresh
 * tick, a view switch) can reach the engine after the drawing it was aimed at is gone: the chain then ends at a handle nobody holds,
 * and the engine logs "ui.press hook skipped… no handler is held under handle". Nothing was lost but that click, and it is not an
 * error of ours, so the `ui.press` hook answers it quietly with the element it was aimed at instead of letting it throw into the log.
 * Every other failure still propagates.
 */
export const STALE_HANDLE = /no handler is held/i

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : typeof error === 'string' ? error : '')

/** `next()`'s answer, or `fallback` when it fails only because the press's handler is no longer held. */
export async function tolerantPress<R>(next: () => R | Promise<R>, fallback: R): Promise<R> {
  try {
    return await next()
  } catch (error) {
    if (STALE_HANDLE.test(messageOf(error))) return fallback

    throw error
  }
}
