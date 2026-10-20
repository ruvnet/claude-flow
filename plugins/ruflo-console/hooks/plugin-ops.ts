/**
 * What the Plugins page can do about the marketplace, as an ask: one fixed `claude plugin marketplace update ruflo` argv (checked against
 * `claude plugin --help`), shown on the confirm row before it runs. Installing, updating, enabling, disabling and removing a plugin are
 * the Plugin Catalog's (plugin-catalog.ts): one place for them, which every page that names a plugin links to. Tested in tests/plugin-ops.spec.ts.
 */
import type { ActionSpec } from './actions'

export type PluginOp = 'refresh'

const MARKET = 'ruflo'

export function pluginSpec(_op: PluginOp): ActionSpec {
  return {
    label: `update the ${MARKET} marketplace clone (git pull of the plugin list: network)`,
    args: [],
    argv: ['claude', 'plugin', 'marketplace', 'update', MARKET],
    shows: `claude plugin marketplace update ${MARKET}`,
    expect: 'a newer clone of the ruflo marketplace',
    note: 'NETWORK: pulls the marketplace from GitHub',
    timeoutMs: 120_000,
  }
}
