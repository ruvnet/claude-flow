# Package download measurements

Measured October 17, 2026 in Toronto, against published version 3.57.0 and candidate source `b00f8ea4c28b08c585e936a7bd5cf001a3405fbf`. Linux x64, Node 24.19.0, npm 11.9.0, fresh directory and empty npm cache for every observation. Lifecycle scripts, audit and funding requests were disabled.

## Published consumer experience

| Package | Archive size | Archive download median | Consumer install | Total registry tarball payload |
| --- | ---: | ---: | ---: | ---: |
| `ruflo` | 4.60 MB | 3.32 s | 61.26 s | 468.02 MB |
| `@claude-flow/cli` | 4.00 MB | 3.48 s | 55.78 s | 463.43 MB |
| `claude-flow` | 3.78 MB | 3.43 s | 47.42 s | 413.97 MB |

Archive medians use three fresh caches per package. Consumer installs are one successful observation each, including the package and its dependencies. These times include npm overhead, metadata resolution, downloading, extraction and lock writing. They exclude lifecycle scripts and application startup, so they are not complete first launch timings. Archive ranges were 2.88 to 5.80 seconds for `ruflo`, 3.27 to 3.53 for the CLI, and 3.22 to 4.58 for the umbrella.

MB means 1,000,000 bytes. Payload is the sum of unique registry tarball contents in npm's cache index. It excludes metadata, headers and retransmissions; it is not a packet level traffic measurement. Registry, CDN and proxy cache state was uncontrolled. Do not extrapolate these Linux timings to other networks or operating systems.

## Proposed dependency cost

| Package | Published dependency payload | Candidate dependency payload | Added payload |
| --- | ---: | ---: | ---: |
| `@claude-flow/cli` | 459.43 MB | 459.43 MB | 0 MB |
| `claude-flow` | 410.19 MB | 522.16 MB | 111.97 MB, 27.30% |

For this comparison, the published archive's bundled files were retained and only the candidate dependency declarations were substituted. Every nonmanifest file was checked for byte identity. Both archives were installed as dependencies in fresh consumer projects. Local fixture archives are excluded from the payload totals. These fixtures measure dependency acquisition, not the validity or final size of a signed candidate release.

Comparison fixture timings are deliberately excluded: diagnostic work overlapped some runs, making elapsed time unsuitable for attributing a performance difference. The published consumer timings above ran sequentially before that overlap.

The CLI's additional direct declarations reused already downloaded transitive packages in this resolution. The `ruflo` wrapper declarations are unchanged and still pin the published CLI; it was not represented as a complete future wrapper release.

Almost all added umbrella payload comes from six SLIM platform binary archives, totaling about 108.95 MB. The captured lock entries have no operating system or CPU restrictions. This Linux run fetched Darwin, Windows and both Linux architectures. The analysis graph itself adds no consumer dependency.

## Diagnostic findings and limits

Installing manifests directly as project roots is not equivalent to installing their packages. Root overrides change resolution, and bundled files matter. Those diagnostics are retained separately in the data and are not used as consumer cost claims.

Both CLI root manifest variants failed with `ERESOLVE`: `agentic-flow@3.0.0-alpha.2` conflicts with the federation plugin's optional peer range `>=2.0.12-fix.8 <4.0.0`. Ordinary published CLI installation and both bundle preserving comparisons succeeded. This root fixture failure is not evidence that the published CLI cannot install.

Required signing and final candidate release builds remain outstanding. Lifecycle scripts could introduce additional downloads or compilation time. Dependency ranges can resolve differently later; the report records manifest inputs, registry integrity, source identity, fixture hashes, lock hashes and added archive URLs.

## Reproduce

```bash
python3 scripts/benchmarks/npm-downloads.py --output /tmp/ruflo-download-measurement
```

Use a new output path. The runner records every result, preserves tarball inventories, manifests, locks and logs, and removes temporary caches and installed modules after each measurement. It downloads several gigabytes across repeated cases and does not publish or execute package lifecycle scripts. The root manifest diagnostics intentionally retain failures rather than bypass peer resolution.

[Machine readable measurements](../../data/npm-download-benchmark.latest.json).

Decision: retain the analysis tooling and CLI declaration work, but hold the umbrella dependency expansion pending a SLIM platform filtering or explicit opt in fix. Acceptance: rerun the same bundle preserving consumer comparison, eliminate off platform SLIM archives on Linux x64, and retain working integration tests on every supported platform before publication.

## Follow up candidate

The [SLIM optional peer comparison](slim-opt-in-validation.md) reduces the previous candidate payload by 109.38 MB (20.95 percent) while retaining an explicit SDK install path. The net difference from the published release still requires a fresh matched comparison. This is validated candidate evidence, not a published release or a latency claim.
