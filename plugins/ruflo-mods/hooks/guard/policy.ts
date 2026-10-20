import type { Verdict } from './verdict'

/**
 * Ruflo policy for Claude Code's own tool calls, read from the projection the
 * CLI writes beside the policy state (`.claude-flow/policy/claude-code.json`,
 * see cli/src/mods/policy-projection.ts) and never from state.json itself:
 * that file holds the receipt ledger (tens of MB) and is past the 4 MiB a hooks
 * module may read.
 *
 * Only rules whose `actions` name a `claude-code.` pattern explicitly take
 * part; a rule with no actions, or `*`, keeps meaning what it meant before
 * this mod existed (MCP calls only). Matching is engine.ts / evaluator.ts
 * `ruleMatches`, copied (a hooks module cannot import @claude-flow/security);
 * the parity test runs both over the same rules and requests. Only explicit
 * matches count: the engine's default-deny for an unmatched request does not
 * apply here, so turning the mod on never refuses a tool that no rule names.
 */

export const PROJECTION_PATH = '.claude-flow/policy/claude-code.json'
export const ACTION_PREFIX = 'claude-code.'

/** `legacy` is never projected: the CLI deletes the file for it, so a file that says so was hand-written (ADR-450 T10). */
export type PolicyMode = 'observe' | 'enforce'
type Effect = 'allow' | 'deny' | 'require_approval'

export type ProjectedRule = {
  readonly id: string
  readonly effect: Effect
  readonly actions: readonly string[]
  readonly enabled?: boolean
  readonly priority?: number
  readonly resources?: readonly string[]
  readonly principals?: readonly string[]
  readonly identityTypes?: readonly string[]
  readonly roles?: readonly string[]
  readonly environments?: readonly string[]
  readonly constraints?: Readonly<Record<string, unknown>>
}

export type Projection = { readonly mode: PolicyMode; readonly rules: readonly ProjectedRule[] }

export type ToolRequest = {
  readonly identity: { readonly id: string; readonly type: string; readonly roles?: readonly string[] }
  readonly action: {
    readonly type: string
    readonly resource?: string
    readonly environment?: string
    readonly network: boolean
    readonly destructive: boolean
    readonly namespace?: string
    readonly costUsd?: number
    readonly tokens?: number
    readonly concurrency?: number
  }
}

const MODES = new Set(['observe', 'enforce'])
const EFFECTS = new Set(['allow', 'deny', 'require_approval'])
const DESTRUCTIVE = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const NETWORK = new Set(['Bash', 'WebFetch', 'WebSearch'])

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
const optStrings = (v: unknown) => v === undefined || isStrings(v)

/** Whether a rule speaks to Claude Code tool calls by name. */
export const targetsClaudeCode = (actions: readonly string[]) =>
  actions.some(a => a.startsWith(ACTION_PREFIX))

/**
 * Validates the projection's text. Throws on anything malformed: the caller
 * fails closed on a projection that exists but cannot be read.
 */
export function parseProjection(text: string): Projection {
  const raw: unknown = JSON.parse(text)
  if (raw === null || typeof raw !== 'object') throw new Error('projection is not an object')
  const { version, mode, rules } = raw as Record<string, unknown>
  if (version !== 1) throw new Error(`unsupported projection version ${String(version)}`)
  if (typeof mode !== 'string' || !MODES.has(mode)) throw new Error('projection mode invalid (only observe or enforce are ever written)')
  if (!Array.isArray(rules)) throw new Error('projection rules invalid')
  const valid = rules.map((r: unknown, i): ProjectedRule => {
    const rule = r as Record<string, unknown> | null
    const ok =
      rule !== null &&
      typeof rule === 'object' &&
      typeof rule.id === 'string' &&
      typeof rule.effect === 'string' &&
      EFFECTS.has(rule.effect) &&
      isStrings(rule.actions) &&
      optStrings(rule.resources) &&
      optStrings(rule.principals) &&
      optStrings(rule.identityTypes) &&
      optStrings(rule.roles) &&
      optStrings(rule.environments) &&
      (rule.priority === undefined || typeof rule.priority === 'number') &&
      (rule.constraints === undefined || (rule.constraints !== null && typeof rule.constraints === 'object'))
    if (!ok) throw new Error(`projection rule ${i} invalid`)
    return rule as unknown as ProjectedRule
  })
  return { mode: mode as PolicyMode, rules: valid.filter(r => targetsClaudeCode(r.actions)) }
}

