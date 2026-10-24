# Source-reviewed isolation-engine policy

Decision: migrate the executor policy from the rejected Bubblewrap 0.9.0 host
binary to the quarantined, repository-retained Bubblewrap 0.12.0 artifact.
This admits only the fixed engineering capability probe to the next host check.
It does not authorize candidate execution, spend repair resources, or establish
bounded RSI.

## Blocker removed

The prior policy deliberately reported native fd binding as unreviewed and
pinned a host pathname for Bubblewrap 0.9.0. That engine cannot provide the
descriptor-bound mount construction required by fd-launch.mjs. The v2 policy
now binds the exact retained artifact:

- repository path repair/engine/bwrap-v0.12.0-linux-x64;
- SHA-256 8d921da11eaa58abdbb707f2947bb038800c5f9f57809f11621da9f0cacd02ea;
- 96,680 bytes, mode 0555;
- libcap.so.2 and libc.so.6, with no RPATH or RUNPATH;
- release asset, source commit/tree, reviewed source blobs, corrected build
  receipt, build source and final artifact-evidence identities.

The executor derives the artifact's absolute path from its own reviewed source
directory and refuses path escape. It stages and revalidates the exact bytes
before use. Version admission is exact bubblewrap 0.12.0, not a permissive
minimum-version parse. --not-a-security-boundary remains forbidden.

## Native fd semantics review

Official Bubblewrap source at commit
2a76602a8c71f36c1527cf9fc3417d9149822e0c, tree
021e149edf2e8b9f4a0339e0b5cc0075d299c9a9, was reviewed through its immutable
Git blobs:

- bubblewrap.c blob 9192550540d3c4f173a7308c11e518e18ef4c303;
- tests/test-run.sh blob e608d4a847014029d5c7c24e8f4db25cfe255a38.

The parser maps --bind-fd and --ro-bind-fd to inherited descriptors and
propagates the read-only flag. After the kernel mount, Bubblewrap reopens the
destination and compares st_dev and st_ino against the inherited descriptor,
failing on mismatch. --ro-bind-data copies from its inherited descriptor into
a private temporary file, applies a read-only bind and unlinks the backing path.
The upstream test exercises --bind-fd.

This source review supports descriptor-bound pathname-replacement protection.
It does **not** prove same-UID content immutability, kernel correctness, runtime
ABI compatibility, namespace creation or denied egress. The fixed probe must
still run on a compatible exclusive-UID host. Protected publication provenance,
archive-to-tree reconstruction and a reproducible build toolchain also remain
open artifact-trust gaps.

## Closed gates

The repair proposal remains unapproved: 36 candidate evaluations, 216 isolated
process starts and 1,080,000 summed process milliseconds across at most three
shared epochs. The policy retains 209,784 native calls, seven epochs, the
original anchor and every confirmation gate. No HYPOTHESIS event is recorded.
No namespace or candidate is started by this increment.

## Acceptance

    node --test v3/@claude-flow/cli/scripts/rsi/repair/executor.test.mjs \
      v3/@claude-flow/cli/scripts/rsi/repair/fd-launch.test.mjs

Expected: all tests pass; engine, source-review, dependency, unsafe-argument,
resource, ledger and path substitutions fail closed. Inspection reports native
fd semantics reviewed while resource authorization and a compatible isolation
receipt remain absent. Candidate execution and RSI acceptance remain false.
