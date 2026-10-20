import type { TestBody } from 'claude-code/testing'

import { MEM_OUT } from './memory'
import { RUFLO_FILES } from './ruflo-run'
import { cliAnswer, command, elementsOf, keyOf, paneAt, PLUGIN, textOf, worldOf } from './world'

export type Engine = Parameters<TestBody>[0]

/** The captured world, with the Memory Lab's reads answered from a two-entry store (auth/beta, notes/alpha). */
export function memoryWorld(on: Parameters<TestBody>[1]) {
  const world = worldOf(on, RUFLO_FILES)
  const out = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

  world.respond = argv => {
    const line = argv.join(' ')

    if (line.includes('memory stats')) return out(MEM_OUT.stats ?? '')
    if (line.includes('memory list')) return out(MEM_OUT.list ?? '')
    if (line.includes('memory retrieve')) return out(MEM_OUT.retrieve ?? '')
    if (line.includes('memory search')) return out(MEM_OUT.search ?? '')
    if (line.includes('memory_search_unified')) return out(MEM_OUT.unified ?? '')

    return cliAnswer(argv)
  }

  return world
}

/** Opens the console on `view` via /ruflo, waits for its probes, and answers its drawing and its Raster keys. */
export async function drawn($: Engine, view: string, columns = 110, sections: readonly string[] = []) {
  await $.command.run(command(view))
  await $.command.run(command('status'))

  const pane = await $.ui.mount({ ...paneAt(columns), plugin: PLUGIN })
  await pane.drawn()
  for (const section of sections) await pane.press({ key: `sec-${section}` })
  const tree = await pane.drawn()

  await pane.unmount()

  return { text: textOf(tree), tree, rasters: elementsOf(tree, 'Raster').map(keyOf) }
}