/** The policy request for a Claude Code tool call. */
export function toolRequest(tool: string, input: unknown): ToolRequest {
  const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const resource =
    typeof args.command === 'string' ? args.command
    : typeof args.file_path === 'string' ? args.file_path
    : typeof args.notebook_path === 'string' ? args.notebook_path
    : typeof args.url === 'string' ? args.url
    : tool
  return {
    identity: { id: 'claude-code', type: 'agent' },
    action: {
      type: `${ACTION_PREFIX}tool.${tool}`,
      resource,
      network: NETWORK.has(tool) || tool.startsWith('mcp__'),
      destructive: DESTRUCTIVE.has(tool),
    },
  }
}

function matches(patterns: readonly string[] | undefined, value: string | undefined): boolean {
  if (!patterns?.length) return true
  if (!value) return false
  return patterns.some(p => p === '*' || p === value || (p.endsWith('*') && value.startsWith(p.slice(0, -1))))
}

// evaluator.ts constraintsPass for a request that carries no evidence: a
// signed-evidence or provenance requirement can never be met here.
function constraintsPass(req: ToolRequest, c: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!c) return true
  const a = req.action
  if (c.maxCostUsd !== undefined && (a.costUsd === undefined || a.costUsd > (c.maxCostUsd as number))) return false
  if (c.maxTokens !== undefined && (a.tokens === undefined || a.tokens > (c.maxTokens as number))) return false
  if (c.maxConcurrency !== undefined && (a.concurrency === undefined || a.concurrency > (c.maxConcurrency as number))) return false
  if (c.network === false && a.network === true) return false
  if (c.destructive === false && a.destructive === true) return false
  if (isStrings(c.allowedNamespaces) && c.allowedNamespaces.length && !matches(c.allowedNamespaces, a.namespace)) return false
  if (c.requireSignedEvidence) return false
  if (isStrings(c.requiredProvenance) && c.requiredProvenance.length) return false
  return true
}

/** evaluator.ts `ruleMatches`, over a projected rule. */
export function ruleMatches(rule: ProjectedRule, req: ToolRequest): boolean {
  if (rule.enabled === false) return false
  const { identity, action } = req
  return (
    matches(rule.actions, action.type) &&
    matches(rule.resources, action.resource) &&
    matches(rule.principals, identity.id) &&
    (!rule.identityTypes?.length || rule.identityTypes.includes(identity.type)) &&
    (!rule.roles?.length || rule.roles.some(role => identity.roles?.includes(role))) &&
    matches(rule.environments, action.environment) &&
    constraintsPass(req, rule.constraints)
  )
}

export type PolicyOpinion = { readonly verdict?: Verdict; readonly wouldBe?: string }

/**
 * Ruflo's opinion on a tool call: in `enforce`, a matched deny rule denies
 * and a matched approval rule asks; an allow rule says nothing (this mod
 * never loosens). In `observe`, `wouldBe` names what enforce would do.
 */
export function policyOpinion(projection: Projection, tool: string, input: unknown): PolicyOpinion {
  if (projection.rules.length === 0) return {}
  const req = toolRequest(tool, input)
  const matched = projection.rules
    .filter(rule => ruleMatches(rule, req))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
  const deny = matched.find(r => r.effect === 'deny')
  const approval = matched.find(r => r.effect === 'require_approval')
  const verdict: Verdict | undefined = deny
    ? { decision: 'deny', reason: `ruflo policy: denied-by:${deny.id}` }
    : approval
      ? { decision: 'ask', reason: `ruflo policy: approval-required-by:${approval.id}` }
      : undefined
  if (!verdict) return {}
  return projection.mode === 'enforce' ? { verdict } : { wouldBe: verdict.reason }
}
