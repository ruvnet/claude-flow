import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/arena-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/arena-mod status', '/arena-mod strategies'].join('\n')

export function answer(args: string, deps: CommandDeps): string {
  const [verb = ''] = args.trim().split(/\s+/)

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `Arena mod active · no tool is guarded`
  }

  if (verb === 'strategies') return 'Classic roster: tit-for-tat, always-cooperate, always-defect, grim, pavlov, alternate, random. Run one with /arena run --a <strategy> --b <strategy>, or /arena tournament.'

  return `Unknown: ${verb}\n${HELP}`
}
