# Router evaluation corpus (ADR-391)

`corpus.jsonl` is the labelled, frozen evaluation set that ADR-391 uses to
compare agent-routing candidates (A current, B MiniLM, C typesafe-hash,
D typesafe-onnx). It contains 197 prompts, each labelled with the one agent a
competent engineering lead would assign.

**Frozen at sha256 `b0c1923b2813b61907304dff56c53d199b709797bfb9600a7c1f496cf0c0bf04`.**
Any edit to `corpus.jsonl` changes this hash. A changed corpus is a new corpus:
earlier receipts don't carry over to it.

## Line format

```json
{"id":"r001","prompt":"...","label":"researcher","split":"dev","trap":false,"source":"issue","note":"why this label"}
```

- `source`: `issue` or `pr` means the prompt paraphrases a real ruflo issue or PR
  title into how a developer would ask for it. `synthetic` means the labeller
  wrote it.
- `trap: true` marks an adversarial case, where a naive keyword match points to
  the wrong agent. Examples: "review the latest issues" is `researcher`,
  "update the test fixtures for the auth API" is `tester`, and "run the
  benchmark" is `performance-engineer`.

## Labels

| label | primary work |
|---|---|
| `coder` | implement a feature or change, fix a bug, write code |
| `tester` | write, extend or fix tests; coverage; test strategy |
| `reviewer` | review a PR, diff or code for quality or correctness |
| `researcher` | investigate, look up, compare, summarise, triage; explain how existing code or issues work |
| `architect` | design, ADRs, API or schema design, module boundaries, refactor planning |
| `security-architect` | security review, vulnerabilities, auth hardening, threat modelling, CVEs |
| `performance-engineer` | profiling, latency and throughput, benchmarks, optimisation |
| `devops` | CI/CD, deploy, Docker, release pipelines, infrastructure |
| `swarm-specialist` | multi-agent, swarm or hive-mind orchestration and coordination |
| `memory-specialist` | memory store, vector index, embeddings, AgentDB, HNSW |
| `none` | not an engineering task: chit-chat, thanks, vague one-word asks, non-software requests |

Tie-break rules, applied the same way to every prompt:

- **Specialist vs `coder`.** A specialist label wins only when the work sits
  squarely in that domain and needs its expertise, such as memory-store
  persistence, HNSW or embeddings internals, auth exposure, or agent coordination.
  When the domain is incidental, the label is `coder`. A wrong exit code in the
  `memory` command, or a hiveId that is never saved, are both `coder`.
- **`reviewer` vs `researcher`.** Reviewing a PR, diff or code is `reviewer`.
  Reading issues, changelogs or docs to report back is `researcher`, even when
  the prompt says "review".
- **Mixed intent.** The label is the primary ask. For example, "profile X" is
  performance work even when X is the memory store. The `note` field says why.

Prompts that two reasonable leads could label differently were rewritten or
dropped.

## Split rule

The split is deterministic and stratified by label. Within each label, sort
rows by `id`. The row at 0-indexed position `i` goes to `dev` if `i % 5` is 0
or 2, and to `test` otherwise. `validate-corpus.mjs` recomputes this rule and
fails if any row disagrees.

- **`dev`** is for tuning thresholds.
- **`test`** decides promotion. Each candidate runs on it once.

Ids were assigned after a seeded shuffle, so they don't encode the label.

## Counts

| label | dev | test | total | traps |
|---|---|---|---|---|
| coder | 12 | 16 | 28 | 12 |
| tester | 8 | 10 | 18 | 10 |
| reviewer | 6 | 9 | 15 | 4 |
| researcher | 10 | 15 | 25 | 11 |
| architect | 7 | 9 | 16 | 3 |
| security-architect | 7 | 9 | 16 | 5 |
| performance-engineer | 7 | 9 | 16 | 5 |
| devops | 7 | 9 | 16 | 3 |
| swarm-specialist | 6 | 7 | 13 | 6 |
| memory-specialist | 6 | 9 | 15 | 3 |
| none | 8 | 11 | 19 | 2 |
| **total** | **84** | **113** | **197** | **64** |

## Blindness rule

The labeller never saw any router's output. No router was run while the corpus
was built: not `hooks route`, `hooks_route`, `router.js`/`router.cjs`, or
typesafe. The labeller also didn't read the router keyword/pattern tables
(`TASK_PATTERNS` in `hooks-tools.ts`, `typesafe-router.ts`) or any routing test
tables. Labels reflect only what the prompt asks for. That independence is what
makes the corpus a fair benchmark, so keep it when extending or relabelling:
whoever labels must not look at router output first.

## Validate

```bash
node validate-corpus.mjs            # defaults to ./corpus.jsonl
```

The validator uses no dependencies. It checks:

- every line is valid JSON
- ids are unique and match `r\d{3}`
- no prompt appears twice
- each label is in the set above
- each split is `dev` or `test`, and matches the split rule
- `trap` is a boolean
- `source` is `issue`, `pr` or `synthetic`
- the total is 180–200
- every label except `none` has at least 8 rows, and `none` has 15–20
- there are at least 30 traps

It prints the counts table above and the file's sha256.
