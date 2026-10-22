/**
 * What the autopilot checks before it acts (ADR-466 §5): task classification, the Project Anatole gate, the kill flag, the spend
 * windows, the permission preflight and what counts as an effect. Pure apart from `killSeen` and `preflightAll`, which are given the
 * reader and the (optional) permission check. Nothing here widens anything: a task it cannot place is `cls: null` and is parked.
 */
import { missionCostArgv, parseMissionCost } from './mission-cost'
import { DENY_PATTERNS, KILL_FILE, TOOL_CLASSES, type ToolClass } from './ap-envelope'
import { ESCAPES, HIDDEN, INVISIBLE } from './parse'
import { ANATOLE_STALE_MS } from './anatole'
import type { EffectFact, Preflight, TaskFact } from './ap-loop'
import type { AnatoleFacts } from './anatole'
import type { Envelope, Spend } from './ap-envelope'
import type { ReaderFs } from './files'

const DENIES = DENY_PATTERNS

/** From least to most privileged: a task that matches several is classified as the most privileged. */
const CLASS_WORDS: readonly [ToolClass, RegExp][] = [
  ['read', /\b(read|review|analy[sz]e|research|audit|inspect|summari[sz]e|investigate|survey|list|explain|document)/i],
  ['test', /\b(test|vitest|jest|lint|typecheck|benchmark|verify|validate|build)\b/i],
  ['edit', /\b(implement|write|fix|refactor|add|edit|update|create|rename|patch|optimi[sz]e|migrate|remove)\b/i],
  ['git-local', /\b(commit|stage|stash)\b/i],
  ['git-branch', /\b(branch|worktree|merge|rebase|cherry-pick)\b/i],
  ['spawn', /\b(spawn|swarm|sub-?agent|delegate)\b/i],
  ['mcp', /\b(mcp|ruflo\s+tool|agentdb|memory_)/i],
  ['network', /\b(fetch|download|curl|http|api\s+call|web\s+search|clone)\b/i],
]

