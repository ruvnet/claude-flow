import { stripVTControlCharacters } from 'node:util';

/** Best-effort masking for public previews, not a guarantee that logs are shareable. */
export function sanitize(value: unknown, limit = 2400): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  text = stripVTControlCharacters(text).replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu,
    character => character === '\n' || character === '\t' ? character : '');
  text = text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[REDACTED PRIVATE KEY]')
    .replace(/(?<![\w-])(["']?[\w-]{0,128}(?:api[_-]?key|password|passwd|secret|access[_-]?key|token)[\w-]{0,128}["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
      '$1[REDACTED]')
    .replace(/\b(?:sk-(?:proj-|ant-)?[\w-]{12,}|(?:ghp|gho|github_pat)_[\w]{12,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED KEY]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED JWT]')
    .replace(/(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[REDACTED]@');
  return text.length > limit ? `${text.slice(0, limit)} ... [truncated]` : text;
}

export function publicText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap(block => {
    if (block && ['text', 'Text', 'input_text', 'output_text'].includes(block.type)
      && typeof block.text === 'string') return [block.text];
    return [];
  }).join('\n');
}
