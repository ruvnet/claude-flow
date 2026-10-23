/**
 * The disk half of the ruRE sample rule (ADR-495). `sample` (data/devtools.ts) is checked as text: relative, no `..`. A link inside the
 * project that points outside it passes that check, and the rure_* tools open the top-level file they are given, so a link there reads
 * what the person never named. This walks the sample from the project folder down and refuses when any part of it is a link. A part that
 * is not there is fine (the tool answers "not found" itself), and a host that cannot stat answers like a missing part, as `checkNoLinks`
 * does for writes: the check narrows what runs, it does not widen it. Leaf: no engine call, the host's `stat` is passed in.
 */
import type { ReaderFs } from './files'

const isLinkKind = (kind: string | undefined): boolean => kind === 'symlink' || kind === 'link'

/** `null` when the sample may be handed to a tool, or the reason it may not (one plain line). */
export async function sampleLinkCheck(fs: Pick<ReaderFs, 'stat'>, sample: string): Promise<string | null> {
  const parts = sample.split('/').filter(part => part !== '' && part !== '.')
  let at = ''

  for (const part of parts) {
    at = at === '' ? part : `${at}/${part}`

    const stat = await fs.stat(at).catch(() => undefined)

    if (stat === undefined) return null
    if (stat.isLink === true || isLinkKind(stat.kind)) return `${at} is a link: it could lead outside the project, so ruRE does not follow it. Copy the file into the project and name the copy.`
  }

  return null
}
