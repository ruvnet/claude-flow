# Native fd-bind admission result

Decision: preserve this useful negative result and fail closed. Exact upstream
source review established that the pinned Bubblewrap 0.9.0 cannot atomically bind
the already validated runtime directories. Ordinary binds canonicalize
`/proc/self/fd/N` back to pathnames, and the untracked inherited directory
descriptors can survive into the sandbox command. No p-limit or repair candidate
was executed.

Source `7d78690fb90014216d212347ddb9c0bb0f41d488` at tree
`368305311216d98045c90ee0771c3379410c1673` is preceded by durable reservation
`3d522ebeb8a32c65f4b5f36937be2c958f92a90d`, whose SHA-256 is
`66dfa346dd717d5568859fcb5656e71979ba5048793d36e6ff9b4fcdfe81b97d`.

The production path now records an incompatible receipt after its pinned version
observation and stops before namespace launch with
`PINNED_ENGINE_LACKS_NATIVE_BIND_FD`. A prepared path uses the native
`--bind-fd`/`--ro-bind-fd` and `--ro-bind-data` mechanics introduced in upstream
v0.10.0, but the current policy cannot reach it. A future migration must bind
native semantics to the reviewed replacement binary's hash, version and source;
a caller-provided boolean is not sufficient.

Three registered pure batches passed 48 tests and three syntax checks in
138.352097, 141.301094 and 158.020957 ms, totaling 437.674148 ms across six Node
parent invocations. Test-runner descendants are unknown. Provider spend was $0;
outer Codex and total acquisition, evaluation and engineering dollars remain
unknown. Mission usage added zero repair evaluations, isolated repair starts,
native calls, epochs or model calls.

Before reservation, a reviewer completed two version checks and attempted one
no-candidate Bubblewrap option smoke. The smoke did not produce an observed
completion, exceeded 10.3 seconds and was later observed alive beyond 258 seconds.
It remains charged with unknown full work and was not retried. This is engineering
probe evidence, not a repair evaluation or mission isolated start.

The cleanup path only detects a snapshot-root replacement already present when
cleanup begins; concurrent same-UID mutation and pathname-recursive cleanup races
remain. A reviewed and content-pinned Bubblewrap 0.10.0-or-later executable plus
a compatible exclusive-UID runner are still required before the clean offline
p-limit reproduction. The repair resource proposal remains unapproved at 36
candidate evaluations, 216 isolated starts and 1080000 summed process ms.

The ledger remains at 209784 native calls, seven epochs and head
`5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`.
No fresh task, descendant improvement capacity or bounded RSI evidence was
measured.

## Acceptance

```bash
node --test \
  v3/@claude-flow/cli/scripts/rsi/repair/fd-launch.test.mjs \
  v3/@claude-flow/cli/scripts/rsi/repair/runtime-snapshot.test.mjs
```

Expected: sixteen passes, including refusal of the 0.9.0-style bind path; candidate
execution and RSI acceptance remain false.
