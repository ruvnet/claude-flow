import type { RenderElement } from 'claude-code'

import { launchOf } from '../ask-claude'
import { VIEWS } from '../state'
import { clip, row, section, text, THEME, type Ctx } from './common'
import { openInCatalog } from './links'

/**
 * The Launch section at the foot of a page: the slash commands of the ruflo plugins this section owns, each a button that asks first
 * and then runs in the main Claude UI (mid-turn it only fills the prompt box). Laid out like the menu's cards: a dim `── plugin ──` rule
 * per plugin (with a link to its entry in the Plugin Catalog), then one dotted-leader row per command ending in a primary ▶ run.
 * Folded by default; nothing is drawn when the session lists no command for this section's plugins.
 */
export function launchRows(ctx: Ctx): RenderElement[] {
  const view = ctx.state.view

  if (view === 'terminal' || view === 'agent' || !VIEWS.some(entry => entry.id === view)) return []

  const groups = launchOf(ctx.state, view)

  if (groups.length === 0) return []

  const total = groups.reduce((sum, group) => sum + group.slashes.length, 0)
  // Room for the card's border and padding, the leader and the run button.
  const lead = Math.max(24, Math.min(56, ctx.columns - 20))
  const body = groups.flatMap(group => [
    row(
      ctx,
      [
        ctx.kit.Text({ color: THEME.info, dimColor: true, children: clip(`── ${group.plugin} ${'─'.repeat(Math.max(0, lead - group.plugin.length - 4))}`, lead + 2) }),
        ctx.kit.Button({ key: `launch-cat-${group.plugin}`, label: ' ▸ in the catalog ', plain: true, dimColor: true, onPress: () => openInCatalog(ctx, group.plugin) }),
      ],
      `launch-head-${group.plugin}`,
    ),
    ...group.slashes.map(slash =>
      row(
        ctx,
        [
          ctx.kit.Button({ key: `launch-${slash}`, label: clip(` /${slash} `, lead).padEnd(lead, '.'), plain: true, onPress: () => ctx.act.ask.launch(slash) }),
          ctx.kit.Button({ key: `launch-run-${slash}`, label: ' ▶ run ', variant: 'primary', onPress: () => ctx.act.ask.launch(slash) }),
        ],
        `launch-row-${slash}`,
      ),
    ),
  ])

  return section(ctx, 'launch', 'Launch', `${total} command${total === 1 ? '' : 's'} from ${groups.length} plugin${groups.length === 1 ? '' : 's'}, run in the Claude UI (asks first)`, [...body, text(ctx, ' each starts a Claude Code turn: it asks first, and mid-turn only fills the prompt box', { dimColor: true })], false)
}
