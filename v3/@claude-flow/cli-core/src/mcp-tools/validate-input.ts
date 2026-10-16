/**
 * Input Validation for MCP Tools
 *
 * Loads @claude-flow/security validators when available
 * and provides lightweight fallback validation otherwise.
 *
 * Addresses #1425: security validators were implemented but never wired to runtime.
 */

// Patterns for input sanitization (inline — no external dependency required)
const SHELL_META = /[;&|`$(){}[\]<>!#\\]/;
const PATH_TRAVERSAL = /\.\.[/\\]/;
const IDENTIFIER_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_\-.:]{0,127}$/;
const GIT_REF_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_\-.:~^/]{0,255}$/;
const NPM_PACKAGE_RE = /^(@[a-zA-Z0-9_\-]+\/)?[a-zA-Z0-9_\-][a-zA-Z0-9_\-.]{0,213}$/;

export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
}

/**
 * Validate an identifier (agent ID, agent type, namespace, key, etc.)
 * Rejects shell metacharacters and path traversal.
 */
export function validateIdentifier(value: unknown, label: string): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { valid: false, sanitized: '', error: `${label} must be a non-empty string` };
  }
  if (value.length > 128) {
    return { valid: false, sanitized: '', error: `${label} exceeds 128 characters` };
  }
  if (SHELL_META.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains disallowed characters` };
  }
  if (PATH_TRAVERSAL.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains path traversal` };
  }
  if (!IDENTIFIER_RE.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains invalid characters (allowed: alphanumeric, _, -, ., :)` };
  }
  return { valid: true, sanitized: value };
}

/**
 * Validate a git ref (HEAD~1, main..feature, commit hashes, etc.).
 * Allows ~, ^, and / which are standard git revision selectors.
 */
export function validateGitRef(value: unknown, label: string): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { valid: false, sanitized: '', error: `${label} must be a non-empty string` };
  }
  if (value.length > 256) {
    return { valid: false, sanitized: '', error: `${label} exceeds 256 characters` };
  }
  if (SHELL_META.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains disallowed characters` };
  }
  if (!GIT_REF_RE.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains invalid characters (allowed: alphanumeric, _, -, ., :, ~, ^, /)` };
  }
  return { valid: true, sanitized: value };
}

/**
 * Validate an npm package name (allows @scope/name format).
 */
export function validatePackageName(value: unknown, label: string): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { valid: false, sanitized: '', error: `${label} must be a non-empty string` };
  }
  if (value.length > 214) {
    return { valid: false, sanitized: '', error: `${label} exceeds 214 characters` };
  }
  if (SHELL_META.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains disallowed characters` };
  }
  if (!NPM_PACKAGE_RE.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains invalid characters (expected npm package name, e.g. @scope/name)` };
  }
  return { valid: true, sanitized: value };
}

// Path-specific shell-meta check: backslash is a legitimate Windows path
// separator (e.g. `E:\Repos\app\file.ts`) and Claude Code's hook events
// deliver absolute paths in `tool_input.file_path` with backslashes on
// Windows. The general SHELL_META set includes `\` for identifier safety,
// but paths are not shell-expanded — normalizing to forward slashes for
// the check keeps every other shell metacharacter rejected while letting
// absolute Windows paths through (#2352).
const PATH_SHELL_META = /[;&|`$(){}[\]<>!#]/;

/**
 * Validate a file path (prevents traversal and shell injection).
 */
export function validatePath(value: unknown, label: string): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { valid: false, sanitized: '', error: `${label} must be a non-empty string` };
  }
  if (value.length > 4096) {
    return { valid: false, sanitized: '', error: `${label} exceeds 4096 characters` };
  }
  if (PATH_TRAVERSAL.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains path traversal (..)` };
  }
  if (PATH_SHELL_META.test(value)) {
    return { valid: false, sanitized: '', error: `${label} contains shell metacharacters` };
  }
  // Normalize Windows backslashes to forward slashes in the sanitized value
  // so downstream consumers see a single path shape regardless of OS.
  const sanitized = value.replace(/\\/g, '/');
  return { valid: true, sanitized };
}

/**
 * Validate a free-text string (description, value, etc.)
 * Allows most characters but rejects shell metacharacters that could cause injection.
 */
export function validateText(value: unknown, label: string, maxLen = 10_000): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, sanitized: '', error: `${label} must be a string` };
  }
  if (value.length > maxLen) {
    return { valid: false, sanitized: '', error: `${label} exceeds ${maxLen} characters` };
  }
  // Strip null bytes
  const sanitized = value.replace(/\0/g, '');
  return { valid: true, sanitized };
}

