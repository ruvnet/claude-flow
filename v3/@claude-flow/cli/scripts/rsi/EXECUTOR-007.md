# Descriptor-bound executor launch

Decision: preserve a useful negative executor result and fail closed. Review of
the exact pinned Bubblewrap 0.9.0 source shows that ordinary `--bind` and
`--ro-bind` canonicalize `/proc/self/fd/N` back to pathnames before mounting.
Holding directory descriptors open therefore does not close the remaining
time-of-check/time-of-use race. The production launcher now refuses to spawn
unless reviewed native `--bind-fd` and `--ro-bind-fd` semantics are present.

The official Bubblewrap v0.10.0 release adds `--[ro-]bind-fd` specifically to
mount a filesystem represented by a descriptor and detect the internal
resolve-to-mount race by comparing descriptor and mounted identities. The prepared
launch path uses those native options for runtime and output directories,
executes the isolation engine through its inherited descriptor, and uses
`--ro-bind-data` for the fixed probe. It is deliberately unreachable under the
current 0.9.0 policy. No unreviewed executable is acquired and no privileged
helper, compiler, permission or resource dimension is added. File hashing uses
positional descriptor reads so the probe descriptor remains at offset zero.
Every inherited descriptor is closed by the parent after a successful, rejected
or interrupted launch callback. Native fd-bind operations also let Bubblewrap close the inherited
directory descriptors after mounting; the rejected 0.9.0 workaround would have
leaked ordinary inherited descriptors into the sandbox command.

This is not complete same-UID isolation. Even after a reviewed engine upgrade, a hostile process with the same uid can
still attempt in-place content mutation, ptrace, signal delivery or output-tree
tampering. Snapshot cleanup detects a root substituted before cleanup begins but
remains pathname-recursive and is not protected against a concurrent replacement.
Runtime subtree bytes are not sealed memfds. Production records an incompatible
capability receipt after the pinned version observation, with
`PINNED_ENGINE_LACKS_NATIVE_BIND_FD` and actual observed costs; it performs no
namespace launch. Candidate execution remains disabled, and a
compatible exclusive-UID runner is still required. The existing host's failed
namespace evidence remains authoritative and must not be retried unchanged.

No repair patch is applied or evaluated. No new HYPOTHESIS, mission epoch,
native field call, model call, provider spend or resource authorization is added.
The unapproved proposal remains 36 candidate evaluations, 216 isolated starts
and 1080000 summed process milliseconds. The original ledger stays at 209784
native calls and seven epochs.

## Acceptance

```bash
node --test \
  v3/@claude-flow/cli/scripts/rsi/repair/fd-launch.test.mjs \
  v3/@claude-flow/cli/scripts/rsi/repair/runtime-snapshot.test.mjs \
  v3/@claude-flow/cli/scripts/rsi/repair/executor.test.mjs
```

Expected: the pinned 0.9.0 path is refused, descriptor substitution and ambiguous
binds fail closed, stale root-path replacement is detected before cleanup, the prepared
fixed probe path becomes descriptor data, all descriptors close on interruption,
and execution/RSI gates remain false. A passing unit suite does not establish OS
namespace compatibility.

The current native-semantics field is hardcoded false for the exact 0.9.0 policy,
not accepted from a production caller. A future migration must derive it from a
reviewed source receipt bound to the replacement engine hash and version; toggling
a boolean is not admission.
