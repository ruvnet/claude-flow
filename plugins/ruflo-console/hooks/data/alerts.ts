/**
 * Health alerts and the approvals queue, derived from the state. Pure: each alert names what it saw and the exact
 * command (or palette entry) that addresses it; each approval names what a person decides and how. Nothing here
 * guesses: an agent is "stalled" only when ruflo marks it busy and the console has seen nothing of it for a while.
 */
import { getBootChecks } from '../boot-checks'
import type { State } from '../state'
import type { ClaimRecord } from './parse'
import { RUFLO_MARKET } from './snapshot'

export type Alert = { id: string; level: 'bad' | 'warn' | 'info'; text: string; fix: string; paletteId?: string }

export type ApprovalAction = { label: string; paletteId: string }
export type Approval = { id: string; kind: 'proposal' | 'mod-trust' | 'policy-deny' | 'budget' | 'stealable'; text: string; detail: string; actions: ApprovalAction[] }

export const STALL_MS = 10 * 60_000
const DAY = 86_400_000

const ownerOf = (claim: ClaimRecord) => claim.claimant.agentType ?? claim.claimant.name ?? claim.claimant.id

/** The last time the console saw anything of each agent: an event about it, or its first sight. */
function lastSeen(state: State, loadedAtMs: number): Map<string, number> {
  const seen = new Map<string, number>()

  for (const agent of state.snapshot?.agents ?? []) seen.set(agent.id, Math.max(loadedAtMs, agent.createdAtMs ?? 0))
  for (const event of state.events) if (event.agentId !== undefined) seen.set(event.agentId, Math.max(seen.get(event.agentId) ?? 0, event.atMs))

  return seen
}

export function alertsOf(state: State, nowMs: number, loadedAtMs: number): Alert[] {
  const snap = state.snapshot
  const out: Alert[] = []

  // The self-check shows on the boot screen, which the plain look and a BBS look with the boot off never draw: a failed area is also an
  // alert, so it is seen in every look, and before any project is read.
  const failed = (getBootChecks() ?? []).filter(check => !check.ok)

  if (failed.length > 0) {
    out.push({ id: 'self-check', level: 'bad', text: `self-check: ${failed.map(check => check.area).join(', ')} failed — ${failed[0]?.problems[0] ?? ''}`.slice(0, 160), fix: 'npx vitest run plugins/ruflo-console/tests/self-check.spec.ts' })
  }

  if (snap === null) return out

  const seen = lastSeen(state, loadedAtMs)

  for (const agent of snap.agents) {
    const since = nowMs - (seen.get(agent.id) ?? nowMs)

    if (/busy/i.test(agent.status) && since >= STALL_MS) {
      out.push({ id: `stalled-${agent.id}`, level: 'warn', text: `${agent.name ?? agent.type} busy with no change for ${Math.round(since / 60_000)}m`, fix: `npx ruflo agent logs --id ${agent.id}`, paletteId: 'agent-logs' })
    }
  }

  for (const claim of snap.claims) {
    if (claim.expiresAtMs !== undefined && claim.expiresAtMs < nowMs) {
      out.push({ id: `expired-${claim.issueId}`, level: 'bad', text: `claim ${claim.issueId} expired (held by ${ownerOf(claim)})`, fix: 'release it (palette: release)', paletteId: 'claim-release' })
    } else if (claim.status === 'active' && claim.claimedAtMs !== undefined && nowMs - claim.claimedAtMs > DAY) {
      out.push({ id: `old-${claim.issueId}`, level: 'info', text: `claim ${claim.issueId} active for ${Math.floor((nowMs - claim.claimedAtMs) / DAY)}d`, fix: 'hand off or release it if the work stopped' })
    }
  }

  const budget = state.ruflo.snapshot?.budget

  if (budget !== undefined && budget.level !== 'OK') {
    out.push({ id: 'budget', level: budget.level === 'INFO' ? 'info' : budget.level === 'WARNING' ? 'warn' : 'bad', text: `budget ${budget.level}: $${(budget.usd ?? state.usage?.costUsd ?? 0).toFixed(2)} of $${budget.limit.toFixed(2)}`, fix: 'see Cost (9); raise costBudgetUsd in /config ruflo-mods' })
  }

  if (snap.plugins.missingFromClone.length > 0) {
    out.push({ id: 'marketplace', level: 'bad', text: `marketplace clone stale: no ${snap.plugins.missingFromClone.join(', ')}`, fix: `/plugin marketplace update ${RUFLO_MARKET}` })
  }

  if (snap.daemon !== null && !snap.daemon.running) out.push({ id: 'daemon', level: 'info', text: 'daemon stopped (per daemon-state.json)', fix: 'npx ruflo daemon start' })
  if (state.ruflo.snapshot === null && snap.isRufloProject) out.push({ id: 'mods', level: 'info', text: 'ruflo-mods not seated: no in-process routing or budget ladder', fix: 'npx ruflo mods install' })

  for (const mod of state.mods.filter(entry => !entry.isLoaded).slice(-3)) {
    out.push({ id: `refused-${mod.provenance}`, level: 'warn', text: `mod ${mod.name} refused`, fix: `allow ${mod.provenance} in ruflo-mods modTrustAllow, if you trust it` })
  }

  return out
}

