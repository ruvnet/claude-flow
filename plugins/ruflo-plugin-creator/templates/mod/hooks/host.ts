/**
 * What the pure logic needs from the engine, as plain functions. The engine
 * reads what a module calls off its source, so `$` never leaves a hook: the
 * hook builds this from literal `$.noun.method(...)` calls (register.ts).
 */
export type Host = {
  readonly status: (text: string | undefined) => void
}

/** The tool-call tally and the line it shows; pure, testable without the engine. */
export function statusLine(calls: number): string {
  return `my-mod · ${calls} tool call${calls === 1 ? '' : 's'}`
}

/** Draws through the host; a refused `ui.status` (an admin may withhold it) is ignored. */
export function show(host: Host, calls: number): void {
  try {
    host.status(statusLine(calls))
  } catch {
    // never fail a hook over the status line
  }
}
