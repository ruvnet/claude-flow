/** The session workspace's two options (ADR-486), read the way every other option family is: a value the plugin does not know is its default. */
export type SessionOptions = {
  /** The attention queue and session browser on the Room. Read-only discovery; on by default. */
  sessionWorkspace: boolean
  /** The preview beside the list. Off draws no transcript text at all. */
  sessionPreview: boolean
}

export const sessionOptionsOf = (raw: unknown): SessionOptions => {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const on = (v: unknown): boolean => v !== false && v !== 'false'

  return { sessionWorkspace: on(value.sessionWorkspace), sessionPreview: on(value.sessionPreview) }
}
