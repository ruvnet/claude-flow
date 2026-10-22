import type { Member } from './members'

/** At most this many members are drawn by name in the diagram; the rest are a count. */
const NAMED = 6

const clip = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

/**
 * The topology as a few lines of box-drawing text, the leader starred. Drawn from the members the pane knows,
 * with the topology ruflo wrote: a name ruflo uses that is not drawn here (`adaptive`, `hierarchical-mesh`) is said, not guessed at.
 */
export function topologyLines(topology: string, members: readonly Member[], width: number): string[] {
  const leader = members.find(member => member.isLeader)
  const others = members.filter(member => member !== leader)
  const named = others.slice(0, NAMED).map(member => member.label)
  const more = others.length - named.length
  const tail = more > 0 ? [`+${more} more`] : []
  const lead = leader !== undefined ? `★ ${leader.label}` : '★ (no leader on disk)'
  const w = Math.max(12, width)

  if (members.length === 0) {
    return [clip(`${topology}: no members yet`, w)]
  }

  switch (topology) {
    case 'hierarchical':
    case 'hierarchical-mesh': {
      const rows = [...named, ...tail]

      return [
        clip(lead, w),
        ...rows.map((name, index) => clip(`${index === rows.length - 1 ? '└─' : '├─'} ${name}`, w)),
        ...(topology === 'hierarchical-mesh' && rows.length > 1 ? [clip('  (workers also linked peer to peer)', w)] : []),
      ]
    }
    case 'mesh': {
      const all = members.slice(0, NAMED).map(member => (member.isLeader ? `★${member.label}` : member.label))
      const links = (members.length * (members.length - 1)) / 2

      return [clip(all.join(' ⇄ '), w), clip(`all-to-all: ${members.length} members, ${links} links${more > 0 ? `, ${more} not named` : ''}`, w)]
    }
    case 'ring': {
      const all = members.slice(0, NAMED).map(member => (member.isLeader ? `★${member.label}` : member.label))

      return [clip(`${all.join(' → ')}${members.length > NAMED ? ' → …' : ''} ↺`, w)]
    }
    case 'star':
      return [clip(`${lead} hub`, w), clip(`  spokes: ${[...named, ...tail].join(', ')}`, w)]
    default:
      return [clip(`${topology}: not drawn by the pane (${members.length} members)`, w), clip(lead, w)]
  }
}
