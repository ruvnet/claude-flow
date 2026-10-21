// Adversarial corpus for scripts/probe-mod-guards.mjs. Pure data builders: no I/O, no plugin knowledge.
// Secrets are assembled from parts at runtime so no secret-shaped literal sits in the repo.

const cp = (...c) => String.fromCodePoint(...c)
const rep = (s, n) => s.repeat(Math.max(1, Math.ceil(n / s.length))).slice(0, n)

export const INVISIBLE = {
  zwsp: cp(0x200b), zwnj: cp(0x200c), zwj: cp(0x200d), lrm: cp(0x200e), rlo: cp(0x202e), pdf: cp(0x202c),
  wj: cp(0x2060), bom: cp(0xfeff), shy: cp(0xad), rli: cp(0x2067), pdi: cp(0x2069), mvs: cp(0x180e), cgj: cp(0x34f),
}

const A36 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
/** Secret shapes the repo's guards are meant to catch, in the order a plugin's detector is tried. */
export const SECRET_TYPES = {
  github: () => 'gh' + 'p_' + A36,
  aws: () => 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  anthropic: () => 'sk' + '-ant-' + rep('a1B2c3D4', 40),
  slack: () => 'xox' + 'b-' + '1234567890-abcdefghijkl',
  jwt: () => 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'abcdefgh12345678',
  bearer: () => 'Bear' + 'er ' + rep('Zy9x8W7v', 32),
  assign: () => 'api_' + 'key = ' + 'A1b2C3d4E5f6G7h8I9j0',
  pem: () => '-----BEGIN ' + 'RSA PRIVATE KEY-----',
}
export const ALL_SECRETS = Object.values(SECRET_TYPES).map(f => f()).join('\n')

export const BENIGN = [
  'Decided to rotate credentials quarterly; the runbook says where each token lives.',
  'pip install sk-learn is wrong; the package is scikit-learn. Version 1.2.3, commit 4f9c2a1.',
  'The password policy needs 12 characters. Bearer auth is described in section 4.',
  'ghp_ is the prefix GitHub uses; AKIA is the AWS prefix. Neither is followed by anything here.',
  'token budget: 4096, max_tokens=128, api key rotation ticket RUF-123',
  'sha256: ' + rep('0123456789abcdef', 64) + ' (a digest, not a key)',
  'id 123e4567-e89b-12d3-a456-426614174000 created by agent-7 at 2026-10-04T12:00:00Z',
  'function isKey(k) { return typeof k === "string" && k.length > 3 }\nconst token = nextToken()',
  { title: 'Use JWT with refresh tokens', status: 'accepted', tags: ['auth', 'adr'], depth: { a: [1, 2, { b: 'c' }] } },
  ['plain', 'list', 'of', 'ordinary', 'words', 42, true, null],
]

const split = (s, ch, at) => s.slice(0, at) + ch + s.slice(at)
const everyChar = (s, ch) => [...s].join(ch)
const fullwidth = s => [...s].map(c => (c >= '!' && c <= '~' ? String.fromCodePoint(c.codePointAt(0) + 0xfee0) : c)).join('')
const homoglyph = s => s.replace(/[aeopc]/g, c => ({ a: cp(0x430), e: cp(0x435), o: cp(0x43e), p: cp(0x440), c: cp(0x441) })[c])
const nest = (leaf, depth, kind) => {
  let v = leaf
  for (let i = 0; i < depth; i++) v = kind === 'arr' ? [v] : kind === 'mix' ? (i % 2 ? [v] : { k: v }) : { k: v }
  return v
}
const pad = (n, s, where) => {
  const filler = rep('lorem ipsum dolor sit amet ', n)
  return where === 'start' ? s + ' ' + filler : where === 'end' ? filler + ' ' + s : filler.slice(0, n >> 1) + ' ' + s + ' ' + filler.slice(n >> 1)
}
const escFirst = s => '\\u00' + s.charCodeAt(0).toString(16) + s.slice(1)

