/**
 * One washing function for everything the Events and Timeline pages persist, draw, copy or export (ADR-474): escapes, control, bidi and
 * tag characters are dropped, credential-shaped text is masked, and a home-directory path loses its user name. Pure.
 */
import { ESCAPES, HIDDEN, INVISIBLE } from './parse'
import { maskSecrets } from './workflows'

/** `token=abc`, `password: hunter2`, `Authorization: Basic xyz`: a key word followed by a value. */
const KEYED = /\b(?:token|secret|passw(?:or)?d|passwd|api[_-]?key|apikey|authorization|credential|private[_-]?key)\b(\s*[=:]\s*)(?:Bearer\s+|Basic\s+)?\S+/gi
const HOME_PATH = /\/(?:home|Users)\/[^/\s'"]+/g
const TAGS = /[\u{E0000}-\u{E007F}]/gu
/** A control character that is not white space is deleted, not turned into a space: `sk-ant-AAAA<NUL>BBBB` is one credential, and a space would leave `BBBB` unmasked on disk. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g
/** `name@host.tld` (bounded, so a long run of word characters cannot make it slow). */
const EMAIL = /\b[\w.+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+\b/g
/** A cookie header carries a session: the whole rest of the line goes. */
const COOKIE = /\b((?:set-)?cookie)\b(\s*[=:]\s*)\S.*/gi
/** A base64 secret with `/` or `+` in it (an AWS secret key is 40 of them); maskSecrets' long-run rule stops at the slash. Needs all three of upper, lower and digit, so a path or a word is left alone. */
const BASE64 = /\b(?=[A-Za-z0-9+/]{32,})(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{32,}={0,2}/g
const WIN_HOME = /\b[A-Za-z]:\\Users\\[^\\\s'"]+/g

export const MASK = '‹masked›'

/** `value` washed and clipped to `max` characters (an ellipsis marks a cut). Never throws; a non-string is ''. */
export function maskLine(value: unknown, max = 240): string {
  if (typeof value !== 'string') return ''

  const washed = value.slice(0, max * 4).replace(ESCAPES, '').replace(TAGS, '').replace(INVISIBLE, '').replace(CONTROLS, '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()
  const masked = maskSecrets(washed.replace(COOKIE, (_all, name: string, sep: string) => `${name}${sep}${MASK}`).replace(KEYED, (_all, sep: string) => `credential${sep}${MASK}`)).replace(BASE64, MASK).replace(EMAIL, MASK).replace(HOME_PATH, '~').replace(WIN_HOME, '~')

  return masked.length > max ? `${masked.slice(0, Math.max(0, max - 1))}…` : masked
}