/**
 * Names that let an attacker pivot a child process before any user code runs:
 * shared-library injection on Linux/macOS, Node hooks, and command resolution.
 *
 * audit_1776853149979: terminal_create previously merged caller-supplied env
 * straight into execSync's environment for every subsequent command in the
 * session. Setting LD_PRELOAD or NODE_OPTIONS via that path is functionally
 * equivalent to remote code execution, so the env input needs an allowlist
 * shape and a denylist on these specific names.
 *
 * dream-cycle 2026-09-21 (CWE-427, Uncontrolled Search Path Element): the
 * original list covered loader/runtime hijack but not command-resolution
 * hijack via PATH itself, or the equivalent interpreter/VCS search-path
 * vars. This rejects a caller-supplied *override* of these names — the
 * real process's own PATH etc. still flows through untouched for callers
 * who don't set them (see terminal-tools.ts's `{ ...process.env,
 * ...session.env }` merge order).
 *
 * dream-cycle 2026-10-16: 2026-09-21 covered Python/Perl/Ruby/git/shell
 * search-path vars but missed credential/arbitrary-command vars in the
 * same git family (GIT_ASKPASS, GIT_PROXY_COMMAND), interpreter-flag
 * injection vars for Perl/Ruby/Java (PERL5OPT/RUBYOPT/JAVA_TOOL_OPTIONS/
 * _JAVA_OPTIONS/JDK_JAVA_OPTIONS — official-docs-confirmed flag-prepend
 * mechanisms, same shape as the already-listed *LIB search-path vars),
 * two more search-path vars (PYTHONHOME, CLASSPATH), and git's numbered
 * GIT_CONFIG_KEY_n/VALUE_n/COUNT family (arbitrary runtime git config
 * injection — strictly broader than any single fixed name, needs a
 * pattern check below, not a fixed Set entry). Also GIT_CONFIG_NOSYSTEM:
 * lets a caller suppress system-level git config entirely, which can
 * bypass an admin-set git security policy (e.g. protocol/safe.directory
 * restrictions) — note this repo's OWN `guidance/mod-sources.ts` git()
 * helper sets this same var to '1' for a benign, defensive purpose (to
 * sandbox ITS OWN git calls against ambient system config), so the risk
 * here is specifically a *caller of terminal_create* setting it to widen
 * trust, not the variable being inherently dangerous — same category
 * judgment call as the other search-path vars below, not a pure RCE
 * primitive like GIT_ASKPASS/GIT_PROXY_COMMAND. PYTHONSTARTUP is included
 * for defense-in-depth despite weaker fit here: official docs confirm
 * arbitrary code execution, but only in Python's *interactive* REPL mode.
 * `terminal_execute` doesn't request that mode itself, but a caller-
 * supplied command string COULD pass `python3 -i` (confirmed empirically:
 * `-i` triggers PYTHONSTARTUP even off a non-tty stdin) — that caller
 * already has unrestricted arbitrary-command execution via `command`
 * under the same trust boundary that controls `env`, so this adds no new
 * capability; it's kept denylisted as defense-in-depth for a future
 * caller shape, not because it's exploitable today through this path.
 * NOT added (researched, rejected): PYTHONEXECUTABLE (macOS-only,
 * cosmetic sys.argv[0] override, no search-path effect); PSModulePath
 * (single third-party source, no primary vendor confirmation — Grade C,
 * insufficient per this routine's evidence-grading rule); GEM_PATH/
 * GEM_HOME (plausible but not independently verified this session).
 */
const DENYLISTED_ENV_NAMES = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FORCE_FLAT_NAMESPACE',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PYTHONPATH',
  'PERL5LIB',
  'RUBYLIB',
  'GIT_EXTERNAL_DIFF',
  'GIT_SSH_COMMAND',
  'BASH_ENV',
  'IFS',
  // dream-cycle 2026-10-16 additions (see note above):
  'GIT_ASKPASS',
  'GIT_PROXY_COMMAND',
  'GIT_CONFIG_NOSYSTEM',
  'PERL5OPT',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'PYTHONHOME',
  'CLASSPATH',
  'PYTHONSTARTUP',
]);
// git's numbered runtime-config-injection family (GIT_CONFIG_COUNT plus
// GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> for n=0..COUNT-1): lets a caller
// set *arbitrary* git config at runtime (core.sshCommand, core.hooksPath,
// http.*, …), strictly broader than any single fixed name above, so it
// needs a pattern match rather than a Set entry (dream-cycle 2026-10-16).
const GIT_CONFIG_ENV_RE = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export interface EnvValidationResult {
  valid: boolean;
  sanitized: Record<string, string>;
  error?: string;
}