/**
 * Evasion probes: the plain secret in the same slot is refused (calibration proves it), so any mutation that is NOT refused is a hole.
 * tier `must` fails the run; `advisory` is an encoding a pattern guard is not designed to decode (reported, fails only with --strict).
 */
export function evasionProbes(big) {
  const p = []
  const add = (id, cls, tier, build) => p.push({ id, cls, tier, kind: 'evade', build })
  add('plain', 'control', 'must', s => `deploy with ${s} now`)
  add('zwsp-prefix', 'invisible', 'must', s => split(s, INVISIBLE.zwsp, 2))
  add('zwj-mid', 'invisible', 'must', s => split(s, INVISIBLE.zwj, s.length >> 1))
  add('bom-mid', 'invisible', 'must', s => split(s, INVISIBLE.bom, s.length >> 1))
  add('shy-split', 'invisible', 'must', s => split(s, INVISIBLE.shy, 3))
  add('word-joiner', 'invisible', 'must', s => split(s, INVISIBLE.wj, 3))
  add('bidi-isolate', 'invisible', 'must', s => split(s, INVISIBLE.rli + INVISIBLE.pdi, 3))
  add('bidi-override-wrap', 'invisible', 'must', s => INVISIBLE.rlo + split(s, INVISIBLE.lrm, 4) + INVISIBLE.pdf)
  add('mongolian-vs', 'invisible', 'must', s => split(s, INVISIBLE.mvs, 3))
  add('every-char-zwsp', 'invisible', 'must', s => everyChar(s, INVISIBLE.zwsp))
  for (const kind of ['obj', 'arr', 'mix']) {
    for (const d of [3, 6, 12, 60, 5000]) add(`nest-${kind}-${d}`, 'nesting', 'must', s => nest(s, d, kind))
  }
  add('wide-array-250', 'wide', 'must', s => [...Array.from({ length: 250 }, (_, i) => `note ${i}`), s])
  add('wide-object-250', 'wide', 'must', s => ({ ...Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, 'x'])), last: s }))
  add('wide-array-5000', 'wide', 'must', s => [...Array.from({ length: 5000 }, () => 'x'), s])
  add('key-name', 'keys', 'must', s => ({ [s]: 'value' }))
  add('key-name-nested-3', 'keys', 'must', s => nest({ [s]: 'value' }, 3, 'obj'))
  add('key-name-in-array', 'keys', 'must', s => [{ [s]: 'value' }])
  add('json-in-string', 'json', 'must', s => JSON.stringify({ token: s, note: 'x' }))
  add('json-double-encoded', 'json', 'must', s => JSON.stringify(JSON.stringify({ token: s })))
  add('json-unicode-escape', 'encoding', 'advisory', s => `{"token":"${escFirst(s)}"}`)
  add('base64', 'encoding', 'advisory', s => Buffer.from(s).toString('base64'))
  add('hex', 'encoding', 'advisory', s => Buffer.from(s).toString('hex'))
  add('url-encoded', 'encoding', 'advisory', s => '%' + s.charCodeAt(0).toString(16) + s.slice(1))
  add('fullwidth-confusable', 'confusable', 'advisory', s => fullwidth(s))
  add('cyrillic-confusable', 'confusable', 'advisory', s => homoglyph(s))
  // Structured credentials: the name and the value sit in two strings, so a rule that needs them together never sees them.
  add('pair-name-value', 'structured', 'must', s => ({ key: 'api_key', value: s }))
  add('pair-name-content-nested', 'structured', 'must', s => ({ entries: [{ field: 'secret', content: s }] }))
  add('pair-array', 'structured', 'must', s => ({ rows: [['token', s]] }))
  // Budgets: past a walker's node or character cap the guard must refuse (fail closed) or still find the secret; it may not pass it.
  add('over-node-cap-25000', 'budget', 'must', s => ({ list: [...Array.from({ length: 25_000 }, () => 1), s] }))
  add('over-char-cap-3m', 'budget', 'must', s => ({ a: 'p'.repeat(1_400_000), b: 'p'.repeat(1_400_000), c: s }))
  add('huge-start', 'huge', 'must', s => pad(big, s, 'start'))
  add('huge-middle', 'huge', 'must', s => pad(big, s, 'middle'))
  add('huge-end', 'huge', 'must', s => pad(big, s, 'end'))
  add('after-25k-padding', 'huge', 'must', s => pad(25_000, s, 'end'))
  add('after-200k-padding', 'huge', 'must', s => pad(Math.min(big, 200_000), s, 'end'))
  return p
}

