/**
 * Which build is running, for the header. The version is the same across every commit of a release, so on its own it cannot say
 * whether a session has the latest code or a stale copy; the git revision can. A leaf with no imports (the drawing code reads it,
 * `register.ts` sets it once the session starts). It is set only when the plugin folder is a `plugins/ruflo-console` checkout of the
 * repo git reports, so an installed copy that happens to sit inside some other repository never shows that repository's commit.
 */
let held = ''

export const setBuild = (id: string): void => {
  held = id
}

export const getBuild = (): string => held

/** The plugin folder's place in its repository that makes it ours: `git rev-parse --show-prefix` prints this for a checkout. */
export const PLUGIN_PREFIX = 'plugins/ruflo-console'

export const isOurCheckout = (showPrefix: string): boolean => showPrefix.trim().replace(/\/$/, '') === PLUGIN_PREFIX

/**
 * `git describe --always --dirty --abbrev=7` as a build id: a short revision, with `-dirty` when the tree has uncommitted edits.
 * Anything else (an error message, escape codes, a long line) is refused, because this text is drawn on the screen.
 */
export const buildOf = (stdout: string): string => (/^[0-9a-f]{4,40}(-dirty)?$/.test(stdout.trim()) ? stdout.trim() : '')
