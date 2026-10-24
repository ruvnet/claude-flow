# Source-reviewed engine policy evidence

Decision: accept executor policy v2 for constructing the fixed Bubblewrap
capability probe only. This does not authorize or validate candidate execution.

The policy binds the repository-retained Bubblewrap 0.12.0 binary by path,
SHA-256, size, mode, ELF closure, exact version output, artifact evidence and
upstream source identities. The executor derives that path from its reviewed
module root and rejects policy drift, path escape, unsupported versions and the
unsafe `--not-a-security-boundary` option.

Official Bubblewrap source at release commit
`2a76602a8c71f36c1527cf9fc3417d9149822e0c` confirms that `--ro-bind-fd`
parses an inherited descriptor, creates a read-only bind, and checks the mounted
device/inode identity. `--ro-bind-data` copies bytes from an inherited descriptor
to a private backing file before read-only binding. The official test suite
contains a native fd-bind case. The two reviewed source blobs total 141,749 bytes.

This closes the stale-policy and unreviewed-native-semantics blockers. It does
not close the same-UID race boundary: Bubblewrap's source explicitly retains a
resolution-to-mount interval and device/inode equality does not authenticate
in-place content. Protected artifact provenance, reproducible toolchain, runtime
ABI, mount/namespace/egress behavior and p-limit isolation remain unverified.

Source CI run 34762475417 passed the complete focused suite then replayed all
seven historical epochs. Local source-bound checks passed six engine-artifact
and six fd-launch tests in 110.837372 ms of reported Node test time. The sparse
local checkout lacked `admission.mjs`, so the local executor test file did not
load; the complete CI checkout passed it. That failure is retained.

After reservation, one local shell started four Node processes: a syntax check,
the two six-test suites and JSON validation. The 12 tests passed with 186.982678
ms combined reported test duration; syntax and JSON validation wall time were
not separately measured.

There were zero candidate evaluations, namespace starts, native field calls,
model calls or provider spend. GitHub process counts, runner dollars, outer
Codex model cost and total dollars remain unknown. The mission ledger remains
at 209,784 native calls and seven epochs. Candidate execution and bounded-RSI
acceptance remain false.
