/**
 * The status contract (ADR-446): the file the console's Mods section reads. It scans `.claude-flow` for `<name>-mod` folders (the folder name
 * must match /^[a-z0-9][a-z0-9-]{0,40}-mod$/) and keeps a file only when `version` is 1. Anything else you write is ignored by the console.
 */
export const STATUS_PATH = '.claude-flow/my-mod/status.json'

/** What the console reads; `calls` is a number (not a per-tool object), `lastDenied` is a short reason, left out until the mod refuses something. */
export type ModStatus = {
  version: 1
  updatedMs: number
  startedMs: number
  modVersion: string
  summary: string
  guard: boolean
  calls: number
  blocked: number
  lastDenied?: string
}

/** The counters the mod keeps for one session. This template guards nothing, so `blocked` stays 0 and `guard` is false. */
export type Counters = { calls: number; blocked: number; lastDenied?: string }

export const newCounters = (): Counters => ({ calls: 0, blocked: 0 })

/** Builds the document; pure, so a test can assert the shape without the engine. */
export function modStatus(c: Counters, nowMs: number, startedMs: number): ModStatus {
  return {
    version: 1,
    updatedMs: nowMs,
    startedMs,
    modVersion: '0.1.0',
    summary: 'counts tool calls; guards nothing',
    guard: false,
    calls: c.calls,
    blocked: c.blocked,
    ...(c.lastDenied !== undefined && { lastDenied: c.lastDenied }),
  }
}

export const statusText = (c: Counters, nowMs: number, startedMs: number): string => `${JSON.stringify(modStatus(c, nowMs, startedMs), null, 2)}\n`
