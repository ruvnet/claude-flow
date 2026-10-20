/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import type { Member } from '../model/members'
import { ACCENT, BAD, GOOD, HEAD, PULSE_COLORS, STATE_COLORS, STATE_GLYPHS, WARN } from './palette'
import { TILE, type PaneModel } from './model'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the buttons do. Each is a closure over the host: the view calls nothing on the engine itself. */
export type PaneActions = {
  hide: () => void
  prev: () => void
  next: () => void
  taskPrev: () => void
  taskNext: () => void
  stop: () => void
  logs: () => void
  pause: () => void
  resume: () => void
  claim: () => void
  offer: () => void
  steal: () => void
  handoff: () => void
  reroute: () => void
  voteYes: () => void
  voteNo: () => void
  confirm: () => void
  cancel: () => void
  fill: () => void
  closeDetail: () => void
}

type Section = { rows: number; node: RenderChildren }

export const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)
const pad = (text: string, width: number): string => (text.length >= width ? text.slice(0, Math.max(0, width)) : text + ' '.repeat(width - text.length))

function rule(kit: Kit, title: string, width: number, right = ''): RenderChildren {
  const { Box, Text } = kit
  const fill = Math.max(1, width - title.length - right.length - 2)

  return (
    <Box>
      <Text bold color={HEAD}>{title}</Text>
      <Text dimColor>{` ${'─'.repeat(fill)} `}</Text>
      <Text>{right}</Text>
    </Box>
  )
}

function tile(kit: Kit, member: Member, width: number, isSelected: boolean): RenderChildren {
  const { Text } = kit
  const glyph = member.isLeader ? '★' : STATE_GLYPHS[member.state]
  const text = pad(`${isSelected ? '▸' : ' '}${glyph} ${clip(member.label, width - 4)}`, width)

  if (member.pulse !== undefined) {
    return <Text inverse bold color={PULSE_COLORS[member.pulse]}>{text}</Text>
  }

  const color = STATE_COLORS[member.state]

  return color === undefined ? <Text dimColor={!isSelected} bold={isSelected}>{text}</Text> : <Text color={color} bold={isSelected}>{text}</Text>
}

/** The agents as a grid of tiles, wrapped to the width; past `maxRows` the rest are a count. */
function tiles(kit: Kit, model: PaneModel, maxRows: number): Section {
  const { Box, Text } = kit
  const perRow = Math.max(1, Math.floor(model.columns / (TILE + 1)))
  const fit = Math.max(1, maxRows) * perRow
  const shown = model.members.length > fit ? model.members.slice(0, fit - 1) : model.members
  const hidden = model.members.length - shown.length
  const rows: Member[][] = []

  for (let i = 0; i < shown.length; i += perRow) {
    rows.push(shown.slice(i, i + perRow))
  }

  return {
    rows: rows.length + (hidden > 0 ? 1 : 0),
    node: (
      <Box flexDirection="column">
        {rows.map(row => (
          <Box columnGap={1}>{row.map(member => tile(kit, member, TILE, member.id === model.selected?.id))}</Box>
        ))}
        {hidden > 0 ? <Text dimColor>{`+${hidden} more agents (select with ◀ ▶)`}</Text> : null}
      </Box>
    ),
  }
}

function legend(kit: Kit, model: PaneModel): RenderChildren {
  const { Box, Text } = kit

  return (
    <Box flexWrap="wrap">
      {model.counts.map(entry => (
        <Text>
          <Text color={STATE_COLORS[entry.state]} dimColor={STATE_COLORS[entry.state] === undefined}>{STATE_GLYPHS[entry.state]}</Text>
          <Text dimColor>{` ${entry.state} ${entry.count}  `}</Text>
        </Text>
      ))}
      <Text color={PULSE_COLORS.read} inverse>{' read '}</Text>
      <Text> </Text>
      <Text color={PULSE_COLORS.write} inverse>{' write '}</Text>
    </Box>
  )
}

