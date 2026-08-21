/**
 * Static, non-blocking risk scanner for pre-existing .claude/settings.json
 * content that `ruflo init`/`ruflo init --upgrade` carry forward unexamined.
 *
 * `mergeSettingsForUpgrade()` and `writeSettings()` both read a target
 * project's *existing* settings.json off disk and spread its `hooks` /
 * `permissions.allow` entries into the merged output verbatim (see
 * executor.ts:352-353 and :901-912) — the same trust shape as the publicly
 * disclosed CVE-2025-59536 class (a settings.json hook payload achieving
 * command execution with no review step). Ruflo's own hook dispatch is a
 * closed set of internal handlers (hook-handler.cjs), so this isn't
 * remotely exploitable through Ruflo itself — but a malicious fork, PR, or
 * compromised dependency that plants a bad settings.json before a user
 * runs `ruflo init`/`--upgrade` in that directory would have its payload
 * silently preserved and reported as a normal "merged"/"updated" result,
 * with zero visibility.
 *
 * This scanner is advisory-only: it never mutates its input and never
 * blocks a merge/write. Callers decide what to do with the findings
 * (surfaced as a CLI warning today).
 *
 * KNOWN LIMITATION (found by an independent adversarial review the same
 * night this was written — see docs/dream-cycle/dream-gist-2026-08-16.md
 * §5): this is a best-effort, static, blocklist-style heuristic, NOT a
 * security boundary. It catches copy-pasted proof-of-concept payload
 * shapes; it does not and cannot catch every obfuscation a motivated
 * adversary could construct (string-built commands, uncommon interpreters,
 * novel exfil channels, etc). Treat findings as "worth a second look,"
 * never as a guarantee of safety.
 */

export interface SettingsRiskFinding {
  location: string;
  snippet: string;
  reason: string;
}

const DANGEROUS_COMMAND_WORDS = [
  'rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'chmod', 'chown',
  'kill', 'killall', 'pkill', 'reboot', 'shutdown', 'poweroff', 'halt',
  'sudo', 'eval',
];

// Words that make a *hook command string* look risky when combined with a
// downloader (curl/wget) or a decode step (base64) anywhere in the same
// string — deliberately co-occurrence-based, not strict adjacency/piping,
// since `curl … -o f && sh f` and `curl … | tee x | bash` both reach the
// same outcome as the textbook `curl … | bash` and a strict pipe-adjacency
// regex misses both (found by adversarial review).
const SHELL_EXEC_WORDS = ['bash', 'sh', 'zsh', 'python', 'python3', 'perl', 'ruby', 'eval'];
const DOWNLOADER_WORDS = ['curl', 'wget'];

const STANDALONE_RISK_PATTERNS: RegExp[] = [
  /\bInvoke-Expression\b/i,
  /\biex\s*\(/i,
  /powershell(\.exe)?\s+.*-e(nc(odedcommand)?)?\s+\S/i,
  /\/dev\/tcp\//i,
  /\bnc\s+-e\b/i,
  /base64\s+(-d|--decode)\b/i,
];

// Words a Bash allow-rule should never blanket-preapprove without a
// specific argument scope, even though they aren't "dangerous" on their
// own the way `rm`/`chmod` are — pre-approving them removes the human
// review step for exactly the commands download-and-execute attacks use.
const RISKY_PREAPPROVE_WORDS = [...DANGEROUS_COMMAND_WORDS, ...SHELL_EXEC_WORDS, ...DOWNLOADER_WORDS];

function wordBoundaryMatches(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

/** Reasons a single hook `command` string looks risky (empty = clean). */
export function scanCommandStringForRisk(command: string): string[] {
  const reasons: string[] = [];

  for (const pattern of STANDALONE_RISK_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push('matches a known-dangerous execution pattern (encoded/remote command execution)');
      break;
    }
  }

  const hasDownloader = DOWNLOADER_WORDS.some((w) => wordBoundaryMatches(command, w));
  const hasShellExec = SHELL_EXEC_WORDS.some((w) => wordBoundaryMatches(command, w));
  if (hasDownloader && hasShellExec) {
    reasons.push('combines a downloader (curl/wget) with a shell/interpreter invocation in the same command');
  }

  for (const word of DANGEROUS_COMMAND_WORDS) {
    if (wordBoundaryMatches(command, word)) {
      reasons.push(`invokes dangerous command "${word}"`);
    }
  }
  return reasons;
}

/** Reasons a single `permissions.allow` rule string looks risky (empty = clean). */
export function scanAllowRuleForRisk(rule: string): string[] {
  const trimmed = rule.trim();
  const reasons: string[] = [];
  if (/^Bash\(\s*\*\s*(:\s*\*\s*)?\)$/i.test(trimmed)) {
    reasons.push('grants unrestricted Bash execution (wildcard allow rule)');
  }
  for (const word of RISKY_PREAPPROVE_WORDS) {
    if (new RegExp(`^Bash\\(\\s*${word}\\s*(:| |\\))`, 'i').test(trimmed)) {
      reasons.push(`pre-allows "${word}" with no per-call confirmation`);
    }
  }
  return reasons;
}

/**
 * Strips ANSI/control characters from untrusted text before it's ever
 * embedded in a CLI warning string. Without this, a malicious hook command
 * could use escape sequences to spoof or corrupt the terminal output of
 * the very warning meant to flag it (found during this candidate's own
 * security review — not part of the CVE-2025-59536 class itself, but the
 * same "untrusted settings.json content reaches the user's terminal"
 * shape, so it gets the same treatment here rather than being left open).
 */
function sanitizeForDisplay(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function buildSnippet(text: string): string {
  const clean = sanitizeForDisplay(text);
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
}

/**
 * Scans a settings.json-shaped object's `hooks` and `permissions.allow`
 * for content matching known-dangerous patterns.
 */
export function scanSettingsForRisk(settings: Record<string, unknown>): SettingsRiskFinding[] {
  const findings: SettingsRiskFinding[] = [];

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (hooks && typeof hooks === 'object') {
    for (const [eventName, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, groupIdx) => {
        const hookList = (group as { hooks?: Array<{ command?: unknown }> })?.hooks;
        if (!Array.isArray(hookList)) return;
        hookList.forEach((h, hookIdx) => {
          if (typeof h?.command !== 'string') return;
          for (const reason of scanCommandStringForRisk(h.command)) {
            findings.push({
              location: `hooks.${eventName}[${groupIdx}].hooks[${hookIdx}]`,
              snippet: buildSnippet(h.command),
              reason,
            });
          }
        });
      });
    }
  }

  const allow = (settings.permissions as { allow?: unknown } | undefined)?.allow;
  if (Array.isArray(allow)) {
    allow.forEach((rule, idx) => {
      if (typeof rule !== 'string') return;
      for (const reason of scanAllowRuleForRisk(rule)) {
        findings.push({
          location: `permissions.allow[${idx}]`,
          snippet: buildSnippet(rule),
          reason,
        });
      }
    });
  }

  return findings;
}

/** Formats findings as short, human-readable CLI warning lines. */
export function formatRiskFindingsAsWarnings(findings: SettingsRiskFinding[]): string[] {
  return findings.map((f) => `${f.location}: ${f.reason} — "${f.snippet}"`);
}
