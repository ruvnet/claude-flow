/** A small ruflo marketplace clone as Claude Code writes it: three plugins, one with skills, agents, commands, MCP and a mod. */
const CLONE = '.claude/plugins/marketplaces/ruflo'

const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nStep one: do the thing.\nStep two: check it.\n`

export const CATALOG_HOME = {
  '.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'ruflo-core@ruflo': [{ scope: 'user', version: '0.2.6', lastUpdated: '2026-07-30T12:06:11.791Z' }],
      'ruflo-swarm@ruflo': [{ scope: 'user', version: '0.2.1' }],
    },
  }),
  '.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/.claude/plugins/marketplaces/ruflo', lastUpdated: '2026-09-03T18:45:31.282Z', autoUpdate: true } }),
  [`${CLONE}/.claude-plugin/marketplace.json`]: JSON.stringify({
    name: 'ruflo',
    plugins: [
      { name: 'ruflo-core', source: './plugins/ruflo-core', description: 'Core Ruflo MCP tools, commands, and orchestration patterns' },
      { name: 'ruflo-mods', source: './plugins/ruflo-mods', description: 'ruflo as a Claude Code mod (function hooks)' },
      { name: 'ruflo-swarm', source: './plugins/ruflo-swarm', description: 'Swarm coordination in a pane' },
      { name: 'ruflo-bad', source: './../escape', description: 'a source that climbs out of the clone is skipped' },
    ],
  }),
  [`${CLONE}/plugins/ruflo-core/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'ruflo-core', version: '0.2.6' }),
  [`${CLONE}/plugins/ruflo-core/skills/ruflo-doctor/SKILL.md`]: skill('ruflo-doctor', 'Diagnose a ruflo install and fix what it can'),
  [`${CLONE}/plugins/ruflo-core/skills/ruflo-status/SKILL.md`]: skill('ruflo-status', 'Show swarm, memory and daemon status'),
  [`${CLONE}/plugins/ruflo-core/agents/coder.md`]: '---\nname: coder\n---\nImplementation specialist.\n',
  [`${CLONE}/plugins/ruflo-core/agents/reviewer.md`]: '---\nname: reviewer\n---\nReview specialist.\n',
  [`${CLONE}/plugins/ruflo-core/commands/ruflo-init.md`]: '---\ndescription: Initialise ruflo here\n---\nRun init.\n',
  [`${CLONE}/plugins/ruflo-core/.mcp.json`]: '{"mcpServers":{"ruflo":{"command":"npx"}}}',
  [`${CLONE}/plugins/ruflo-mods/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'ruflo-mods', version: '0.1.0' }),
  [`${CLONE}/plugins/ruflo-mods/hooks/register.ts`]: 'export default {}',
  [`${CLONE}/plugins/ruflo-swarm/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'ruflo-swarm', version: '0.2.1' }),
  [`${CLONE}/plugins/ruflo-swarm/skills/swarm-watch/SKILL.md`]: skill('swarm-watch', 'Watch a swarm in the pane'),
  [`${CLONE}/plugins/ruflo-swarm/hooks/register.ts`]: 'export default {}',
}
