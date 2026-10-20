/**
 * Policy for what the PostToolUse Bash hook may keep (#4056).
 *
 * `hooks post-command` used to store every command in full as
 * `commands/cmd-<ts>`: 27k rows / 285 MB on one project, full command text
 * that can carry tokens, and no way to switch it off. This module answers two
 * questions for that writer:
 *
 *   1. May a command be recorded at all?  (`commandRecordingDisabled`)
 *   2. What form of it may be stored?     (`redactCommandForStorage`)
 *
 * Every pattern below is bounded, and the input is capped before any pattern
 * runs, so a hostile command cannot stall the hook (the same lesson as the
 * settings-risk scanner, #4053).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Longest command text kept per row. */
export const MAX_RECORDED_COMMAND_CHARS = 2000;

/** Only this much of a command is ever scanned; the stored text is shorter still. */
const MAX_SCANNED_CHARS = 8000;

const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

const isOff = (v: string | undefined): boolean => v !== undefined && OFF_VALUES.has(v.trim().toLowerCase());

function configDisablesRecording(cwd: string): boolean {
  for (const file of [
    path.resolve(cwd, 'claude-flow.config.json'),
    path.resolve(cwd, '.claude-flow', 'config.json'),
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { hooks?: { recordCommands?: unknown } };
      if (raw?.hooks?.recordCommands === false) return true;
    } catch {
      /* malformed config: keep the default (recording on) rather than guess */
    }
  }
  return false;
}

/**
 * True when command recording is switched off. Any one of these turns it off:
 *   - `CLAUDE_FLOW_HOOKS_RECORD_COMMANDS` = 0 | false | off | no
 *   - `CLAUDE_FLOW_HOOKS_ENABLED`         = 0 | false | off | no
 *   - `hooks.recordCommands: false` in `claude-flow.config.json` or `.claude-flow/config.json`
 */
export function commandRecordingDisabled(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): boolean {
  if (isOff(env.CLAUDE_FLOW_HOOKS_RECORD_COMMANDS)) return true;
  if (isOff(env.CLAUDE_FLOW_HOOKS_ENABLED)) return true;
  return configDisablesRecording(cwd);
}

const QUOTED_OR_BARE = `"[^"]{0,512}"|'[^']{0,512}'|[^\\s"']{1,512}`;

// Order matters little; each rule only ever shortens the text.
const RULES: Array<[RegExp, string]> = [
  // Authorization: Bearer xyz   /   authorization=Basic xyz
  [/(authorization["']?\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"']{1,512}/gi, '$1[redacted]'],
  // --password x / --token=x / --api-key "x" / -token x
  [new RegExp(`(--?(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret)(?:=|\\s+))(?:${QUOTED_OR_BARE})`, 'gi'), '$1[redacted]'],
  // NPM_TOKEN=x  AWS_SECRET_ACCESS_KEY=x  DB_PASSWORD=x
  [new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]{0,63}(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?))=(?:${QUOTED_OR_BARE})`, 'gi'), '$1=[redacted]'],
  // user:password@host in a URL
  [/(:\/\/[^\s:@/]{1,128}:)[^\s@/]{1,256}(@)/g, '$1[redacted]$2'],
  // well-known token shapes
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, '[redacted]'],
];

/**
 * The form of a command that may be written to the store: secrets of the
 * common shapes replaced with `[redacted]`, and the text capped at
 * `MAX_RECORDED_COMMAND_CHARS`. This is best effort, not a guarantee; the off
 * switch is the guarantee.
 */
export function redactCommandForStorage(command: string): string {
  let text = String(command);
  if (text.length > MAX_SCANNED_CHARS) {
    // Cut at a token boundary so a half-token at the cut is not left behind.
    const cut = text.slice(0, MAX_SCANNED_CHARS);
    const lastSpace = cut.search(/\s\S*$/);
    text = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
    text += ' ';
  }
  for (const [re, replacement] of RULES) text = text.replace(re, replacement);
  if (text.length > MAX_RECORDED_COMMAND_CHARS) {
    text = `${text.slice(0, MAX_RECORDED_COMMAND_CHARS)} …[truncated]`;
  }
  return text.trimEnd();
}
