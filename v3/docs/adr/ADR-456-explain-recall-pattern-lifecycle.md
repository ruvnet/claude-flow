# ADR 456: Explain a recall, and the pattern lifecycle, in the Learning Lab

Status: Accepted

Date: 2026-10-05

Builds on: ADR-404 (ruflo as a mod), ADR-444 (Claude controls the console), the Learning Lab (`views/neural.ts`)

## 1. Context

The Learning Lab says how much ruflo has learned (counts from `neural/stats.json`) but not what the intelligence hook actually pulled into a prompt, nor which stored patterns are earning their place. The request: pick a past prompt and see which memories and patterns it surfaced, with scores; and a lifecycle table (age, uses, last success, rank) with promote and prune as confirm-card commands.

The real sources were read before designing. They do not hold what the request assumes:

| Source | What it holds | Console can read it? |
|---|---|---|
| `.claude/helpers/intelligence.cjs` `getContext` | prints `[INTELLIGENCE] ... (score) summary [rank #n]` into the prompt; **writes only `context.lastMatchedPatterns` (ids)** to `.claude-flow/sessions/current.json`; each ended session's own `session-<ms>.json` keeps the same `context` | sessions: yes (small) |
| `.claude-flow/data/ranked-context.json` | the entries the hook recalls from: `summary`, `category`, `confidence`, `pageRank`, `accessCount`, `words` (no created or last-used time) | yes (1.2 MB) |
| `.claude-flow/routing-outcomes.json` | `task` text, agent, success, quality, timestamp: the only prompt-like text any hook file keeps | yes |
| `.claude-flow/neural/models.json` | the store `neural_patterns {action:delete}` and `neural_compress {method:prune}` act on: `id, name, type, content, metadata.verdict, createdAt, usageCount`; no confidence, no last-used time | yes (120 KB) |
| `.claude-flow/neural/patterns.json` | the ReasoningBank (`confidence`, `usageCount`, `lastUsedAt`, `metadata.success`) | **no: 3.9 MB here, over `READ_MAX` (2 MB)**; no per-pattern verb acts on it either |

Consequences that shape the decision:

1. The hook logs **neither the prompt nor the scores it surfaced**. "Which memories did this past prompt surface, with scores" cannot be read back; it can only be recomputed.
2. There are **three stores** and each verb touches exactly one: the hook recalls from `ranked-context.json` (derived from auto-memory), the neural verbs act on `models.json`, and `patterns.json` is a third the console cannot read. A prune button on a row must act on the file the row came from, so the lifecycle table is built from `models.json` only.
3. `usageCount` is 0 for every pattern in `models.json` on the reference machine; the table shows that rather than hide it.

## 2. Decision

**Explain a recall** (section in the Learning Lab, source `ranked-context.json`, `sessions/`, `routing-outcomes.json`):

- *Recorded*: the newest session's last recall, each id resolved against the ranked file to its summary (80 characters, the clip the hook itself prints into every prompt), category, confidence, pageRank, accessCount and the hook's own sort key (`0.6 pageRank + 0.4 confidence`, labelled "rank", not "match score"). Older sessions are listed as id counts with when they ended.
- *Recomputed*: pick one of the router's past task texts, or type a prompt, and the console re-scores it against today's ranked file with the hook's formula, copied (`tokenize`, trigrams, jaccard, `0.6 match + 0.4 pageRank`, threshold 0.05, top 5, the same stop words), showing the parts of each score. It is labelled "what would surface now: recomputed, not what surfaced then". A spec runs the real `intelligence.cjs` against a fixture and requires the same two-decimal scores, so drift in the copy is caught.

**Pattern lifecycle** (section, source `models.json`): a table of pattern id, type, age (`createdAt`), uses (`usageCount`), verdict (`metadata.verdict`: the verdict at creation, not "last success") and name, ordered most-used then oldest. Each row has promote and prune; one bulk row prunes the never-used.

- *Prune* (one): `neural_patterns {action:"delete", patternId}`. Deletes for good; the confirm card says so.
- *Prune* (bulk): `neural_compress {method:"prune", targetSize:1}`, which removes patterns with `usageCount` below 1. The label carries the count the file says now.
- *Promote*: ruflo has no verb that raises a stored pattern's rank in place. The documented promotion path is `agentdb_feedback {success:true, quality:0.95, patterns:[<its text>]}`, which (memory-bridge `bridgeRecordFeedback`) stores the text in the ReasoningBank and, because quality is at least 0.9, creates a reusable skill. It **adds**; the original row is unchanged. The note on the card says exactly that.
- All three are fixed argv through `mcp exec -p <one JSON element>` (no shell), ids are validated to `[A-Za-z0-9_-]{1,80}`, all are `writes` cost so they always ask first, and their ids start `nn-` so the Learning Lab's existing result panel shows them.

**Omitted, and why** (the rule: a field the files do not record is not drawn):

- *rank* and *last use* in the lifecycle table: `models.json` records neither. (`ranked-context` has a real rank, but those rows are a different store and a prune would not touch them.)
- *last success*: only a creation-time verdict is recorded, so the column is named "verdict".
- *the surfaced list of a past prompt*: not recorded; see section 1.
- *`patterns.json`*: not read (too large); the section says so and says no per-pattern verb acts on it.

## 3. Consequences

- The console learns four reads: `readRecall` (in `data/recall.ts`) reads the ranked file, `models.json`, `routing-outcomes.json` (all through the bounded, cached reader) and at most 8 newest `session-*.json` files (each capped at 100 KB, regular files only); it stats `patterns.json` and never reads it. Nothing is read from `current.json`, auto-memory content, or any key file.
- Summaries shown are at most 80 characters of what the hook already prints on every prompt. Words arrays stay in memory only for scoring; nothing is written anywhere.
- Mutations exist only as the three confirm-card commands above.
- The ranked file is parsed again only when its text changes.
- Known limits: the typed prompt is held in a view-local variable and redrawn with `act.refresh()` (the integrator may move it into `State`); the recorded recall is only each session's last one; the recompute reflects today's ranked file, not the file as it was.

## 4. Test and benchmark plan

`tests/recall.spec.ts` (pure, under a second): parsers on fixtures shaped like the real files with embeddings present; the scoring against hand-computed 0.6/0.4 weights; **parity with the real `intelligence.cjs` `getContext`** on the same fixture; argv for all three commands and their refusals (ids that are not safe, a pattern the store does not hold, an empty store); the rows' honest empty states (probe not wired, file missing or too large) and their notes about what is not recorded; the reader against a fake file system (newest sessions only, `patterns.json` and `current.json` never read, never rejects). Benchmark: scoring 239 entries of about 400 words each is a single pass of set intersections, in the same budget as the hook's own 15 ms.

## 5. Rollback

The three new files (`hooks/data/recall.ts`, `hooks/recall.ts`, `hooks/views/recall-rows.ts`) and the two `section` calls in `views/neural.ts` are the whole change; reverting the commit removes the feature. It adds no state, no stored files and no setting. Pruned patterns cannot be restored from the console: that is stated on each card.