/** The selected agent, what it is, and the buttons that act on it: only the ones its kind can take. */
function selection(kit: Kit, model: PaneModel, actions: PaneActions): Section {
  const { Box, Text, Button } = kit
  const member = model.selected

  if (member === null) {
    return { rows: 1, node: <Text dimColor>No agents yet.</Text> }
  }

  const isRuflo = member.source === 'ruflo'
  const task = model.board.selected
  const who = `${member.label} · ${member.word}${member.claims > 0 ? ` · ${member.claims} claim${member.claims === 1 ? '' : 's'}` : ''}${member.calls > 0 ? ` · ${member.calls} calls` : ''}`

  return {
    rows: 2,
    node: (
      <Box flexDirection="column">
        <Box>
          <Button key="prev" dimColor onPress={actions.prev}>◀</Button>
          <Text bold>{` ${clip(who, Math.max(8, model.columns - 8))} `}</Text>
          <Button key="next" dimColor onPress={actions.next}>▶</Button>
        </Box>
        <Box flexWrap="wrap" columnGap={1}>
          {isRuflo ? <Button key="logs" onPress={actions.logs}>logs</Button> : <Button key="logs" onPress={actions.logs}>activity</Button>}
          {isRuflo && task !== null ? <Button key="claim" onPress={actions.claim}>claim task</Button> : null}
          {isRuflo && task !== null ? <Button key="steal" onPress={actions.steal}>steal task</Button> : null}
          {isRuflo && task !== null ? <Button key="handoff" onPress={actions.handoff}>hand off here</Button> : null}
          {isRuflo && member.claims > 0 ? <Button key="pause" onPress={actions.pause}>pause claim</Button> : null}
          {isRuflo && member.claims > 0 ? <Button key="resume" onPress={actions.resume}>resume claim</Button> : null}
          {isRuflo && member.state !== 'done' ? <Button key="stop" onPress={actions.stop}>stop…</Button> : null}
        </Box>
      </Box>
    ),
  }
}

function prompts(kit: Kit, model: PaneModel, actions: PaneActions): Section | null {
  const { Box, Text, Button } = kit

  if (model.confirm !== null) {
    return {
      rows: 1,
      node: (
        <Box columnGap={1}>
          <Text color={WARN} bold>{clip(`${model.confirm.label}?`, Math.max(8, model.columns - 22))}</Text>
          <Button key="confirm" onPress={actions.confirm}>confirm</Button>
          <Button key="cancel" dimColor onPress={actions.cancel}>cancel</Button>
        </Box>
      ),
    }
  }

  if (model.isActing) {
    return { rows: 1, node: <Text color={ACCENT}>running…</Text> }
  }

  const outcome = model.outcome

  if (outcome === null) {
    return null
  }

  const mark = !outcome.ok ? '✗' : outcome.verified === 'no' ? '?' : '✓'
  const color = !outcome.ok ? BAD : outcome.verified === 'no' ? WARN : GOOD
  const said = outcome.verified === 'yes' ? 'seen on disk' : outcome.verified === 'no' ? 'exited 0 but the disk does not show it' : outcome.ok ? 'done' : 'failed'

  // What happened leads, so a narrow pane cuts the label, never the verdict.
  return { rows: 1, node: <Text color={color}>{clip(`${mark} ${said}: ${outcome.label}${outcome.detail !== '' ? ` · ${outcome.detail}` : ''}`, model.columns)}</Text> }
}

function board(kit: Kit, model: PaneModel, maxRows: number, actions: PaneActions): Section {
  const { Box, Text, Button } = kit
  const b = model.board
  const right = `pending ${b.pending} · claimed ${b.claimed} · done ${b.done}${b.failed > 0 ? ` · failed ${b.failed}` : ''}`

  if (b.total === 0) {
    return { rows: 2, node: <Box flexDirection="column">{rule(kit, 'Tasks', model.columns, right)}<Text dimColor>No tasks on disk.</Text></Box> }
  }

  const start = Math.max(0, Math.min(b.rows.findIndex(row => row.isSelected) - 1, b.rows.length - maxRows))
  const shown = b.rows.slice(start, start + Math.max(1, maxRows))

  return {
    rows: 2 + shown.length,
    node: (
      <Box flexDirection="column">
        {rule(kit, 'Tasks', model.columns, right)}
        {shown.map(row => (
          <Text bold={row.isSelected} dimColor={!row.isSelected && row.status === 'completed'}>
            {clip(`${row.isSelected ? '▸' : ' '} ${pad(row.status, 12)} ${row.description || row.type} → ${row.owner}`, model.columns)}
          </Text>
        ))}
        <Box columnGap={1}>
          <Button key="task-prev" dimColor onPress={actions.taskPrev}>◀ task</Button>
          <Button key="task-next" dimColor onPress={actions.taskNext}>task ▶</Button>
          <Button key="offer" onPress={actions.offer}>offer for stealing</Button>
          <Button key="reroute" onPress={actions.reroute}>re-route</Button>
        </Box>
      </Box>
    ),
  }
}

