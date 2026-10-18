# Umbrella SLIM installation validation

Measured October 18, 2026 UTC, against baseline source `bca822cfd5788ee813dec12b6c8f7dad24e313d8`. The candidate moves `@agntcy/slim-bindings@2.0.0-alpha.5` from the umbrella's optional dependencies into an exact optional peer. Operators who use SLIM install it deliberately. Local transport remains the default. The scoped CLI declaration is unchanged.

## Measured result

| Measure | Previous candidate | Optional peer candidate |
| --- | ---: | ---: |
| Registry tarball payload | 522,159,201 bytes | 412,781,888 bytes |
| Unique registry tarballs | 548 | 538 |
| Observed install time | 69.275 seconds | 59.471 seconds |
| SLIM packages acquired automatically | Present | Absent |

Savings are **109,377,313 bytes, or 20.95 percent** of the previous candidate payload. The earlier 111,971,638 byte increase remains the historical motivation. Only the paired current measurement establishes this candidate's improvement; no net residual versus the published release is claimed without repeating that comparison.

All 538 retained tarballs have identical integrity hashes; no new tarballs appear. Retained package versions and integrities also match across both consumer locks. The removed payload comprises six SLIM platform archives and four SDK or binding dependency archives. The root lock change is restricted to the SLIM and UBJS dependency closure. Unrelated MCP Express 4 workspace entries are preserved; a regression check guards their compatible major version.

Each variant uses a new consumer directory and empty npm cache, identical Linux x64 environment, Node 24.19.0 and npm 11.9.0. Lifecycle scripts, audits and funding requests are disabled. Both fixtures preserve all 1,941 nonmanifest files from the same published 3.57.0 archive. These are dependency acquisition fixtures, not signed candidate releases.

Payload counts unique registry tarball bytes in npm's cache, excluding local fixtures, metadata, headers and retransmissions. Timings are single observations, with uncontrolled CDN state and some concurrent validation work; no attributable latency improvement is claimed.

## Capability acceptance

The actual installed candidate reports version 3.57.0 and `transport use slim` exits successfully with local transport when unconfigured. The actual source runtime detector reports the absent SDK cleanly. Explicit installation of the pinned SDK into the same consumer succeeds using the captured registry cache, and its native import resolves under Node 24.19.0. This checks SDK loading, not a network transport handshake or every supported operating system.

```bash
npm install claude-flow @agntcy/slim-bindings@2.0.0-alpha.5
```

SLIM users retain the upstream platform archive cost. This is a deliberate default acquisition change, not a fix to upstream OS/CPU metadata. Users who previously relied on automatic acquisition must use the explicit install command. A consumer selecting a different SLIM version may encounter a peer version conflict; the exact alpha pin is intentional and must be reconciled explicitly. Failure diagnostics and local fallback remain intact.

67 Node contract tests, 15 Python collector tests and two installed RuVector integration tests pass with no skips. The new contract tests cover exact optional peer ownership, manifest/lock agreement, missing SDK, installed fixture SDK and broken imports. The two cycle evaluator reruns all seven registered checks successfully and still reports 391 uncovered packages. Coverage has not increased.

## Reproduce and rollback

Use the baseline root manifest from the recorded commit and the published archive with the SHA256 recorded in the JSON evidence:

```bash
git show bca822cfd5788ee813dec12b6c8f7dad24e313d8:package.json > /tmp/slim-baseline.json
npm pack claude-flow@3.57.0 --ignore-scripts
python3 scripts/benchmarks/npm-slim-opt-in.py --archive ./claude-flow-3.57.0.tgz --baseline-manifest /tmp/slim-baseline.json --output /tmp/slim-proof
node scripts/benchmarks/probe-slim-consumer.mjs /tmp/slim-proof/candidate absent
```

The comparison script does not install the opt in SDK or publish packages. To repeat the explicit installation probe, install the pinned SDK in the candidate consumer with lifecycle scripts disabled, then run the probe with `present`. Keep the before installation lock and tarball measurements before changing that consumer.

Rollback restores the umbrella declaration to optionalDependencies and regenerates the root lock, then reruns the same contracts. Promotion remains blocked on signed release artifacts and the applicable release gates. The full restart persistent memory workflow remains the next implementation task.

[Machine readable source and measurement evidence](../../data/npm-slim-opt-in.latest.json). The earlier benchmark remains preserved as the fixed reference. The existing explorer queue uses that earlier snapshot; this candidate receipt records partial remediation without rewriting historical observations.