/** Stress inputs (no secret needed): the guard must neither throw nor take > the budget. */
export function stressProbes(big) {
  const p = []
  const add = (id, build) => p.push({ id, cls: 'stress', tier: 'must', kind: 'stress', build })
  const n = big
  add('s-a', () => 'a'.repeat(n))
  add('s-a-bang', () => 'a'.repeat(n) + '!')
  add('s-sk-near-miss', () => rep('sk' + '-' + 'a'.repeat(22) + ' ', n))
  add('s-ghp-near-miss', () => rep('gh' + 'p_' + 'a'.repeat(28) + ' ', n))
  add('s-akia-near-miss', () => rep('AK' + 'IA' + 'ABCDEFGHIJKLM ', n))
  add('s-assign-spaces', () => rep('api_' + 'key' + ' '.repeat(40), n))
  add('s-assign-long-value', () => 'pass' + 'word: ' + 'a'.repeat(n))
  add('s-bearer', () => 'Bear' + 'er ' + 'a'.repeat(n))
  add('s-pem-spaces', () => '-----BEGIN ' + 'A '.repeat(n >> 1))
  add('s-pem-upper', () => '-----BEGIN ' + 'A'.repeat(n))
  add('s-jwt-dots', () => rep('eyJ' + 'abcdefghi.', n))
  add('s-curl-repeat', () => 'curl '.repeat(n / 5))
  add('s-ignore-repeat', () => 'ignore previous '.repeat(n / 16))
  add('s-role-tags', () => '<system>'.repeat(n / 8))
  add('s-send-secrets', () => rep('send the ', n) + 'x')
  add('s-newlines', () => '\n'.repeat(n))
  add('s-spaces-x', () => ' '.repeat(n) + 'x')
  add('s-lt', () => '<'.repeat(n))
  add('s-brace', () => '{'.repeat(n))
  add('s-backslash', () => 'x:' + '\\'.repeat(n))
  add('s-zwsp', () => INVISIBLE.zwsp.repeat(n))
  add('s-zwsp-in-secret', () => rep('gh' + INVISIBLE.zwsp + 'p_' + INVISIBLE.zwsp, n))
  add('s-emoji', () => '\u{1F600}'.repeat(n >> 1))
  add('s-email', () => 'a@' + 'a.'.repeat(n >> 1))
  add('s-email-dots', () => 'a.'.repeat(n >> 1) + '@')
  add('s-url', () => 'http://' + 'a'.repeat(n))
  add('s-url-userinfo', () => 'http://' + 'a:'.repeat(n >> 1) + '@h')
  add('s-path-dots', () => '../'.repeat(n / 3))
  add('s-words', () => rep('alpha beta gamma ', n))
  add('s-eq-run', () => ('a'.repeat(200) + '=').repeat(n / 201))
  add('s-deep-obj-5000', () => nest('benign', 5000, 'obj'))
  add('s-deep-arr-5000', () => nest('benign', 5000, 'arr'))
  add('s-deep-obj-100000', () => nest('benign', 100_000, 'obj'))
  add('s-wide-array-100k', () => Array.from({ length: 100_000 }, () => 'x'))
  add('s-wide-keys-100k', () => Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => ['k' + i, 'x'])))
  add('s-many-1kb-strings', () => Array.from({ length: Math.max(200, n >> 10) }, () => 'a'.repeat(1024)))
  return p
}
