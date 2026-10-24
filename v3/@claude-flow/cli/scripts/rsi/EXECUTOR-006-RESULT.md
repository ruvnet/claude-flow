# Descriptor and isolation-engine hardening result

Decision: accept the bounded engineering increment only. It removes the mutable,
unverified host Bubblewrap binary as the executor authority and closes unbounded
runtime-file reads. It does not establish a compatible isolation runner, execute
a repair candidate, or support an RSI claim.

Source `6d96051ca75c45f5aeb84825eeba2b58c0f91cf0` at tree
`d4c275194731febef96a8a31cffebcd94e37d3c5` pins Bubblewrap 0.9.0 to SHA-256
`52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712`
and 72160 bytes. Production copies those bytes through a bounded, no-follow file
descriptor into a canonical mode-0700 directory and revalidates the copy before
the fixed probe. Runtime sources, destinations, manifests, policies and source
hashes use bounded descriptor reads. Attempted version spawns are charged before
the call; an exception without a child identity leaves observed starts unknown.

The predecessor commit and its reservation remain intact. Its four registered
Node processes took 1576 ms. The final source-bound reservation covered five
Node processes: three snapshot-test runs, one runtime-layout run, and one host
snapshot plus engine stage/verify/discard. They took 189, 180, 185, 155, and
1043 ms, respectively: 1752 ms summed. They produced 27 snapshot-test passes,
17 runtime-layout-test passes, one exact snapshot reconstruction and one exact
private engine copy. A failed attempt to use absent `/usr/bin/time` launched no
Node process and has unknown wall time. Twelve additional engineering Node checks
have unaggregated wall time. Provider spend was $0; total acquisition, evaluation
and engineering dollar costs remain unknown.

[Dedicated CI run 34747206674](https://github.com/ruvnet/ruflo/actions/runs/34747206674)
passed 205 focused tests and source-specific replay of all seven epochs from the
original anchor. Mission usage remains 209784 native calls and seven epochs.
There were zero repair candidates, Bubblewrap starts, isolated starts, new native
calls, or new epochs.

A read-only security review found no candidate-execution or resource-gate bypass.
It also retained the important negative boundary: validation is not atomic with
pathname-based execution or mounts. A hostile same-UID process could still race
the engine, probe or snapshot paths. The review repeated 26 locally runnable
tests; this is code review and reproducibility checking, not independent efficacy
evidence.

The next acceptance condition is an exclusive-UID runner or a reviewed fd-relative
`openat2`/`open_tree` helper that proves the staged engine and mount roots cannot
be replaced between validation and spawn. On that compatible clean runner, the
fixed offline p-limit base must reproduce 3/4 and its exposed historical fix 4/4.
The separate proposal for 36 candidate evaluations, 216 isolated starts and
1080000 summed process milliseconds remains unapproved.

Largest uncertainty: whether inherited training-only failure-analysis state helps
descendants produce better successors on fresh tasks under matched controls.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/runtime-snapshot.test.mjs
```

Expected: nine passes. Candidate execution and bounded RSI acceptance remain false.
