// @ts-check
/**
 * The ONE audited builder for every shell string sent to a ruOS desktop
 * (ADR-405 §Command construction).
 *
 * Invariants, enforced here and asserted by tests/command-builder.test.mjs:
 *   1. Every command is a single line (no \n, \r or NUL) of at most
 *      MAX_COMMAND_BYTES — the fleet `desktop_exec` limit.
 *   2. The only variable regions are (a) a run id that matched RUN_ID_RE,
 *      (b) integers produced by this module, (c) base64 text inside single
 *      quotes, (d) a model name from a fixed enum. Task text never appears.
 *   3. Prompt text travels as base64 and is decoded on the desktop into a
 *      file that the runner reads on stdin — it is never parsed by a shell.
 *   4. Output comes back base64-encoded, so arbitrary bytes survive the JSON
 *      tool result and are decoded locally.
 * Both transports (fleet MCP desktop_exec and SSH :2222) send these exact
 * strings, so one builder covers both.
 */
import { createHash } from 'node:crypto';
import { RuosError } from './types.mjs';
import { assertRunId, assertModel, assertBudget, assertInt, assertPrompt } from './validate.mjs';

export const MAX_COMMAND_BYTES = 4000;
/**
 * Largest output slice one poll returns (raw bytes, before base64).
 * desktop_exec head-caps stdout at ~4 KiB INCLUDING its `▶ run:` echo of the
 * ~430-byte poll command (measured live 2026-10-01): 2048 raw bytes → 2732
 * base64 chars leaves headroom. parsePoll also tolerates truncation.
 */
export const POLL_SLICE_BYTES = 2048;

const B64_RE = /^[A-Za-z0-9+/=]*$/;

/** per-command marker nonce: 64 random bits as 16 hex chars */
export const NONCE_RE = /^[0-9a-f]{16}$/;

/** @param {string} n */
function nonce(n) {
  if (typeof n !== 'string' || !NONCE_RE.test(n)) throw new RuosError('invalid-input', 'nonce must be 16 hex chars');
  return n;
}

/**
 * Emit the marker line `RUOS<nonce>_<NAME>[:<fmt>]` WITHOUT that token ever
 * appearing contiguously in the command text. desktop_exec echoes the
 * command it ran (`▶ run: …`), so a literal marker in the command would show
 * up in the output even when the branch that prints it never ran. Here the
 * format string holds `RUOS%s_NAME` and the nonce is a separate argument.
 * @param {string} n
 * @param {string} name
 * @param {string=} fmt   extra printf format after `NAME:` (e.g. '%s:%s')
 * @param {string=} args  printf arguments for fmt
 */
function say(n, name, fmt, args) {
  return fmt === undefined
    ? `printf 'RUOS%s_${name}\\n' '${nonce(n)}'`
    : `printf 'RUOS%s_${name}:${fmt}' '${nonce(n)}' ${args}`;
}

/**
 * @param {string} n
 * @param {string} name
 * @param {string=} rest  regex for the part after `NAME:`
 */
function marker(n, name, rest) {
  return new RegExp(`^RUOS${nonce(n)}_${name}${rest === undefined ? '' : `:${rest}`}$`, 'm');
}

/** @param {string} runId */
function runDir(runId) {
  return `"$HOME/.ruflo-ruos/runs/${assertRunId(runId)}"`;
}

/**
 * @param {string} cmd
 * @returns {string}
 */
function seal(cmd) {
  if (/[\n\r\0]/.test(cmd)) throw new RuosError('invalid-input', 'command must be one line');
  if (Buffer.byteLength(cmd, 'utf8') > MAX_COMMAND_BYTES) {
    throw new RuosError('invalid-input', `command exceeds ${MAX_COMMAND_BYTES} bytes`);
  }
  return cmd;
}

/**
 * @param {string} runId
 * @param {string} n  marker nonce
 */
export function buildPrepare(runId, n) {
  const d = runDir(runId);
  return seal(`umask 077 && mkdir -p ${d} && : > ${d}/prompt.b64 && ${say(n, 'PREPARED')}`);
}

/**
 * Split the prompt into append commands that each fit the size limit.
 * @param {string} runId
 * @param {string} prompt
 * @returns {{ commands: string[], sha256: string, bytes: number }}
 */
