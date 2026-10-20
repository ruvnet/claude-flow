# ADR-472: Recall log and stored vectors for the Learning Lab and the memory map

- Status: Accepted
- Date: 2026-10-06
- Builds on: ADR-454 (memory map), ADR-456 (explain a recall, pattern lifecycle), ADR-457 (memory health)
- Touches shipped code: `.claude/helpers/{intelligence,hook-handler}.cjs` (both copies), `v3/@claude-flow/cli/src/{commands/memory.ts,memory/*}`; console: `plugins/ruflo-console`

## 1. Context

Two limits remained after ADR-454..457.

1. The intelligence hook never logged which entries it surfaced for a prompt. The Learning Lab could show only each session's last recall (ids) and a labelled recomputation against today's ranked file.
2. `memory list` did not print vectors, so the memory map used a hash layout and said "NOT similarity".

## 2. Decision: the recall log

`intelligence.cjs` gains `getContextDetailed(prompt)` (the old `getContext` is now a thin wrapper that returns the same text), `appendRecall(detailed, meta)`, `recallLogEnabled()` and `promptDigest()`. `hook-handler.cjs route` prints the context exactly as before, runs the router, then appends one record, each step in its own try (the printed context is never suppressed by a logging failure, and logging never blocks).

File: `.claude-flow/data/recall-log.jsonl`, one JSON object per line, mode 0600:

```json
{"v":1,"at":1791325954383,"sid":"<claude session id|null>","digest":"<16 hex>",
 "surfaced":[{"id":"mem_ab..","score":0.4321,"rank":1,"cat":"project_notes"}],
 "router":{"agent":"coder","confidence":0.812}}
```

- `digest` = first 16 hex of sha256 of the trimmed prompt. The prompt text is never written. It is a join key: the console hashes the router's recorded task texts (and a typed prompt) the same way, so a record can be matched to a prompt the person still has.
- `surfaced` = the ids, the hook's own score, rank (1-based) and category of what it printed (at most 10; the hook prints 5). No summary, no content, no paths. `cat` is the memory file stem for imported memories.
- `router` is present only when the router answered. `sid` comes from the hook's stdin JSON (`session_id`), `null` when absent (never the string "undefined").
- Masking: ids, categories, session id and agent pass through a mask that replaces credential-shaped tokens (`sk-`, `ghp_`, `gho_`, `xox*-`, `AKIA`, `eyJ` prefixes, and any 40+ character base64-ish run) with `[masked]`, and strips control characters.
- Bounded and rotating: capped at 1000 records or 1 MiB, whichever is hit first. Past the cap the newest half is kept, rewritten through a temp file and renamed so a reader never sees a half file. The 1 MiB cap (not 2 MB) is deliberate: the console's `READ_MAX` is 2,000,000 bytes, and a log that is unreadable exactly when it is fullest is worse than one that rotates earlier. Lines are only counted once the file passes 100 KiB (a record is at least ~140 bytes, so below that the record cap cannot be exceeded): the common append is one `stat` and one `appendFileSync`.
- Fail-open: every step is in try/catch and returns false on failure.

### Privacy decision: default ON

Default **on**, off with `RUFLO_RECALL_LOG=0` (also `false`, `off`, `no`) or `{"recallLog":{"enabled":false}}` in `claude-flow.config.json`. The env var wins when set (an explicit `1` re-enables over the file). Justification, checked against the code: the log is local, mode 0600, holds no prompt text and no values; the repo already keeps strictly more sensitive material by default (`.claude-flow/routing-outcomes.json` stores raw task text via `hooks post-task` / `model-outcome`, `pending-insights.jsonl` stores edited file paths, `sessions/*.json` store the matched ids). A digest-only log is less sensitive than all of those. Two honest caveats, stated here rather than hidden:

- ranked ids are slugified memory headings (`mem-project_x-swarm-execution-is-a-no-op---r-4`), so "ids only" still reveals the titles of the user's own memory notes, on the user's own disk;
- a 16-hex digest of a short or predictable prompt can be confirmed by anyone who can guess the prompt (a dictionary check). It cannot be reversed, and anyone who can read the log can already read `routing-outcomes.json`.

Not logged when the `route` event is owned by a mod (`RUFLO_MODS_OWNS=route`): the script does not run then, and the mod's own route does not call `getContext`. Not logged when nothing surfaced.

### Shipped-file and signing note

Both copies of `intelligence.cjs` and `hook-handler.cjs` are byte-identical (the parity test passes). They are covered by `helpers.manifest.json`, which is signed with a key this change does not hold. **The manifest is not re-signed here**; until the integrator signs at release, `__tests__/helper-signing.test.ts` "its hashes match the actual shipped helper files" fails by design (it is the gate that proves the helpers were signed after the last edit). The `semver.gte` downgrade guard in `helper-refresh.ts` is untouched: a project's older helpers are refreshed from the package only when the package version is not older, so the log appears after a release that carries these helpers. The generated fallback helpers in `helpers-generator.ts` are not changed (the log is a feature of the shipped helpers only).

## 3. Decision: the console