function consensus(kit: Kit, model: PaneModel, actions: PaneActions): Section | null {
  const { Box, Text, Button } = kit

  if (model.proposals.length === 0 && model.decisions.length === 0) {
    return null
  }

  const first = model.proposals[0]

  return {
    rows: 1 + Math.min(2, model.proposals.length) + model.decisions.length + (first !== undefined ? 1 : 0),
    node: (
      <Box flexDirection="column">
        {rule(kit, 'Consensus', model.columns, `${model.proposals.length} open`)}
        {model.proposals.slice(0, 2).map(proposal => (
          <Text>{clip(`  ${proposal.type} (${proposal.strategy}) for ${proposal.votesFor} · against ${proposal.votesAgainst}`, model.columns)}</Text>
        ))}
        {model.decisions.map(decision => (
          <Text dimColor>{clip(`  ${decision.result === 'approved' ? '✓' : '✗'} ${decision.type} ${decision.result} ${decision.votesFor}–${decision.votesAgainst}`, model.columns)}</Text>
        ))}
        {first !== undefined ? (
          <Box columnGap={1}>
            <Button key="vote-yes" onPress={actions.voteYes}>vote yes</Button>
            <Button key="vote-no" onPress={actions.voteNo}>vote no</Button>
            <Text dimColor>{clip(`as ${model.selected?.label ?? '—'}`, 24)}</Text>
          </Box>
        ) : null}
      </Box>
    ),
  }
}

function detail(kit: Kit, model: PaneModel, actions: PaneActions, maxRows: number): Section | null {
  const { Box, Text, Button } = kit

  if (model.detail === null) {
    return null
  }

  const lines = model.detail.lines.slice(-Math.max(1, maxRows))

  return {
    rows: 1 + lines.length,
    node: (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color={HEAD}>{clip(model.detail.title, model.columns - 8)}</Text>
          <Button key="close-detail" dimColor onPress={actions.closeDetail}>close</Button>
        </Box>
        {lines.map(line => <Text dimColor wrap="truncate-end">{clip(line, model.columns)}</Text>)}
      </Box>
    ),
  }
}

function header(kit: Kit, model: PaneModel, actions: PaneActions): RenderChildren {
  const { Box, Text, Button } = kit

  return (
    <Box justifyContent="space-between">
      <Text bold wrap="truncate-end">{clip(model.title, Math.max(8, model.columns - 7))}</Text>
      <Button key="hide" dimColor onPress={actions.hide}>hide</Button>
    </Box>
  )
}

function nextRow(kit: Kit, model: PaneModel, actions: PaneActions): Section | null {
  const { Box, Text, Button } = kit

  if (model.next === null) {
    return null
  }

  return {
    rows: 2,
    node: (
      <Box flexDirection="column">
        <Text>
          <Text color={ACCENT} bold>Next </Text>
          <Text>{clip(model.next.text, Math.max(8, model.columns - 5))}</Text>
        </Text>
        <Box columnGap={1}>
          <Text dimColor>{clip(model.next.why, Math.max(8, model.columns - 16))}</Text>
          <Button key="fill" onPress={actions.fill}>put in prompt</Button>
        </Box>
      </Box>
    ),
  }
}

/** The empty pane: no swarm on disk. Says so, and names the one command that starts one. */
function empty(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit
  const next = nextRow(kit, model, actions)

  return (
    <Box flexDirection="column" rowGap={1}>
      {header(kit, model, actions)}
      <Text>No ruflo swarm on disk in this folder.</Text>
      {next?.node ?? null}
      <Text dimColor>{clip(`${model.usage}`, model.columns)}</Text>
    </Box>
  )
}

