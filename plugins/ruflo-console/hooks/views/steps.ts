/**
 * "Start here": a short, ordered card at the top of a page whose job has a real order (a swarm needs ruflo set up, then a swarm,
 * then agents). Each step says what it does, shows whether the disk already has it (✔), marks the next one to do (▶) and carries
 * the button that does it: a one-click start or run (each asks first, with the exact command on the confirm row), a field to
 * type in, or the page where it happens. Where the disk cannot say whether a step is done (a score, a read), the steps are a
 * numbered menu in order, each one a click. The card is collapsible, and gone once every step the disk can check is done.
 */
import type { RenderElement } from 'claude-code'

import type { Snapshot } from '../data/snapshot'
import type { StartId } from '../starts'
import type { ViewId } from '../state'
import { clip, row, section, text, THEME, type Ctx } from './common'

type Go = { start: StartId } | { run: string } | { focus: string } | { view: ViewId } | { claim: true }
type Step = { label: string; why: string; go: Go; /** Whether the disk already has it; absent when it cannot say. */ done?: (snapshot: Snapshot) => boolean }

/** The pages with an order, and their steps. */
export const STEPS: Partial<Record<ViewId, { title: string; steps: readonly Step[] }>> = {
  overview: {
    title: 'Set ruflo up here',
    steps: [
      { label: 'Initialise ruflo in this project', why: 'creates .claude-flow and the mods', go: { start: 'init' }, done: s => s.isRufloProject },
      { label: 'Start the daemon', why: 'background workers: map, audit, optimize, consolidate', go: { start: 'daemon' }, done: s => s.daemon?.running === true },
      { label: 'Start a swarm', why: 'hierarchical, up to 8 agents', go: { start: 'swarm' }, done: s => s.swarm !== null },
    ],
  },
  swarm: {
    title: 'Get a swarm going',
    steps: [
      { label: 'Initialise ruflo in this project', why: 'creates .claude-flow and the mods', go: { start: 'init' }, done: s => s.isRufloProject },
      { label: 'Start a swarm', why: 'hierarchical, specialized, up to 8 agents', go: { start: 'swarm' }, done: s => s.swarm !== null },
      { label: 'Spawn a coder', why: 'writes the code', go: { start: 'spawn-coder' }, done: s => s.agents.some(agent => agent.type === 'coder') },
      { label: 'Spawn a tester', why: 'checks it', go: { start: 'spawn-tester' }, done: s => s.agents.some(agent => agent.type === 'tester') },
      { label: 'Spawn a reviewer', why: 'reviews it', go: { start: 'spawn-reviewer' }, done: s => s.agents.some(agent => agent.type === 'reviewer') },
      { label: 'Watch them work', why: 'who is busy, and when', go: { view: 'timeline' } },
    ],
  },
  hive: {
    title: 'Start a hive-mind',
    steps: [
      { label: 'Initialise ruflo in this project', why: 'creates .claude-flow and the mods', go: { start: 'init' }, done: s => s.isRufloProject },
      { label: 'Start a hive-mind', why: 'a queen and raft consensus', go: { start: 'hive' }, done: s => s.hive !== null },
      { label: 'Spawn three workers', why: 'the voters', go: { start: 'hive-workers' }, done: s => s.hiveAgents.length > 0 || (s.hive?.workers.length ?? 0) > 0 },
      { label: 'Propose a decision', why: 'the workers vote on it', go: { focus: 'hive-propose' }, done: s => (s.hive?.pending.length ?? 0) + (s.hive?.history.length ?? 0) > 0 },
      { label: 'Cast votes', why: 'every vote and ask, in one place', go: { view: 'approvals' }, done: s => (s.hive?.history.length ?? 0) > 0 },
    ],
  },
  claims: {
    title: 'Put work on the board',
    steps: [
      { label: 'Create a task', why: 'one line says what must be done', go: { focus: 'start-field-task' }, done: s => s.tasks.length > 0 },
      { label: 'Claim it', why: 'one owner per task, with a time limit', go: { claim: true }, done: s => s.claims.length > 0 },
    ],
  },
  learning: {
    title: 'Teach ruflo this repo',
    steps: [
      { label: 'Start the daemon', why: 'its workers do the learning', go: { start: 'daemon' }, done: s => s.daemon?.running === true },
      { label: 'Pretrain on this repo', why: 'seeds the patterns the router uses', go: { start: 'pretrain' }, done: s => (s.neural?.patterns ?? 0) > 0 || (s.sona?.patterns ?? 0) > 0 },
      { label: 'Open the Learning Lab', why: 'train, predict, search and store patterns', go: { view: 'neural' } },
    ],
  },
  federation: {
    title: 'Join the federation',
    steps: [
      { label: 'Join the federation', why: 'registers your own key (it asks first)', go: { start: 'federation-join' }, done: s => s.hasNostrKey === true },
      { label: 'Read the public announcements', why: 'pub:announce, signed by the swarm', go: { start: 'channel-read' } },
      { label: 'Open the x.ruv.io board', why: 'registry, roster, work claims, AgentBBS', go: { view: 'xruv' } },
    ],
  },
  metaharness: {
    title: 'Check your harness',
    steps: [
      { label: 'Score the harness', why: 'five readiness axes and the cost per run', go: { run: 'mh-score' } },
      { label: 'Scan the MCP surface', why: 'static findings, by severity', go: { run: 'mh-mcp-scan' } },
      { label: 'See the audit trend', why: 'the newest audit against the one before', go: { run: 'mh-trend' } },
    ],
  },
  memory: {
    title: 'Look at your memory',
    steps: [
      { label: 'See what is stored', why: 'entries, storage, oldest and newest', go: { run: 'mem-stats' } },
      { label: 'Check AgentDB health', why: 'which controllers are on', go: { run: 'mem-health' } },
      { label: 'Browse and search below', why: 'view, store and delete entries', go: { view: 'memory' } },
    ],
  },
  plugins: {
    title: 'Get the ruflo plugins',
    steps: [
      { label: 'Add the ruflo marketplace', why: 'so Claude Code can install its plugins', go: { start: 'marketplace' }, done: s => s.plugins.markets?.some(market => market.name === 'ruflo') === true },
      { label: 'Install a ruflo plugin', why: 'pick one below, or in the Plugin Catalog', go: { view: 'market' }, done: s => (s.plugins.installed ?? []).some(plugin => plugin.marketplace === 'ruflo') },
    ],
  },
}

