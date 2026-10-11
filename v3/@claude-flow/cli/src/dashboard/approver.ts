/** Local approval for write+ commands. Default: interactive y/N on a TTY; with no TTY the answer is always "deny". */
import { createInterface } from 'node:readline';

export interface ApprovalRequest {
  cid: string; cmd: string; summary: string; level: string; args: Record<string, unknown>; by: string;
  /** Dashboard the command came from and the fingerprint of the pinned server key (shown in the prompt header). */
  baseUrl?: string; serverFingerprint?: string;
  /** True when any text argument exceeds LONG_TEXT: the approver must show ALL of it before accepting. */
  long?: boolean;
  /** When set, the person must type exactly this (a guard plugin's name) before the command runs. */
  typed?: string;
}
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

export const LONG_TEXT = 500;
export const PAGE_LINES = 20;
const WRAP = 100;

/** Printable ASCII/Unicode only: strips ESC and other control characters so a hostile arg cannot rewrite the prompt. */
/** Control, bidi, zero-width and format characters become spaces: a hostile string cannot reorder or hide what the person reads. */
const FORMAT = '\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF';
export const printable = (s: string, n = 300): string => s.replace(new RegExp(`[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029${FORMAT}]`, 'g'), ' ').slice(0, n);
/** Like printable but lossless in length and visible: newlines/tabs get glyphs, other controls become '?'. Never masks content. */
export const visible = (s: string): string => s.replace(/\n/g, '↵').replace(/\t/g, '→').replace(new RegExp(`[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029${FORMAT}]`, 'g'), '?');

export const denyAll: Approver = async () => false;

/** True if any string argument is longer than LONG_TEXT. */
export const hasLongText = (args: Record<string, unknown>): boolean => Object.values(args).some(v => typeof v === 'string' && v.length > LONG_TEXT);

/** The complete, untruncated prompt body as lines (header + every argument in full, wrapped). */
export function renderApproval(req: ApprovalRequest): string[] {
  const lines = ['', '[ruflo dashboard] Remote command requires approval',
    `  dashboard : ${printable(req.baseUrl ?? 'unknown', 200)}`, `  server key: ${printable(req.serverFingerprint ?? 'unknown', 64)}`,
    `  from      : ${printable(req.by, 80)}`, `  command   : ${printable(req.cmd, 40)} (${printable(req.summary, 120)})`, `  level     : ${printable(req.level, 12)}`, '  arguments :'];
  for (const [k, v] of Object.entries(req.args)) {
    const text = visible(typeof v === 'string' ? v : JSON.stringify(v));
    lines.push(`    ${printable(k, 40)} (${text.length} chars):`);
    for (let i = 0; i < Math.max(text.length, 1); i += WRAP) lines.push(`      | ${text.slice(i, i + WRAP)}`);
  }
  return lines;
}

export function ttyApprover(input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin, output: NodeJS.WritableStream = process.stderr, timeoutMs = 120_000): Approver {
  return async req => {
    if (!input.isTTY) return false;
    const long = req.long ?? hasLongText(req.args);
    const rl = createInterface({ input, output });
    const ask = (q: string) => new Promise<string | null>(resolve => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      rl.question(q, a => { clearTimeout(t); resolve(a); });
    });
    try {
      const lines = renderApproval(req);
      for (let i = 0; i < lines.length; i += PAGE_LINES) {
        output.write(lines.slice(i, i + PAGE_LINES).join('\n') + '\n');
        if (i + PAGE_LINES < lines.length) { const a = await ask('-- more (Enter to continue, q to deny) -- '); if (a === null || /^q/i.test(a.trim())) return false; }
      }
      if (req.typed) {
        output.write(`  This changes a guard. Type its name (${printable(req.typed, 64)}) to confirm.\n`);
        return (await ask('Name: '))?.trim() === req.typed;
      }
      if (long) {
        output.write(`  NOTE: this command carries a text argument longer than ${LONG_TEXT} characters; it was shown in full above.\n`);
        return (await ask("Type 'yes' to approve the full text: "))?.trim() === 'yes';
      }
      return /^y(es)?$/i.test((await ask('Run it? [y/N] ') ?? '').trim());
    } finally { rl.close(); }
  };
}
