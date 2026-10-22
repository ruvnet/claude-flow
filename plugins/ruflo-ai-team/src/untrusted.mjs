import { randomBytes } from 'node:crypto';

export function fenced(value, provenance = 'tenant team memory') {
  const nonce = randomBytes(12).toString('hex');
  return {
    provenance,
    trust: 'untrusted-data-not-instructions',
    boundary: nonce,
    data: `BEGIN_UNTRUSTED_${nonce}\n${JSON.stringify(value)}\nEND_UNTRUSTED_${nonce}`,
  };
}

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior) instructions/i,
  /system prompt/i,
  /developer message/i,
  /reveal (?:your |the )?(?:secret|token|password|credential)/i,
  /call (?:this |the )?tool without (?:asking|approval)/i,
];

export function scanStoredText(text) {
  const matches = INJECTION_PATTERNS.filter((pattern) => pattern.test(String(text))).map((pattern) => pattern.source);
  return { safe: matches.length === 0, status: matches.length ? 'blocked_prompt_injection' : 'accepted', matches };
}