const PATH = /(?:^|[\s"'`(=:])(\/(?:[A-Za-z0-9._@-]+\/)*[A-Za-z0-9._@-]+)/g
/** A path that is not absolute (home, a variable, a parent): it is never inside the envelope's folders, so a task naming one is parked. */
const RELATIVE_PATH = /(?:^|[\s"'`(=:])(~\/\S*|~(?=\s|$)|\$\{?HOME\}?(?:\/\S*)?|\.\.\/\S*|\.\.(?=\s|$))/g
/** Verbs whose effect the class words do not capture (they leave the machine, change the system or run arbitrary code): a task using one is parked instead of guessed. */
const UNPLACED = /\b(push(es|ed|ing)?|install(s|ed|ing)?|uninstall|upload|send|post|e-?mail|ssh|scp|rsync|sudo|execute|exec|kill|chmod|chown|shred|wipe|systemctl|crontab)\b/i

/** Text as the patterns must see it: compatibility-normalised, escape sequences gone, zero-width and format characters REMOVED (so "pub<ZWSP>lish" reads as "publish"), other control characters spaced. */
export const seen = (value: string): string => value.normalize('NFKC').replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ' ')
/** URLs the text names: host, then up to three path segments (enough to read a GitHub `owner/name`). */
const URLS = /\bhttps?:\/\/([A-Za-z0-9.-]{1,253})(?::\d+)?((?:\/[A-Za-z0-9._~%@-]*){0,3})/gi

const repoOf = (urlPath: string): string | null => {
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(urlPath)

  return match === null ? null : `${match[1]}/${(match[2] as string).replace(/\.git$/, '')}`
}

/** A task's text as the facts the loop needs. The class is the most privileged one the words suggest; none is `null`, never a default. */
export function classifyTask(id: string, title: string, requirement = ''): TaskFact {
  const text = seen(`${title}\n${requirement}`)
  const hardDeny = DENIES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
  const hits = CLASS_WORDS.filter(([, pattern]) => pattern.test(text)).map(([cls]) => cls)
  const cls = hits.length === 0 || UNPLACED.test(text) ? null : (hits.at(-1) as ToolClass)
  const paths = [...new Set([...[...text.matchAll(PATH)].map(m => m[1] as string), ...[...text.matchAll(RELATIVE_PATH)].map(m => m[1] as string)])].slice(0, 12)
  const urls = [...text.matchAll(URLS)]
  const hosts = [...new Set(urls.map(match => (match[1] as string).toLowerCase()))].slice(0, 8)
  const repos = [...new Set(urls.flatMap(match => ((match[1] as string).toLowerCase() === 'github.com' ? [repoOf(match[2] as string)] : []).filter((name): name is string => name !== null)))].slice(0, 8)

  return { id, title: seen(title).slice(0, 160), cls, hardDeny, path: paths[0] ?? null, paths, ...(hosts.length > 0 && { hosts }), ...(repos.length > 0 && { repos }) }
}

/**
 * Anatole's state for the gate: `on` only when a status file that is FRESH (written within ANATOLE_STALE_MS) says a mode other than off and
 * does not say it failed open; `off` when it says off; else `absent`. Any process can write those files, so a stale or degraded one
 * proves nothing. Without `nowMs` freshness is not checked (the pure callers that hold no clock).
 */
export function anatoleFact(facts: AnatoleFacts | undefined, nowMs?: number): 'on' | 'off' | 'absent' {
  const mode = facts?.status?.mode ?? facts?.modeOverride ?? null

  if (facts === undefined || !facts.present || mode === null) return 'absent'
  if (mode === 'off') return 'off'
  if (nowMs === undefined) return 'on'

  const status = facts.status

  if (status === null || (status.degraded !== false && status.degraded !== undefined) || status.updatedMs === null || nowMs - status.updatedMs > ANATOLE_STALE_MS) return 'absent'

  return 'on'
}

/** True when the kill flag exists. A stat that throws means no flag (a missing file is how stat says it). Checked on every tick. */
export async function killSeen(fs: Pick<ReaderFs, 'stat'>, cwd: string): Promise<boolean> {
  try {
    return (await fs.stat(`${cwd.replace(/\/+$/, '')}/${KILL_FILE}`)) !== undefined
  } catch {
    return false
  }
}

export type SpendWindows = { hour: readonly string[] | null; day: readonly string[] | null; total: readonly string[] | null }

/** The three ledger commands (last hour, last 24 hours, since the start) for the project; null where a path check refuses. */
export function spendArgvs(root: string, startMs: number, nowMs: number, project: string): SpendWindows {
  return { hour: missionCostArgv(root, nowMs - 3_600_000, null, project), day: missionCostArgv(root, nowMs - 86_400_000, null, project), total: missionCostArgv(root, startMs, null, project) }
}

/** The three ledger outputs as spend. Any window that did not parse, or whose total is unknown (unpriced rows), makes the whole reading null: unknown is not zero. */
export function spendOf(out: { hour: string; day: string; total: string }): Spend | null {
  const [hour, day, total] = [parseMissionCost(out.hour), parseMissionCost(out.day), parseMissionCost(out.total)]

  if (hour?.usd == null || day?.usd == null || total?.usd == null) return null

  return { hourUsd: hour.usd, dayUsd: day.usd, totalUsd: total.usd }
}

/** The engine's own permission check, when the host offers one (`$.tool.check`). Absent in this console today: said, never faked. */
export type ToolCheck = (tool: string, input?: unknown) => Promise<{ decision?: string } | string | undefined>

/** The tool a class is checked through. A class whose representative tool the person's settings would block is parked, never tried. */
export const PREFLIGHT_TOOL: Record<ToolClass, string> = { read: 'Read', test: 'Bash', edit: 'Edit', 'git-local': 'Bash', 'git-branch': 'Bash', spawn: 'Agent', mcp: 'mcp__plugin_ruflo-core_ruflo__task_update', network: 'WebFetch' }

/**
 * The input the engine is asked about for a class. The engine decides on a call's INPUT (a path rule, a command prefix rule), so a probe with
 * no input is answered `ask` for everything (found live: with acceptEdits and the test command allowed, an empty-input Read, Edit and
 * Bash all said ask, and every task was parked). The input is a call the envelope itself allows: a file in its first folder, its first
 * verify command, a host from its network list. A class the envelope has nothing representative for is asked with no input, as before.
 */
export function preflightInput(cls: ToolClass, env: Envelope | null): unknown {
  const root = env?.paths[0]

  if (env === null || root === undefined) return {}
  if (cls === 'read') return { file_path: `${root}/preflight-probe` }
  if (cls === 'edit') return { file_path: `${root}/preflight-probe`, old_string: 'a', new_string: 'b' }
  if (cls === 'test') return env.verify[0] === undefined ? {} : { command: env.verify[0].join(' ') }
  if (cls === 'git-local') return { command: 'git status' }
  if (cls === 'git-branch') return { command: 'git switch -c preflight-probe' }
  if (cls === 'network') return env.network[0] === undefined ? {} : { url: `https://${env.network[0]}/` }

  return {}
}

export async function preflightAll(check: ToolCheck | undefined, env: Envelope | null = null): Promise<Record<string, Preflight>> {
  const out: Record<string, Preflight> = {}

  for (const cls of TOOL_CLASSES) {
    if (check === undefined) {
      out[cls] = 'unwired'
      continue
    }

    try {
      const answer = await check(PREFLIGHT_TOOL[cls], preflightInput(cls, env))
      const decision = typeof answer === 'string' ? answer : answer?.decision

      out[cls] = decision === 'allow' ? 'allow' : decision === 'deny' ? 'deny' : decision === 'ask' ? 'ask' : 'unwired'
    } catch {
      out[cls] = 'unwired'
    }
  }

  return out
}

/** A step's effect. The ruflo task store's status is a CLAIM (its swarm execution is a known no-op): `done` needs the person's own verify commands to pass; with none the step is `done-unverified` and says so everywhere. */
export function effectOf(storeStatus: string | undefined, verify: { ran: number; failed: number }): EffectFact {
  if (storeStatus === 'failed' || storeStatus === 'cancelled') return 'failed'
  if (storeStatus !== 'completed') return 'unknown'
  if (verify.failed > 0) return 'failed'

  return verify.ran === 0 ? 'done-unverified' : 'done'
}

/**
 * The engine's verdict on one verify command, asked as the Bash call it is. The console runs these itself (the host's process API, not the
 * engine's tool path), so the person's own permission rules must be consulted here or the envelope would launder them: `blocked` when
 * they would deny or ask, `unwired` when there is no check to ask (the person approved the exact argv on the Start card).
 */
export async function verifyPermission(check: ToolCheck | undefined, argv: readonly string[]): Promise<'allow' | 'blocked' | 'unwired'> {
  if (check === undefined) return 'unwired'

  try {
    const answer = await check('Bash', { command: argv.join(' ') })
    const decision = typeof answer === 'string' ? answer : answer?.decision

    return decision === 'allow' ? 'allow' : 'blocked'
  } catch {
    return 'unwired'
  }
}
