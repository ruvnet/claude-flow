/**
 * Pure text screening for the guidance and delivery features. Two jobs: find secrets (so none is stored or sent) and find prompt-injection phrasing (so
 * screened text cannot instruct the model). Findings are NAMES only: the matched text is never returned, logged or counted by value.
 */

const SECRETS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack token', /\b(?:xox[abeprs]-|xapp-\d-)[A-Za-z0-9-]{10,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}(?:\b|(?![0-9A-Za-z_-]))/],
  ['anthropic or openai key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  // One start per token run (linear on '-eyJ' repeats), at the first eyJ after a '-' or the run start.
  ['jwt', /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_]*-)*?eyJ))\1[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
  // The keyword ends an _ or - separated name (GITHUB_TOKEN=, "client_secret":), optionally then _key / _access_key
  // (aws_secret_access_key =). Names that only start with it (TOKEN_URL=, MAX_TOKENS=) and all-digit values do not
  // match, and nothing after the keyword can backtrack against it (linear on 'token_token_...').
  ['key assignment', /(?<![A-Za-z0-9_-])[_-]*(?:[A-Za-z0-9]+[_-]+)*(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?(?:[_-](?:access[_-]?)?key)?["']?\s*[:=]\s*["']?(?=[A-Za-z0-9/+=_.-]*[A-Za-z])[A-Za-z0-9/+=_.-]{16,}/i],
]

const INJECTION: readonly (readonly [string, RegExp])[] = [
  ['override instructions', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|system)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i],
  ['role reassignment', /\byou are (?:now|no longer)\b|\bact as (?:an? )?(?:unrestricted|jailbroken)\b/i],
  ['new instructions', /\b(?:new|updated|real) (?:system )?instructions?\s*:/i],
  ['fake role tags', /<\/?\s*(?:system|assistant|developer|instructions?)\s*>|^\s*(?:system|assistant)\s*:/im],
  ['concealment', /\bdo not (?:tell|inform|mention|reveal)[^.\n]{0,30}\b(?:user|human|operator)\b/i],
  ['exfiltration', /\b(?:exfiltrate|send|post|upload)\b[^.\n]{0,50}\b(?:secrets?|credentials?|tokens?|api keys?|\.env)\b/i],
  ['shell pipe', /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
]

// C0/C1 controls (keeping tab and newline), DEL, line/paragraph separators and every default-ignorable code point: zero-width,
// bidi overrides and isolates, soft hyphen, combining grapheme joiner, variation selectors and tag characters, so none can split a phrase.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Default_Ignorable_Code_Point}]/gu

// The set the screen stripped before this one widened: joining only across these keeps the original reading.
const LEGACY_INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g

// One space or newline per whitespace run: padding cannot stretch a match across a window boundary, and a
// rule's \s* or ^ cannot go quadratic on a run of blank lines.
const collapse = (text: string) => text.replace(/\s+/g, run => (run.includes('\n') ? '\n' : ' '))

/** The text the rules see first: invisible characters removed, then NFKC (fullwidth and compatibility forms fold to ASCII). */
export const bare = (text: string) => collapse(text.replace(INVISIBLE, '').normalize('NFKC').replace(INVISIBLE, ''))

/**
 * Three readings, each screened. Removing or folding a character joins what follows to the word before it, so a
 * leading \b can no longer match ("x" + soft hyphen + "Ignore ..."); the literal reading (only the original set
 * removed) and the spaced one (invisible characters become spaces) keep those word starts.
 */
const readings = (text: string) => [bare(text), collapse(text.replace(LEGACY_INVISIBLE, '')), collapse(text.replace(INVISIBLE, ' '))]

const WINDOW = 20_000
// Far longer than any rule can span, so a match is never split across two windows.
const OVERLAP = 1_024

function cut(clean: string): string[] {
  if (clean.length <= WINDOW) return [clean]
  const out: string[] = []
  for (let start = 0; start < clean.length; start += WINDOW - OVERLAP) {
    // A later window starts after whitespace when there is some within 256 characters, so a rule's lookbehind,
    // \b and ^ do not see a word cut in half; a long run without whitespace is covered by the overlap.
    const ws = start === 0 ? -1 : clean.slice(start, start + 256).search(/\s/)
    const from = ws >= 0 ? start + ws + 1 : start
    // Mid-line, a window's first character is not a line start: a lead character keeps ^ from matching there.
    const lead = ws >= 0 && clean[from - 1] !== '\n' ? '\u0001' : ''
    out.push(lead + clean.slice(from, start + WINDOW))
    if (start + WINDOW >= clean.length) break
  }
  return out
}

/**
 * Every reading in overlapping windows. The whole text is screened, not a prefix: padding must not push a phrase or a
 * secret past the screen. Each rule runs per window, so the cost stays linear in the input.
 */
export function windows(text: string): string[] {
  return readings(text).flatMap(cut)
}

/** Whether `re` matches anywhere in the screened windows. */
export const anyWindow = (parts: readonly string[], re: RegExp) => parts.some(part => re.test(part))

export type Findings = { readonly secrets: readonly string[]; readonly injection: readonly string[] }

const names = (rules: readonly (readonly [string, RegExp])[], parts: readonly string[]) => rules.filter(([, re]) => anyWindow(parts, re)).map(([name]) => name)

/** Names of every secret shape and injection phrase in already-screened windows. */
export function scanWindows(parts: readonly string[]): Findings {
  return { secrets: names(SECRETS, parts), injection: names(INJECTION, parts) }
}

/** Names of every secret shape and injection phrase found in `text`. Cost is linear in the input. */
export const scan = (text: string): Findings => scanWindows(windows(text))
