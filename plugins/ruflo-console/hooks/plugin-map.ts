/**
 * Which console section owns each ruflo plugin: the section that launches its slash commands (the Launch row) and answers
 * "ask Claude" about it. Every plugin directory under `plugins/`, and every external plugin the marketplace lists by a git
 * source, appears here, and a test fails when one is added without a line, so no plugin is ever unreachable from the console.
 * A plugin with no section of its own says why (`catalogOnly`) and is reached from the Plugin Catalog. Pure data.
 */
import type { ViewId } from './state'

export type PluginHome = { view: ViewId; /** Set when the plugin has no surface of its own yet: why, and where it is reached instead. */ catalogOnly?: string }

const home = (view: ViewId): PluginHome => ({ view })
const catalog = (why: string): PluginHome => ({ view: 'market', catalogOnly: why })

export const PLUGIN_MAP: Readonly<Record<string, PluginHome>> = {
  'agentic-qe-fleet': home('devtools'),
  'ruflo-adr': home('devtools'),
  'ruflo-agent': home('swarm'),
  'ruflo-agentdb': home('memory'),
  'ruflo-agntcy': home('federation'),
  'ruflo-aidefence': home('secure'),
  'ruflo-ai-team': home('swarm'),
  'ruflo-arena': home('evolve'),
  'ruflo-autopilot': home('automate'),
  'ruflo-bbs-federation': home('xruv'),
  'ruflo-browser': home('devtools'),
  'ruflo-business-pods': home('federation'),
  'ruflo-chatgpt-federation': home('federation'),
  'ruflo-console': catalog('this mod: it is the console'),
  'ruflo-core': home('overview'),
  'ruflo-cost-tracker': home('cost'),
  'ruflo-daa': home('neural'),
  'ruflo-ddd': home('devtools'),
  'ruflo-deepseek-harness': home('terminal'),
  'ruflo-docs': home('devtools'),
  'ruflo-federation': home('federation'),
  'ruflo-goals': home('missions'),
  'ruflo-graph-intelligence': home('vector'),
  'ruflo-intelligence': home('learning'),
  'ruflo-iot-cognitum': catalog('a device fleet with firmware writes: launched from the Plugin Catalog until the Domains view'),
  'ruflo-jujutsu': home('devtools'),
  'ruflo-knowledge-graph': home('memory'),
  'ruflo-loop-workers': home('automate'),
  'ruflo-market-data': catalog('a market-data domain plugin: launched from the Plugin Catalog until the Domains view'),
  'ruflo-metaharness': home('metaharness'),
  'ruflo-migrations': home('devtools'),
  'ruflo-mods': home('plugins'),
  'ruflo-music': catalog('a creative-domain plugin that may spend on generation: launched from the Plugin Catalog until the Domains view'),
  'ruflo-neural-trader': catalog('a trading domain plugin (never live from the console): launched from the Plugin Catalog until the Domains view'),
  'ruflo-observability': home('timeline'),
  'ruflo-plugin-creator': home('plugins'),
  'ruflo-rag-memory': home('memory'),
  'ruflo-ruos': home('swarm'),
  'ruflo-ruvector': home('vector'),
  'ruflo-ruvllm': home('neural'),
  'ruflo-rvf': home('sandbox'),
  'ruflo-protector': home('secure'),
  'ruflo-security-audit': home('secure'),
  'ruflo-sparc': home('missions'),
  'ruflo-swarm': home('swarm'),
  'ruflo-testgen': home('devtools'),
  'ruflo-workflows': home('automate'),
  'ruflo-x-gateway': home('xruv'),
}

/** The section that owns a plugin (by directory name, or by the `plugin:command` slash name). */
export const homeOf = (pluginOrSlash: string): ViewId | null => PLUGIN_MAP[pluginOrSlash.split(':')[0] ?? '']?.view ?? null

/** The plugins a section owns, in name order: what its Launch row can offer. */
export const pluginsOfView = (view: ViewId): string[] =>
  Object.entries(PLUGIN_MAP)
    .filter(([, entry]) => entry.view === view)
    .map(([plugin]) => plugin)
    .sort()
