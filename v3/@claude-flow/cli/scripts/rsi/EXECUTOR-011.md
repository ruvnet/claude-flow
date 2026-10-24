# Shared bounded-file FIFO rejection

EXECUTOR-011 removes a reproduced pre-fstat denial of service from the shared
runtime-admission file reader. At source
`24e47c6e887b47f666e72aaef3ec8c5b4d35e38c`, `bounded-file.mjs` opened an
untrusted path with blocking `O_RDONLY|O_NOFOLLOW`. An actual FIFO caused the
timeout-bounded validator child to hang for one second before it was killed.
EXECUTOR-010 fixed this only for fd-launch engine and probe inputs; the shared
helper used by executor, runtime-layout and runtime-snapshot still had the flaw.

The change adds `O_NONBLOCK` before fstat. The existing regular-file, byte ceiling,
positional-read and descriptor identity checks remain unchanged. A direct suite
covers exact regular bytes, empty/oversized files, symlinks and an actual FIFO.
Baseline was 3/4 with one retained ETIMEDOUT; fixed source is 4/4 and rejects the
FIFO before reading. This is not a guarantee for every device, filesystem or
same-UID mutation, and it does not validate Bubblewrap or OS isolation.

The third local command retained an environmental negative: the sparse snapshot
lacks `repair/admission.mjs`, so executor tests could not load. All 27 runtime
layout/snapshot cases that did execute passed. Complete-checkout CI is therefore
the required acceptance source. Raw results and measured costs are preserved in
[repair-bounded-fifo.json](evidence/loop-development/repair-bounded-fifo.json)
and its companion raw text file.

The first complete-checkout CI run passed the 262 previously registered tests and
seven replays, but log inspection found that its explicit list omitted this new
suite. That incomplete acceptance is retained. The workflow now registers the
shared-helper suite, and only the second run may accept this increment.

Acceptance on Linux with Node 24:

    node --test v3/@claude-flow/cli/scripts/rsi/repair/bounded-file.test.mjs

Expected four passes. Full focused CI must also replay the seven historical
epochs from original sources. Candidate execution remains disabled. No repair
resource, mission-native call or epoch is consumed, and no RSI claim follows.

Guidance now requires every untrusted bounded regular-file admission path to
retain a nonblocking open before fstat. Hourly cadence is retained because useful
bounded implementation remains available. Roll back only if complete-checkout CI
shows changed regular-file bytes or a current consumer regression.
