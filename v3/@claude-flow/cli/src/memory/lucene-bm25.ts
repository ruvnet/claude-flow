// Lucene-style BM25 with Porter stemmer + Lucene English stopword list +
// length normalisation. Closer to the published BEIR BM25 baseline than
// hybrid-retrieval.ts's repo-history-tuned multi-field BM25.
//
// Motivation: ADR-087 measured our hybrid-retrieval BM25 at nDCG@10 = 0.279
// on NFCorpus vs the published Lucene baseline of 0.325 — a 14% relative gap
// that broke RRF (the weaker input averaged noise into the top-K). This
// module closes that gap.
//
// Pure function module, no external deps. Porter algorithm: standard
// Porter (1980), implemented from the published rule tables. Stopword
// list: Lucene 8.x English Analyzer (33 tokens) plus a few high-frequency
// extras for retrieval (total ~120 tokens) per BEIR convention.
//
// ADR-088.

// ---------------------------------------------------------------------------
// Porter stemmer (1980) — single-pass, table-driven
// ---------------------------------------------------------------------------

const VOWEL = /^[aeiou]$/;
const CONSONANT_Y = /[aeiouy]/;

function isCons(s: string, i: number): boolean {
  const c = s[i];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') return false;
  if (c === 'y') return i === 0 ? true : !isCons(s, i - 1);
  return true;
}

function measure(s: string): number {
  let n = 0;
  let i = 0;
  // Skip leading consonants
  while (i < s.length && isCons(s, i)) i++;
  while (i < s.length) {
    // skip vowels
    while (i < s.length && !isCons(s, i)) i++;
    if (i >= s.length) return n;
    n++;
    // skip consonants
    while (i < s.length && isCons(s, i)) i++;
  }
  return n;
}

function containsVowel(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (!isCons(s, i)) return true;
  return false;
}

function endsDoubleCons(s: string): boolean {
  if (s.length < 2) return false;
  const a = s[s.length - 2];
  const b = s[s.length - 1];
  if (a !== b) return false;
  return isCons(s, s.length - 1);
}

function endsCvc(s: string): boolean {
  if (s.length < 3) return false;
  if (!isCons(s, s.length - 3)) return false;
  if (isCons(s, s.length - 2)) return false;
  if (!isCons(s, s.length - 1)) return false;
  const last = s[s.length - 1];
  if (last === 'w' || last === 'x' || last === 'y') return false;
  return true;
}

function replace(word: string, suffix: string, replacement: string, minM: number): string | null {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, word.length - suffix.length);
  if (measure(stem) > minM) return stem + replacement;
  return null;
}

function step1a(w: string): string {
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ies')) return w.slice(0, -2);
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function step1b(w: string): string {
  if (w.endsWith('eed')) {
    const stem = w.slice(0, -3);
    return measure(stem) > 0 ? stem + 'ee' : w;
  }
  let stem: string | null = null;
  if (w.endsWith('ed')) {
    const s = w.slice(0, -2);
    if (containsVowel(s)) stem = s;
  } else if (w.endsWith('ing')) {
    const s = w.slice(0, -3);
    if (containsVowel(s)) stem = s;
  }
  if (stem === null) return w;
  if (stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz')) return stem + 'e';
  if (endsDoubleCons(stem)) {
    const last = stem[stem.length - 1];
    if (last !== 'l' && last !== 's' && last !== 'z') return stem.slice(0, -1);
    return stem;
  }
  if (measure(stem) === 1 && endsCvc(stem)) return stem + 'e';
  return stem;
}

function step1c(w: string): string {
  if (w.endsWith('y') && w.length > 1) {
    const stem = w.slice(0, -1);
    if (CONSONANT_Y.test(stem) && stem.split('').some((_, i) => !isCons(stem, i))) {
      return stem + 'i';
    }
  }
  return w;
}

const STEP2_RULES: Array<[string, string]> = [
  ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'],
  ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'],
  ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
  ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
  ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
];

function step2(w: string): string {
  for (const [suf, rep] of STEP2_RULES) {
    const r = replace(w, suf, rep, 0);
    if (r !== null) return r;
  }
  return w;
}

const STEP3_RULES: Array<[string, string]> = [
  ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'],
  ['ical', 'ic'], ['ful', ''], ['ness', ''],
];

function step3(w: string): string {
  for (const [suf, rep] of STEP3_RULES) {
    const r = replace(w, suf, rep, 0);
    if (r !== null) return r;
  }
  return w;
}

const STEP4_SUFFIXES = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment',
  'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
];

function step4(w: string): string {
  for (const suf of STEP4_SUFFIXES) {
    if (w.endsWith(suf)) {
      const stem = w.slice(0, w.length - suf.length);
      if (measure(stem) > 1) {
        if (suf === 'ion') {
          const last = stem[stem.length - 1];
          if (last === 's' || last === 't') return stem;
        } else {
          return stem;
        }
      }
    }
  }
  // ION special-case
  if (w.endsWith('ion')) {
    const stem = w.slice(0, -3);
    if (measure(stem) > 1) {
      const last = stem[stem.length - 1];
      if (last === 's' || last === 't') return stem;
    }
  }
  return w;
}

function step5a(w: string): string {
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1);
    const m = measure(stem);
    if (m > 1) return stem;
    if (m === 1 && !endsCvc(stem)) return stem;
  }
  return w;
}

