# Console and mod-fleet optimization, 2026-10 (R4)

Measure first, change only what the numbers justify. Result: **no console or mod code changed.** Every target was either
dominated by something outside the plugin's control, or already costs under a millisecond. This page holds the numbers,
the decision each one decided, and two new benches.

Host: ruvultra, 32 cores, **load average ~27 from sibling workers during every run**, so wall times are upper bounds.
Run on `a962c403e`.

## (a) Cold start: `session.start` to first draw

| Measurement | Result |
|---|---|
| Empty plugin (kit, `boot: false`), `session.start` | 13 to 35 ms |
| Full console, **first** `session.start` in a test | 540 to 1500 ms (typically ~650) |
| Full console, 2nd to 4th `session.start` with the same `$` | 21 to 27 ms |
| After `session.start`: `/ruflo overview`, `/ruflo status`, mount, first draw | 2, 5, 25, 1 ms |
| Under tsx: import the whole `hooks/register.ts` graph | ~245 ms (self-check alone 12 ms cold, 0.3 ms warm) |

The handler costs ~22 ms. The rest is the engine loading and transpiling the module graph (182 files, 1.5 MB, no file
over 32 KB) afresh for every test. Dynamic `import()` would defer it but smoke step 3 bans it by design, and the size is
spread evenly, so there is no single heavy module to trim. **Decision: unchanged.**

Smoke step timings (`PS4` trace of `scripts/smoke.sh`, total ~9 s on this host): step 14 (vitest) 7.99 s, step 11
(file-length `find`, one `awk` per file) 0.51 s, step 12 0.14 s, every other step under 55 ms. The ~30 s CI wall for the
fleet is CPU contention on top of the same vitest step, not a slow smoke step. Replacing step 11's per-file `-exec awk`
would save ~0.45 s of 9 s; left alone.

## (b) Per-frame render cost under load

`scripts/bench-views.mjs`: 300 events, 200 control-log entries, 60 mod status rows, 110 columns, 400 renders per page
through `paneView` with a recording kit (the engine's own layout is not in it). Allocation is the `heapUsed` delta over
200 renders after `gc()`: approximate.

| Page | median | p99 | allocated per render |
|---|---|---|---|
| Room | 0.689 ms | 2.246 ms | ~77 KiB |
| Overview | 0.281 ms | 1.289 ms | ~28 KiB |
| Memory | 0.290 ms | 3.385 ms | ~5 KiB |
| Events | 0.181 ms | 0.940 ms | ~61 KiB |

The frame budget is 4 ms (`scripts/bench.ts`). Every page is under it at p99 even loaded. **Decision: unchanged.**

## (c) Snapshot read path

`scripts/bench-snapshot.mjs`, 60 `*-mod` folders beside the captured run. The refresh runs every `refreshSeconds` (default
3 s, 2 to 60) while the pane is seen, and every 30 s otherwise.

| | `$.fs.stat` | `$.fs.read` | `$.fs.list` | total engine calls | parse and assemble (median / p99) |
|---|---|---|---|---|---|
| cold (empty cache) | 79 | 75 | 2 | 156 | 0.205 / 1.131 ms |
| warm (nothing changed) | 75 | 0 | 2 | 77 | 0.178 / 1.211 ms |

Unchanged files are not re-read (the mtime and size cache in `readBounded` works; 0 reads warm), but are re-parsed. The
parse costs ~0.18 ms, so an mtime-keyed parse cache would save at most ~0.03 ms per refresh and add invalidation state.
The cost that matters is the ~77 stat hops (60 of them the mods scan), and fewer stats means skipping files, which is
observable. **Decision: no parse cache, no change.**

## (d) Status-file write amplification by the 40 mods

Every mod's `flush` does one awaited `$.fs.write` of the whole file at `session.start` and on every denial, inside the
`tool.call` deny path. Measured on `ruflo-daa` through the kit (scratch copy, mock fs): **500 sequential denials produced
500 writes (41,974 bytes), 0.42 ms per denial.** So the amplification is real (one write per denial, nothing coalesced)
but small in absolute terms, and a burst of hundreds of denials is not something a session produces in practice.

Nine `flush` variants exist across the 39 plugins, so a fix is a 39-file edit, in files sibling workers are merging into
now. **Decision: not changed here.** Recipe for whoever owns the fleet: write at the leading edge (the first denial still
leaves `blocked: 1` in the file, so existing assertions hold), then schedule a single trailing write with `$.clock.after`
after a quiet interval. A pure debounce would break the mods' suites, which mock `clock.now` but not `mock.clock` and
read the file straight after a denial.

## (e) Test suite wall time

| Run | Result |
|---|---|
| `npx vitest run plugins/ruflo-console/tests/` | 882 pass, 3 skipped; 23 files fail to load; 7.4 to 8.7 s wall; `collect` 95 to 112 s, `tests` 19.6 s |
| `claude plugin test plugins/ruflo-console` | 211 pass, 0 fail, 23 files, 47.6 s wall; per-test durations sum to 320 s, mean 1.5 s |

The 23 failing files are the `*.test.ts` kit files: `Error: Cannot find package 'claude-code/testing'`. That module is
provided by the `claude` binary, so root vitest can never resolve it. This is by design: smoke step 12 keeps them in
`scripts/ci-test-baseline.txt`, step 14 runs vitest with `--exclude '**/*.test.ts'`, and `claude plugin test` runs them.

The kit run is slow because each of the 211 tests pays the ~650 ms first-`session.start` module load from (a); that is
~137 s of the 320 s sum. The slowest tests (3 to 4.5 s) are button sweeps ("every button does something") that press
dozens of buttons in one test. `worldOf` is a few `Map` lookups, so there is no shared fixture to cache; merging tests to
share a session would change test counts. **Decision: unchanged.**

## Before and after

| Target | Before | After |
|---|---|---|
| (a) cold start | ~650 ms first `session.start` | unchanged: engine module load, ~22 ms handler |
| (b) render, loaded | 0.18 to 0.69 ms median | unchanged: all under the 4 ms budget |
| (c) refresh | 77 engine calls warm, 0.18 ms parse | unchanged: a parse cache saves ~0.03 ms |
| (d) status writes | 500 writes per 500 denials | unchanged: recipe above, fleet-wide edit left to its owners |
| (e) tests | 211 pass / 882 vitest, 47.6 s / 8.7 s | unchanged |

Reproduce: `NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-views.mjs`,
`npx -y tsx plugins/ruflo-console/scripts/bench-snapshot.mjs`.
