/**
 * The one argv that appends stdin to a log. Shared by the Events store (activity-io.ts) and the autopilot journal (ap-journal.ts), so both
 * keep a batch in one piece when two consoles write one file.
 *
 * GNU (Linux): `dd` with O_APPEND, no shell, the path one element. `bs=1M iflag=fullblock` matters: dd's default 512-byte blocks write a
 * batch from a pipe in many short `write` calls, so two writers' batches interleave in the middle of a line (measured: 1094 of 4800 lines
 * torn with two writers). With one block per batch, dd issues one write(2) per batch to an O_APPEND file.
 *
 * POSIX (macOS, BSD): BSD `dd` has no `oflag=append`, so the shell opens the file for append (`>>` is O_APPEND) and the same `dd bs=1M
 * iflag=fullblock` writes the batch to it (BSD dd has `iflag=fullblock` and `status=none`; verified on macOS 26). See write-flavor.ts.
 *
 * What holds on both: one dd block per batch of at most 1 MiB. Appends from two consoles can interleave only if a write is split: a batch
 * over 1 MiB (several blocks; the callers stay far below, BATCH_MAX in activity-io.ts), or a short write(2) that dd completes with a second
 * call (the kernel may do that, e.g. on a full disk or a signal). This is not claimed to be atomic beyond that.
 */
import { hostFsArgv, posixAppend, type WriteFlavor } from './write-flavor'

export const appendArgv = (path: string, flavor: WriteFlavor): readonly string[] =>
  flavor === 'gnu' ? ['dd', `of=${path}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'] : flavor === 'posix' ? posixAppend(path) : hostFsArgv('append', path)
