# Patched engine artifact evidence

The source-bound Bubblewrap 0.12.0 artifact is accepted for executor engineering
only. Fresh official review rejected 0.10.0 because GHSA-pxhw-h44j-8pfx affects
all versions below 0.12.0.

Corrected CI run 34757982794 verified the durable reservation, exact head and
workflow bytes, then built exact release asset SHA-256
`9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314`.
External readback reproduced archive SHA-256
`53e646d3db1bd10201029235203bbfe7d3ec7f872ff7ad50a5c4f34cb2956785`,
receipt SHA-256
`d99ced2329c1b1c1071863b2746afc7bf7a40d659bfec2cffdf5b68bb95a63e4`
and binary SHA-256
`8d921da11eaa58abdbb707f2947bb038800c5f9f57809f11621da9f0cacd02ea`.
The binary and raw receipt are retained in Git.

Evidence publication unintentionally retriggered the pull-request build before a
single-use head guard landed. Run 34758156847 produced the same binary and is
retained and charged, but the accepted plus duplicate runs exceeded the v2
reservation's observed-child ceiling by eight. The guard in commit
`f23852cb96b40d96c6ae6e05788d0b5d2eb3104e` now makes later invocations skip;
closure reservation `ed7bd2cd10f774c0f976906bffba4f15400b647e` binds the final
workflow bytes.

The initial, corrected and unplanned duplicate receipts measured 60 child starts
and 8,150.450823 ms summed child wall time; workflows elapsed 118 seconds. Known
network payloads total 507,662 bytes. Bootstrap processes, APT
bytes/cost, runner cost, model cost and total
dollars are unknown. No namespace, candidate, model or native evaluation ran.

Native fd semantics, runtime compatibility and OS isolation are unverified.
Candidate execution and bounded-RSI acceptance remain false. The ledger remains
at 209,784 calls and seven epochs.
