/**
 * For specs that write to a real disk through the console's own code: the write argv must be the one this machine's tools take (GNU on
 * Linux, the sh scripts on macOS/BSD), found the way the console finds it at session start (`uname -s` through
 * `startWriteFlavorDetection`). The detection is module state, so it is cleared after the block: specs on a fake disk keep seeing the GNU
 * argv they parse.
 */
import { spawnSync } from 'node:child_process'

import { afterAll, beforeAll } from 'vitest'

import { setWriteFlavor, startWriteFlavorDetection, type WriteFlavor } from '../../hooks/data/write-flavor'

/** The host's run, for `uname -s` only. */
export const realRun = async (argv: readonly string[]): Promise<{ exitCode: number | null; stdout: string }> => {
  const result = spawnSync(argv[0] as string, argv.slice(1), { encoding: 'utf8' })

  return { exitCode: result.status, stdout: result.stdout ?? '' }
}

/** The flavor this machine needs, as the console would detect it; the module state is left cleared. */
export async function nativeWriteFlavor(): Promise<WriteFlavor> {
  setWriteFlavor(null)

  const flavor = await startWriteFlavorDetection(realRun)

  setWriteFlavor(null)

  return flavor
}

/** Detects the machine's flavor before the enclosing block (or file) and clears it after. */
export function useNativeWriteFlavor(): void {
  beforeAll(async () => {
    setWriteFlavor(null)
    await startWriteFlavorDetection(realRun)
  })
  afterAll(() => setWriteFlavor(null))
}
