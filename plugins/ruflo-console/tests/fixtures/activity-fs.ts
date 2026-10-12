/**
 * An in-memory disk for the Events and Timeline persistence tests (ADR-474): `fs` for reads and `run` for the fixed argv the console
 * writes with (mkdir, the `sh -c 'cat >> "$1"'` append, dd, mv, rm, install). Several consoles can share one disk.
 */
import type { Host } from '../../hooks/host'

export type Disk = { files: Map<string, string>; dirs: Set<string>; links: Set<string>; runs: (readonly string[])[]; failAppend: boolean }

export const newDisk = (files: Record<string, string> = {}): Disk => ({ files: new Map(Object.entries(files)), dirs: new Set(['/work', '/work/proj']), links: new Set(), runs: [], failAppend: false })

export function hostOn(disk: Disk): Pick<Host, 'fs' | 'run'> {
  return {
    fs: {
      read: async path => {
        const found = disk.files.get(path)

        if (found === undefined) throw new Error('missing')

        return found
      },
      stat: async path => (disk.links.has(path) ? { isLink: true, kind: 'file', size: 0 } : disk.files.has(path) ? { kind: 'file', size: disk.files.get(path)!.length, mtimeMs: 1 } : disk.dirs.has(path) ? { kind: 'dir' } : undefined),
      list: async () => [],
    },
    run: async (argv, _timeout, stdin = '') => {
      disk.runs.push(argv)

      const out = (exitCode: number) => ({ exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

      if (argv[0] === 'mkdir') {
        let at = ''

        for (const part of (argv[argv.length - 1] as string).split('/').filter(Boolean)) disk.dirs.add((at += `/${part}`))

        return out(0)
      }

      if (argv[0] === 'dd') {
        const path = (argv.find(arg => arg.startsWith('of=')) as string).slice(3)

        if (argv.includes('conv=excl') && disk.files.has(path)) return out(1)
        if (argv.includes('oflag=append')) {
          if (disk.failAppend) return out(1)
          disk.files.set(path, (disk.files.get(path) ?? '') + stdin)

          return out(0)
        }

        disk.files.set(path, stdin)

        return out(0)
      }

      if (argv[0] === 'install') {
        disk.files.set(argv[argv.length - 1] as string, stdin)

        return out(0)
      }

      if (argv[0] === 'rm') {
        for (const path of argv.slice(3)) disk.files.delete(path)

        return out(0)
      }

      if (argv[0] === 'mv') {
        const [from, to] = [argv[3] as string, argv[4] as string]

        disk.files.set(to, disk.files.get(from) ?? '')
        disk.files.delete(from)

        return out(0)
      }

      return out(127)
    },
  }
}
