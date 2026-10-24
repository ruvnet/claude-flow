# Descriptor validator FIFO rejection

EXECUTOR-010 fixes a concrete pre-launch hang. At baseline commit
`838c19cb31ea73dc1cf599ae25a5faa7d662041b`, openFile used blocking O_RDONLY
before fstat. Replacing the engine or fixed probe with a FIFO could block the
parent before the child timeout applies. O_NOFOLLOW rejects symlinks, not FIFOs.

Add O_NONBLOCK to that open. fstat then rejects the non-regular descriptor and
closes it. The existing hash, size, mode, identity and regular-file positional
read checks remain intact. This is not a general device-open or remote-filesystem
timeout guarantee and does not close same-UID content-mutation risks.

Two bounded real-FIFO tests reproduce both baseline hangs (ETIMEDOUT at 1s),
then pass on the fixed source without reaching the launch callback. Each test
uses one mkfifo and one timeout-bounded Node validator child, never Bubblewrap.
The full descriptor suite changes from 6/8 to 8/8. Raw baseline output, fixed
summary, costs and original ledger anchor are retained in
[evidence/loop-development/repair-fd-fifo.json](evidence/loop-development/repair-fd-fifo.json).
Reservation was published before execution in
[mission issue 85](https://github.com/ruvnet/core-memory/issues/85#issuecomment-5654324864).

Two local Node test commands reported 2323.683862 ms combined. Eight helper spawn
attempts comprise four successful mkfifo commands, two successful validator
children and two retained validator timeouts. PIDs were not retained and total
process/model/CI dollars remain unknown. Zero namespace launches, repair
candidate evaluations, mission native calls or new epochs; no provider spend
initiated. No new empirical HYPOTHESIS. Original negative evidence is untouched.

Acceptance from this commit with Linux and Node:

    node --test v3/@claude-flow/cli/scripts/rsi/repair/fd-launch.test.mjs

Expected eight passes, including both actual FIFO rejections. Other platforms
skip those two FIFO cases explicitly. CI also runs the current focused tests and
original-source seven-epoch replay. No incompatible-host probe is retried.

Next execution boundary remains a compatible exclusive-UID isolation host with
reviewed provenance/runtime and an OS-level capability receipt. The repair
resource envelope remains unapproved. No improving descendants or RSI evidence
have been measured. Optional pi retrieval remains BLOCKED_AUTH and is skipped.