/**
 * Validate a Record<string,string> of environment variables: enforce POSIX
 * names, reject hijack-prone names (LD_PRELOAD, NODE_OPTIONS, …), forbid null
 * bytes in values, and cap value length so a malicious caller can't bloat the
 * stored session past reasonable bounds.
 */
export function validateEnv(value: unknown, label = 'env'): EnvValidationResult {
  if (value === undefined || value === null) {
    return { valid: true, sanitized: {} };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, sanitized: {}, error: `${label} must be an object of string→string` };
  }
  const out: Record<string, string> = {};
  for (const [name, rawVal] of Object.entries(value as Record<string, unknown>)) {
    if (!ENV_NAME_RE.test(name)) {
      return { valid: false, sanitized: {}, error: `${label} key "${name}" is not a valid POSIX env name` };
    }
    // Case-fold the lookup: Windows env vars are case-insensitive at the OS
    // level, so `path`/`Path`/`PATH` are the same variable to a child
    // process even though they're distinct object keys here. Every entry in
    // DENYLISTED_ENV_NAMES is uppercase, so this also catches the existing
    // loader-hijack names, not just the search-path family (adversarial
    // critique, dream-cycle 2026-09-21).
    if (DENYLISTED_ENV_NAMES.has(name.toUpperCase())) {
      return { valid: false, sanitized: {}, error: `${label} key "${name}" is denylisted (loader/runtime hijack)` };
    }
    if (GIT_CONFIG_ENV_RE.test(name.toUpperCase())) {
      return { valid: false, sanitized: {}, error: `${label} key "${name}" is denylisted (arbitrary git config injection)` };
    }
    if (typeof rawVal !== 'string') {
      return { valid: false, sanitized: {}, error: `${label}["${name}"] must be a string` };
    }
    if (rawVal.length > 32_768) {
      return { valid: false, sanitized: {}, error: `${label}["${name}"] exceeds 32768 characters` };
    }
    if (rawVal.includes('\0')) {
      return { valid: false, sanitized: {}, error: `${label}["${name}"] contains a null byte` };
    }
    out[name] = rawVal;
  }
  return { valid: true, sanitized: out };
}

/**
 * Assert validation or throw with a structured error.
 */
export function assertValid(result: ValidationResult): string {
  if (!result.valid) {
    throw new Error(`Validation failed: ${result.error}`);
  }
  return result.sanitized;
}

// Try to load the full @claude-flow/security module for enhanced validation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _securityModule: Record<string, any> | null = null;
let _securityLoaded = false;

async function getSecurityModule(): Promise<Record<string, any> | null> {
  if (_securityLoaded) return _securityModule;
  _securityLoaded = true;
  try {
    // Dynamic import — @claude-flow/security is an optional dependency
    _securityModule = await (Function('return import("@claude-flow/security")')() as Promise<Record<string, any>>);
  } catch {
    // @claude-flow/security is optional — fallback to inline validation above
  }
  return _securityModule;
}

/**
 * Enhanced validation using @claude-flow/security Zod schemas when available.
 * Falls back to inline regex validation otherwise.
 */
export async function validateAgentSpawn(input: Record<string, unknown>): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Always run inline validation
  if (input.agentType) {
    const r = validateIdentifier(input.agentType, 'agentType');
    if (!r.valid) errors.push(r.error!);
  }
  if (input.agentId) {
    const r = validateIdentifier(input.agentId, 'agentId');
    if (!r.valid) errors.push(r.error!);
  }
  if (input.domain) {
    const r = validateIdentifier(input.domain, 'domain');
    if (!r.valid) errors.push(r.error!);
  }

  // Try enhanced Zod validation if available.
  // Fix for #1567: @claude-flow/security's SpawnAgentSchema expects `type` and
  // `id` (not `agentType`/`name`), so the previous call always failed with
  // "type: Required". Also swallow `invalid_enum_value` errors because the
  // schema enumerates only 15 built-in agent types — we support custom types
  // (the inline validator already checked the identifier is safe).
  const sec = await getSecurityModule();
  if (sec?.SpawnAgentSchema) {
    try {
      sec.SpawnAgentSchema.parse({
        type: input.agentType,
        id: input.agentId,
      });
    } catch (zodErr: any) {
      if (zodErr.issues) {
        for (const issue of zodErr.issues) {
          if (issue.code === 'invalid_enum_value') continue;
          errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
