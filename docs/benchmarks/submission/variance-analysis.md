# Variance Analysis — GAIA L1 Stable Config

## All Measured Runs

| Iter | Config | Questions | Score | Pass Rate | Cost USD | Notes |
|------|--------|-----------|-------|-----------|----------|-------|
| iter49 | Baseline (untuned) | 53 | 21 | 39.6% | ~$2.5 | Reference point |
| iter49b | Baseline rerun | 53 | 23 | 43.4% | ~$2.5 | Variance check |
| iter49.5 | Contrastive (no tools) | 53 | 23 | 43.4% | ~$2.2 | Confirms tool value |
| iter51 | Max turns=24 | 53 | 24 | 45.3% | ~$3.2 | More turns = marginal gain |
| iter53a | T2 narrowed extraction | 53 | 27 | 50.9% | ~$3.0 | **+6 vs baseline** |
| iter53b | T2+T1 attachment tools | 53 | 29 | 54.7% | ~$3.4 | **+2 vs T2-only** |
| iter56 | CodeAgent routing | 53 | 30 | 56.6% | ~$5.5 | Rejected (below stable) |
| iter61b-sonnet | Hybrid routing, no visit_webpage | 53 | 31 | 58.5% | $4.10 | Neutral, not adopted |
| iter60 | Hybrid + visit_webpage | 53 | 28 | 52.8% | $6.12 | visit_webpage drag |
| iter63 | Convergence layer | 53 | 34 | 64.2% | $3.89 | **Current best, n=1** |
| iter63b | Convergence n=2 | 53 | — | — | — | File empty, run pending |

## n=4 T2+T1 Block Statistics

Runs: iter53a (27), iter53b (29), iter56 (30), iter61b-sonnet (31)
Note: These runs vary in configuration, so this is an approximate cross-config distribution.

- Mean: 29.25/53
- Range: 27–31
- Std dev: ±1.6 questions
- 95% CI (approximate): 26–32

## Per-Question Stability Classification

Based on cross-run analysis of available results.

**Stable PASS** (correct in all available runs where question is comparable):
Approximately 22 questions. These are single-hop factual lookups, math problems, or logic puzzles where the model reliably reaches the correct answer.

**Stable FAIL** (wrong in all available runs):
Approximately 12 questions. These include:
- Video analysis requiring frame-level understanding (e.g., "bird species on camera simultaneously")
- Deep multi-hop Wikipedia chains where the path is non-obvious
- Problems requiring reverse-engineering of a specific data structure (e.g., the ping-pong game simulation)
- Empty-answer failures where the model produces no output (8 in iter63)

**Flipping** (inconsistent, correct in some runs but not others):
Approximately 19 questions (35.8% of the question pool). These are the primary source of score variance.

Common flip patterns:
1. **Search availability**: Multi-hop retrieval where the correct intermediate page may or may not be surfaced by the search backend on a given run
2. **Extraction precision**: Questions requiring exact numeric extraction where the model sometimes gets the right page but extracts the wrong number
3. **Format sensitivity**: Questions where the correct answer appears in multiple acceptable forms and the model's normalization varies

## Why We Submit the Mean, Not the Peak

The iter63 score of 34/53 is the current highest observed score (n=1). We do not claim 34/53 as the stable expected score because:

1. With ±1.7 question std dev from prior runs, a score of 36 or 32 is equally plausible
2. The convergence layer reduces but does not eliminate variance (flip questions remain flipping)
3. A single run may have benefited from favorable search result availability
4. HAL requires reproducible results; a peak-lucky score that can't be reproduced is not a valid submission

**Submission policy**: If n=3 mean ≥ 35, submit using the mean as the headline. If n=3 mean is 33–34, report the mean honestly and note that the package fell short of the HAL top-10 entry threshold. If n=3 mean < 33, investigate for regression before submitting.

## Convergence Layer Impact

The convergence layer converts empty-answer failures into partial-answer recoveries.

**iter63 empty answers**: 8 questions returned no model answer (blank string)
- `ec09fa32` — ping-pong game (complex simulation, model gave up)
- `2d83110e` — reversed sentence (turns=1, immediate failure)
- `4b6bb5f7` — Doctor Who script (fetch failed)
- `5cfb274c` — Excel maze (turns=2, model gave up)
- `42576abe` — Tizin language translation (turns=1, immediate failure)
- `65afbc8a` — Excel hex color (turns=2, model gave up)
- `99c9cc74` — MP3 pie recipe (turns=2, attachment failure)
- `e142056d` — Bob's game show (turns=1, complex math)

The convergence layer is designed to prevent these blanks. If iter63b scores higher, the convergence layer is working as expected on these cases. If iter63b scores the same or lower, the blanks are genuine capability gaps that the harness cannot bridge.

## Std Dev and Submission Confidence

- n=1: std dev unknown from single observation
- n=3 (if available): allows ±1 std dev bound with ~68% confidence
- Recommended: do not submit to HAL with n<3 unless schedule forces it

**Current status**: n=1 only (iter63b pending). This package is DRAFT.
