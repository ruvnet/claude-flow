# Equal-mechanics control materializer contract

This increment removes one blocker to the next matched comparison: every declared
arm now sends two ranked descriptors through the same deterministic patch
materializer and produces two content-addressed artifacts. A batch launches one
child for inherited, frozen, static, shuffled and previous, then independently
recomputes every child result in the parent.

All four patch-family templates are researcher-authored from the exposed p-limit
calibration task. The inherited top family reconstructs the published fix exactly;
other arms select whatever their frozen state ranks. Duplicate candidates across
arms are retained rather than perturbed, including the expected generation-zero
frozen/previous degeneracy. This gives equal proposal mechanics, not equal byte
costs, fresh-task outcomes, repair evaluations or evidence of improvement.

The plan, raw bytes, exact base, replacement anchors, replacement bytes, candidate
hashes, Git blobs, descriptor lineage and selected tests are frozen. Plan mutation,
undeclared arms and parent/child disagreement fail closed. No API applies a patch
to a repository or reaches the isolated executor.

## Acceptance

```bash
node --test --test-isolation=none v3/@claude-flow/cli/scripts/rsi/repair/control-materializer.test.mjs
```

Expected: fourteen tests pass. One successful batch charges five materializer child
spawn attempts, observes five completions and retains ten child artifacts. Parent verification independently rebuilds
ten descriptors and ten artifacts, so the batch counts 20 descriptor scores, 20
artifact constructions and 20 replacement operations. Parent reads are observed;
child plan reads are charged upper bounds. Failed and interrupted starts remain
charged with unknown child work.
Repair evaluations, isolated starts, native calls, model
calls and provider spend remain zero; all trial and RSI gates remain closed.