/** The narrow form: one line per agent and the board as counts, for a pane under 44 columns. */
function narrow(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const budget = Math.max(1, model.rows - 7)
  const shown = model.members.slice(0, budget)
  const b = model.board

  return (
    <Box flexDirection="column">
      {header(kit, model, actions)}
      {shown.map(member => {
        const color = member.pulse !== undefined ? PULSE_COLORS[member.pulse] : STATE_COLORS[member.state]

        return (
          <Text color={color} dimColor={color === undefined} inverse={member.pulse !== undefined} bold={member.id === model.selected?.id}>
            {clip(`${member.id === model.selected?.id ? '▸' : ' '}${member.isLeader ? '★' : STATE_GLYPHS[member.state]} ${member.label} ${member.state}`, model.columns)}
          </Text>
        )
      })}
      {model.members.length > shown.length ? <Text dimColor>{`+${model.members.length - shown.length} more`}</Text> : null}
      <Text>{clip(`tasks ${b.pending} pending · ${b.claimed} claimed · ${b.done} done`, model.columns)}</Text>
      <Text dimColor>{clip(model.route, model.columns)}</Text>
      <Text dimColor>{clip(model.usage, model.columns)}</Text>
      <Box columnGap={1}>
        <Button key="prev" dimColor onPress={actions.prev}>◀</Button>
        <Button key="next" dimColor onPress={actions.next}>▶</Button>
        <Button key="logs" onPress={actions.logs}>{model.selected?.source === 'ruflo' ? 'logs' : 'activity'}</Button>
      </Box>
      {prompts(kit, model, actions)?.node ?? null}
    </Box>
  )
}

/**
 * The swarm pane. Sections are kept in the order that matters most and dropped from the bottom when the body is short:
 * the tiles, what is selected and any confirm prompt always; then the board, consensus, topology, the router and usage.
 */
export function paneView(kit: Kit, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text } = kit

  if (!model.hasSwarm && model.members.length <= 1) {
    return empty(kit, model, actions)
  }

  if (model.isNarrow) {
    return narrow(kit, model, actions)
  }

  let budget = Math.max(6, model.rows) - 1
  const take = (section: Section | null): RenderChildren => {
    if (section === null || section.rows > budget) {
      return null
    }

    budget -= section.rows

    return section.node
  }

  const top = [take(tiles(kit, model, Math.max(1, Math.min(6, Math.floor(model.rows / 4))))), take({ rows: 1, node: legend(kit, model) }), take(selection(kit, model, actions)), take(prompts(kit, model, actions))]
  const shownDetail = take(detail(kit, model, actions, Math.min(12, Math.max(2, budget - 8))))
  const shownBoard = take(board(kit, model, Math.min(8, Math.max(1, budget - 10)), actions))
  const shownConsensus = take(consensus(kit, model, actions))
  const shownRemote = model.remote.length > 0 ? take({ rows: 1 + model.remote.length, node: <Box flexDirection="column">{rule(kit, 'ruOS hosts', model.columns)}{model.remote.map(line => <Text>{clip(line, model.columns)}</Text>)}</Box> }) : null
  const shownTopology = take({ rows: 1 + model.topology.length, node: <Box flexDirection="column">{rule(kit, 'Topology', model.columns)}{model.topology.map(line => <Text>{line}</Text>)}</Box> })
  const shownSignals = take({ rows: 2, node: <Box flexDirection="column"><Text>{clip(model.route, model.columns)}</Text><Text dimColor>{clip(model.usage, model.columns)}</Text></Box> })
  const shownNext = take(nextRow(kit, model, actions))
  const shownMissing = model.missing.length > 0 ? take({ rows: 1, node: <Text dimColor>{clip(`not on disk: ${model.missing.join(', ')}`, model.columns)}</Text> }) : null

  return (
    <Box flexDirection="column">
      {header(kit, model, actions)}
      {top}
      {shownDetail}
      {shownBoard}
      {shownConsensus}
      {shownRemote}
      {shownTopology}
      {shownSignals}
      {shownNext}
      {shownMissing}
    </Box>
  )
}
