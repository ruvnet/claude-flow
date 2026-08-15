# Adversarial Critique — Agent-Count Complexity Gate (2026-08-14)

Independent critic (separate subagent from the candidate author) re-read the diff via
`git diff HEAD`, the pre-patch code via `git show HEAD:...`, the full benchmark script, and
the receipt. Re-ran the benchmark independently and hand-traced individual rows.

## Checklist

- **Weakened benchmark / altered gold answers / cherry-picked tasks / exploited evaluator?**
  No — deterministic pure-function comparison, no gold answers to game. One real (non-malicious)
  corpus construction defect was found (see Caveat 1) and has since been fixed.
- **Cost / latency / quality regression, or work merely moved elsewhere?**
  Change is a `Set.has()` + `Array.slice(0,1)` — negligible. Tool is advisory-only
  (`hooksPreTask` returns metadata; does not spawn or gate agents), bounding blast radius.
- **Undocumented cache / modified thresholds / leaked expected answers?**
  No. `loadRoutingOutcomes` stub returns `[]`, documented and identical in both baseline and
  candidate paths. No thresholds altered; the gate is a fixed `complexity !== 'low'` check.
- **Is the baseline byte-faithful to HEAD?**
  Yes — confirmed directly against `git show HEAD:...`. Identical `KEYWORD_PATTERNS`,
  `extractKeywords`, fallback return, and complexity-computation expression (only its
  *position* moved, not its logic).
- **Statistically meaningful given determinism?**
  Yes — determinism is the correct standard for a pure function; re-ran twice, byte-identical
  output both times, and reproduced the committed receipt exactly.
- **Would the change survive a different workload?**
  Real, bounded risk identified: a short, keyword-matched, non-security task that is
  genuinely nontrivial (e.g. `"refactor the scheduler"`) now gets discounted to one agent,
  whereas before the complexity signal was inert. Severity is bounded because the tool is
  advisory-only and the highest-severity category (security/auth) is explicitly exempted.
  This is a real caveat, not a disqualifying defect (see Caveat 2).
- **Cherry-picked / tuned corpus?**
  No prior commit to diff against (written fresh tonight). Structural inspection found a real
  defect (Caveat 1) that does not inflate the reported result — both the intended and
  actual matched pattern in the collision case were non-protected 3→1 cases.
- **Independent reproduction.** Two independent re-runs (critic's and, after the corpus fix,
  a follow-up re-run) produced byte-identical receipts.
- **Hand-traced rows.** 7 rows hand-traced against the actual patched/baseline logic
  (including `low-authentication`, `low-security-explicit`, `low-auth-explicit`,
  `medium-api`, `high-security`) — all correct, no fabricated or mismatched rows.

## Additional finding (not on the standard checklist)

`suggestAgentsForTask` has 3 call sites; only the `hooksPreTask` site (the one this candidate
targets) was updated to pass `complexity` through. `hooksExplain` and the routing-tool's
keyword-fallback path each independently compute an equivalent complexity value nearby but
don't wire it through — pre-patch behavior is unchanged there. Not a defect in tonight's
scope; flagged as a follow-up so the fix isn't read as broader than it is.

## Verdict: **CONFIRMED**

## Caveats recorded alongside CONFIRMED

1. **Corpus coverage claim was inaccurate for the low bucket at critique time** — the
   original `"fix ${kw} bug"` template's trailing `"bug"` substring caused 6/17 keywords
   (`fix, feature, swarm, memory, deploy, ci/cd`) to silently match the `'bug'` pattern
   instead of their own. Non-result-inflating (both the intended and actual matches were
   equivalent non-protected 3→1 cases), but the coverage claim needed correcting. **Fixed
   post-critique**: template changed to `"${kw} needs a quick update"`, re-verified —
   17/17 low-bucket rows now match their own labeled keyword; receipt and Darwin lineage
   were regenerated from the corrected corpus (see `receipt-2026-08-14.json`,
   `darwin-lineage-2026-08-14.json` — both reflect the corrected numbers: low-bucket mean
   agent count 2.90→1.48 on n=21, `agentsSavedOnLowBucket: 30`, reduction 49.2%).
2. **Pre-existing complexity heuristic becomes consequential for the first time.** The
   naive `length<50` / `'fix'`/`'simple'` substring heuristic is unchanged tonight, but
   tonight's patch is what makes a misclassification actually reduce agent count for the
   first time. Bounded by advisory-only scope and the security/auth exemption; worth
   monitoring, and a reasonable target for a future, separate improvement — not a blocker.
3. **Fix applies to 1 of 3 `suggestAgentsForTask` call sites** (`hooksPreTask` only).
   `hooksExplain` and the keyword-fallback routing path are unaffected. Follow-up ticket
   recommended, not a blocker for tonight's scoped diff.

## Darwin cross-check (post-critique)

Bounded Darwin exploration (`darwin-lineage-2026-08-14.json`) independently surfaced a
related point: by raw composite fitness alone, a variant that drops the security-role
exemption (`variant-d-no-exemption`) scores marginally higher (0.9542 vs 0.9492) than the
shipped candidate, because the fitness function's 0.10 safety weight under-prices the cost
of a protected-role removal relative to the cost_efficiency it buys. Selection was
corrected to treat "zero safety-role violations" and "zero out-of-scope-bucket discounts"
as hard disqualifying constraints (per the frozen hypothesis's own invariants), not
fitness components to trade off — `variant-d-no-exemption` is excluded from winner
selection on that basis, independent of and consistent with the critic's own conclusion
that the shipped exemption is load-bearing.