/** The "Start here" card for the page in front, or nothing: no steps for this page, every checkable step done, or no read yet. */
export function stepsRows(ctx: Ctx): RenderElement[] {
  const plan = STEPS[ctx.state.view]
  const snapshot = ctx.state.snapshot

  if (plan === undefined || snapshot === null || ctx.state.palette.isOpen || ctx.state.isHelp) return []

  // A JOIN receipt completes this card only; unknown current key status must still ask before a read can create a key.
  const done = plan.steps.map(step => step.done?.(snapshot) === true ||
    ('start' in step.go && step.go.start === 'federation-join' && snapshot.hasNostrKey === null && ctx.state.nostrKeyVerifiedAtMs !== null))
  const checkable = plan.steps.filter(step => step.done !== undefined).length

  // Every step the disk can check is done (and there is at least one): the card has done its job.
  if (checkable > 0 && plan.steps.every((step, i) => step.done === undefined || done[i] === true)) return []

  const next = done.findIndex((isDone, i) => !isDone && (plan.steps[i] as Step).done !== undefined)
  const first = next >= 0 ? next : plan.steps.findIndex(step => step.done === undefined)
  const count = done.filter(Boolean).length

  const rows = plan.steps.map((step, i) => {
    const isNext = i === first
    const mark = done[i] === true ? '✔' : isNext ? '▶' : '○'
    const press = () => {
      if ('start' in step.go) ctx.act.start(step.go.start)
      else if ('run' in step.go) void ctx.act.run(step.go.run)
      else if ('focus' in step.go) ctx.act.focus(step.go.focus)
      else if ('view' in step.go) ctx.act.view(step.go.view)
      else ctx.act.claim()
    }

    return row(
      ctx,
      [
        text(ctx, ` ${mark} ${i + 1}. ${step.label}`, { bold: isNext, ...(done[i] === true ? { color: THEME.ok } : isNext ? { color: THEME.head } : { dimColor: true }) }),
        text(ctx, `  ${clip(step.why, Math.max(8, ctx.columns - step.label.length - 24))}`, { dimColor: true }),
        ...(done[i] === true ? [] : [ctx.kit.Button({ key: `step-${ctx.state.view}-${i}`, label: isNext ? ' ▸ do this ' : ' ▸ ', ...(isNext ? { variant: 'primary' as const } : { plain: true as const }), onPress: press })]),
      ],
      `step-row-${i}`,
    )
  })

  return [ctx.kit.Box({ key: 'steps', flexDirection: 'column', children: section(ctx, 'steps', `Start here: ${plan.title}`, checkable > 0 ? `${count} of ${checkable} done` : `${plan.steps.length} steps, in order`, rows) })]
}