export function buildPromptChunks(runId, prompt) {
  const text = assertPrompt(prompt);
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const d = runDir(runId);
  const head = `printf '%s' '`;
  const tail = `' >> ${d}/prompt.b64`;
  const room = MAX_COMMAND_BYTES - Buffer.byteLength(head + tail, 'utf8');
  const step = room - (room % 4); // keep chunk boundaries on base64 quanta
  /** @type {string[]} */
  const commands = [];
  for (let i = 0; i < b64.length; i += step) {
    const chunk = b64.slice(i, i + step);
    if (!B64_RE.test(chunk)) throw new RuosError('invalid-input', 'internal: non-base64 chunk');
    commands.push(seal(head + chunk + tail));
  }
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return { commands, sha256, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Decode the prompt, print its sha256 (checked against the local hash before
 * the run is trusted), and start the runner detached in its own session so a
 * later stop can signal the whole process group.
 * @param {import('./types.mjs').RunSpec} spec
 * @param {string} n  marker nonce
 */
export function buildLaunch(spec, n) {
  const d = runDir(spec.runId);
  if (spec.runner !== 'claude') throw new RuosError('invalid-input', 'runner must be claude');
  const model = assertModel(spec.model);
  const budget = assertBudget(spec.maxBudgetUsd);
  const flags = ['--output-format text'];
  if (model) flags.push(`--model ${model}`);
  if (budget !== undefined) flags.push(`--max-budget-usd ${budget.toFixed(2)}`);
  // The inner script is a constant apart from the enum/number flags above.
  const inner = `claude -p ${flags.join(' ')} < prompt.txt > out.log 2>&1; echo $? > exit.code.tmp && mv exit.code.tmp exit.code`;
  // Setup runs as separate `|| exit` statements, never an `&&` chain ending
  // in `&` (that would background the whole chain in a subshell). In a
  // non-interactive shell the background job is not a group leader, so
  // setsid execs in place and $! is the new session's pgid.
  return seal(
    `umask 077 ; command -v claude >/dev/null || { ${say(n, 'NO_RUNNER')} ; exit 127; }` +
      ` ; cd ${d} || exit 3` +
      ` ; base64 -d prompt.b64 > prompt.txt || exit 5` +
      ` ; rm -f exit.code ; : > out.log` +
      ` ; ${say(n, 'SHA', '%s\\n', '"$(sha256sum prompt.txt | cut -c1-64)"')}` +
      ` ; nohup setsid sh -c '${inner}' > /dev/null 2>&1 < /dev/null & p=$! ; echo "$p" > pid ; ${say(n, 'PID', '%s\\n', '"$p"')}`,
  );
}

/**
 * Report exit state and size, then return one base64 slice of the log from
 * byte `offset`. Output line: `RUOS<nonce>_POLL:<exit|->:<size>:<alive 0|1>:<base64>`.
 * `alive` lets the adapter detect a runner killed before it wrote exit.code.
 * @param {string} runId
 * @param {number} offset
 * @param {string} n  marker nonce
 * @param {number=} maxBytes
 */
export function buildPoll(runId, offset, n, maxBytes = POLL_SLICE_BYTES) {
  const d = runDir(runId);
  const off = assertInt(offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const max = assertInt(maxBytes, 1, 1024 * 1024, 'maxBytes');
  return seal(
    `cd ${d} 2>/dev/null || { ${say(n, 'NORUN')} ; exit 3; }` +
      ` ; e=$(cat exit.code 2>/dev/null || echo -) ; s=$(stat -c %s out.log 2>/dev/null || echo 0)` +
      ` ; p=$(cat pid 2>/dev/null) ; a=0 ; case "$p" in ''|*[!0-9]*) ;; *) kill -0 "$p" 2>/dev/null && a=1 ;; esac` +
      ` ; ${say(n, 'POLL', '%s:%s:%s:', '"$e" "$s" "$a"')} ; tail -c +${off + 1} out.log 2>/dev/null | head -c ${max} | base64 -w0 ; echo`,
  );
}

/**
 * Stop the run's process group. The pid file is re-validated as digits on
 * the desktop before it is used.
 * @param {string} runId
 * @param {string} n  marker nonce
 */
export function buildStop(runId, n) {
  const d = runDir(runId);
  return seal(
    `p=$(cat ${d}/pid 2>/dev/null)` +
      ` ; case "$p" in ''|*[!0-9]*) ${say(n, 'NOPID')} ; exit 4;; esac` +
      ` ; if { kill -TERM -- -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; } ; then ${say(n, 'STOPPED')} ; else ${say(n, 'NOT_RUNNING')} ; fi`,
  );
}

/** a repo path on the desktop, relative to $HOME; no traversal, no quoting tricks */
export const REPO_PATH_RE = /^(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}$/;

/**
 * Read-only deploy hand-off probe (ADR-405 §Deploy hand-off): what would be
 * shipped from a repo on the desktop. It never pushes or deploys — ruOS's
 * exec filter refuses `git push` / `fly deploy` literals by design, and the
 * deploy decision stays with the user.
 * @param {string} repoPath  path relative to $HOME
 * @param {string} n  marker nonce
 */
export function buildRepoSummary(repoPath, n) {
  if (typeof repoPath !== 'string' || !REPO_PATH_RE.test(repoPath)) {
    throw new RuosError('invalid-input', 'repo path must be relative to $HOME without ..');
  }
  const d = `"$HOME/${repoPath}"`;
  return seal(
    `cd ${d} 2>/dev/null || { ${say(n, 'NOREPO')} ; exit 3; }` +
      ` ; ${say(n, 'BRANCH', '%s\\n', '"$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"')}` +
      ` ; ${say(n, 'HEAD', '%s\\n', '"$(git rev-parse HEAD 2>/dev/null)"')}` +
      ` ; ${say(n, 'DIRTY', '%s\\n', '"$(git status --porcelain 2>/dev/null | wc -l)"')}` +
      ` ; ${say(n, 'AHEAD', '%s\\n', '"$(git rev-list --count @{u}..HEAD 2>/dev/null || echo unknown)"')}`,
  );
}

/**
 * @param {string} stdout
 * @param {string} n  marker nonce used to build the command
 * @returns {{ found: boolean, branch?: string, head?: string, dirty?: number, ahead?: string }}
 */
export function parseRepoSummary(stdout, n) {
  if (marker(n, 'NOREPO').test(stdout)) return { found: false };
  const get = (/** @type {string} */ k) => marker(n, k, '(.*)').exec(stdout)?.[1]?.trim() ?? '';
  return { found: true, branch: get('BRANCH'), head: get('HEAD'), dirty: Number(get('DIRTY')) || 0, ahead: get('AHEAD') };
}

/**
 * Probe: is the runner present on this desktop?
 * @param {string} n  marker nonce
 */
export function buildProbe(n) {
  return seal(`if command -v claude >/dev/null ; then ${say(n, 'RUNNER_OK')} ; else ${say(n, 'RUNNER_MISSING')} ; fi`);
}

/**
 * @typedef {object} PollResult
 * @property {number|null} exitCode  null while running
 * @property {number} size           total log size on the desktop
 * @property {boolean} alive         runner process group still exists
 * @property {Buffer} chunk
 */

/*
 * Parsers match `RUOS<nonce>_NAME` as WHOLE LINES, with the nonce used to
 * build that command. desktop_exec echoes the command it ran (found live,
 * 2026-10-01); the nonce-split printf in say() means the echo can never
 * contain a matching line, and a stale line from another command (different
 * nonce) can't either.
 */

/**
 * @param {string} stdout
 * @param {string} n  marker nonce used to build the command
 * @returns {PollResult|'norun'}
 */
export function parsePoll(stdout, n) {
  if (marker(n, 'NORUN').test(stdout)) return 'norun';
  const m = marker(n, 'POLL', '(-|\\d+):(\\d+):([01]):([A-Za-z0-9+/=]*)').exec(stdout);
  if (!m) throw new RuosError('remote-error', 'unparseable poll output');
  // If the transport truncated the result mid-quantum, decode only whole
  // quanta: the offset then advances by exactly what was received and the
  // next poll resumes from there, so no byte is skipped.
  const whole = m[4].slice(0, m[4].length - (m[4].length % 4));
  return {
    exitCode: m[1] === '-' ? null : Number(m[1]),
    size: Number(m[2]),
    alive: m[3] === '1',
    chunk: Buffer.from(whole, 'base64'),
  };
}

/**
 * @param {string} stdout
 * @param {string} n  marker nonce used to build the command
 * @returns {{ sha256: string|null, pid: number|null, noRunner: boolean }}
 */
export function parseLaunch(stdout, n) {
  const sha = marker(n, 'SHA', '([0-9a-f]{64})').exec(stdout);
  const pid = marker(n, 'PID', '(\\d+)').exec(stdout);
  return {
    sha256: sha ? sha[1] : null,
    pid: pid ? Number(pid[1]) : null,
    noRunner: marker(n, 'NO_RUNNER').test(stdout),
  };
}

/**
 * @param {string} stdout
 * @param {string} n
 */
export const parseStopped = (stdout, n) => marker(n, 'STOPPED').test(stdout);

/** @param {string} cmd */
export const commandSha256 = (cmd) => createHash('sha256').update(cmd, 'utf8').digest('hex');

/**
 * The command handed to the ruOS jobs API (ADR-105), which owns detaching,
 * output capture, exit status and cancel. The prompt is staged first with
 * buildPrepare + buildPromptChunks (same base64 path); this only decodes it
 * and runs the runner in the foreground of the job.
 * @param {import('./types.mjs').RunSpec} spec
 */
export function buildJobCommand(spec) {
  const d = runDir(spec.runId);
  if (spec.runner !== 'claude') throw new RuosError('invalid-input', 'runner must be claude');
  const model = assertModel(spec.model);
  const budget = assertBudget(spec.maxBudgetUsd);
  const flags = ['--output-format text'];
  if (model) flags.push(`--model ${model}`);
  if (budget !== undefined) flags.push(`--max-budget-usd ${budget.toFixed(2)}`);
  return seal(`umask 077 ; cd ${d} || exit 3 ; base64 -d prompt.b64 > prompt.txt || exit 5 ; exec claude -p ${flags.join(' ')} < prompt.txt`);
}