function step5b(w: string): string {
  if (w.endsWith('ll') && measure(w) > 1) return w.slice(0, -1);
  return w;
}

/** Porter stem a lowercase token. Words ≤ 2 chars are returned unchanged. */
export function porterStem(word: string): string {
  if (word.length <= 2) return word;
  let w = word;
  w = step1a(w);
  w = step1b(w);
  w = step1c(w);
  w = step2(w);
  w = step3(w);
  w = step4(w);
  w = step5a(w);
  w = step5b(w);
  return w;
}

// ---------------------------------------------------------------------------
// Lucene English stopword list (8.x EnglishAnalyzer) + a few BEIR extras
// ---------------------------------------------------------------------------

const LUCENE_STOPWORDS = new Set([
  // Lucene's default English (33)
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
  'if', 'in', 'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or',
  'such', 'that', 'the', 'their', 'then', 'there', 'these', 'they',
  'this', 'to', 'was', 'will', 'with',
  // Common BEIR extras for retrieval queries
  'how', 'what', 'when', 'where', 'who', 'why', 'which', 'whose', 'whom',
  'can', 'do', 'does', 'did', 'has', 'have', 'had', 'been', 'being',
  'am', 'were', 'about', 'after', 'all', 'also', 'any', 'because', 'before',
  'below', 'between', 'both', 'each', 'few', 'from', 'further', 'here',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'them', 'theirs', 'over', 'under', 'than',
  'just', 'only', 'more', 'most', 'other', 'some', 'so', 'too', 'very',
  'one', 'two', 'three', 'first', 'last', 'new', 'old',
]);

// ---------------------------------------------------------------------------
// Lucene-style tokenizer (single-field over title+text concatenation)
// ---------------------------------------------------------------------------

/**
 * Tokenise text into Lucene-style stemmed tokens: lowercase, split on
 * Unicode word boundaries, drop stopwords + length<2, Porter stem.
 */
export function luceneTokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (raw.length < 2) continue;
    if (LUCENE_STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length < 4) continue; // drop short numbers
    tokens.push(porterStem(raw));
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Single-field BM25 (Lucene Okapi defaults: k1=1.2, b=0.75)
// ---------------------------------------------------------------------------

export interface LuceneCorpusStats {
  df: Map<string, number>;
  idf: Map<string, number>;
  avgDocLen: number;
  N: number;
}

export function buildLuceneCorpusStats(tokenisedDocs: string[][]): LuceneCorpusStats {
  const N = tokenisedDocs.length;
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of tokenisedDocs) {
    totalLen += doc.length;
    const seen = new Set<string>();
    for (const t of doc) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [t, dfVal] of df) {
    idf.set(t, Math.log(1 + (N - dfVal + 0.5) / (dfVal + 0.5)));
  }
  return { df, idf, avgDocLen: N > 0 ? totalLen / N : 0, N };
}

/**
 * Lucene-style Okapi BM25: k1=1.2 (vs hybrid-retrieval's 1.5), b=0.75.
 */
export function luceneBM25(
  queryTokens: string[],
  docTokens: string[],
  stats: LuceneCorpusStats,
  k1 = 1.2,
  b = 0.75,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const docLen = docTokens.length;
  const norm = docLen / (stats.avgDocLen || 1);
  let score = 0;
  for (const qt of queryTokens) {
    const f = tf.get(qt);
    if (!f) continue;
    const idf = stats.idf.get(qt) ?? 0;
    if (idf === 0) continue;
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * norm)));
  }
  return score;
}