/** Decisions waiting for a person, each with the palette entries that act on it in place. */
export function approvalsOf(state: State): Approval[] {
  const snap = state.snapshot
  const out: Approval[] = []

  for (const proposal of snap?.hive?.pending ?? []) {
    out.push({
      id: `proposal-${proposal.id}`,
      kind: 'proposal',
      text: `hive-mind proposal: ${proposal.type} (${proposal.strategy})`,
      detail: `${proposal.status} · for ${proposal.votesFor} · against ${proposal.votesAgainst} · ${proposal.id}`,
      actions: [
        { label: 'vote yes', paletteId: `vote-yes-${proposal.id}` },
        { label: 'vote no', paletteId: `vote-no-${proposal.id}` },
      ],
    })
  }

  for (const claim of (snap?.claims ?? []).filter(entry => entry.isStealable)) {
    out.push({ id: `steal-${claim.issueId}`, kind: 'stealable', text: `claim ${claim.issueId} offered for stealing`, detail: `held by ${ownerOf(claim)}; pick an agent (a) and steal`, actions: [{ label: 'steal for picked agent', paletteId: 'claim-steal' }] })
  }

  for (const mod of state.mods.filter(entry => !entry.isLoaded)) {
    out.push({ id: `mod-${mod.provenance}`, kind: 'mod-trust', text: `mod ${mod.name} refused by a trust gate`, detail: `${mod.reason ?? ''} — to allow it, add ${mod.provenance} to modTrustAllow (/config ruflo-mods)`, actions: [] })
  }

  for (const deny of state.denied.slice(-5)) {
    out.push({ id: `deny-${deny.atMs}`, kind: 'policy-deny', text: `${deny.tool} denied by a permission verdict`, detail: `${deny.reason} — a deny is never loosened from here; change the policy if it is wrong`, actions: [] })
  }

  const budget = state.ruflo.snapshot?.budget

  if (budget !== undefined && (budget.level === 'WARNING' || budget.level === 'CRITICAL' || budget.level === 'HARD_STOP')) {
    out.push({ id: 'budget', kind: 'budget', text: `budget ${budget.level}`, detail: `$${(budget.usd ?? 0).toFixed(2)} of $${budget.limit.toFixed(2)}`, actions: [{ label: 'open Cost', paletteId: 'view-cost' }] })
  }

  return out
}


/** The approvals a person can act on: rows with at least one action. The rest (a refused mod, a permission deny) are notices that stay on the page but are not "waiting" (#3920). */
export function waitingApprovalsOf(state: State): Approval[] {
  return approvalsOf(state).filter(item => item.actions.length > 0)
}
