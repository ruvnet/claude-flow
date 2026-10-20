import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/agntcy-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/agntcy-mod status', '/agntcy-mod config'].join('\n')

export function answer(args: string, deps: CommandDeps): string {
  const [verb = ''] = args.trim().split(/\s+/)

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `AGNTCY mod active · no tool is guarded`
  }

  if (verb === 'config') return 'AGNTCY/SLIM/CASA integration is scaffolding (ADR-380): no upstream package is installed, transport is local, CASA enforcement is off. This mod makes no network call to AGNTCY infrastructure.'

  return `Unknown: ${verb}\n${HELP}`
}
