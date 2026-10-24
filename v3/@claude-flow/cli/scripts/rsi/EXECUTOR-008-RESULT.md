# Patched isolation-engine artifact result

Decision: accept the source-bound Bubblewrap 0.12.0 binary as a quarantined
engineering artifact. Do not yet admit it to the executor. Candidate execution
and bounded-RSI acceptance remain false.

The planned 0.10.0 lineage was rejected before build after fresh official-source
review found GHSA-pxhw-h44j-8pfx: every Bubblewrap version below 0.12.0 is affected
by sandbox-setup symlink traversal. The replacement is built from the official
0.12.0 release asset (SHA-256
`9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314`),
published 2026-08-26 and associated with commit
`2a76602a8c71f36c1527cf9fc3417d9149822e0c` and tree
`021e149edf2e8b9f4a0339e0b5cc0075d299c9a9`. The upstream commit itself is
unsigned, and archive-to-Git-tree reconstruction has not yet been verified.

Full-SHA-pinned GitHub Actions on `ubuntu-24.04` built the binary with SELinux,
tests, manual pages and shell completions disabled. The 96,680-byte ELF has
SHA-256 `8d921da11eaa58abdbb707f2947bb038800c5f9f57809f11621da9f0cacd02ea`,
mode 0555, no setuid/setgid bits, no file capability, no RPATH/RUNPATH and only
`libcap.so.2` plus `libc.so.6` dependencies. It reports exactly `bubblewrap
0.12.0` and exposes `--bind-fd`, `--ro-bind-fd` and `--ro-bind-data`.
`--not-a-security-boundary` is explicitly forbidden from every future launch.

The first build run 34757629242 completed, but review found that its workflow did
not verify the external durable reservation or bind its receipt to the exact head.
It remains preserved and charged, but is not the accepted artifact receipt.
Corrected run 34757982794 verified reservation commit
`6d885c5e50ea3bd62210a0c2a856bace984c43f5`, bound head
`d1394f0b7d4436210e10c5f2b35f25c9e5a1a889` and the workflow SHA-256, and
succeeded in 37 seconds. Artifact 10318235508 has archive SHA-256
`53e646d3db1bd10201029235203bbfe7d3ec7f872ff7ad50a5c4f34cb2956785`.
External download reproduced the archive, receipt and binary hashes and reran the
version, help, ELF and file-capability checks. Both runs produced the identical
binary. The binary and corrected raw receipt are retained in Git rather than
relying on the 30-day Actions retention window.

Publishing that evidence retriggered the pull-request workflow because GitHub
evaluates path filters over the full pull-request diff. Unplanned run 34758156847
therefore repeated the build before a single-use head guard could land. It
produced the same binary, but exceeded the v2 reservation's 32-child observed
ceiling by eight when combined with the accepted run. The run and charge are
retained without refund and are not evidence of additional capability. Commit
`f23852cb96b40d96c6ae6e05788d0b5d2eb3104e` added the single-use guard;
closure reservation `ed7bd2cd10f774c0f976906bffba4f15400b647e` binds those
final workflow bytes. Later workflow invocations skip before acquisition.

The three receipts measured 60/60 build-orchestration child starts and
8,150.450823 ms summed child wall time. The workflows lasted 41, 37 and 40
seconds. Three upstream release downloads totaled 379,356 bytes and three
artifact readbacks totaled 128,306 bytes.
Bootstrap process count, APT bytes/cost, runner dollars, outer Codex/model costs
and total dollars remain unknown. Local readback used five parent shells and 30
observed child commands. There were zero namespace starts, candidate evaluations,
native field calls, model calls or provider spend.

This closes patched engine-version selection and preserves a content-addressed
binary payload. It does not provide a protected-workflow signature or verified
archive-to-Git-tree correspondence, and the mutable APT/bootstrap environment is
not an independently reproducible toolchain. It also does not verify native fd
semantics, runtime-library compatibility, namespace separation,
network denial or p-limit execution. The next executor step is to bind this exact
binary and its dynamic dependency closure into the runtime policy, statically
review the 0.12 fd-mount path, and run the fixed capability probe on a compatible
exclusive-UID host. Repair trials still require explicit approval for 36
evaluations, 216 isolated starts and 1,080,000 summed process milliseconds.

The original mission remains at 209,784 native calls, seven epochs and ledger
head `5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`.
No descendant-improvement evidence was produced.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/engine-artifact.test.mjs
```

Expected: six passes; vulnerable-version substitutions, missing fd-bind flags,
unsafe launch arguments, privilege bits, dependency drift, hidden costs and ledger
resets fail closed. Candidate execution and RSI acceptance remain false.