- `data/recall.ts` reads the log through the bounded reader as a regular file (never a link), parses it newest first (malformed lines and records with no valid surfaced item are skipped), and reports a status (`ok`, `missing`, `too-large`). The digest function is a plain-TypeScript sha256 (the engine's module host is not promised `node:crypto`); a spec runs the real helper and requires the same digest and the same fields.
- Learning Lab, **Explain a recall**: with a log, the section lists recorded recalls (time, digest prefix, count, router agent, and the router's task text when its digest matches). Picking one shows exactly what it surfaced with the hook's own scores, resolved to today's ranked summary where the id still exists. A prompt (typed or a past router task) whose digest was recorded is shown as recorded ("not recomputed"). Any other prompt keeps the recomputation with its label. With no log the old text and label are unchanged.
- **Pattern lifecycle**: a `seen` column and a "most surfaced" list use real counts from the log. The lifecycle table is `models.json` (ADR-456 section 1) and the hook recalls from `ranked-context.json`, which has different ids, so most rows read 0. The view says how many rows appear in the log (`N of M`) rather than implying a join that does not exist.
- **Memory health**: "stale" can now mean "not surfaced by the hook for N days", with these rules, each stated in the view:
  - the log speaks for an entry only if the log reaches back at least `STALE_DAYS` (30) and the entry's key equals a ranked id or its category (the names the hook can recall at all); such an entry is stale if the hook has not surfaced it inside the window and it was not updated inside it (`accessCount` has no time, so it does not vote);
  - every other entry keeps the documented rule (accessCount 0 and not updated for 30 days);
  - each stale row says which rule judged it (`by recall log` or `by access count`), and the rule line gives the counts per rule and how many entries the log could judge.
  - Two different "recall" notions are named: `accessCount` counts retrievals by `memory retrieve`/search, the log counts hook surfacing.
  - The join is by exact key; if no memory key matches a ranked name, `logChecked` is 0 and the access-count rule applies to all (the view says the log is not used).

## 4. Decision: vectors

Path: `memory list --format json --embeddings`. `listEntries` / `bridgeListEntries` (both backends already `SELECT embedding`) gain `includeEmbedding`. Each row then carries `embeddingQ8: {dims, scale, b64}`: the stored vector as int8 with one per-vector scale (`scale = max|v|/127`), base64. Read-only: no write, no content (the `content` field is still absent). Bounded: at most 500 rows (`MAX_LIST_EMBEDDINGS`) per call and 4096 dimensions per vector; a malformed, non-finite, constant-zero or over-long vector yields no field (never a guess). `--embeddings` has no effect without `--format json`.

Why int8 and not floats: the console reads CLI stdout through `jsonAfter`, which parses at most 1,000,000 characters. 500 x 384 as 4-decimal JSON floats is about 1.3 MB; as base64 float32 about 1.07 MB; both would silently truncate and the map would fall back to hash with no error. As int8 it is 326 KB (measured) and the reconstruction cosine is above 0.9999, far more than a 2D random projection needs. A spec asserts the 500 x 384 output fits under the cap.

Console: `memmapProbe` adds `--embeddings`; `mapEntriesOf` decodes `embeddingQ8` (and still accepts a plain `embedding` array). An older CLI ignores the unknown flag (`commandParser` allows unknown flags), prints no vectors, and the map stays in the hash layout with its label: graceful, tested. `drawable()` makes the map useful when a store has some un-embedded entries: if at least half have a vector it draws only those in the embedding layout and the title says "N without a vector not drawn"; below half it keeps every entry in the hash layout. The "NOT similarity" label is dropped only when stored vectors drove the layout; the embedding label says the vectors are read from the store and that a 2D projection loses most of the distance.

Memory health adds **similar by meaning**: clusters of entries whose stored vectors have cosine >= 0.97 (union of pairs, at most 500 entries with a vector, cap and counts shown), computed only when the map's probe actually returned vectors; otherwise one line says it was not checked and why. It never runs on the 1000-entry health list (that probe does not ask for vectors).

### Performance (`scripts/bench-memmap.mjs`, 500 entries x 384 dims, median of 10)

| step | cost |
|---|---|
| parse + decode 326 KB of stdout (per probe result, 60 s cadence) | 6.8 ms |
| layout (cold, per probe result) | 0.26 ms |
| picture, whole frame warm | 0.17 ms / 0.32 ms |
| similar-by-meaning (124,750 pairs, once per probe result) | 33 ms median, 80 ms p99 |

Per-frame cost is unchanged (layouts and the cluster report are cached by the probe result's array identity). Per-refresh cost is bounded by the 500-row cap on the CLI side and the console side.

## 5. What remains unavailable

- Log entries before this change do not exist; sessions and routing outcomes are still the only history for older recalls.
- The log carries ranked-context ids only; neural `models.json` rows (and the ReasoningBank `patterns.json`) are different stores and are not in it.
- Memory-health's log rule applies only to entries whose key equals a ranked id or category; other namespaces have no recall history at all, and stay on the access-count rule.
- Mod-owned `route` does not log.
- The map shows at most 500 entries (unchanged), and similar-by-meaning at most 500 of those.

## 6. Tests

`v3/@claude-flow/cli/__tests__/adr-472-recall-log.test.ts` (8, runs the real shipped helpers, including `hook-handler route` end to end), `adr-472-memory-list-embeddings.test.ts` (4: encoder, `listEntries` on a fixture store with real ONNX vectors, bounds, read-only, the `list` command with and without `--embeddings`); console `recall-log.spec.ts` (11), `memmap-vectors.spec.ts` (10), `memory-health-recall.spec.ts` (10) plus the amended existing specs. Mutation checks performed: masking regex, opt-out guard, digest, rotation floor, q8 sign extension, log window guard, log rule, half-drawable threshold, digest match; each is caught.

## 7. Rollback

Console: revert the commit's `plugins/ruflo-console` changes; the probe then stops passing `--embeddings` and nothing else depends on the log. CLI: `--embeddings` and `includeEmbedding` are additive (no flag, no change). Helpers: set `RUFLO_RECALL_LOG=0` to stop logging immediately without a release, delete `.claude-flow/data/recall-log.jsonl` to drop the data; reverting `intelligence.cjs` / `hook-handler.cjs` restores the old behaviour (`getContext` is unchanged for every other caller).
